/**
 * @file CameraUIController.js
 * @desc 相机机位UI控制器（单例）：根据相机机位变化统一控制多个UI元素的显示/隐藏和交互状态
 * @pc-attrs
 *   targetCameraPosition:string="main", uiEntities:entity[], fadeInDuration:number=0.5, fadeOutDuration:number=0.3,
 *   enableDebugLog:boolean=false
 */
/* global pc */
var CameraUIController = pc.createScript('cameraUIController');

// ----- 单例实例字典 -----
CameraUIController._instances = {};

// ----- 属性 -----
CameraUIController.attributes.add('targetCameraPosition', { 
    type: 'string', 
    default: 'main', 
    title: '目标机位名称',
    description: '当相机切换到此机位时显示UI元素'
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

// ----- 单例获取 -----
CameraUIController.getInstance = function (positionName) {
    return CameraUIController._instances[positionName] || null;
};

CameraUIController.getAllInstances = function () {
    return CameraUIController._instances;
};

// ----- 初始化 -----
CameraUIController.prototype.initialize = function () {
    // 单例模式：每个机位只能有一个控制器实例
    var existingControllers = CameraUIController._instances || {};
    if (existingControllers[this.targetCameraPosition]) {
        console.warn('[CameraUIController] Controller for position "' + this.targetCameraPosition + '" already exists.');
        return;
    }
    
    // 初始化单例实例字典
    if (!CameraUIController._instances) {
        CameraUIController._instances = {};
    }
    CameraUIController._instances[this.targetCameraPosition] = this;
    
    this._isVisible = false;
    this._isTransitioning = false;
    this._activeTweens = []; // 存储活跃的动画回调
    this._uiElementsData = []; // 存储UI元素的原始数据
    this._isUIManagerBlocking = false; // UIManager 是否在阻止显示（typewriter/first_time_intro）
    this._shouldBeVisibleAfterUnblock = false; // 解除阻止后是否应该显示 UI
    
    // 初始化UI元素数据
    this._initializeUIElements();
    
    // 初始状态：隐藏所有UI元素
    this._setUIVisibility(false, true);
    
    // 监听 UIManager 状态变化
    this._setupUIManagerEvents();
    
    // 监听相机过渡事件
    this._setupCameraEvents();
    
    if (this.enableDebugLog) {
        console.log('[CameraUIController] Controller initialized for position:', this.targetCameraPosition);
        console.log('[CameraUIController] Managing', this.uiEntities.length, 'UI entities');
        console.log('[CameraUIController] Available positions: main, moai, flower, trophy, ocean');
    }
};

// ----- 初始化UI元素数据 -----
CameraUIController.prototype._initializeUIElements = function () {
    this._uiElementsData = [];
    
    for (var i = 0; i < this.uiEntities.length; i++) {
        var entity = this.uiEntities[i];
        if (!entity || !entity.element) {
            console.warn('[CameraUIController] Entity at index', i, 'has no Element component');
            continue;
        }
        
        this._uiElementsData.push({
            entity: entity,
            element: entity.element,
            originalOpacity: entity.element.opacity,
            tween: null
        });
    }
    
    if (this.enableDebugLog) {
        console.log('[CameraUIController] Initialized', this._uiElementsData.length, 'UI elements');
    }
};

// ----- UIManager 事件监听 -----
CameraUIController.prototype._setupUIManagerEvents = function () {
    var self = this;
    
    // 监听 UIManager 状态变化
    this.app.on('ui:state_changed', function (eventData) {
        if (!eventData || !eventData.to) return;
        
        var state = eventData.to;
        
        // typewriter 或 first_time_intro 状态时阻止UI显示
        if (state === 'typewriter' || state === 'first_time_intro') {
            // 记录当前是否应该显示（在被阻止前的状态）
            self._shouldBeVisibleAfterUnblock = self._isVisible || self._isTransitioning;
            self._isUIManagerBlocking = true;
            
            // 如果当前UI可见，强制隐藏
            if (self._isVisible) {
                self._hideUI();
            }
            
            if (self.enableDebugLog) {
                console.log('[CameraUIController] UIManager blocking UI, state:', state, 
                            'shouldBeVisibleAfterUnblock:', self._shouldBeVisibleAfterUnblock);
            }
        } else if (state === 'normal') {
            self._isUIManagerBlocking = false;
            
            if (self.enableDebugLog) {
                console.log('[CameraUIController] UIManager unblocking UI, shouldBeVisibleAfterUnblock:', 
                            self._shouldBeVisibleAfterUnblock);
            }
            
            // 如果解除阻止前 UI 是可见的，现在重新显示
            if (self._shouldBeVisibleAfterUnblock && !self._isVisible) {
                if (self.enableDebugLog) {
                    console.log('[CameraUIController] Restoring UI visibility after unblock');
                }
                self._showUI();
            }
            
            // 重置标志
            self._shouldBeVisibleAfterUnblock = false;
        }
    }, this);
};

// ----- 事件监听 -----
CameraUIController.prototype._setupCameraEvents = function () {
    var self = this;
    
    // 监听相机过渡开始事件
    this.app.on('camera:transition:start', function (positionName, config) {
        if (self.enableDebugLog) {
            console.log('[CameraUIController] Camera transition start:', positionName);
        }
        
        // 检查是否是目标机位
        if (positionName === 'mainMenu' && config && config.name === self.targetCameraPosition) {
            self._shouldBeVisibleAfterUnblock = true; // 记录应该显示
            self._showUI();
        } else {
            self._shouldBeVisibleAfterUnblock = false; // 记录不应该显示
            self._hideUI();
        }
    }, this);
    
    // 监听相机过渡完成事件
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
    
    // 检查 UIManager 是否在阻止UI显示
    if (this._isUIManagerBlocking) {
        if (this.enableDebugLog) {
            console.log('[CameraUIController] UIManager is blocking, skip showing UI for:', this.targetCameraPosition);
        }
        return;
    }
    
    if (this.enableDebugLog) {
        console.log('[CameraUIController] Showing UI for position:', this.targetCameraPosition);
    }
    
    this._isTransitioning = true;
    
    // 停止所有当前动画
    this._stopAllTweens();
    
    var completedCount = 0;
    var totalCount = this._uiElementsData.length;
    var self = this;
    
    // 为每个UI元素创建渐显动画
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var uiData = this._uiElementsData[i];
        
        // 检查实体是否存在
        if (!uiData.entity) {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = true;
                self._isTransitioning = false;
                self._setInputEnabled(true);
            }
            continue;
        }
        
        this._tweenOpacity(uiData.entity, uiData.element.opacity, uiData.originalOpacity, this.fadeInDuration * 1000, function() {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = true;
                self._isTransitioning = false;
                self._setInputEnabled(true);
                
                if (self.enableDebugLog) {
                    console.log('[CameraUIController] All UI elements show complete, input enabled');
                }
            }
        });
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
    
    // 为每个UI元素创建渐隐动画
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var uiData = this._uiElementsData[i];
        
        // 检查实体是否存在
        if (!uiData.entity) {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = false;
                self._isTransitioning = false;
            }
            continue;
        }
        
        this._tweenOpacity(uiData.entity, uiData.element.opacity, 0, this.fadeOutDuration * 1000, function() {
            completedCount++;
            if (completedCount >= totalCount) {
                self._isVisible = false;
                self._isTransitioning = false;
                
                if (self.enableDebugLog) {
                    console.log('[CameraUIController] All UI elements hide complete, input disabled');
                }
            }
        });
    }
};

// ----- 自定义Tween动画（仿照UIManager） -----
CameraUIController.prototype._tweenOpacity = function (entity, from, to, durationMs, onComplete) {
    var self = this;
    var t = 0, dur = Math.max(0, durationMs|0);
    
    // 设置初始透明度
    this._setEntityOpacity(entity, from);
    
    if (dur <= 0) {
        this._setEntityOpacity(entity, to);
        if (onComplete) onComplete();
        return;
    }
    
    // 用 update 驱动一次性 tween
    var dtFunc = function (dt) {
        t += dt * 1000;
        var k = Math.min(1, t / dur);
        var currentOpacity = from + (to - from) * k;
        
        // 递归设置实体及其子节点的透明度
        self._setEntityOpacity(entity, currentOpacity);
        
        if (k >= 1) {
            // 从活跃动画列表中移除
            var index = self._activeTweens.indexOf(dtFunc);
            if (index > -1) {
                self._activeTweens.splice(index, 1);
            }
            self.app.off('update', dtFunc);
            if (onComplete) onComplete();
        }
    };
    
    // 添加到活跃动画列表
    this._activeTweens.push(dtFunc);
    this.app.on('update', dtFunc);
};

// ----- 递归设置实体透明度 -----
CameraUIController.prototype._setEntityOpacity = function (entity, opacity) {
    if (!entity) {
        return;
    }
    
    // 设置当前实体的透明度
    if (entity.element) {
        entity.element.opacity = opacity;
    }
    
    // 递归设置所有子实体的透明度
    if (entity.children) {
        var children = entity.children;
        for (var i = 0; i < children.length; i++) {
            this._setEntityOpacity(children[i], opacity);
        }
    }
};

// ----- 停止所有动画 -----
CameraUIController.prototype._stopAllTweens = function () {
    // 停止所有活跃的动画
    for (var i = 0; i < this._activeTweens.length; i++) {
        this.app.off('update', this._activeTweens[i]);
    }
    this._activeTweens = [];
};

// ----- 输入控制 -----
CameraUIController.prototype._setInputEnabled = function (enabled) {
    // 为所有UI元素设置输入状态
    for (var i = 0; i < this._uiElementsData.length; i++) {
        var uiData = this._uiElementsData[i];
        var entity = uiData.entity;
        
        // 检查实体是否存在或已被销毁
        if (!entity || !entity.element) {
            continue;
        }
        
        // 设置元素本身的输入状态
        try {
            if (entity.element && entity.element.useInput !== undefined) {
                entity.element.useInput = enabled;
            }
        } catch (e) {
            // 元素可能已被销毁
            continue;
        }
        
        // 如果有button组件，也要控制其enabled状态
        try {
            if (entity.button && entity.button.enabled !== undefined) {
                entity.button.enabled = enabled;
            }
        } catch (e) {
            // button 可能已被销毁
        }
        
        // 递归设置子元素的输入状态
        this._setChildrenInputEnabled(entity, enabled);
    }
};

CameraUIController.prototype._setChildrenInputEnabled = function (entity, enabled) {
    if (!entity || !entity.children) {
        return;
    }
    
    var children = entity.children;
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        
        if (!child) {
            continue;
        }
        
        // 设置子元素的输入状态
        try {
            if (child.element && child.element.useInput !== undefined) {
                child.element.useInput = enabled;
            }
        } catch (e) {
            // 元素可能已被销毁
        }
        
        try {
            if (child.button && child.button.enabled !== undefined) {
                child.button.enabled = enabled;
            }
        } catch (e) {
            // button 可能已被销毁
        }
        
        // 递归处理子元素的子元素
        try {
            this._setChildrenInputEnabled(child, enabled);
        } catch (e) {
            // 子元素可能已被销毁
        }
    }
};

// ----- 可见性控制 -----
CameraUIController.prototype._setUIVisibility = function (visible, immediate) {
    if (immediate) {
        for (var i = 0; i < this._uiElementsData.length; i++) {
            var uiData = this._uiElementsData[i];
            
            // 检查实体是否存在
            if (!uiData.entity) {
                continue;
            }
            
            var targetOpacity = visible ? uiData.originalOpacity : 0;
            // 递归设置实体及其子节点的透明度
            this._setEntityOpacity(uiData.entity, targetOpacity);
        }
        this._isVisible = visible;
        this._setInputEnabled(visible);
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
    if (!entity || !entity.element) {
        console.warn('[CameraUIController] Cannot add entity without Element component');
        return false;
    }
    
    this._uiElementsData.push({
        entity: entity,
        element: entity.element,
        originalOpacity: entity.element.opacity,
        tween: null
    });
    
    // 如果当前不可见，立即隐藏新添加的元素
    if (!this._isVisible) {
        this._setEntityOpacity(entity, 0);
        this._setEntityInputEnabled(entity, false);
    }
    
    if (this.enableDebugLog) {
        console.log('[CameraUIController] Added UI entity, total:', this._uiElementsData.length);
    }
    
    return true;
};

CameraUIController.prototype._setEntityInputEnabled = function (entity, enabled) {
    if (!entity) {
        return;
    }
    
    try {
        if (entity.element && entity.element.useInput !== undefined) {
            entity.element.useInput = enabled;
        }
    } catch (e) {
        // 元素可能已被销毁
    }
    
    try {
        if (entity.button && entity.button.enabled !== undefined) {
            entity.button.enabled = enabled;
        }
    } catch (e) {
        // button 可能已被销毁
    }
    
    try {
        this._setChildrenInputEnabled(entity, enabled);
    } catch (e) {
        // 递归调用可能失败
    }
};

// ----- 清理 -----
CameraUIController.prototype.destroy = function () {
    // 停止所有动画
    this._stopAllTweens();
    
    // 清理所有自定义tween动画
    // 注意：不能使用app.off('update')，这会影响其他组件
    
    // 移除事件监听
    this.app.off('ui:state_changed', null, this);
    this.app.off('camera:transition:start', null, this);
    this.app.off('camera:transition:complete', null, this);
    
    // 清除单例实例
    if (CameraUIController._instances) {
        delete CameraUIController._instances[this.targetCameraPosition];
    }
    
    if (this.enableDebugLog) {
        console.log('[CameraUIController] Controller destroyed for position:', this.targetCameraPosition);
    }
};
