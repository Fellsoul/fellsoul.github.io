/* global pc */
var PlayerController = pc.createScript('playerController');

// ====== 可调参数 ======
PlayerController.attributes.add('walkSpeed', { type: 'number', default: 4, title: '走路速度' });
PlayerController.attributes.add('runSpeed',  { type: 'number', default: 7, title: '跑步速度' });
PlayerController.attributes.add('accel',     { type: 'number', default: 12, title: '加速(越大越快到目标)' });
PlayerController.attributes.add('decel',     { type: 'number', default: 16, title: '减速(松键后收敛)' });
PlayerController.attributes.add('airControl',{ type: 'number', default: 0.3, title: '空中控制(0~1)' });
PlayerController.attributes.add('jumpSpeed', { type: 'number', default: 6, title: '跳起初速度' });
PlayerController.attributes.add('groundCheckDistance', { type: 'number', default: 0.6, title: '落地检测距离' });
PlayerController.attributes.add('groundCheckHz', { type: 'number', default: 30, title: '落地检测频率(Hz, 降帧压测)' });

// 攀爬相关
PlayerController.attributes.add('climbSpeed', { type: 'number', default: 2, title: '攀爬速度' });
PlayerController.attributes.add('climbKey', { type: 'string', default: 'KeyF', title: '攀爬按键' });
PlayerController.attributes.add('climbOffset', { type: 'number', default: 0.35, title: '贴墙间距(米)' });
PlayerController.attributes.add('climbStickGain', { type: 'number', default: 12, title: '贴附强度(越大越贴墙)' });
PlayerController.attributes.add('climbMaxSlopeDeg', { type: 'number', default: 89, title: '可攀最大坡度(°)' });

PlayerController.attributes.add('cameraEntity', { type: 'entity', title: '相机实体(可选)' });
PlayerController.attributes.add('visualPivot', { type: 'entity', title: '可视旋转节点(建议)' });

PlayerController.attributes.add('mouseSensitivity', { type: 'number', default: 0.3, title: '鼠标灵敏度' });
PlayerController.attributes.add('autoRotateWithMovement', { type: 'boolean', default: false, title: '移动时自动转向(不用鼠标时)' });
PlayerController.attributes.add('invertForward', { type: 'boolean', default: true, title: '反向前后(W/S反转)' });
PlayerController.attributes.add('invertRight', { type: 'boolean', default: true, title: '反向左右(A/D反转)' });

// 键盘转向设置（用相机方向作为参考）
PlayerController.attributes.add('turnWithKeys', { type: 'boolean', default: true, title: '方向键控制朝向(基于相机)' });
PlayerController.attributes.add('turnTimeSeconds', { type: 'number', default: 0.8, title: '键盘转向时长(秒)' });

// 事件广播频率限制（10Hz）
PlayerController.attributes.add('eventHz', { type: 'number', default: 10, title: '状态/速度广播频率(Hz)' });

// 旋转阈值（角度差小于该值则不更新）
PlayerController.attributes.add('yawEpsilonDeg', { type: 'number', default: 0.1, title: '旋转更新阈值(度)' });

// =========== 工具 ===========
PlayerController.prototype._normalizeAngle = function (a) {
    a = ((a % 360) + 360) % 360; // 0..360
    if (a > 180) a -= 360;       // -180..180
    return a;
};

PlayerController.prototype._lerpAngle = function (a, b, t) {
    a = this._normalizeAngle(a);
    b = this._normalizeAngle(b);
    var d = this._normalizeAngle(b - a);
    return this._normalizeAngle(a + d * Math.max(0, Math.min(1, t)));
};

// =========== 初始化 ===========
PlayerController.prototype.initialize = function () {
    this.rigidbody = this.entity.rigidbody;
    if (!this.rigidbody) { this.enabled = false; return; }

    // —— 只在初始化时克隆材质（不会卡）——
    var r = this.entity.render;
    if (r && r.meshInstances) {
        r.meshInstances.forEach(mi => {
            var mat = mi.material && mi.material.clone();
            if (!mat) return;
            // 近似无光
            mat.metalness = 0;
            if ('roughness' in mat) mat.roughness = 1;
            if (mat.specular) mat.specular.set(0,0,0);
            if ('envIntensity' in mat) mat.envIntensity = 0;
            mat.useLighting = false;
            mat.emissive.set(1,1,1);
            mat.update();
            mi.material = mat;
        });
    }

    // 物理参数：禁止角速度，降低线性阻尼避免卡顿
    this.rigidbody.linearDamping  = 0.2; // 降低阻尼，避免移动卡顿
    this.rigidbody.angularDamping = 1.0;
    this.rigidbody.angularFactor  = new pc.Vec3(0, 0, 0);
    this.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
    this.rigidbody.friction = 0.8; // 摩擦力

    // —— 预分配临时向量（PERF：避免 GC）——
    this._tmpVel   = new pc.Vec3();
    this._tmpHoriz = new pc.Vec3();
    this._tmpDir   = new pc.Vec3();
    this._tmpPos   = new pc.Vec3();
    this._tmpStart = new pc.Vec3();
    this._tmpEnd   = new pc.Vec3();

    // 输入与状态
    this._input = new pc.Vec3(); // (x,0,z)
    this.keys = { w:false, s:false, a:false, d:false, shift:false };
    this.isRunning = false;
    this.isGrounded = false;
    this.speedMagnitude = 0;
    this.playerYaw = this._normalizeAngle(this.entity.getEulerAngles().y);
    this._lastAppliedYaw = this.playerYaw;

    // 玩家行动状态
    this.actionState = 'Idle';

    // 移动端输入
    this.mobileInput = new pc.Vec2(0, 0);
    this.mobileMagnitude = 0;
    this.mobileState = 'idle';

    // 输入绑定（键盘）
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this.onKeyDown, this);
    this.app.keyboard.on(pc.EVENT_KEYUP,   this.onKeyUp, this);

    // 移动端摇杆
    this._bindMobileEvents();

    // 事件广播节流
    this._evtInterval = 1 / Math.max(1, this.eventHz || 10);
    this._evtTimer = 0;
    this._prevActionState = null;

    // 地面检测节流
    this._groundInterval = 1 / Math.max(1, this.groundCheckHz || 30);
    this._groundTimer = 0;

    // 坐姿与锁定（根据场景判断初始状态）
    var sceneName = (this.app.scene && this.app.scene.name) || '';
    var isStartScene = (sceneName.toLowerCase() === 'start' || sceneName.toLowerCase() === 'main');
    
    this.isSitting = isStartScene; // 起始场景默认坐姿
    this.actionState = isStartScene ? 'Sitting' : 'Idle';
    
    // 攀爬状态
    this.isClimbing = false;
    this.climbableData = null; // { normal, angle, climbSpeed }
    
    // console.log('[PlayerController] Scene:', sceneName, 'isStartScene:', isStartScene, 'Initial state:', this.actionState);
    
    // 如果是起始场景，立即设置为坐姿状态
    if (isStartScene) {
        try {
            this.rigidbody.linearVelocity  = new pc.Vec3(0,0,0);
            this.rigidbody.angularVelocity = new pc.Vec3(0,0,0);
            this.rigidbody.type = pc.BODYTYPE_STATIC;
            this.lockAction();
            // console.log('[PlayerController] Start scene - sitting state set, actionState:', this.actionState);
        } catch (e) {
            console.error('[PlayerController] Failed to set sitting state:', e);
        }
    } else {
        // 非起始场景，设置为站立状态 + 自由跟随相机
        try {
            this.rigidbody.type = pc.BODYTYPE_DYNAMIC;
            this.rigidbody.linearFactor = new pc.Vec3(1, 1, 1);
            this.actionEnabled = true;
            // console.log('[PlayerController] Non-start scene - standing state set');
            
            // 设置相机为自由跟随模式
            setTimeout(function() {
                try {
                    if (typeof GlobalCameraManager !== 'undefined') {
                        var gcam = GlobalCameraManager.getInstance();
                        if (gcam) {
                            gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
                            // console.log('[PlayerController] Camera set to FREE_FOLLOW for non-start scene');
                        }
                    } else {
                        // 通过事件设置
                        self.app.fire('ui:control:set', 'FREE_FOLLOW');
                        // console.log('[PlayerController] Sent ui:control:set FREE_FOLLOW');
                    }
                } catch (e) {
                    console.warn('[PlayerController] Failed to set camera state:', e);
                }
            }, 100); // 延迟确保相机管理器已初始化
        } catch (e) {
            console.error('[PlayerController] Failed to set standing state:', e);
        }
    }

    var self = this;
    this._onSetSitting = function (flag) {
        var wasSitting = self.isSitting;
        self.isSitting = !!flag;
        
        console.log('[PlayerController] _onSetSitting called, flag:', flag, 'wasSitting:', wasSitting, 'newSitting:', self.isSitting);
        
        if (self.isSitting === wasSitting) {
            // 状态未变化，跳过
            // console.log('[PlayerController] Sitting state unchanged, skipping');
            return;
        }
        
        if (self.isSitting) {
            self.lockAction();
            try {
                self.rigidbody.linearVelocity  = new pc.Vec3(0,0,0);  // ★★ 赋值
                self.rigidbody.angularVelocity = new pc.Vec3(0,0,0);  // ★★ 赋值
                self.rigidbody.type = pc.BODYTYPE_STATIC;
            } catch(e){}
            self.actionState = 'Sitting';
            console.log('[PlayerController] Set to sitting, actionState:', self.actionState);
        } else {
            // 站立：解锁行动 + DYNAMIC + 线性因子恢复 + 唤醒
            self.unlockAction(); // 内部已设置 DYNAMIC/linearFactor/wakeUp
            try {
                // 双保险：即使外部有脚本又把刚体改回去，这里也强制恢复一次
                self.rigidbody.type = pc.BODYTYPE_DYNAMIC;
                self.rigidbody.linearFactor = new pc.Vec3(1, 1, 1); // ★★ 赋值
                self.rigidbody.wakeUp();
            } catch (e) {}
            self.actionState = 'Idle';
            console.log('[PlayerController] Set to standing, actionState:', self.actionState);
        }
        self.app.fire('player:is_sitting', self.isSitting);
        self.app.fire('player:actionState', self.actionState);
        self._queueEventNow(); // 立即同步一次
    };
    this.app.on('player:set_sitting', this._onSetSitting, this);
    
    // 攀爬事件监听
    var self = this;
    this._onClimbableEnter = function(data) {
        self.climbableData = data;
        // console.log('[PlayerController] Climbable surface detected, angle:', data.angle.toFixed(1), '°');
    };
    this._onClimbableExit = function() {
        self.climbableData = null;
        self.isClimbing = false;
        self._updateActionState();
        // console.log('[PlayerController] Left climbable surface');
    };
    this.app.on('climbable:enter', this._onClimbableEnter, this);
    this.app.on('climbable:exit', this._onClimbableExit, this);

    this._onLockAction = this.lockAction.bind(this);
    this._onUnlockAction = this.unlockAction.bind(this);
    this.app.on('player:lock_action', this._onLockAction, this);
    this.app.on('player:unlock_action', this._onUnlockAction, this);

    // 立即广播初始坐姿状态
    this.app.fire('player:is_sitting', this.isSitting);
    this.app.fire('player:actionState', this.actionState);
    
    // 首次事件推送
    this._queueEventNow();
    
    // console.log('[PlayerController] Initialization complete, isSitting:', this.isSitting, 'actionState:', this.actionState);
};

// ===== 绑定移动端事件 =====
PlayerController.prototype._bindMobileEvents = function () {
    var self = this;
    this._onJoystickMove = function (data) {
        if (!data) return;
        
        // 检查 UIManager 状态，如果是 typewriter 或 first_time_intro 状态则忽略摇杆输入
        if (typeof UIManager !== 'undefined') {
            var uiManager = UIManager.getInstance();
            if (uiManager && (uiManager.currentState === 'typewriter' || uiManager.currentState === 'first_time_intro')) {
                if (self.enableDebugLog) {
                    console.log('[PlayerController] Mobile joystick input ignored during UIManager animation state:', uiManager.currentState);
                }
                return;
            }
        }
        
        self.mobileInput.set(data.x || 0, data.y || 0);
        self.mobileMagnitude = data.magnitude || 0;
        self.mobileState = data.moveState || 'idle';
    };
    this.app.on('mobile:joystick:move', this._onJoystickMove, this);
    
    // 移动端跳跃按钮
    this._onMobileJump = function () {
        // 检查 UIManager 状态，如果是 typewriter 或 first_time_intro 状态则忽略
        if (typeof UIManager !== 'undefined') {
            var uiManager = UIManager.getInstance();
            if (uiManager && (uiManager.currentState === 'typewriter' || uiManager.currentState === 'first_time_intro')) {
                if (self.enableDebugLog) {
                    console.log('[PlayerController] Mobile jump ignored during UIManager animation state:', uiManager.currentState);
                }
                return;
            }
        }
        self.jump();
    };
    this.app.on('mobile:jump', this._onMobileJump, this);
};

PlayerController.prototype.onKeyDown = function (e) {
    // 检查 UIManager 状态，如果是 typewriter 或 first_time_intro 状态则忽略移动和跳跃输入
    if (typeof UIManager !== 'undefined') {
        var uiManager = UIManager.getInstance();
        if (uiManager && (uiManager.currentState === 'typewriter' || uiManager.currentState === 'first_time_intro')) {
            if (this.enableDebugLog) {
                console.log('[PlayerController] Key input ignored during UIManager animation state:', uiManager.currentState, 'key:', e.key);
            }
            return;
        }
    }
    
    switch (e.key) {
        case pc.KEY_W: this.keys.w = true; break;
        case pc.KEY_S: this.keys.s = true; break;
        case pc.KEY_A: this.keys.a = true; break;
        case pc.KEY_D: this.keys.d = true; break;
        case pc.KEY_SPACE: this.jump(); break;
        case pc.KEY_SHIFT: this.keys.shift = true; break;
        case pc.KEY_ALT:
            if (document.exitPointerLock) { try { document.exitPointerLock(); } catch(e){} }
            break;
    }
};

PlayerController.prototype.onKeyUp = function (e) {
    // 检查 UIManager 状态，如果是 typewriter 或 first_time_intro 状态则忽略按键释放
    if (typeof UIManager !== 'undefined') {
        var uiManager = UIManager.getInstance();
        if (uiManager && (uiManager.currentState === 'typewriter' || uiManager.currentState === 'first_time_intro')) {
            if (this.enableDebugLog) {
                console.log('[PlayerController] Key release ignored during UIManager animation state:', uiManager.currentState, 'key:', e.key);
            }
            return;
        }
    }
    
    switch (e.key) {
        case pc.KEY_W: this.keys.w = false; break;
        case pc.KEY_S: this.keys.s = false; break;
        case pc.KEY_A: this.keys.a = false; break;
        case pc.KEY_D: this.keys.d = false; break;
        case pc.KEY_SHIFT: this.keys.shift = false; break;
    }
};

// =========== 每帧更新 ===========
PlayerController.prototype.update = function (dt) {
    if (!this.rigidbody) return;

    // 若已解锁但刚体仍是 STATIC（比如其他脚本又改了），则强制恢复
    if (this.actionEnabled && this.rigidbody.type !== pc.BODYTYPE_DYNAMIC) {
        try {
            this.rigidbody.type = pc.BODYTYPE_DYNAMIC;
            this.rigidbody.linearFactor = new pc.Vec3(1, 1, 1); // ★★ 赋值
            this.rigidbody.wakeUp();
        } catch (e) {}
    }

    // —— Grounded：固定频率检测（PERF）——
    this._groundTimer += dt;
    if (this._groundTimer >= this._groundInterval) {
        this._groundTimer -= this._groundInterval;
        this._checkGrounded(); // 30Hz 默认
    }

    // 若禁止行动 → 仅锁定“输入驱动”的移动与状态计算，不改写物理速度
    // 目的：保留当前 y 速度（重力/下落/上升）以及已有的水平速度，不强行清零
    if (!this.isActionEnabled || !this.isActionEnabled()) {
        // 不改 rigidbody.linearVelocity，仅更新显示/广播
        var v0 = this.rigidbody.linearVelocity;
        this.speedMagnitude = Math.sqrt(v0.x * v0.x + v0.z * v0.z);
        this.isRunning = false;
        this.actionState = this.isSitting ? 'Sitting' : 'Idle';
        this._broadcastThrottled(dt);
        return;
    }

    // —— 合并输入（移动端优先）——
    var rawX = 0, rawZ = 0;
    var hasMobileInput = this.mobileMagnitude > 0.05;

    if (hasMobileInput) {
        rawX = this.mobileInput.x;
        rawZ = this.mobileInput.y;
        this.isRunning = (this.mobileState === 'running') || (this.mobileMagnitude > 0.9);
    } else {
        rawZ = (this.keys.w ? 1 : 0) + (this.keys.s ? -1 : 0);
        rawX = (this.keys.d ? 1 : 0) + (this.keys.a ? -1 : 0);
        if (this.invertForward) rawZ = -rawZ;
        if (this.invertRight)   rawX = -rawX;
        rawZ = Math.max(-1, Math.min(1, rawZ));
        rawX = Math.max(-1, Math.min(1, rawX));
        this.isRunning = !!this.keys.shift;
    }
    this._input.set(rawX, 0, rawZ);
    
    // 检查攀爬按键
    var climbKeyPressed = this.app.keyboard.isPressed(pc[this.climbKey] || pc.KEY_F);
    
    // 更新攀爬状态
    if (this.climbableData && climbKeyPressed && this.actionEnabled) {
        this.isClimbing = true;
    } else {
        this.isClimbing = false;
    }

    // 是否有输入
    var hasInput = (rawX !== 0 || rawZ !== 0);

    // 速度目标（移动端按强度缩放）
    var targetSpeed = this.isRunning ? this.runSpeed : this.walkSpeed;
    if (hasMobileInput && this.mobileMagnitude > 0) {
        targetSpeed *= this.mobileMagnitude;
    }

    // 当前速度
    var vel = this.rigidbody.linearVelocity.clone(); // 拿一份副本来改
    
    // ===== 攀爬模式 =====
    if (this.isClimbing && this.climbableData) {
        // 攀爬时沿着表面移动
        var climbDir = new pc.Vec3();
        
        // 计算攀爬方向（左右移动）
        if (Math.abs(rawX) > 0.05) {
            // 获取相机右方向
            var camRight = this._getCameraRight();
            climbDir.add(camRight.mulScalar(rawX));
        }
        
        // 计算攀爬方向（上下移动）
        if (Math.abs(rawZ) > 0.05) {
            // 向上攀爬：沿着表面法线的反方向
            var climbUp = this.climbableData.normal.clone().mulScalar(-1);
            climbDir.add(climbUp.mulScalar(rawZ));
        }
        
        // 归一化并应用攀爬速度
        if (climbDir.length() > 0.05) {
            climbDir.normalize();
            climbDir.mulScalar(this.climbSpeed);
            vel.set(climbDir.x, climbDir.y, climbDir.z);
        } else {
            vel.set(0, 0, 0);
        }
        
        this.rigidbody.linearVelocity = vel;
        this.speedMagnitude = climbDir.length();
        this.actionState = 'Climbing';
    }
    // ===== 正常移动模式 =====
    else {
        // 朝前移动：方向取自当前 yaw（而非输入向量本身）
        var dir = this._getMoveDirFromYaw(0, -1, this._tmpDir); // 传入复用向量
        if (!hasInput) dir.set(0,0,0);
        var desiredX = dir.x * (hasInput ? targetSpeed : 0);
        var desiredZ = dir.z * (hasInput ? targetSpeed : 0);

        this._tmpHoriz.set(vel.x, 0, vel.z);

        // 加减速系数
        var k = hasInput
            ? (this.isGrounded ? this.accel : this.accel * this.airControl)
            : (this.isGrounded ? this.decel : this.decel * this.airControl);

        // 平滑插值（无分配）
        var t = 1 - Math.exp(-k * dt);
        this._tmpHoriz.x = this._tmpHoriz.x + (desiredX - this._tmpHoriz.x) * t;
        this._tmpHoriz.z = this._tmpHoriz.z + (desiredZ - this._tmpHoriz.z) * t;

        vel.set(this._tmpHoriz.x, vel.y, this._tmpHoriz.z);
        this.rigidbody.linearVelocity = vel;       // ★★ 必须重新赋值
        this.speedMagnitude = Math.sqrt(this._tmpHoriz.x * this._tmpHoriz.x + this._tmpHoriz.z * this._tmpHoriz.z);
    }

    // —— 方向键控制朝向（只转 visualPivot，降低物理同步成本）——
    if (this.turnWithKeys && hasInput) {
        var camYaw = this._getCameraYaw();
        var inputAngle = Math.atan2(-this._input.x, this._input.z) * 180 / Math.PI;
        var targetYaw = this._normalizeAngle(camYaw + inputAngle);

        var tau = Math.max(0.001, this.turnTimeSeconds || 0.8);
        var alpha = 1 - Math.exp(-dt / tau);
        this.playerYaw = this._lerpAngle(this.playerYaw, targetYaw, alpha);
    }

    this._applyYawOptimized(); // 仅在角度变化超过阈值时更新

    // —— 状态判定 —— 
    var nextState = 'Idle';
    if (this.isClimbing) {
        // 攀爬状态细分
        if (hasInput) {
            if (Math.abs(rawX) > Math.abs(rawZ)) {
                // 左右移动为主
                nextState = rawX > 0 ? 'ClimbRight' : 'ClimbLeft';
            } else {
                // 上下移动为主
                nextState = rawZ > 0 ? 'ClimbUp' : 'ClimbDown';
            }
        } else {
            // 攀爬闲置（固定在墙上）
            nextState = 'ClimbIdle';
        }
    } else if (hasInput && this.speedMagnitude >= 0.05) {
        nextState = this.isRunning ? 'Runing' : 'Walk';
    }
    this.actionState = nextState;

    // —— 广播（限流）——
    this._broadcastThrottled(dt);
};

// =========== Grounded（30Hz） ===========
PlayerController.prototype._checkGrounded = function () {
    var p = this.entity.getPosition();
    
    // ⭐ 增加射线起点高度，避免在斜坡上射线从碰撞体内部开始
    // 从玩家中心位置开始（假设碰撞体高度约2米，中心在1米）
    this._tmpStart.set(p.x, p.y + 0.5, p.z);  // 从0.1改为0.5
    this._tmpEnd.set(p.x, p.y - this.groundCheckDistance, p.z);
    
    var hit = this.app.systems.rigidbody.raycastFirst(this._tmpStart, this._tmpEnd);
    
    // 确保射线击中的不是玩家自己
    var isHit = !!hit && hit.entity !== this.entity;
    
    // 额外检查：如果没有击中，尝试更长的射线（斜坡情况）
    if (!isHit && hit && hit.entity === this.entity) {
        // 射线击中了自己，从更高的位置重试
        this._tmpStart.set(p.x, p.y + 1.0, p.z);
        hit = this.app.systems.rigidbody.raycastFirst(this._tmpStart, this._tmpEnd);
        isHit = !!hit && hit.entity !== this.entity;
    }
    
    this.isGrounded = isHit;
};

// =========== 移动方向（复用输出向量） ===========
PlayerController.prototype._getMoveDirFromYaw = function (x, z, out) {
    // 本地输入 (x,z) → 我们永远以前向(-Z)走，所以这里传(0,-1)
    var lx = x;
    var lz = -z;

    var rad = this.playerYaw * Math.PI / 180;
    var s = Math.sin(rad), c = Math.cos(rad);

    var wx = c * lx + s * lz;
    var wz = -s * lx + c * lz;

    out.set(wx, 0, wz);
    if (out.lengthSq() > 0) out.normalize();
    return out;
};

// =========== 跳跃 ===========
PlayerController.prototype.jump = function () {
    // 如果在 LOCKED_MULTI 状态，跳跃触发站起来
    if (typeof GlobalCameraManager !== 'undefined') {
        var gcam = GlobalCameraManager.getInstance();
        if (gcam && gcam.getState() === GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI) {
            // 直接切换状态（与 S 方向相同的逻辑）
            gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
            return; // 不执行实际跳跃
        }
    }
    
    // 正常跳跃逻辑
    if (!this.isActionEnabled || !this.isActionEnabled() || !this.isGrounded) return;
    var v = this.rigidbody.linearVelocity.clone();
    v.y = this.jumpSpeed;
    this.rigidbody.linearVelocity = v;   // ★★ 必须重新赋值
};

// =========== 行动开关 ===========
PlayerController.prototype.actionEnabled = true;

PlayerController.prototype.isActionEnabled = function () {
    return !!this.actionEnabled;
};

PlayerController.prototype.lockAction = function () {
    // 仅锁定“输入”，不改写刚体速度/类型，避免打断重力等行为
    this.actionEnabled = false;
    // console.log('[PlayerController] lockAction (input-only) called, actionEnabled:', this.actionEnabled);
    if (this.app) this.app.fire('player:action_locked');
};

PlayerController.prototype.unlockAction = function () {
    this.actionEnabled = true;
    
    // 如果玩家处于坐姿状态，只解锁 actionEnabled，不改变刚体
    if (this.isSitting) {
        // console.log('[PlayerController] unlockAction (sitting mode) - actionEnabled set to true, rigidbody remains STATIC');
        if (this.app) this.app.fire('player:action_unlocked');
        return;
    }
    
    // 站立状态：仅恢复输入。若外部曾改刚体，可在此处恢复，但默认不强制改写
    try { if (this.rigidbody) this.rigidbody.wakeUp(); } catch (e) {}
    // console.log('[PlayerController] unlockAction (standing mode) - input unlocked, actionEnabled:', this.actionEnabled);
    if (this.app) this.app.fire('player:action_unlocked');
};

// =========== 相机朝向 ===========
PlayerController.prototype._getCameraYaw = function () {
    var yaw = this.playerYaw;
    var cam = this.cameraEntity;
    if (cam) {
        var followCam = cam.script && cam.script.followCamera;
        if (followCam && typeof followCam._yaw !== 'undefined') {
            yaw = followCam._yaw;
        } else if (cam.getEulerAngles) {
            yaw = cam.getEulerAngles().y;
        }
    }
    return this._normalizeAngle(yaw);
};

// =========== 获取相机右方向 ===========
PlayerController.prototype._getCameraRight = function () {
    var cam = this.cameraEntity;
    if (cam) {
        return cam.right.clone();
    }
    // 回退：使用玩家朝向
    var yaw = this.playerYaw * pc.math.DEG_TO_RAD;
    return new pc.Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
};

// =========== 仅在需要时应用旋转 ===========
PlayerController.prototype._applyYawOptimized = function () {
    var eps = this.yawEpsilonDeg || 0.1;
    var dy = Math.abs(this._normalizeAngle(this.playerYaw - this._lastAppliedYaw));
    if (dy < eps) return; // 角度变化太小，跳过
    
    if (this.visualPivot) {
        // 有独立可视节点：只转可视节点，刚体不转（需要对称碰撞体）
        this.visualPivot.setEulerAngles(0, this.playerYaw, 0);
    } else {
        // 无独立可视节点：必须用 teleport 同步刚体旋转
        var q = new pc.Quat();
        q.setFromEulerAngles(0, this.playerYaw, 0);
        this.rigidbody.teleport(this.entity.getPosition(), q);
    }
    
    this._lastAppliedYaw = this.playerYaw;
};

// =========== 广播（限流 + 立即触发入口） ===========
PlayerController.prototype._queueEventNow = function () {
    this._evtTimer = 9999;
    this._broadcastThrottled(0);
};

PlayerController.prototype._broadcastThrottled = function (dt) {
    this._evtTimer += dt;
    if (this._evtTimer >= this._evtInterval) {
        this._evtTimer = 0;

        if (this._prevActionState !== this.actionState) {
            this.app.fire('player:actionState', this.actionState);
            this._prevActionState = this.actionState;
        }
        this.app.fire('player:speed', this.speedMagnitude);
        this.app.fire('player:is_grounded', this.isGrounded);
    }
};

// =========== 销毁 ===========
PlayerController.prototype.destroy = function () {
    if (this.app && this.app.keyboard) {
        this.app.keyboard.off(pc.EVENT_KEYDOWN, this.onKeyDown, this);
        this.app.keyboard.off(pc.EVENT_KEYUP,   this.onKeyUp, this);
    }
    if (this.app && this._onJoystickMove) {
        this.app.off('mobile:joystick:move', this._onJoystickMove, this);
    }
    if (this.app && this._onMobileJump) {
        this.app.off('mobile:jump', this._onMobileJump, this);
    }
    if (this._onSetSitting) this.app.off('player:set_sitting', this._onSetSitting, this);
    if (this._onLockAction) this.app.off('player:lock_action', this._onLockAction, this);
    if (this._onUnlockAction) this.app.off('player:unlock_action', this._onUnlockAction, this);
    if (this._onClimbableEnter) this.app.off('climbable:enter', this._onClimbableEnter, this);
    if (this._onClimbableExit) this.app.off('climbable:exit', this._onClimbableExit, this);
};
