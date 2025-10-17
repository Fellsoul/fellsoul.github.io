/* global pc */
var PlayerAnimator = pc.createScript('playerAnimator');

// —— 可视化配置 —— //
PlayerAnimator.attributes.add('hips', { type: 'entity', title: 'Hips (has anim)' });
PlayerAnimator.attributes.add('layerName', { type: 'string', default: 'Base Layer', title: 'Anim Layer' });

// 首选：参数驱动（推荐）
PlayerAnimator.attributes.add('useParameters', { type: 'boolean', default: true, title: 'Use Parameters' });
PlayerAnimator.attributes.add('paramSpeed', { type: 'string', default: 'Speed' });
PlayerAnimator.attributes.add('paramIsMoving', { type: 'string', default: 'IsMoving' });
PlayerAnimator.attributes.add('paramIsRunning', { type: 'string', default: 'IsRunning' });
PlayerAnimator.attributes.add('paramIsSitting', { type: 'string', default: 'IsSitting', title: 'Param IsSitting' });

// 注意：本脚本不调用 play()/layer.play()，仅通过参数驱动状态图

PlayerAnimator.prototype.initialize = function () {
    // 取 anim 组件：优先 hips，其次自身
    this.animEntity = this.hips || this.entity;
    this.anim = this.animEntity.anim;
    
    // 速度平滑缓存
    this._smoothSpeed = 0;
    this._lastSpeed = 0;
    this._smoothing = 8; // 越大越跟手

    if (!this.anim) {
        console.error('[PlayerAnimator] Missing anim on Hips / entity'); 
        this.enabled = false;
        return;
    }

    // 订阅控制器事件
    this.app.on('player:actionState', this.onActionState, this);
    this.app.on('player:speed', this.onSpeed, this);
    this.app.on('player:is_sitting', this.onSitting, this);

    // 初始化参数（避免未定义导致条件不触发）
    if (this.useParameters) {
        if (this.paramSpeed)     this.anim.setFloat(this.paramSpeed, 0);
        if (this.paramIsMoving)  this.anim.setBoolean(this.paramIsMoving, false);
        if (this.paramIsRunning) this.anim.setBoolean(this.paramIsRunning, false);
        if (this.paramIsSitting) this.anim.setBoolean(this.paramIsSitting, false);
    }
};

// 低通平滑速度并喂给参数
PlayerAnimator.prototype.update = function (dt) {
    if (!this.anim) return;
    // exp 近似的线性插值：alpha = clamp(dt * smoothing, 0..1)
    var alpha = Math.min(1, Math.max(0, dt * this._smoothing));
    this._smoothSpeed += (this._lastSpeed - this._smoothSpeed) * alpha;

    if (this.useParameters && this.paramSpeed) {
        this.anim.setFloat(this.paramSpeed, this._smoothSpeed);
    }
};

PlayerAnimator.prototype.destroy = function () {
    this.app.off('player:actionState', this.onActionState, this);
    this.app.off('player:speed', this.onSpeed, this);
    this.app.off('player:is_sitting', this.onSitting, this);
};

PlayerAnimator.prototype.onSpeed = function (speed) {
    // 仅记录，实际设置放在 update 的平滑输出
    this._lastSpeed = Math.max(0, speed || 0);
};

PlayerAnimator.prototype.onActionState = function (state) {
    if (!this.anim) return;

    if (this.useParameters) {
        // 参数流：让状态机自己根据条件迁移
        var isMoving = (state === 'Walk' || state === 'Runing');
        if (this.paramIsMoving)  this.anim.setBoolean(this.paramIsMoving, isMoving);
        if (this.paramIsRunning) this.anim.setBoolean(this.paramIsRunning, state === 'Runing');
        if (this.paramIsSitting) this.anim.setBoolean(this.paramIsSitting, state === 'Sitting');
        // 可选：也可顺带设置一个离散整数/枚举参数
        return;
    }
    // 未启用参数方式时，不进行任何直接播放或强制跳转。
};

// 坐姿事件回调：设置 Animator 参数
PlayerAnimator.prototype.onSitting = function (flag) {
    if (!this.anim) return;
    if (this.useParameters && this.paramIsSitting) {
        this.anim.setBoolean(this.paramIsSitting, !!flag);
    }
};
