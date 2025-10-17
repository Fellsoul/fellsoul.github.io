/**
 * @file CameraUIController.js
 * @desc 相机机位UI控制器（单例）：根据相机机位变化统一控制多个UI元素的显示/隐藏和交互状态
 *
 * 重点修复：
 * 1) 只在“第二次进入机位”才显示：原因是 addUIEntity 在控制器当前可见时仍然把新加入的实体隐藏+禁用；
 *    ——已修复：当控制器当前是可见状态(_isVisible=true)时，addUIEntity 会立即恢复原始不透明度、启用输入与层级；
 * 2) 机位匹配条件过窄：原逻辑只在 (positionName==='mainMenu' && config.name===targetCameraPosition) 时显示，容易错过首次切换；
 *    ——已修复：改为更宽松、直观的匹配：positionName===targetCameraPosition 或 config.name/id/camera===targetCameraPosition 均算匹配；
 * 3) 与子插件（如按钮溶解）一致：仍在切换开始事件广播 ui:camera:active，供其他脚本（cameraPositionScope/visibleOnCameras）使用。
 *
 * @pc-attrs
 *   targetCameraPosition:string="main"
 *   uiEntities:entity[]
 *   fadeInDuration:number=0.5
 *   fadeOutDuration:number=0.3
 *   enableDebugLog:boolean=false
 */

/* global pc */
var CameraUIController = pc.createScript('cameraUIController');

// ----- 单例实例（按机位）-----
CameraUIController._instances = {};

// ----- 层级显隐（不限于 Element）-----
CameraUIController.prototype._setHierarchyEnabled = function (entity, enabled) {
    if (!entity) return;
    entity.enabled = !!enabled;
    var children = entity.children || [];
    for (var i = 0; i < children.length; i++) {
        this._setHierarchyEnabled(children[i], enabled);
    }
};

// ----- 属性 -----
CameraUIController.attributes.add('targetCameraPosition', {
    type: 'string',
    default: 'main',
    title: '目标机位名称',
    description: '当相机切换到此机位时显示UI元素（匹配 positionName 或 config.name/id/camera）'
});
CameraUIController.attributes.add('uiEntities', {
    type: 'entity',
    array: true,
    title: 'UI实体数组',
    description: '需要统一控制的UI元素实体列表'
});
CameraUIController.attributes.add('fadeInDuration', {
    type: 'number',
    default: 0.5,
    title: '渐显时长(秒)',
    min: 0.1,
    max: 5.0
});
CameraUIController.attributes.add('fadeOutDuration', {
    type: 'number',
    default: 0.3,
    title: '渐隐时长(秒)',
    min: 0.1,
    max: 5.0
});
CameraUIController.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

// 是否在启动时执行一次“淡出”动画（从当前不透明度 → 0），用于更自然的初始隐藏
CameraUIController.attributes.add('initialFadeOutOnStart', {
    type: 'boolean',
    default: false,
    title: '启动时执行一次淡出'
});

// 交互行为选项：
// A) 淡入开始即开启输入（推荐，首次进入即可 hover/click）
// B) 若保持淡入期间不可点，则在启用输入时对鼠标当前位置下的按钮补发 hover
CameraUIController.attributes.add('enableInputAtFadeStart', {
    type: 'boolean',
    default: true,
    title: '淡入开始启用输入(A)'
});
CameraUIController.attributes.add('simulateHoverOnEnable', {
    type: 'boolean',
    default: true,
    title: '启用输入时补发Hover(B)'
});

// ----- 单例获取（按机位名，可选）-----
CameraUIController.getInstance = function (positionName) {
    if (positionName) {
        return CameraUIController._instances[positionName] || null;
    }
    return null;
};

// ----- 初始化 -----
CameraUIController.prototype.initialize = function () {
    // 设置按机位单例实例
    if (CameraUIController._instances[this.targetCameraPosition]) {
        console.warn('[CameraUIController] Multiple instances detected for position:', this.targetCameraPosition);
        return;
    }
    CameraUIController._instances[this.targetCameraPosition] = this;

    this._isVisible = false;
    this._isTransitioning = false;
    this._activeTweens = []; // 兼容旧命名：不再使用 tween 库
    this._activeFades = [];  // 当前进行中的淡入淡出任务
    this._uiElementsData = []; // 存储UI元素的原始数据

    // 绑定 update 回调用于手动插值
    this._updateHandler = this._updateFades.bind(this);
    this.app.on('update', this._updateHandler, this);

    // 初始化UI元素数据
    this._initializeUIElements();

    // 初始状态：
    // - 若启用 initialFadeOutOnStart：先立即显示为原始不透明度，再执行一次淡出动画
    // - 否则：保持当前逻辑，立即隐藏
    if (this.initialFadeOutOnStart) {
        // 先以“立即模式”设置为可见（恢复原始不透明度与输入匹配可选，但此处不启用输入）
        this._setUIVisibility(true, true);
        // 立即禁用输入，避免初始淡出期间可交互
        this._setInputEnabled(false);
        // 执行一次淡出动画
        this._hideUI();
    } else {
        // 直接立即隐藏
        this._setUIVisibility(false, true);
    }

    // 监听相机过渡事件
    this._setupCameraEvents();

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Position-scoped singleton initialized for position:', this.targetCameraPosition);
        console.log('[CameraUIController] Managing', this.uiEntities.length, 'UI entities');
    }
};

// ----- 初始化UI元素数据 -----
CameraUIController.prototype._initializeUIElements = function () {
    this._uiElementsData = [];

    for (var i = 0; i < this.uiEntities.length; i++) {
        var entity = this.uiEntities[i];
        if (!entity) {
            console.warn('[CameraUIController] uiEntities contains null/undefined at index', i);
            continue;
        }
        // 递归收集该实体及其所有子节点上的 Element 组件
        var collected = this._collectElementData(entity);
        if (!collected.length) {
            console.warn('[CameraUIController] Entity at index', i, 'has no Element components in its hierarchy');
        }
        for (var j = 0; j < collected.length; j++) {
            this._uiElementsData.push(collected[j]);
        }
    }

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Initialized', this._uiElementsData.length, 'UI elements');
    }
};

// 递归收集实体及其所有子节点上的 Element 组件，并记录原始不透明度
CameraUIController.prototype._collectElementData = function (rootEntity) {
    var list = [];
    var stack = [rootEntity];
    while (stack.length > 0) {
        var e = stack.pop();
        if (e.element) {
            list.push({
                entity: e,
                element: e.element,
                originalOpacity: e.element.opacity,
                tween: null
            });
        }
        // 入栈子节点
        var children = e.children;
        for (var c = 0; c < children.length; c++) {
            stack.push(children[c]);
        }
    }
    return list;
};

// ----- 事件监听 -----
CameraUIController.prototype._setupCameraEvents = function () {
    var self = this;

    // 监听相机过渡开始事件
    this.app.on('camera:transition:start', function (positionName, config) {
        if (self.enableDebugLog) {
            console.log('[CameraUIController] Camera transition start:', positionName, config);
        }

        // 广播统一机位事件，供 UI 插件（如按钮溶解）委托监听
        try {
            self.app.fire('ui:camera:active', {
                position: positionName || '',
                name: (config && (config.name || config.id || config.camera)) || ''
            });
        } catch (e) {}

        // 机位匹配逻辑（更宽松直观）：
        // 命中任一条件即可视为“当前是目标机位”
        var cfgName = config && (config.name || config.id || config.camera) || '';
        var isMatch =
            (positionName === self.targetCameraPosition) ||
            (cfgName === self.targetCameraPosition);

        if (isMatch) {
            self._showUI();
        } else {
            self._hideUI();
        }
    }, this);

    // 监听相机过渡完成事件（此处保留以便将来扩展）
    this.app.on('camera:transition:complete', function (params) {
        if (self.enableDebugLog) {
            console.log('[CameraUIController] Camera transition complete');
        }
    }, this);
};

// ----- UI显示控制 -----
CameraUIController.prototype._showUI = function () {
    if (this._isVisible || this._isTransitioning) {
        return;
    }

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Showing UI for position:', this.targetCameraPosition);
    }

    this._isTransitioning = true;
    // 在开始淡入前，确保整棵层级可见（enabled=true），否则元素不会渲染
    for (var r = 0; r < this.uiEntities.length; r++) {
        var rootEnt = this.uiEntities[r];
        if (rootEnt) this._setHierarchyEnabled(rootEnt, true);
    }

    // 停止所有当前动画
    this._stopAllTweens();

    // A) 配置为淡入开始即启用输入
    if (this.enableInputAtFadeStart) {
        this._setInputEnabled(true);
    }

    var completedCount = 0;
    var totalCount = this._uiElementsData.length;
    var self = this;

    if (totalCount === 0) {
        this._isVisible = true;
        this._isTransitioning = false;
        // B) 若未在淡入开始启用输入，则在完成时启用，并可选择补发 hover
        if (!this.enableInputAtFadeStart) {
            this._setInputEnabled(true);
            if (this.simulateHoverOnEnable) this._emitHoverAtMousePosition();
        }
        return;
    }

    // 为每个UI元素创建渐显动画（基于 update 的手动插值）
    for (var i = 0; i < totalCount; i++) {
        var uiData = this._uiElementsData[i];
        this._fadeTo(uiData, uiData.originalOpacity, this.fadeInDuration, 'outSine', function () {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = true;
                self._isTransitioning = false;
                // B) 若未在淡入开始启用输入，则在完成时启用，并可选择补发 hover
                if (!self.enableInputAtFadeStart) {
                    self._setInputEnabled(true);
                    if (self.simulateHoverOnEnable) self._emitHoverAtMousePosition();
                }
                if (self.enableDebugLog) {
                    console.log('[CameraUIController] All UI elements show complete');
                }
            }
        });
    }
};

// ----- 补发 Hover（方案B）-----
// 在启用输入的瞬间，PlayCanvas 不会自动派发 mouseenter。
// 这里根据当前鼠标位置对命中的按钮组件补发一次 mouseenter，以恢复正确的 Hover 态。
CameraUIController.prototype._emitHoverAtMousePosition = function () {
    if (!this.app || !this.app.mouse || !this.app.mouse.isPointerLocked && this.app.mouse.isPointerLocked === undefined) {
        // 若环境无鼠标，跳过
        return;
    }
    var pos = this.app.mouse.getPosition ? this.app.mouse.getPosition() : null;
    if (!pos) return;
    var mx = pos.x, my = pos.y;

    // 从管理的 UI 元素中筛选可交互的根实体（按 entity 去重）
    var seen = {};
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var data = this._uiElementsData[i];
        var ent = data.entity;
        if (!ent || seen[ent.getGuid ? ent.getGuid() : ent._guid || i]) continue;
        seen[ent.getGuid ? ent.getGuid() : ent._guid || i] = true;

        var btn = ent.button;
        var el  = ent.element || data.element;
        if (!btn || !btn.enabled || !el || !el.useInput) continue;

        // 使用 Element.hitTest 检测屏幕坐标是否在元素内
        if (typeof el.hitTest === 'function' && el.hitTest(mx, my)) {
            // 给绑定到 button 组件上的监听派发事件
            if (typeof btn.fire === 'function') {
                btn.fire('mouseenter');
            }
        }
    }
};

CameraUIController.prototype._hideUI = function () {
    if (!this._isVisible && !this._isTransitioning) {
        return;
    }

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Hiding UI for position:', this.targetCameraPosition);
    }

    // 立即禁用输入
    this._setInputEnabled(false);
    this._isTransitioning = true;

    // 停止所有当前动画
    this._stopAllTweens();

    var completedCount = 0;
    var totalCount = this._uiElementsData.length;
    var self = this;

    if (totalCount === 0) {
        this._isVisible = false;
        this._isTransitioning = false;
        return;
    }

    // 为每个UI元素创建渐隐动画（基于 update 的手动插值）
    for (var i = 0; i < totalCount; i++) {
        var uiData = this._uiElementsData[i];
        this._fadeTo(uiData, 0, this.fadeOutDuration, 'inSine', function () {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = false;
                self._isTransitioning = false;
                // 渐隐完成后，整棵层级禁用，保证非 Element 子节点也被隐藏
                for (var r = 0; r < self.uiEntities.length; r++) {
                    var rootEnt = self.uiEntities[r];
                    if (rootEnt) self._setHierarchyEnabled(rootEnt, false);
                }
                if (self.enableDebugLog) {
                    console.log('[CameraUIController] All UI elements hide complete, input disabled');
                }
            }
        });
    }
};

// ----- 停止所有动画 -----
CameraUIController.prototype._stopAllTweens = function () {
    // 旧 tween 清理（兼容）
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var uiData = this._uiElementsData[i];
        if (uiData.tween && uiData.tween.stop) {
            uiData.tween.stop();
            uiData.tween = null;
        }
    }
    // 取消所有进行中的淡入淡出
    for (var j = 0; j < this._activeFades.length; j++) {
        this._activeFades[j].cancelled = true;
    }
    this._activeFades.length = 0;
};

// ----- 基于 update 的淡入淡出实现 -----
CameraUIController.prototype._fadeTo = function (uiData, targetOpacity, duration, easing, onComplete) {
    var startOpacity = uiData.element.opacity;
    var d = Math.max(0.0001, duration);
    var fade = {
        element: uiData.element,
        start: startOpacity,
        end: targetOpacity,
        time: 0,
        duration: d,
        easing: easing || 'linear',
        cancelled: false,
        onComplete: onComplete || null
    };
    this._activeFades.push(fade);
};

CameraUIController.prototype._ease = function (t, mode) {
    // t: [0,1]
    if (mode === 'inSine') {
        return 1 - Math.cos((t * Math.PI) / 2);
    }
    if (mode === 'outSine') {
        return Math.sin((t * Math.PI) / 2);
    }
    // 默认线性
    return t;
};

CameraUIController.prototype._updateFades = function (dt) {
    if (!this._activeFades.length) return;
    // 拷贝数组，允许回调中修改原数组
    var fades = this._activeFades.slice();
    for (var i = 0; i < fades.length; i++) {
        var f = fades[i];
        if (f.cancelled) continue;
        f.time += dt;
        var t = Math.min(1, f.time / f.duration);
        var k = this._ease(t, f.easing);
        var value = f.start + (f.end - f.start) * k;
        f.element.opacity = value;
        if (t >= 1) {
            f.cancelled = true;
            // 从活动列表移除
            var idx = this._activeFades.indexOf(f);
            if (idx !== -1) this._activeFades.splice(idx, 1);
            if (f.onComplete) f.onComplete();
        }
    }
};

// ----- 输入控制 -----
CameraUIController.prototype._setInputEnabled = function (enabled) {
    // 为所有UI元素设置输入状态
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var uiData = this._uiElementsData[i];
        var entity = uiData.entity;

        // 设置元素本身的输入状态
        if (uiData.element) {
            uiData.element.useInput = enabled;
        }

        // 如果有button组件，也要控制其enabled状态
        if (entity.button) {
            entity.button.enabled = enabled;
        }

        // 递归设置子元素的输入状态
        this._setChildrenInputEnabled(entity, enabled);
    }
};

CameraUIController.prototype._setChildrenInputEnabled = function (entity, enabled) {
    var children = entity.children;
    for (var i = 0; i < children.length; i++) {
        var child = children[i];

        // 设置子元素的输入状态
        if (child.element) {
            child.element.useInput = enabled;
        }
        if (child.button) {
            child.button.enabled = enabled;
        }

        // 递归处理子元素的子元素
        this._setChildrenInputEnabled(child, enabled);
    }
};

// ----- 可见性控制 -----
CameraUIController.prototype._setUIVisibility = function (visible, immediate) {
    if (immediate) {
        for (var i = 0; i < this._uiElementsData.length; i++) {
            var uiData = this._uiElementsData[i];
            uiData.element.opacity = visible ? uiData.originalOpacity : 0;
        }
        this._isVisible = visible;
        this._setInputEnabled(visible);
        // 立即模式下同时处理整棵层级显隐
        for (var r = 0; r < this.uiEntities.length; r++) {
            var rootEnt = this.uiEntities[r];
            if (rootEnt) this._setHierarchyEnabled(rootEnt, !!visible);
        }
    } else {
        if (visible) {
            this._showUI();
        } else {
            this._hideUI();
        }
    }
};

// ----- 公共方法 -----
CameraUIController.prototype.show = function () {
    this._showUI();
};

CameraUIController.prototype.hide = function () {
    this._hideUI();
};

CameraUIController.prototype.isVisible = function () {
    return this._isVisible;
};

CameraUIController.prototype.isTransitioning = function () {
    return this._isTransitioning;
};

// ----- 添加/移除UI元素 -----
CameraUIController.prototype.addUIEntity = function (entity) {
    if (!entity) {
        console.warn('[CameraUIController] Cannot add null/undefined entity');
        return false;
    }
    // 递归收集
    var collected = this._collectElementData(entity);
    if (!collected.length) {
        console.warn('[CameraUIController] Cannot add entity: no Element components found in hierarchy');
        return false;
    }
    for (var i = 0; i < collected.length; i++) {
        this._uiElementsData.push(collected[i]);
    }

    // 关键修复：根据当前控制器可见状态决定如何处理新加入实体
    if (this._isVisible) {
        // 控制器当前可见：立即恢复原始不透明度、启用输入、启用整棵层级
        for (var j = 0; j < collected.length; j++) {
            collected[j].element.opacity = collected[j].originalOpacity;
        }
        this._setEntityInputEnabled(entity, true);
        this._setHierarchyEnabled(entity, true);
    } else {
        // 控制器当前不可见：保持隐藏与禁用
        for (var k = 0; k < collected.length; k++) {
            collected[k].element.opacity = 0;
        }
        this._setEntityInputEnabled(entity, false);
        this._setHierarchyEnabled(entity, false);
    }

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Added UI entity, total elements:', this._uiElementsData.length, ' controller visible:', this._isVisible);
    }

    return true;
};

CameraUIController.prototype._setEntityInputEnabled = function (entity, enabled) {
    if (entity.element) {
        entity.element.useInput = enabled;
    }
    if (entity.button) {
        entity.button.enabled = enabled;
    }
    this._setChildrenInputEnabled(entity, enabled);
};

// ----- 清理 -----
CameraUIController.prototype.destroy = function () {
    // 停止所有动画
    this._stopAllTweens();

    // 移除事件监听
    this.app.off('camera:transition:start', null, this);
    this.app.off('camera:transition:complete', null, this);
    // 解绑 update 回调
    if (this._updateHandler) {
        this.app.off('update', this._updateHandler, this);
        this._updateHandler = null;
    }

    // 清除按机位单例实例
    if (CameraUIController._instances && this.targetCameraPosition && CameraUIController._instances[this.targetCameraPosition] === this) {
        delete CameraUIController._instances[this.targetCameraPosition];
    }

    if (this.enableDebugLog) {
        console.log('[CameraUIController] Singleton destroyed for position:', this.targetCameraPosition);
    }
};
