/* global pc, GlobalCameraManager */
/**
 * @file UIMobile.js
 * @desc 移动端UI控制：虚拟摇杆、触摸相机控制（基于 Element.screenCorners，坐标无偏移）
 *
 * @pc-attrs
 *   mobileGroup:entity, joystickBase:entity, joystickStick:entity, 
 *   interactButton:entity, jumpButton:entity, respawnButton:entity, soulShoreButton:entity,
 *   joystickMaxRadius:number=0, joystickTouchScale:number=1.0, joystickReturnSpeed:number=8,
 *   cameraSensitivity:number=0.3, cameraZone:string='right',
 *   enableDebugLog:boolean=false
 */

var UIMobile = pc.createScript('uiMobile');

// ===== 属性 =====
UIMobile.attributes.add('mobileGroup', { type: 'entity', title: '移动端UI组(包含背景和摇杆)' });
UIMobile.attributes.add('joystickBase', { type: 'entity', title: '虚拟摇杆底盘' });
UIMobile.attributes.add('joystickStick', { type: 'entity', title: '虚拟摇杆' });

// 移动端按钮（新增）
UIMobile.attributes.add('interactButton', { type: 'entity', title: '互动按钮(Button组件)' });
UIMobile.attributes.add('interactHintText', { type: 'entity', title: '互动提示文字(Text Element)' });
UIMobile.attributes.add('jumpButton', { type: 'entity', title: '跳跃按钮(Button组件)' });
UIMobile.attributes.add('respawnButton', { type: 'entity', title: '重生按钮(Button组件)' });
UIMobile.attributes.add('soulShoreButton', { type: 'entity', title: '心灵彼岸按钮(Button组件)' });

// 在属性定义区加入：
UIMobile.attributes.add('touchCenterOffsetX', {
    type: 'number', default: 0, title: '触摸中心偏移X(px, 右为正)'
  });
  UIMobile.attributes.add('touchCenterOffsetY', {
    type: 'number', default: 0, title: '触摸中心偏移Y(px, 下为正)'
  });

UIMobile.attributes.add('enableOffsetAutoScale', { type: 'boolean', default: true, title: '偏移随分辨率自动缩放' });
UIMobile.attributes.add('referenceScreenWidth',  { type: 'number', default: 830,  title: '参考分辨率宽(用于偏移缩放)' });
UIMobile.attributes.add('referenceScreenHeight', { type: 'number', default: 1080, title: '参考分辨率高(用于偏移缩放)' });
  

UIMobile.attributes.add('joystickMaxRadius', { type: 'number', default: 0, title: '摇杆最大半径(px, 0=自动)' });
UIMobile.attributes.add('joystickReturnSpeed', { type: 'number', default: 8, title: '摇杆回中速度' });

// 速度映射
UIMobile.attributes.add('walkThreshold', { type: 'number', default: 0.3, title: '行走阈值(0~1)' });
UIMobile.attributes.add('runThreshold', { type: 'number', default: 0.7, title: '跑步阈值(0~1)' });

UIMobile.attributes.add('cameraSensitivity', { type: 'number', default: 0.3, title: '相机灵敏度' });
UIMobile.attributes.add('cameraZone', { type: 'string', default: 'right', title: '相机控制区域(left/right/full)' });

UIMobile.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '启用调试日志' });



// ===== 单例 =====
UIMobile._instance = null;

// ===== 初始化 =====
UIMobile.prototype.initialize = function () {
    // 单例管理 - 支持场景切换时的实例替换
    if (UIMobile._instance && UIMobile._instance !== this) {
        console.log('[UIMobile] 检测到场景切换，替换旧实例');
        // 清理旧实例
        var oldInstance = UIMobile._instance;
        if (oldInstance && typeof oldInstance.destroy === 'function') {
            oldInstance.destroy();
        }
    }
    
    UIMobile._instance = this;
    
    // 检测设备类型
    this._isMobile = this._detectMobileDevice();
    this._isPCMode = false;
    
    // 如果是 PC 端，隐藏所有移动端 UI 但仍需监听状态变化
    if (!this._isMobile) {
        if (this.enableDebugLog) console.log('[UIMobile] Not a mobile device, hiding mobile UI elements');
        this._hideMobileUIForPC();
        // 不要 return，继续执行状态监听器绑定
    }
    
    // 通用状态初始化（PC 和移动端都需要）
    // 记录被禁用的mobile节点（用于typewriter状态恢复）
    this._disabledMobileNodes = [];

    // 如果是移动设备，继续初始化移动端组件
    if (this._isMobile) {
        if (this.enableDebugLog) {
            console.log('[UIMobile] Mobile device detected, initializing mobile UI');
        }

        // 状态
        this.joystickActive = false;
        this.joystickTouchId = -1;
        this.joystickStartPos = new pc.Vec2(0, 0);  // 局部中心(0,0)
        this.joystickCurrentPos = new pc.Vec2(0, 0);
        this.joystickDelta = new pc.Vec2(0, 0);     // 归一化(-1~1)
        
        // 移动端按钮状态
        this._interactButtonVisible = false;
        this._currentInteractHint = '';

        this.cameraTouchId = -1;
        this.cameraLastPos = new pc.Vec2(0, 0);
        this.cameraDelta = new pc.Vec2(0, 0);

        this.interactPressed = false;

        // 缓存
        this._tempVec2 = new pc.Vec2();
        this._tempVec3 = new pc.Vec3();

        if (!this._validateEntities()) {
            console.error('[UIMobile] Required entities missing.');
            // 即使验证失败，也要继续绑定状态监听器
        } else {
            // 底盘可接收输入（保留；虽走全局触摸）
            if (this.joystickBase && this.joystickBase.element) {
                this.joystickBase.element.useInput = true;
            }

            // 摇杆杆体居中
            if (this.joystickStick) {
                this.joystickStick.enabled = true;
                this.joystickStick.setLocalPosition(0, 0, 0);
            }

            this._bindTouchEvents();
            
            // 绑定移动端按钮事件
            this._bindMobileButtons();
            
            // 自动禁用mobileGroup中可能阻挡按钮的背景元素
            this._disableMobileGroupBackgroundInput();
            
            // 监听 InteractableHint 事件
            this._onInteractHintShow = this._handleInteractHintShow.bind(this);
            this._onInteractHintHide = this._handleInteractHintHide.bind(this);
            this.app.on('interactable:hint:show', this._onInteractHintShow, this);
            this.app.on('interactable:hint:hide', this._onInteractHintHide, this);
            
            // 监听对话状态事件
            this._dialogueActive = false;
            this._onDialogueStarted = this._handleDialogueStarted.bind(this);
            this._onDialogueStopped = this._handleDialogueStopped.bind(this);
            this.app.on('dialogue:started', this._onDialogueStarted, this);
            this.app.on('dialogue:stopped', this._onDialogueStopped, this);
            
            // 监听分辨率变化事件
            this._lastScreenWidth = this.app.graphicsDevice.width;
            this._lastScreenHeight = this.app.graphicsDevice.height;
            this._onResizeHandler = this._handleResize.bind(this);
            this.app.graphicsDevice.on('resizecanvas', this._onResizeHandler, this);
            
            // 监听UI显示/隐藏事件（用于prologue等场景）
            this._onMobileUIHide = this._handleMobileUIHide.bind(this);
            this._onMobileUIShow = this._handleMobileUIShow.bind(this);
            this.app.on('mobile:ui:hide', this._onMobileUIHide, this);
            this.app.on('mobile:ui:show', this._onMobileUIShow, this);
        }
    }
    
    // 监听UIManager状态变化（用于TYPEWRITER状态时隐藏UI）
    this._onUIStateChanged = this._handleUIStateChanged.bind(this);
    this.app.on('ui:state_changed', this._onUIStateChanged, this);
    console.log('[UIMobile] State change listener bound, _isMobile:', this._isMobile, '_isPCMode:', this._isPCMode);
    
    // 检查当前 UIManager 状态，处理初始化时序问题
    if (typeof UIManager !== 'undefined') {
        var uiManager = UIManager.getInstance();
        if (uiManager && uiManager.currentState) {
            console.log('[UIMobile] Checking initial UIManager state:', uiManager.currentState);
            // 模拟状态变化事件，从 null 到当前状态
            this._handleUIStateChanged({
                from: null,
                to: uiManager.currentState
            });
        }
    }

    if (this.enableDebugLog) {
        var b = this._getElementBoundsCanvas(this.joystickBase);
        console.log('[UIMobile] ===== Initialized =====');
        if (b) console.log('[UIMobile] Base center:', b.centerX.toFixed(0), b.centerY.toFixed(0),
                           'size:', b.width.toFixed(0), 'x', b.height.toFixed(0));
        console.log('[UIMobile] Max radius(px):', this._getJoystickMaxRadius().toFixed(1));
        console.log('[UIMobile] Touch scale:', (this.joystickTouchScale * 100).toFixed(0) + '%');
        console.log('[UIMobile] Screen:', this.app.graphicsDevice.width, 'x', this.app.graphicsDevice.height);
        console.log('[UIMobile] =======================');
    }
};

// ===== 验证实体 =====
UIMobile.prototype._validateEntities = function () {
    var ok = true;
    
    // 验证移动端UI组
    if (!this.mobileGroup || !this.mobileGroup.element) {
        console.error('[UIMobile] mobileGroup must be a valid UI Element (Group).');
        ok = false;
    }
    
    if (!this.joystickBase || !this.joystickBase.element) {
        console.error('[UIMobile] joystickBase must be an Image Element.');
        ok = false;
    }
    if (!this.joystickStick || !this.joystickStick.element) {
        console.error('[UIMobile] joystickStick must be an Image Element.');
        ok = false;
    }
    if (this.interactButton && !this.interactButton.element) {
        console.warn('[UIMobile] interactButton is not a valid Element. Ignored.');
        this.interactButton = null;
    }
    if (this.respawnButton && !this.respawnButton.element) {
        console.warn('[UIMobile] respawnButton is not a valid Element. Ignored.');
        this.respawnButton = null;
    }
    if (this.soulShoreButton && !this.soulShoreButton.element) {
        console.warn('[UIMobile] soulShoreButton is not a valid Element. Ignored.');
        this.soulShoreButton = null;
    }
    
    // 验证层级关系
    if (ok && this.mobileGroup && this.joystickBase) {
        var isChild = this._isChildOf(this.joystickBase, this.mobileGroup);
        if (!isChild) {
            console.warn('[UIMobile] joystickBase should be a child of mobileGroup for proper alignment.');
        }
    }
    
    return ok;
};

// 检查是否为子实体
UIMobile.prototype._isChildOf = function (child, parent) {
    var current = child;
    while (current && current.parent) {
        if (current.parent === parent) {
            return true;
        }
        current = current.parent;
    }
    return false;
};

// ===== 自动禁用mobileGroup背景的输入（防止阻挡按钮）=====
UIMobile.prototype._disableMobileGroupBackgroundInput = function () {
    if (!this.mobileGroup) return;
    
    var children = this.mobileGroup.children || [];
    var disabledCount = 0;
    
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (!child || !child.element) continue;
        
        var name = (child.name || '').toLowerCase();
        
        // 识别可能是背景的元素（名称包含background/bg/mask/panel）
        var isBackground = name.includes('background') || name.includes('bg') || 
                          name.includes('mask') || name.includes('panel');
        
        // 排除控制元素（按钮、摇杆等）
        var isControl = name.includes('button') || name.includes('joystick') || 
                       name.includes('stick') || name.includes('interact') ||
                       name.includes('jump') || name.includes('respawn') || 
                       name.includes('soul') || name.includes('shore');
        
        // 如果是背景元素且不是控制元素，禁用其输入
        if (isBackground && !isControl && child.element.useInput) {
            child.element.useInput = false;
            disabledCount++;
            
            if (this.enableDebugLog) {
                console.log('[UIMobile] 自动禁用背景输入:', child.name, '(防止阻挡按钮点击)');
            }
        }
    }
    
    if (disabledCount > 0 || this.enableDebugLog) {
        console.log('[UIMobile] 已禁用', disabledCount, '个背景元素的useInput，确保按钮可点击');
    }
};

// ===== 绑定触摸（统一走全局 Touch 事件） =====
UIMobile.prototype._bindTouchEvents = function () {
    if (!this.app.touch) return;

    var self = this;

    this.onTouchStart = function (event) {
        var touches = event.touches || [];
        for (var i = 0; i < touches.length; i++) {
            var t = touches[i];
            var p = new pc.Vec2(t.x, t.y);

            // 优先占用摇杆
            if (self.joystickTouchId === -1 && self._isTouchInJoystick(p)) {
                self._startJoystick(t.id, p);
                if (self.enableDebugLog) console.log('[UIMobile] Joystick START id=', t.id, 'x=', p.x, 'y=', p.y);
                continue;
            }

            // 检查所有按钮（优先级高于相机控制）
            var buttonHandled = false;
            
            // 互动按钮
            if (self.interactButton && self._isTouchInElement(p, self.interactButton)) {
                self._pressInteract();
                buttonHandled = true;
            }
            // 跳跃按钮
            else if (self.jumpButton && self._isTouchInElement(p, self.jumpButton)) {
                self._pressJump();
                buttonHandled = true;
            }
            // 重生按钮
            else if (self.respawnButton && self._isTouchInElement(p, self.respawnButton)) {
                self._pressRespawn();
                buttonHandled = true;
            }
            // 心灵彼岸按钮
            else if (self.soulShoreButton && self._isTouchInElement(p, self.soulShoreButton)) {
                self._pressSoulShore();
                buttonHandled = true;
            }
            
            if (buttonHandled) {
                continue; // 按钮处理了，跳过相机控制
            }

            // 相机控制（只有在没有按钮被触摸时才激活）
            if (self.cameraTouchId === -1 && self._isTouchInCameraZone(p)) {
                self._startCamera(t.id, p);
            }
        }
        if (event.event) event.event.preventDefault();
    };

    this.onTouchMove = function (event) {
        var touches = event.touches || [];
        for (var i = 0; i < touches.length; i++) {
            var t = touches[i];
            var p = new pc.Vec2(t.x, t.y);
            if (t.id === self.joystickTouchId) self._updateJoystick(p);
            if (t.id === self.cameraTouchId) self._updateCamera(p);
        }
        if (event.event) event.event.preventDefault();
    };

    this.onTouchEnd = function (event) {
        var changed = event.changedTouches || [];
        for (var i = 0; i < changed.length; i++) {
            var t = changed[i];
            if (t.id === self.joystickTouchId) self._endJoystick();
            if (t.id === self.cameraTouchId) self._endCamera();
        }
        if (event.event) event.event.preventDefault();
    };

    this.app.touch.on(pc.EVENT_TOUCHSTART, this.onTouchStart, this);
    this.app.touch.on(pc.EVENT_TOUCHMOVE,  this.onTouchMove,  this);
    this.app.touch.on(pc.EVENT_TOUCHEND,   this.onTouchEnd,   this);
    this.app.touch.on(pc.EVENT_TOUCHCANCEL,this.onTouchEnd,   this);
};

// ===== 基于 Element.screenCorners 的边界（Canvas 像素坐标系）=====
UIMobile.prototype._getElementBoundsCanvas = function (entity) {
    if (!entity || !entity.element) return null;
    var el = entity.element;
    
    // 优先使用canvasCorners，它考虑了Screen组件的缩放
    var corners = el.canvasCorners || el.screenCorners || el.worldCorners;
    if (!corners) return null;

    var minX =  Infinity, minY =  Infinity;
    var maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < corners.length; i++) {
        var c = corners[i]; // Vec3
        var x = c.x, y = c.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    var w = maxX - minX, h = maxY - minY;
    return {
        minX: minX, minY: minY, maxX: maxX, maxY: maxY,
        width: w, height: h,
        centerX: minX + w * 0.5,
        centerY: minY + h * 0.5
    };
};


// ===== 底盘短边 =====
UIMobile.prototype._getBaseSize = function () {
    var b = this._getElementBoundsCanvas(this.joystickBase);
    if (!b) return 100;
    return Math.min(b.width, b.height);
};

// ===== 获取MobileGroup的边界 =====
UIMobile.prototype._getMobileGroupBounds = function () {
    if (!this.mobileGroup) return null;
    return this._getElementBoundsCanvas(this.mobileGroup);
};

// ===== 半径 =====
UIMobile.prototype._getJoystickMaxRadius = function () {
    if (this.joystickMaxRadius > 0) return this.joystickMaxRadius;
    return this._getBaseSize() * 0.5; // 默认：底盘短边的一半
};

// ===== 命中（圆形，以底盘中心为圆心）=====
UIMobile.prototype._isTouchInJoystick = function (touchPos) {
    var lp = this._screenToBaseLocal(touchPos.x, touchPos.y);
    var radius = this._getJoystickMaxRadius();
    radius *= (this.joystickTouchScale > 0 ? this.joystickTouchScale : 1.0);
    var inside = (lp.x * lp.x + lp.y * lp.y) <= (radius * radius);

    if (this.enableDebugLog) {
        var b  = this._getElementBoundsCanvas(this.joystickBase);
        var c  = this._getBaseCenterWithOffset();
        console.log('[UIMobile] HitTest Joystick:', inside ? 'IN' : 'OUT',
            '| touch(', touchPos.x.toFixed(0), ',', touchPos.y.toFixed(0), ')',
            '| baseCenter(', b ? (b.centerX.toFixed(0)+','+b.centerY.toFixed(0)) : '?,?', ')',
            '| offset(', (this.touchCenterOffsetX||0), ',', (this.touchCenterOffsetY||0), ')',
            '| usedCenter(', c ? (c.x.toFixed(0)+','+c.y.toFixed(0)) : '?,?', ')',
            '| local(', lp.x.toFixed(0), ',', lp.y.toFixed(0), ')',
            '| r=', radius.toFixed(0));
    }
    return inside;
};


// ===== 元素命中（矩形）=====
UIMobile.prototype._isTouchInElement = function (touchPos, entity) {
    var b = this._getElementBoundsCanvas(entity);
    if (!b) return false;
    return (touchPos.x >= b.minX && touchPos.x <= b.maxX &&
            touchPos.y >= b.minY && touchPos.y <= b.maxY);
};

// ===== 摇杆 =====
UIMobile.prototype._startJoystick = function (touchId, touchPos) {
    this.joystickActive = true;
    this.joystickTouchId = touchId;

    this.joystickStartPos.set(0, 0);

    var lp = this._screenToBaseLocal(touchPos.x, touchPos.y);
    this.joystickCurrentPos.copy(lp);

    if (this.enableDebugLog) {
        console.log('[UIMobile] Joystick START local:', lp.x.toFixed(1), lp.y.toFixed(1), 'id:', touchId);
    }
};

UIMobile.prototype._updateJoystick = function (touchPos) {
    if (!this.joystickActive) return;

    var lp = this._screenToBaseLocal(touchPos.x, touchPos.y);
    var x = lp.x, y = lp.y;

    var maxRadius = this._getJoystickMaxRadius();
    var len = Math.hypot(x, y);
    if (len > maxRadius) {
        var r = maxRadius / len;
        x *= r; y *= r;
    }

    // 视觉：与手指一致（局部坐标）
    this.joystickStick.setLocalPosition(x, y, 0);

    // 归一化输入 (0~1)
    var normalizedX = x / maxRadius;
    var normalizedY = y / maxRadius;
    this.joystickDelta.set(normalizedX, normalizedY);
    
    // 计算速度强度（距离中心的距离）
    var magnitude = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
    magnitude = Math.min(magnitude, 1.0); // 限制在 0~1
    
    // 判断移动状态
    var moveState = 'idle';
    if (magnitude > this.walkThreshold) {
        moveState = magnitude > this.runThreshold ? 'running' : 'walking';
    }
    
    // 发送事件（x取反：屏幕向右为正 -> 游戏向左为正；y取反：屏幕向下为正 -> 游戏向上为正）
    this.app.fire('mobile:joystick:move', {
        x: -normalizedX,
        y: -normalizedY,
        magnitude: magnitude,
        moveState: moveState
    });
};

// 偏移后的屏幕中心（canvas 像素坐标系）
// 获取Screen组件的缩放因子
UIMobile.prototype._getScreenScaleFactor = function () {
    try {
        // 查找Screen组件，优先从mobileGroup开始
        var screen = null;
        var searchRoot = this.mobileGroup || this.joystickBase;
        
        if (searchRoot && searchRoot.screen) {
            screen = searchRoot.screen;
        } else {
            // 向上查找父级的Screen组件
            var parent = searchRoot;
            while (parent && !screen) {
                if (parent.screen) {
                    screen = parent.screen;
                    break;
                }
                parent = parent.parent;
            }
        }
        
        if (screen && screen.scale) {
            return screen.scale;
        }
    } catch (e) {
        if (this.enableDebugLog) {
            console.warn('[UIMobile] Failed to get screen scale factor:', e);
        }
    }
    
    return 1.0; // 默认无缩放
};

// 偏移后的屏幕中心（canvas 像素坐标系），支持按分辨率缩放偏移
UIMobile.prototype._getBaseCenterWithOffset = function () {
    // 优先使用mobileGroup的边界，如果没有则回退到joystickBase
    var groupBounds = this._getMobileGroupBounds();
    var baseBounds = this._getElementBoundsCanvas(this.joystickBase);
    
    // 如果有mobileGroup，使用它的坐标系；否则使用joystickBase
    var referenceBounds = groupBounds || baseBounds;
    if (!referenceBounds) return null;

    var sw = this.app.graphicsDevice.width;
    var sh = this.app.graphicsDevice.height;

    // 获取Screen组件的缩放因子
    var screenScale = this._getScreenScaleFactor();

    // 计算缩放比：当前尺寸 / 参考尺寸
    var scaleX = (this.enableOffsetAutoScale && this.referenceScreenWidth  > 0) ? (sw / this.referenceScreenWidth)  : 1;
    var scaleY = (this.enableOffsetAutoScale && this.referenceScreenHeight > 0) ? (sh / this.referenceScreenHeight) : 1;

    // 应用Screen组件缩放
    scaleX *= screenScale;
    scaleY *= screenScale;

    // 实际生效的偏移 = 原偏移 * 缩放比
    var offX = (this.touchCenterOffsetX || 0) * scaleX;
    var offY = (this.touchCenterOffsetY || 0) * scaleY;

    // 如果使用mobileGroup，需要计算joystickBase相对于group的偏移
    var centerX = referenceBounds.centerX;
    var centerY = referenceBounds.centerY;
    
    if (groupBounds && baseBounds) {
        // 计算joystickBase相对于mobileGroup的偏移
        var relativeOffsetX = baseBounds.centerX - groupBounds.centerX;
        var relativeOffsetY = baseBounds.centerY - groupBounds.centerY;
        
        // 应用相对偏移
        centerX = groupBounds.centerX + relativeOffsetX;
        centerY = groupBounds.centerY + relativeOffsetY;
        
        if (this.enableDebugLog) {
            console.log('[UIMobile] Using mobileGroup coordinate system - groupCenter:', 
                       groupBounds.centerX.toFixed(1), groupBounds.centerY.toFixed(1),
                       'baseCenter:', baseBounds.centerX.toFixed(1), baseBounds.centerY.toFixed(1),
                       'relativeOffset:', relativeOffsetX.toFixed(1), relativeOffsetY.toFixed(1));
        }
    }

    var result = { x: centerX + offX, y: centerY + offY };
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Center calculation - screenScale:', screenScale.toFixed(3), 
                   'scaleX:', scaleX.toFixed(3), 'scaleY:', scaleY.toFixed(3),
                   'referenceCenter:', centerX.toFixed(1), centerY.toFixed(1),
                   'offset:', offX.toFixed(1), offY.toFixed(1),
                   'finalCenter:', result.x.toFixed(1), result.y.toFixed(1),
                   'usingGroup:', !!groupBounds);
    }

    return result;
};

// 屏幕 -> 底盘局部(以“偏移后中心”为原点，Y向上为正)
UIMobile.prototype._screenToBaseLocal = function (screenX, screenY) {
    var c = this._getBaseCenterWithOffset();
    if (!c) return new pc.Vec2(0, 0);
    return new pc.Vec2(screenX - c.x, -(screenY - c.y));
};


UIMobile.prototype._endJoystick = function () {
    this.joystickActive = false;
    this.joystickTouchId = -1;
    this.joystickDelta.set(0, 0);

    this.app.fire('mobile:joystick:move', { x: 0, y: 0 });

    if (this.enableDebugLog) console.log('[UIMobile] Joystick END');
};

// ===== 相机 =====
UIMobile.prototype._isTouchInCameraZone = function (touchPos) {
    var screenWidth = this.app.graphicsDevice.width;
    var zone = this.cameraZone || 'right';

    // 摇杆激活时不占用相机
    if (this.joystickActive) return false;

    if (zone === 'full') return true;
    if (zone === 'left') return touchPos.x < screenWidth / 2;
    if (zone === 'right') return touchPos.x >= screenWidth / 2;
    return false;
};

UIMobile.prototype._startCamera = function (touchId, touchPos) {
    this.cameraTouchId = touchId;
    this.cameraLastPos.copy(touchPos);
    this.cameraDelta.set(0, 0);

    if (this.enableDebugLog) console.log('[UIMobile] Camera START', touchPos.x, touchPos.y, 'id:', touchId);
};

UIMobile.prototype._updateCamera = function (touchPos) {
    if (this.cameraTouchId === -1) return;

    var dx = touchPos.x - this.cameraLastPos.x;
    var dy = touchPos.y - this.cameraLastPos.y;
    
    // 过滤微小抖动（阈值：1像素）
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    this.cameraDelta.set(dx, dy);
    this.cameraLastPos.copy(touchPos);

    try {
        var gcam = (typeof GlobalCameraManager !== 'undefined') ? GlobalCameraManager.getInstance() : null;
        if (gcam && gcam.applyMouseDelta) {
            gcam.applyMouseDelta(dx * this.cameraSensitivity, dy * this.cameraSensitivity);
        }
    } catch (e) {
        if (this.enableDebugLog) console.warn('[UIMobile] applyMouseDelta failed:', e);
    }

    this.app.fire('mobile:camera:rotate', {
        dx: dx * this.cameraSensitivity,
        dy: dy * this.cameraSensitivity
    });
};

UIMobile.prototype._endCamera = function () {
    this.cameraTouchId = -1;
    this.cameraDelta.set(0, 0);
    if (this.enableDebugLog) console.log('[UIMobile] Camera END');
};

// ===== 互动按钮（可选）=====
UIMobile.prototype._pressInteract = function () {
    this.interactPressed = true;
    this.app.fire('mobile:interact:press');
    if (this.enableDebugLog) console.log('[UIMobile] Interact PRESS');

    var self = this;
    setTimeout(function () {
        self.interactPressed = false;
        self.app.fire('mobile:interact:release');
    }, 100);
};

// ===== 跳跃按钮 =====
UIMobile.prototype._pressJump = function () {
    this.app.fire('mobile:jump:press');
    this.app.fire('input:key:space'); // 模拟空格键
    if (this.enableDebugLog) console.log('[UIMobile] Jump PRESS');
};

// ===== 重生按钮 =====
UIMobile.prototype._pressRespawn = function () {
    console.log('[UIMobile] Respawn button pressed');
    
    // 检查DeathController是否存在
    var hasDeathController = false;
    try {
        // 查找场景中的DeathController
        var entities = this.app.root.findByName('DeathController') || this.app.root.findByTag('deathcontroller');
        hasDeathController = !!(entities && entities.length > 0);
        console.log('[UIMobile] DeathController found:', hasDeathController);
    } catch (e) {
        console.warn('[UIMobile] Failed to check DeathController:', e);
    }
    
    // 检查存档点
    if (typeof GlobalGame !== 'undefined' && GlobalGame.getCheckpoint) {
        var checkpoint = GlobalGame.getCheckpoint();
        console.log('[UIMobile] Has checkpoint:', !!checkpoint);
        if (checkpoint) {
            console.log('[UIMobile] Checkpoint position:', checkpoint);
        } else {
            console.warn('[UIMobile] No checkpoint set!');
        }
    }
    
    // 触发DeathController的手动回档事件
    console.log('[UIMobile] Firing player:respawn event for DeathController...');
    this.app.fire('player:respawn');
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Respawn event fired: player:respawn');
    }
};

// ===== 心灵彼岸按钮 =====
UIMobile.prototype._pressSoulShore = function () {
    this.app.fire('mobile:soulshore:press');
    
    // 触发ESC界面（与PC端按ESC键效果相同）
    try {
        var uiMgr = (typeof UIManager !== 'undefined') ? UIManager.getInstance() : null;
        if (uiMgr && uiMgr._showEscConfirm) {
            uiMgr._showEscConfirm();
        } else {
            console.warn('[UIMobile] UIManager或_showEscConfirm方法不可用');
        }
    } catch (e) {
        console.error('[UIMobile] 调用ESC界面失败:', e);
    }
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] SoulShore PRESS - 触发ESC界面');
    }
};

// ===== 更新（回中动画）=====
UIMobile.prototype.update = function (dt) {
    // 安全检查：确保所有必需的对象都存在
    if (!this._tempVec3 || !this.joystickStick) return;
    
    if (!this.joystickActive && this.joystickStick.element) {
        try {
            var current = this.joystickStick.getLocalPosition();
            if (!current) return; // 实体可能正在被销毁
            
            var target = this._tempVec3.set(0, 0, 0);
            var t = Math.min(1, dt * this.joystickReturnSpeed);
            this._tempVec3.lerp(current, target, t);
            this.joystickStick.setLocalPosition(this._tempVec3);
        } catch (e) {
            // 场景切换时可能出现错误，静默忽略
            if (this.enableDebugLog) {
                console.warn('[UIMobile] Update error (scene switching?):', e);
            }
        }
    }
};

// ===== 公共接口 =====
UIMobile.prototype.getJoystickInput = function () {
    return { x: this.joystickDelta.x, y: -this.joystickDelta.y };
};
UIMobile.prototype.getCameraDelta = function () {
    return { dx: this.cameraDelta.x * this.cameraSensitivity, dy: this.cameraDelta.y * this.cameraSensitivity };
};
UIMobile.prototype.isInteractPressed = function () {
    return this.interactPressed;
};

// ===== 移动端按钮绑定（新增） =====
UIMobile.prototype._bindMobileButtons = function () {
    var self = this;
    
    // 跳跃按钮
    if (this.jumpButton && this.jumpButton.button) {
        this._onJumpButtonClick = function () {
            if (self.enableDebugLog) console.log('[UIMobile] Jump button clicked');
            self.app.fire('mobile:jump');
        };
        this.jumpButton.button.on('click', this._onJumpButtonClick, this);
    }
    
    // 互动按钮
    if (this.interactButton && this.interactButton.button) {
        this._onInteractButtonClick = function () {
            if (self.enableDebugLog) console.log('[UIMobile] Interact button clicked');
            self.app.fire('mobile:interact');
        };
        this.interactButton.button.on('click', this._onInteractButtonClick, this);
        
        // 初始隐藏互动按钮
        this.interactButton.enabled = false;
    }
    
    // 重生按钮（相当于PC端G键，触发deathController事件）
    if (this.respawnButton && this.respawnButton.button) {
        this._onRespawnButtonClick = function () {
            if (self.enableDebugLog) console.log('[UIMobile] Respawn button clicked (G key equivalent)');
            // 触发死亡控制器事件，相当于PC端按G键
            self.app.fire('mobile:respawn');
            // 也可以直接触发键盘事件模拟G键
            self.app.fire('input:key:g');
        };
        this.respawnButton.button.on('click', this._onRespawnButtonClick, this);
        
        if (self.enableDebugLog) {
            console.log('[UIMobile] Respawn button event bound successfully');
        }
    } else if (self.enableDebugLog) {
        console.warn('[UIMobile] Respawn button not found or missing button component');
    }
    
    // 心灵彼岸按钮（触发ESC界面）
    if (this.soulShoreButton && this.soulShoreButton.button) {
        this._onSoulShoreButtonClick = function () {
            if (self.enableDebugLog) {
                console.log('[UIMobile] Soul Shore button clicked - 触发ESC界面');
            }
            
            // 触发ESC界面（与PC端按ESC键效果相同）
            try {
                var uiMgr = (typeof UIManager !== 'undefined') ? UIManager.getInstance() : null;
                if (uiMgr && uiMgr._showEscConfirm) {
                    uiMgr._showEscConfirm();
                } else {
                    console.warn('[UIMobile] UIManager或_showEscConfirm方法不可用');
                }
            } catch (e) {
                console.error('[UIMobile] 调用ESC界面失败:', e);
            }
        };
        this.soulShoreButton.button.on('click', this._onSoulShoreButtonClick, this);
        
        if (self.enableDebugLog) {
            console.log('[UIMobile] Soul Shore button event bound successfully');
        }
    } else if (self.enableDebugLog) {
        console.warn('[UIMobile] Soul Shore button not found or missing button component');
    }
    
    // 初始隐藏提示文字
    if (this.interactHintText) {
        this.interactHintText.enabled = false;
    }
};

UIMobile.prototype._unbindMobileButtons = function () {
    if (this.jumpButton && this.jumpButton.button && this._onJumpButtonClick) {
        this.jumpButton.button.off('click', this._onJumpButtonClick, this);
    }
    if (this.interactButton && this.interactButton.button && this._onInteractButtonClick) {
        this.interactButton.button.off('click', this._onInteractButtonClick, this);
    }
    if (this.respawnButton && this.respawnButton.button && this._onRespawnButtonClick) {
        this.respawnButton.button.off('click', this._onRespawnButtonClick, this);
    }
    if (this.soulShoreButton && this.soulShoreButton.button && this._onSoulShoreButtonClick) {
        this.soulShoreButton.button.off('click', this._onSoulShoreButtonClick, this);
    }
};

// ===== InteractableHint 事件处理（新增） =====
UIMobile.prototype._handleInteractHintShow = function (data) {
    if (this.enableDebugLog) {
        console.log('[UIMobile] _handleInteractHintShow called, data:', data);
        console.log('[UIMobile] interactButton:', this.interactButton);
        console.log('[UIMobile] interactHintText:', this.interactHintText);
    }
    
    if (!data) return;
    
    // 显示互动按钮
    if (this.interactButton) {
        this.interactButton.enabled = true;
        this._interactButtonVisible = true;
        if (this.enableDebugLog) {
            console.log('[UIMobile] Interact button enabled');
        }
    } else if (this.enableDebugLog) {
        console.warn('[UIMobile] interactButton is null!');
    }
    
    // 更新提示文字（优先使用已翻译的文本）
    if (this.interactHintText && this.interactHintText.element) {
        var hintText = '';
        var hintKey = data.hintKey || '';
        var preTranslatedHint = data.hint || '';
        
        if (this.enableDebugLog) {
            console.log('[UIMobile] Processing hint - hintKey:', hintKey, 'preTranslatedHint:', preTranslatedHint, 'data:', data);
        }
        
        // 优先使用已经翻译好的文本
        if (preTranslatedHint && typeof preTranslatedHint === 'string') {
            hintText = preTranslatedHint;
            if (this.enableDebugLog) {
                console.log('[UIMobile] Using pre-translated hint:', hintText);
            }
        } else if (hintKey) {
            // 如果没有预翻译文本，尝试从 i18n 获取
            if (typeof I18n !== 'undefined' && I18n.get) {
                try {
                    // 先尝试从 'ui' 命名空间获取
                    hintText = I18n.get('ui', hintKey);
                    if (this.enableDebugLog) {
                        console.log('[UIMobile] I18n.get("ui", "' + hintKey + '") ->', hintText);
                    }
                    
                    // 如果没有找到，尝试直接获取
                    if (!hintText || typeof hintText !== 'string') {
                        hintText = I18n.get(hintKey);
                        if (this.enableDebugLog) {
                            console.log('[UIMobile] I18n.get("' + hintKey + '") ->', hintText);
                        }
                    }
                    
                    // 如果仍然没有找到，使用原始 key 作为兜底
                    if (!hintText || typeof hintText !== 'string') {
                        hintText = hintKey;
                        if (this.enableDebugLog) {
                            console.log('[UIMobile] I18n lookup failed, using key as fallback:', hintKey);
                        }
                    }
                } catch (e) {
                    if (this.enableDebugLog) {
                        console.warn('[UIMobile] I18n.get failed:', e);
                    }
                    hintText = hintKey;
                }
            } else {
                hintText = hintKey;
                if (this.enableDebugLog) {
                    console.log('[UIMobile] I18n not available, using hintKey:', hintText);
                }
            }
        } else {
            hintText = 'Interact'; // 默认文本
            if (this.enableDebugLog) {
                console.log('[UIMobile] No hint data available, using default:', hintText);
            }
        }
        
        this.interactHintText.element.text = hintText;
        this.interactHintText.enabled = true;
        this._currentInteractHint = hintText;
        
        if (this.enableDebugLog) {
            console.log('[UIMobile] Final hint text set:', hintText);
        }
    } else if (this.enableDebugLog) {
        console.warn('[UIMobile] interactHintText is null or has no element!');
    }
};

UIMobile.prototype._handleInteractHintHide = function () {
    // 隐藏互动按钮
    if (this.interactButton) {
        this.interactButton.enabled = false;
        this._interactButtonVisible = false;
    }
    
    // 隐藏提示文字
    if (this.interactHintText) {
        this.interactHintText.enabled = false;
        this._currentInteractHint = '';
    }
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Interact hint hide');
    }
};

// ===== 对话状态处理 =====
UIMobile.prototype._handleDialogueStarted = function () {
    // PC模式下不处理移动端UI
    if (this._isPCMode) return;
    
    this._dialogueActive = true;
    
    // 隐藏移动控制UI（摇杆、跳跃按钮、互动按钮）
    this._hideMobileControls();
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Dialogue started - mobile controls hidden');
    }
};

UIMobile.prototype._handleDialogueStopped = function () {
    // PC模式下不处理移动端UI
    if (this._isPCMode) return;
    
    this._dialogueActive = false;
    
    // 恢复移动控制UI
    this._showMobileControls();
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Dialogue stopped - mobile controls restored');
    }
};

// 隐藏移动控制UI（对话时）
UIMobile.prototype._hideMobileControls = function () {
    // 如果有mobileGroup，可以选择隐藏整个组或只隐藏控制部分
    // 这里选择只隐藏控制相关的UI，保留可能的背景装饰
    
    // 隐藏摇杆
    if (this.joystickBase) this.joystickBase.enabled = false;
    if (this.joystickStick) this.joystickStick.enabled = false;
    
    // 隐藏跳跃按钮
    if (this.jumpButton) this.jumpButton.enabled = false;
    
    // 隐藏互动按钮和提示
    if (this.interactButton) {
        this.interactButton.enabled = false;
        this._interactButtonVisible = false;
    }
    if (this.interactHintText) {
        this.interactHintText.enabled = false;
    }
    
    // 重置摇杆状态
    this._resetJoystickState();
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Mobile controls hidden for dialogue', this.mobileGroup ? '(mobileGroup available)' : '');
    }
};

// 显示移动控制UI（对话结束后）
UIMobile.prototype._showMobileControls = function () {
    // 只在移动设备上显示
    if (!this._isMobile) return;
    
    // 确保mobileGroup是启用的（如果存在）
    if (this.mobileGroup) {
        this.mobileGroup.enabled = true;
    }
    
    // 显示摇杆
    if (this.joystickBase) this.joystickBase.enabled = true;
    if (this.joystickStick) this.joystickStick.enabled = true;
    
    // 显示跳跃按钮
    if (this.jumpButton) this.jumpButton.enabled = true;
    
    // 显示功能按钮（重生和心灵彼岸按钮在对话后恢复显示）
    if (this.respawnButton) this.respawnButton.enabled = true;
    if (this.soulShoreButton) this.soulShoreButton.enabled = true;
    
    // 注意：互动按钮和提示由InteractableHint系统控制，不在这里恢复
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Mobile controls restored after dialogue', this.mobileGroup ? '(via mobileGroup)' : '');
    }
};

// 重置摇杆状态
UIMobile.prototype._resetJoystickState = function () {
    this.joystickActive = false;
    this.joystickTouchId = -1;
    this.joystickCurrentPos.set(0, 0);
    this.joystickDelta.set(0, 0);
    
    // 重置摇杆杆体位置
    if (this.joystickStick) {
        this.joystickStick.setLocalPosition(0, 0, 0);
    }
    
    // 停止移动输入
    this.app.fire('mobile:move', { x: 0, z: 0, magnitude: 0 });
};

// ===== 处理UI隐藏事件（用于prologue等场景） =====
UIMobile.prototype._handleMobileUIHide = function () {
    // PC模式下不处理
    if (this._isPCMode || !this._isMobile) return;
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Hiding mobile UI (prologue/cutscene)');
    }
    
    // 隐藏整个mobileGroup
    if (this.mobileGroup) {
        this.mobileGroup.enabled = false;
    }
    
    // 重置摇杆状态
    this._resetJoystickState();
};

// ===== 处理UI显示事件 =====
UIMobile.prototype._handleMobileUIShow = function () {
    // PC模式下不处理
    if (this._isPCMode || !this._isMobile) return;
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] Showing mobile UI');
    }
    
    // 显示mobileGroup
    if (this.mobileGroup) {
        this.mobileGroup.enabled = true;
    }
};

// ===== 处理UIManager状态变化（TYPEWRITER状态时禁用UIScreen）=====
UIMobile.prototype._handleUIStateChanged = function (data) {
    console.log('[UIMobile] _handleUIStateChanged called with data:', data);
    console.log('[UIMobile] _isPCMode:', this._isPCMode, '_isMobile:', this._isMobile);
    
    // PC模式下不处理
    if (this._isPCMode || !this._isMobile) {
        console.log('[UIMobile] Skipping state change handling - PC mode or not mobile');
        return;
    }
    
    if (!data) {
        console.log('[UIMobile] No data provided for state change');
        return;
    }
    
    var from = data.from;
    var to = data.to;
    
    console.log('[UIMobile] UI state changed:', from, '->', to);
    console.log('[UIMobile] Current _disabledMobileNodes count:', this._disabledMobileNodes ? this._disabledMobileNodes.length : 'undefined');
    
    // 定义需要禁用UIScreen的状态（注意：状态字符串是小写加下划线）
    var disableScreenStates = ['typewriter', 'first_time_intro'];
    
    var shouldDisableScreen = disableScreenStates.indexOf(to) !== -1;
    var wasScreenDisabled = disableScreenStates.indexOf(from) !== -1;
    
    console.log('[UIMobile] shouldDisableScreen:', shouldDisableScreen, 'wasScreenDisabled:', wasScreenDisabled);
    console.log('[UIMobile] disableScreenStates:', disableScreenStates);
    console.log('[UIMobile] to state in array:', disableScreenStates.indexOf(to));
    
    // 进入TYPEWRITER或FIRST_TIME_INTRO状态时直接禁用UIScreen
    if (shouldDisableScreen && !wasScreenDisabled) {
        console.log('[UIMobile] Entering typing/intro state, disabling UIScreen');
        this._disableUIScreen();
    }
    // 离开TYPEWRITER或FIRST_TIME_INTRO状态时重新启用UIScreen
    else if (!shouldDisableScreen && wasScreenDisabled) {
        console.log('[UIMobile] Leaving typing/intro state, enabling UIScreen');
        this._enableUIScreen();
    } else {
        console.log('[UIMobile] No action needed for state change - shouldDisableScreen:', shouldDisableScreen, 'wasScreenDisabled:', wasScreenDisabled);
    }
};

// ===== 禁用/启用UIScreen下所有mobile开头的子节点 =====
UIMobile.prototype._disableUIScreen = function () {
    // 查找UIScreen组件
    var uiScreen = this._findUIScreen();
    if (uiScreen) {
        // 如果已经有禁用的节点记录，先恢复它们
        if (this._disabledMobileNodes && this._disabledMobileNodes.length > 0) {
            console.log('[UIMobile] Warning: _disabledMobileNodes already has', this._disabledMobileNodes.length, 'entries, clearing first');
        }
        
        // 重新初始化记录数组
        this._disabledMobileNodes = [];
        
        // 递归查找所有以"mobile"开头的子节点
        this._findAndDisableMobileNodes(uiScreen);
        
        console.log('[UIMobile] Disabled', this._disabledMobileNodes.length, 'mobile nodes for typewriter state');
        if (this.enableDebugLog) {
            for (var i = 0; i < this._disabledMobileNodes.length; i++) {
                var node = this._disabledMobileNodes[i];
                console.log('[UIMobile] Disabled node[' + i + ']:', node.name, 'originalEnabled:', node.originalEnabled);
            }
        }
    } else {
        if (this.enableDebugLog) {
            console.warn('[UIMobile] UIScreen not found, falling back to hiding mobileGroup');
        }
        // 回退方案：隐藏mobileGroup
        this._handleMobileUIHide();
    }
};

UIMobile.prototype._enableUIScreen = function () {
    console.log('[UIMobile] _enableUIScreen called, _disabledMobileNodes count:', this._disabledMobileNodes ? this._disabledMobileNodes.length : 'undefined');
    
    // 恢复之前禁用的mobile节点
    if (this._disabledMobileNodes && this._disabledMobileNodes.length > 0) {
        var restoredCount = 0;
        var failedCount = 0;
        
        for (var i = 0; i < this._disabledMobileNodes.length; i++) {
            var node = this._disabledMobileNodes[i];
            if (node && node.entity) {
                // 检查实体是否仍然有效
                if (node.entity.enabled !== undefined) {
                    // 恢复到原始状态
                    node.entity.enabled = node.originalEnabled;
                    restoredCount++;
                    
                    console.log('[UIMobile] Restored mobile node[' + i + ']:', node.name, 'to originalEnabled:', node.originalEnabled);
                } else {
                    failedCount++;
                    console.warn('[UIMobile] Failed to restore node[' + i + ']:', node.name, '- entity may be destroyed');
                }
            } else {
                failedCount++;
                console.warn('[UIMobile] Invalid node[' + i + ']:', node);
            }
        }
        
        console.log('[UIMobile] Restore summary: restored=' + restoredCount + ', failed=' + failedCount + ', total=' + this._disabledMobileNodes.length);
        
        // 清空记录
        this._disabledMobileNodes = [];
    } else {
        console.warn('[UIMobile] No disabled mobile nodes to restore (count:', this._disabledMobileNodes ? this._disabledMobileNodes.length : 'undefined', '), falling back to showing mobileGroup');
        // 回退方案：显示mobileGroup
        this._handleMobileUIShow();
    }
};

// 递归查找并禁用所有以"mobile"开头的子节点
UIMobile.prototype._findAndDisableMobileNodes = function (parentEntity) {
    if (!parentEntity || !parentEntity.children) {
        console.log('[UIMobile] _findAndDisableMobileNodes: parentEntity is null or has no children');
        return;
    }
    
    var children = parentEntity.children;
    console.log('[UIMobile] _findAndDisableMobileNodes: searching in', parentEntity.name, 'with', children.length, 'children');
    
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (!child) continue;
        
        var childName = (child.name || '').toLowerCase();
        console.log('[UIMobile] Checking child[' + i + ']:', child.name, 'lowercase:', childName);
        
        // 检查是否以"mobile"开头
        if (childName.indexOf('mobile') === 0) {
            // 记录原始状态
            var nodeInfo = {
                entity: child,
                originalEnabled: child.enabled,
                name: child.name
            };
            this._disabledMobileNodes.push(nodeInfo);
            
            // 禁用节点
            child.enabled = false;
            
            console.log('[UIMobile] ✓ Disabled mobile node:', child.name, 'originalEnabled:', nodeInfo.originalEnabled);
        } else {
            // 递归搜索子节点
            console.log('[UIMobile] Recursing into child:', child.name);
            this._findAndDisableMobileNodes(child);
        }
    }
};

// 查找UIScreen组件
UIMobile.prototype._findUIScreen = function () {
    console.log('[UIMobile] _findUIScreen called');
    console.log('[UIMobile] Current entity (UIScreen):', this.entity ? this.entity.name : 'null');
    console.log('[UIMobile] Entity has screen component:', !!this.entity.screen);
    
    // UIScreen 就是当前 UIMobile 脚本绑定的节点
    if (this.entity && this.entity.screen) {
        console.log('[UIMobile] Using current entity as UIScreen:', this.entity.name);
        return this.entity;
    }
    
    // 回退方案：从mobileGroup开始向上查找Screen组件
    console.log('[UIMobile] Fallback: searching from mobileGroup/joystickBase');
    var searchRoot = this.mobileGroup || this.joystickBase;
    var current = searchRoot;
    
    while (current) {
        console.log('[UIMobile] Checking entity:', current.name, 'hasScreen:', !!current.screen);
        if (current.screen) {
            console.log('[UIMobile] Found UIScreen via fallback:', current.name);
            return current;
        }
        current = current.parent;
    }
    
    console.warn('[UIMobile] No UIScreen found - current entity has no screen component');
    return null;
};

// 处理分辨率变化
UIMobile.prototype._handleResize = function (width, height) {
    if (!this._isMobile || this._isPCMode) return;
    
    var widthChanged = Math.abs(width - this._lastScreenWidth) > 1;
    var heightChanged = Math.abs(height - this._lastScreenHeight) > 1;
    
    if (widthChanged || heightChanged) {
        if (this.enableDebugLog) {
            console.log('[UIMobile] Screen resized from', this._lastScreenWidth + 'x' + this._lastScreenHeight, 
                       'to', width + 'x' + height);
        }
        
        // 延迟更新，等待UI元素重新布局
        var self = this;
        setTimeout(function() {
            self.updateJoystickAlignment();
        }, 100);
        
        this._lastScreenWidth = width;
        this._lastScreenHeight = height;
    }
};

// 强制更新摇杆中心对齐（在分辨率变化时调用）
UIMobile.prototype.updateJoystickAlignment = function () {
    if (!this._isMobile || !this.joystickBase || !this.joystickStick) return;
    
    // 重新计算中心位置
    var center = this._getBaseCenterWithOffset();
    if (!center) return;
    
    // 如果摇杆正在使用中，重新计算杆体位置
    if (this.joystickActive) {
        var maxRadius = this._getJoystickMaxRadius();
        var currentDelta = this.joystickDelta;
        
        // 根据当前增量重新设置杆体位置
        var x = currentDelta.x * maxRadius;
        var y = currentDelta.y * maxRadius;
        this.joystickStick.setLocalPosition(x, y, 0);
        
        if (this.enableDebugLog) {
            console.log('[UIMobile] Joystick alignment updated - center:', center.x.toFixed(1), center.y.toFixed(1),
                       'stick pos:', x.toFixed(1), y.toFixed(1),
                       'mobileGroup:', !!this.mobileGroup);
        }
    } else {
        // 摇杆未激活时，确保杆体在中心
        this.joystickStick.setLocalPosition(0, 0, 0);
        
        if (this.enableDebugLog) {
            console.log('[UIMobile] Joystick reset to center - mobileGroup:', !!this.mobileGroup);
        }
    }
};

// ===== 设备检测 =====
UIMobile.prototype._detectMobileDevice = function () {
    // 检测 GlobalGame 的设备信息
    if (typeof GlobalGame !== 'undefined' && GlobalGame.device) {
        return GlobalGame.device.isMobile || false;
    }
    
    // 回退：检测 user agent
    var ua = navigator.userAgent || navigator.vendor || window.opera || '';
    var isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase());
    
    // 检测触摸支持
    var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    return isMobile || (hasTouch && window.innerWidth < 1024);
};

// ===== 检查是否为PC模式 =====
UIMobile.prototype.isPCMode = function () {
    return this._isPCMode || false;
};

// ===== 隐藏所有移动端 UI =====
UIMobile.prototype._hideAllMobileUI = function () {
    // 优先隐藏整个mobileGroup
    if (this.mobileGroup) {
        this.mobileGroup.enabled = false;
    } else {
        // 回退：单独隐藏各个组件
        if (this.joystickBase) this.joystickBase.enabled = false;
        if (this.joystickStick) this.joystickStick.enabled = false;
        if (this.interactButton) this.interactButton.enabled = false;
        if (this.interactHintText) this.interactHintText.enabled = false;
        if (this.jumpButton) this.jumpButton.enabled = false;
        if (this.respawnButton) this.respawnButton.enabled = false;
        if (this.soulShoreButton) this.soulShoreButton.enabled = false;
    }
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] All mobile UI elements hidden', this.mobileGroup ? '(via mobileGroup)' : '(individually)');
    }
};

// ===== PC端隐藏移动端UI =====
UIMobile.prototype._hideMobileUIForPC = function () {
    // PC端隐藏所有移动端UI元素
    if (this.mobileGroup) {
        this.mobileGroup.enabled = false;
        if (this.enableDebugLog) {
            console.log('[UIMobile] PC detected: Hidden entire mobileGroup');
        }
    }
    
    // 无论是否有mobileGroup，都单独隐藏各个移动端组件（防止组件在mobileGroup外）
    if (this.joystickBase) {
        this.joystickBase.enabled = false;
    }
    if (this.joystickStick) {
        this.joystickStick.enabled = false;
    }
    if (this.jumpButton) {
        this.jumpButton.enabled = false;
    }
    if (this.interactButton) {
        this.interactButton.enabled = false;
    }
    if (this.interactHintText) {
        this.interactHintText.enabled = false;
    }
    if (this.respawnButton) {
        this.respawnButton.enabled = false;
    }
    if (this.soulShoreButton) {
        this.soulShoreButton.enabled = false;
    }
    
    if (this.enableDebugLog) {
        console.log('[UIMobile] PC detected: Hidden individual mobile UI elements');
        console.log('[UIMobile] - jumpButton:', !!this.jumpButton, 'enabled:', this.jumpButton ? this.jumpButton.enabled : 'N/A');
        console.log('[UIMobile] - interactButton:', !!this.interactButton, 'enabled:', this.interactButton ? this.interactButton.enabled : 'N/A');
        console.log('[UIMobile] - respawnButton:', !!this.respawnButton, 'enabled:', this.respawnButton ? this.respawnButton.enabled : 'N/A');
        console.log('[UIMobile] - soulShoreButton:', !!this.soulShoreButton, 'enabled:', this.soulShoreButton ? this.soulShoreButton.enabled : 'N/A');
    }
    
    // 设置PC端标志
    this._isPCMode = true;
};

// ===== 清理 =====
UIMobile.prototype.destroy = function () {
    if (UIMobile._instance === this) UIMobile._instance = null;
    
    // 解绑 InteractableHint 事件
    if (this._onInteractHintShow) this.app.off('interactable:hint:show', this._onInteractHintShow, this);
    if (this._onInteractHintHide) this.app.off('interactable:hint:hide', this._onInteractHintHide, this);
    
    // 解绑对话事件
    if (this._onDialogueStarted) this.app.off('dialogue:started', this._onDialogueStarted, this);
    if (this._onDialogueStopped) this.app.off('dialogue:stopped', this._onDialogueStopped, this);
    
    // 解绑分辨率变化事件
    if (this._onResizeHandler) this.app.graphicsDevice.off('resizecanvas', this._onResizeHandler, this);
    
    // 解绑UI显示/隐藏事件
    if (this._onMobileUIHide) this.app.off('mobile:ui:hide', this._onMobileUIHide, this);
    if (this._onMobileUIShow) this.app.off('mobile:ui:show', this._onMobileUIShow, this);
    
    // 解绑UIManager状态变化事件
    if (this._onUIStateChanged) this.app.off('ui:state_changed', this._onUIStateChanged, this);
    
    // 解绑按钮事件
    this._unbindMobileButtons();

    if (this.app.touch) {
        if (this.onTouchStart) this.app.touch.off(pc.EVENT_TOUCHSTART, this.onTouchStart, this);
        if (this.onTouchMove)  this.app.touch.off(pc.EVENT_TOUCHMOVE,  this.onTouchMove,  this);
        if (this.onTouchEnd) {
            this.app.touch.off(pc.EVENT_TOUCHEND,    this.onTouchEnd, this);
            this.app.touch.off(pc.EVENT_TOUCHCANCEL, this.onTouchEnd, this);
        }
    }
    if (this.enableDebugLog) console.log('[UIMobile] Destroyed');
};
