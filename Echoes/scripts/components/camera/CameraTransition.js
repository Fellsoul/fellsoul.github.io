/* global pc */
/**
 * @file CameraTransition.js
 * @desc 相机位置/参数动画过渡插件：平滑移动到预设机位，切换俯仰限制、灵敏度等参数。
 *       支持 WASD 键盘切换：A/D 左右切换，W/S 前后切换机位。
 *
 * 关键修复点：
 * - 机位表为异步加载：加入“就绪排队”机制（_ensureReady/_flushReady），即使 UIManager 提前调用也能在资源就绪后自动执行。
 * - snapToPosition 也会广播 camera:transition:start（以前只在 transitionToPosition 时广播，导致 UI 没接到事件）。
 * - 加载完成后广播 camera:positions:ready，便于外部调试/兜底。
 * - 首次设置当前机位组与索引，保证 WASD 能工作。
 */

var CameraTransition = pc.createScript('cameraTransition');

// ----- 单例管理 -----
CameraTransition._instance = null;

CameraTransition.getInstance = function() {
    return CameraTransition._instance;
};

// ----- 属性 -----
CameraTransition.attributes.add('transitionDuration', { type: 'number', default: 2.0, title: '过渡时长(秒)' });
CameraTransition.attributes.add('easeType', {
    type: 'string',
    default: 'easeInOut',
    title: '缓动类型',
    enum: [
        { 'linear': 'linear' },
        { 'easeIn': 'easeIn' },
        { 'easeOut': 'easeOut' },
        { 'easeInOut': 'easeInOut' }
    ]
});
CameraTransition.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });
// 与 UIManager 协同：主菜单组与默认子机位名（用于抑制 S 键将第三人称的切换留给 UIManager）
CameraTransition.attributes.add('mainMenuGroupName', { type: 'string', default: 'mainMenu', title: '主菜单机位组名' });
CameraTransition.attributes.add('mainMenuMainPos',   { type: 'string', default: 'main',     title: '主菜单默认子机位名' });

// ----- 初始化 -----
CameraTransition.prototype.initialize = function () {
    // 单例管理 - 支持场景切换时的实例替换
    if (CameraTransition._instance && CameraTransition._instance !== this) {
        if (this.enableDebugLog) {
            console.log('[CameraTransition] 检测到场景切换，替换旧实例');
        }
        // 清理旧实例
        var oldInstance = CameraTransition._instance;
        if (oldInstance && typeof oldInstance.destroy === 'function') {
            oldInstance.destroy();
        }
    }
    
    CameraTransition._instance = this;
    // 过渡插值状态
    this._isTransitioning = false;
    this._transitionTime = 0;
    this._startPos  = new pc.Vec3();
    this._startRot  = new pc.Quat();
    this._targetPos = new pc.Vec3();
    this._targetRot = new pc.Quat();
    this._startParams  = {};
    this._targetParams = {};
    this._onCompleteCallback = null;

    // 当前机位状态（键盘切换依赖）
    this._currentPositionGroup = null;
    this._currentPositionIndex = 0;

    // 机位配置 & 就绪队列
    this._cameraPositions = {};
    this._ready = false;
    this._pendingCalls = []; // 队列：资源未就绪时把调用排队，资源就绪后统一执行

    // 键盘输入监听
    this._setupKeyboardInput();
    
    // 移动端摇杆输入监听
    this._setupMobileInput();

    // 预加载机位数据
    this._loadCameraPositions();

    // 仅在 UI 处于 LOCKED_MULTI 时允许键盘控制机位
    this._inputEnabled = true;
    this._uiState = null; // 记录UIManager当前状态
    
    var self = this;
    
    // 监听UIManager状态变化
    this._onUIStateChanged = function (data) {
        if (data && data.to) {
            self._uiState = data.to;
            if (self.enableDebugLog) {
                console.log('[CameraTransition] UIManager state changed to:', data.to);
            }
        }
    };
    this.app.on('ui:state_changed', this._onUIStateChanged, this);
    
    // 监听相机控制状态变化
    this._onUiControlChanged = function (e) {
        var to = e && e.to;
        var from = e && e.from;
        
        // 如果UIManager正在播放动画（first_time_intro或typewriter），不处理相机状态变化
        if (self._uiState === 'first_time_intro' || self._uiState === 'typewriter') {
            if (self.enableDebugLog) {
                console.log('[CameraTransition] Ignoring camera state change during UIManager animation:', self._uiState);
            }
            return;
        }
        
        // UIManager 发出的 to 是 'locked_multi' / 'free_follow' 等字符串
        var wasEnabled = self._inputEnabled;
        self._inputEnabled = (to === 'locked_multi');
        
        if (self.enableDebugLog || wasEnabled !== self._inputEnabled) {
            console.log('[CameraTransition] ui:control_state_changed event:', e, 'inputEnabled:', wasEnabled, '->', self._inputEnabled);
        }
    };
    this.app.on('ui:control_state_changed', this._onUiControlChanged, this);

    // 取消跨层事件订阅：隐藏按钮改由 UIManager 直接驱动 CameraUIController（camera:transition:start）
};

// ----- 机位配置加载（异步） -----
CameraTransition.prototype._loadCameraPositions = function () {
    var self = this;
    this._cameraPositions = {};

    var configAsset = this.app.assets.find('cameraPosition.json', 'json');

    function onLoaded(asset) {
        self._cameraPositions = (asset && asset.resource) || {};
        self._flushReady();
        try {
            self.app.fire('camera:positions:ready', Object.keys(self._cameraPositions || {}));
        } catch (e) {}
        if (self.enableDebugLog) console.log('[CameraTransition] positions ready:', Object.keys(self._cameraPositions || {}));
    }

    if (configAsset) {
        if (configAsset.resource) {
            onLoaded(configAsset);
        } else {
            configAsset.once('load', onLoaded);
            this.app.assets.load(configAsset);
        }
    } else {
        // 没有配置也视为就绪（空机位表），避免调用者永远等待
        this._cameraPositions = {};
        this._flushReady();
        try { this.app.fire('camera:positions:ready', []); } catch (e) {}
        if (this.enableDebugLog) console.warn('[CameraTransition] cameraPosition.json not found, positions empty.');
    }
};

// ----- 就绪排队工具 -----
CameraTransition.prototype._ensureReady = function (cb) {
    if (this._ready) { cb(); return; }
    this._pendingCalls.push(cb);
};

CameraTransition.prototype._flushReady = function () {
    this._ready = true;
    var q = this._pendingCalls.slice();
    this._pendingCalls.length = 0;
    for (var i = 0; i < q.length; i++) {
        try { q[i](); } catch (e) { if (this.enableDebugLog) console.warn('[CameraTransition] pending call error:', e); }
    }
};

// ----- 内部工具 -----
CameraTransition.prototype._isAt = function (groupName, subPosName) {
    if (this._currentPositionGroup !== groupName) return false;
    try {
        var grp = this._cameraPositions && this._cameraPositions[groupName];
        if (!grp || !grp.positions || !grp.positions.length) return false;
        var idx = this._currentPositionIndex|0; idx = Math.max(0, Math.min(idx, grp.positions.length - 1));
        var cur = grp.positions[idx];
        return !!(cur && cur.name === subPosName);
    } catch (e) { return false; }
};

CameraTransition.prototype._ease = function (t, type) {
    switch (type) {
        case 'linear':   return t;
        case 'easeIn':   return t * t;
        case 'easeOut':  return 1 - (1 - t) * (1 - t);
        case 'easeInOut':return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
        default:         return t;
    }
};

CameraTransition.prototype._lerp = function (a, b, t) {
    return a + (b - a) * t;
};

// 当前相机控制脚本参数
CameraTransition.prototype._getCurrentCameraParams = function () {
    var c = this.entity.script && this.entity.script.followCamera;
    if (c) {
        return {
            pitchMin: c.minPitch != null ? c.minPitch : (c.pitchMin != null ? c.pitchMin : -60),
            pitchMax: c.maxPitch != null ? c.maxPitch : (c.pitchMax != null ? c.pitchMax : 60),
            yawMin:   c.yawMin  != null ? c.yawMin  : -180,
            yawMax:   c.yawMax  != null ? c.yawMax  :  180,
            mouseSensitivity: c.mouseSensitivity != null ? c.mouseSensitivity : 0.3
        };
    }
    return { pitchMin:-60, pitchMax:60, yawMin:-180, yawMax:180, mouseSensitivity:0.3 };
};

CameraTransition.prototype._applyCameraParams = function (params) {
    var c = this.entity.script && this.entity.script.followCamera;
    if (c) {
        // 兼容属性名
        if ('minPitch' in c) c.minPitch = params.pitchMin;
        if ('maxPitch' in c) c.maxPitch = params.pitchMax;
        if ('pitchMin' in c) c.pitchMin = params.pitchMin;
        if ('pitchMax' in c) c.pitchMax = params.pitchMax;
        c.yawMin = params.yawMin;
        c.yawMax = params.yawMax;
        c.mouseSensitivity = params.mouseSensitivity;
    }
    try { this.app.fire('camera:params:changed', params); } catch (e) {}
};

// ----- 公共：过渡（带动画） -----
CameraTransition.prototype.transitionToPosition = function (positionName, subPositionName, onComplete) {
    var self = this;
    if (typeof subPositionName === 'function') { onComplete = subPositionName; subPositionName = null; }

    // 如果已就绪，立即执行
    if (this._ready) {
        var config = self._getPositionConfig(positionName, subPositionName);
        if (!config) {
            if (self.enableDebugLog) console.warn('[CameraTransition] no config for', positionName, subPositionName);
            return false;
        }
        if (self._isTransitioning) {
            if (self.enableDebugLog) console.warn('[CameraTransition] already transitioning, ignore.');
            return false;
        }

        // 起止姿态
        self._startPos.copy(self.entity.getPosition());
        self._startRot.copy(self.entity.getRotation());
        self._targetPos.set(config.position.x, config.position.y, config.position.z);
        self._targetRot.setFromEulerAngles(config.rotation.x, config.rotation.y, config.rotation.z);

        // 参数插值
        self._startParams = self._getCurrentCameraParams();
        self._targetParams = {
            pitchMin: config.pitchMin,
            pitchMax: config.pitchMax,
            yawMin: config.yawMin,
            yawMax: config.yawMax,
            mouseSensitivity: config.mouseSensitivity
        };

        // 更新当前机位组/索引（供 WASD 使用）
        self.setCurrentPositionGroup(positionName, subPositionName);

        // 开始过渡
        self._isTransitioning = true;
        self._transitionTime = 0;
        self._onCompleteCallback = onComplete || null;

        // 广播开始（UI/按钮依赖）
        try { self.app.fire('camera:transition:start', positionName, config); } catch (e) {}

        return true;
    }
    
    // 如果未就绪，加入队列
    this._ensureReady(function () {
        self.transitionToPosition(positionName, subPositionName, onComplete);
    });

    return true; // 返回 true 表示调用已接受（排队中）
};

// ----- 公共：瞬切（无动画） -----
// 现在也会广播 camera:transition:start，便于 UI 第一帧就拿到机位。
CameraTransition.prototype.snapToPosition = function (positionName, subPositionName) {
    var self = this;
    
    // 如果已就绪，立即执行
    if (this._ready) {
        var config = self._getPositionConfig(positionName, subPositionName);
        if (!config) {
            if (self.enableDebugLog) console.warn('[CameraTransition] no config for', positionName, subPositionName);
            return false;
        }

        // 立即设置位置与朝向
        self.entity.setPosition(config.position.x, config.position.y, config.position.z);
        self.entity.setEulerAngles(config.rotation.x, config.rotation.y, config.rotation.z);

        // 立即应用相机控制参数
        self._applyCameraParams({
            pitchMin: config.pitchMin,
            pitchMax: config.pitchMax,
            yawMin: config.yawMin,
            yawMax: config.yawMax,
            mouseSensitivity: config.mouseSensitivity
        });

        // 更新当前机位组/索引（键盘切换）
        self.setCurrentPositionGroup(positionName, subPositionName);

        // ⭐ 也广播一次开始事件，唤醒 UI（比如按钮显隐/输入开关）
        try { self.app.fire('camera:transition:start', positionName, config); } catch (e) {}

        return true;
    }
    
    // 如果未就绪，加入队列（返回 true 表示已排队）
    this._ensureReady(function () {
        self.snapToPosition(positionName, subPositionName);
    });
    return true; // 返回 true 表示调用已接受（排队中）
};

// ----- Update：插值推进 -----
CameraTransition.prototype.update = function (dt) {
    if (!this._isTransitioning) return;

    this._transitionTime += dt;
    var t = Math.min(this._transitionTime / Math.max(0.0001, this.transitionDuration), 1.0);
    var k = this._ease(t, this.easeType);

    // 位置与旋转
    var p = new pc.Vec3().lerp(this._startPos, this._targetPos, k);
    var q = new pc.Quat().slerp(this._startRot, this._targetRot, k);
    this.entity.setPosition(p);
    this.entity.setRotation(q);

    // 参数插值
    var cur = {
        pitchMin: this._lerp(this._startParams.pitchMin, this._targetParams.pitchMin, k),
        pitchMax: this._lerp(this._startParams.pitchMax, this._targetParams.pitchMax, k),
        yawMin:   this._lerp(this._startParams.yawMin,   this._targetParams.yawMin,   k),
        yawMax:   this._lerp(this._startParams.yawMax,   this._targetParams.yawMax,   k),
        mouseSensitivity: this._lerp(this._startParams.mouseSensitivity, this._targetParams.mouseSensitivity, k)
    };
    this._applyCameraParams(cur);

    if (t >= 1.0) {
        this._isTransitioning = false;

        // 广播完成
        try { this.app.fire('camera:transition:complete', cur); } catch (e) {}

        // 回调
        if (this._onCompleteCallback) {
            var cb = this._onCompleteCallback;
            this._onCompleteCallback = null;
            try { cb(); } catch (e) {}
        }
    }
};

// ----- 数据访问：获取机位配置 -----
CameraTransition.prototype._getPositionConfig = function (positionName, subPositionName) {
    // 允许把 'default' 当作 null（取第一个）
    if (subPositionName === 'default') subPositionName = null;

    var all = this._cameraPositions || {};
    var group = all[positionName];
    if (!group) return null;

    // 新格式：{ positions: [ { name, position:{x,y,z}, rotation:{x,y,z}, pitchMin... }, ... ] }
    if (group.positions && Array.isArray(group.positions)) {
        if (!group.positions.length) return null;
        if (!subPositionName) return group.positions[0];
        for (var i = 0; i < group.positions.length; i++) {
            if (group.positions[i].name === subPositionName) return group.positions[i];
        }
        return null;
    }

    // 旧格式：group 自身就是机位对象
    return group;
};

// ----- 公共：机位列表（调试/工具） -----
CameraTransition.prototype.getAvailablePositions = function () {
    var res = {}, all = this._cameraPositions || {};
    for (var key in all) {
        var g = all[key];
        if (g && Array.isArray(g.positions)) res[key] = g.positions.map(function (p) { return p.name; });
        else res[key] = [key];
    }
    return res;
};

CameraTransition.prototype.getSubPositions = function (positionName) {
    var all = this._cameraPositions || {};
    var g = all[positionName];
    if (!g) return [];
    return Array.isArray(g.positions) ? g.positions.map(function (p) { return p.name; }) : [];
};

// ----- 公共：状态 -----
CameraTransition.prototype.isTransitioning = function () { return this._isTransitioning; };

CameraTransition.prototype.stopTransition = function () {
    if (this._isTransitioning) {
        this._isTransitioning = false;
        this._onCompleteCallback = null;
        try { this.app.fire('camera:transition:stopped'); } catch (e) {}
    }
};

// ----- 键盘输入（仅在 locked_multi + mainMenu 组时有效） -----
CameraTransition.prototype._setupKeyboardInput = function () {
    var self = this;
    this.app.keyboard.on(pc.EVENT_KEYDOWN, function (event) {
        if (!self._inputEnabled) return;
        if (self._currentPositionGroup !== (self.mainMenuGroupName || 'mainMenu')) return;
        
        // 如果UIManager正在播放动画（first_time_intro或typewriter），忽略按键输入
        if (self._uiState === 'first_time_intro' || self._uiState === 'typewriter') {
            if (self.enableDebugLog) {
                console.log('[CameraTransition] Key input ignored during UIManager animation state:', self._uiState);
            }
            return;
        }

        if (event.key === pc.KEY_A) {
            self._switchByKey('keyATo');
        } else if (event.key === pc.KEY_D) {
            self._switchByKey('keyDTo');
        } else if (event.key === pc.KEY_W) {
            self._switchByKey('keyWTo');
        } else if (event.key === pc.KEY_S) {
            // 若当前就在主菜单 main 子机位，S 键让 UIManager 接管（切到第三人称）
            if (!self._isAt(self.mainMenuGroupName, self.mainMenuMainPos)) {
                self._switchByKey('keySTo');
            }
        }
    }, this);
};

// ----- 移动端摇杆输入（映射到 WASD） -----
CameraTransition.prototype._setupMobileInput = function () {
    var self = this;
    var lastDirection = null;
    var directionCooldown = 0;
    
    this._onMobileJoystickMove = function (data) {
        if (!self._inputEnabled) return;
        if (self._currentPositionGroup !== (self.mainMenuGroupName || 'mainMenu')) return;
        
        // 如果UIManager正在播放动画（first_time_intro或typewriter），忽略摇杆输入
        if (self._uiState === 'first_time_intro' || self._uiState === 'typewriter') {
            if (self.enableDebugLog) {
                console.log('[CameraTransition] Mobile joystick input ignored during UIManager animation state:', self._uiState);
            }
            return;
        }
        
        if (!data || data.magnitude < 0.3) {
            lastDirection = null;
            return;
        }
        
        // 根据摇杆方向映射到 WASD
        // 注意：UIMobile 已经取反了 x 和 y，所以这里需要反向映射
        var x = -data.x;  // 反转 x
        var y = -data.y;  // 反转 y
        var angle = Math.atan2(y, x) * 180 / Math.PI; // -180 ~ 180
        
        var direction = null;
        if (angle >= -45 && angle < 45) {
            direction = 'D'; // 右
        } else if (angle >= 45 && angle < 135) {
            direction = 'W'; // 上
        } else if (angle >= -135 && angle < -45) {
            direction = 'S'; // 下
        } else {
            direction = 'A'; // 左
        }
        
        // 防止重复触发（冷却时间）
        if (direction === lastDirection) return;
        lastDirection = direction;
        
        // 执行对应的切换
        if (direction === 'A') {
            self._switchByKey('keyATo');
        } else if (direction === 'D') {
            self._switchByKey('keyDTo');
        } else if (direction === 'W') {
            self._switchByKey('keyWTo');
        } else if (direction === 'S') {
            // 若当前在主菜单 main 子机位，S 方向进入 free_follow
            if (self._isAt(self.mainMenuGroupName, self.mainMenuMainPos)) {
                // 直接切换到 free_follow
                if (typeof GlobalCameraManager !== 'undefined') {
                    var gcam = GlobalCameraManager.getInstance();
                    if (gcam) {
                        gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
                    }
                }
            } else {
                self._switchByKey('keySTo');
            }
        }
    };
    
    this.app.on('mobile:joystick:move', this._onMobileJoystickMove, this);
};

// 根据键位切换机位（索引）
// positions[*] 上需配置 keyATo/keyDTo/keyWTo/keySTo -> 目标索引（number）
CameraTransition.prototype._switchByKey = function (keyProperty) {
    if (!this._currentPositionGroup || this._isTransitioning) return;

    var group = this._cameraPositions[this._currentPositionGroup];
    if (!group || !Array.isArray(group.positions)) return;

    var cur = group.positions[this._currentPositionIndex];
    if (!cur || typeof cur[keyProperty] !== 'number') return;

    var toIndex = cur[keyProperty]|0;
    if (toIndex < 0 || toIndex >= group.positions.length || toIndex === this._currentPositionIndex) return;

    var toPos = group.positions[toIndex];
    this._currentPositionIndex = toIndex;
    this.transitionToPosition(this._currentPositionGroup, toPos.name);
};

// 设置当前机位组与索引（供 WASD 使用）
CameraTransition.prototype.setCurrentPositionGroup = function (groupName, positionName) {
    this._currentPositionGroup = groupName;

    var group = this._cameraPositions[groupName];
    if (group && Array.isArray(group.positions)) {
        if (positionName) {
            for (var i = 0; i < group.positions.length; i++) {
                if (group.positions[i].name === positionName) { this._currentPositionIndex = i; return; }
            }
            this._currentPositionIndex = 0;
        } else {
            this._currentPositionIndex = 0;
        }
    } else {
        this._currentPositionIndex = 0;
    }
};

// ----- 清理 -----
CameraTransition.prototype.destroy = function () {
    // 解绑所有事件监听器
    if (this.app && this._onUIStateChanged) {
        try { this.app.off('ui:state_changed', this._onUIStateChanged, this); } catch (e) {}
    }
    if (this.app && this._onUiControlChanged) {
        try { this.app.off('ui:control_state_changed', this._onUiControlChanged, this); } catch (e) {}
    }
    if (this.app && this._onUiButtonsHide) {
        try { this.app.off('ui:camera:buttons:hide', this._onUiButtonsHide, this); } catch (e) {}
    }
    if (this.app && this._onUiCameraActive) {
        try { this.app.off('ui:camera:active', this._onUiCameraActive, this); } catch (e) {}
    }
    if (this.app && this._onMobileJoystickMove) {
        try { this.app.off('mobile:joystick:move', this._onMobileJoystickMove, this); } catch (e) {}
    }
    
    // 清除单例引用
    if (CameraTransition._instance === this) {
        CameraTransition._instance = null;
    }
    
    if (this.enableDebugLog) {
        console.log('[CameraTransition] 已销毁并清理单例');
    }
};
