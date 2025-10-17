/* global pc */
var WindZone = pc.createScript('windZone');

/** === 属性 === */
WindZone.attributes.add('force', { type: 'vec3', default: [0, 400, 0], title: '风力(牛顿/帧)' });
WindZone.attributes.add('pulseStrength', { type: 'number', default: 0.2, title: '脉动强度(0~1)' });
WindZone.attributes.add('turbulence', { type: 'number', default: 0.1, title: '湍流(0~1, 轻微抖动)' });

WindZone.attributes.add('particlesEnabled', { type: 'boolean', default: true, title: '启用粒子外观' });
WindZone.attributes.add('emitterRate', { type: 'number', default: 30, title: '粒子发射率(每秒)' });
WindZone.attributes.add('particleLifetime', { type: 'number', default: 1.2, title: '粒子寿命(秒)' });
WindZone.attributes.add('particleStartSize', { type: 'number', default: 0.15, title: '粒子起始尺寸' });
WindZone.attributes.add('particleEndSize', { type: 'number', default: 0.05, title: '粒子结束尺寸' });
WindZone.attributes.add('particleSpeed', { type: 'number', default: 3.0, title: '粒子初速度(米/秒, 沿风向)' });
WindZone.attributes.add('emitterBoxScale', { type: 'vec3', default: [1, 1, 1], title: '发射体积倍增(相对碰撞盒)' });
WindZone.attributes.add('tintStart', { type: 'rgba', default: [0.8, 1.0, 0.9, 0.35], title: '粒子起始色(rgba)' });
WindZone.attributes.add('tintEnd',   { type: 'rgba', default: [0.6, 0.9, 1.0, 0.0],  title: '粒子结束色(rgba)' });

/** === 内部 === */
WindZone.prototype.initialize = function () {
    if (!this.entity.collision || !this.entity.collision.isTrigger) {
        console.warn('[WindZone] 需要 collision 且 Is Trigger = true');
        return; // 如果没有正确的collision组件，直接返回
    }

    // 触发监听
    this.entity.collision.on('triggerenter', this._onEnter, this);
    this.entity.collision.on('triggerleave', this._onLeave, this);

    // 粒子外观
    this._makeOrUpdateParticles();

    // 风向可视化（编辑器里预览朝向）
    this._dir = new pc.Vec3(this.force.x, this.force.y, this.force.z);
    if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 1, 0);
    this._dir.normalize();
};

WindZone.prototype._makeOrUpdateParticles = function () {
    if (!this.particlesEnabled) return;

    // 已存在则更新
    if (this._fx && this._fx.particlesystem) {
        this._configureParticleComponent(this._fx.particlesystem);
        return;
    }

    // 创建子实体
    this._fx = new pc.Entity('WindParticles');
    this.entity.addChild(this._fx);

    this._fx.addComponent('particlesystem', {
        numParticles: Math.max(32, this.emitterRate * (this.particleLifetime || 1)),
        lifetime: Math.max(0.2, this.particleLifetime),
        rate: this.emitterRate,
        loop: true,
        emitterShape: pc.EMITTERSHAPE_BOX,
        emitterExtents: this._calcEmitterExtents(),
        initialVelocity: this.particleSpeed,
        // 让粒子跟随发射体移动
        localSpace: true,
        sort: pc.PARTICLESORT_NONE
    });

    this._configureParticleComponent(this._fx.particlesystem);
    this._orientParticlesToForce();
};

WindZone.prototype._calcEmitterExtents = function () {
    // 取碰撞盒大小作为发射体积基础
    var ext = new pc.Vec3(0.5, 0.5, 0.5);
    if (this.entity.collision && this.entity.collision.type === 'box') {
        ext.copy(this.entity.collision.halfExtents);
    }
    // 按倍增缩放
    ext.x *= this.emitterBoxScale.x;
    ext.y *= this.emitterBoxScale.y;
    ext.z *= this.emitterBoxScale.z;
    return ext;
};

WindZone.prototype._configureParticleComponent = function (ps) {
    // 颜色渐变
    ps.colorGraph = new pc.CurveSet([
        [this.tintStart.r, this.tintEnd.r],
        [this.tintStart.g, this.tintEnd.g],
        [this.tintStart.b, this.tintEnd.b]
    ]);
    ps.alphaGraph = new pc.Curve([this.tintStart.a, this.tintEnd.a]);

    // 尺寸渐变
    ps.scaleGraph = new pc.Curve([this.particleStartSize, this.particleEndSize]);

    // 方向速度（沿风向）
    var dir = new pc.Vec3(this.force.x, this.force.y, this.force.z).normalize();
    ps.velocityGraph = new pc.CurveSet([
        [dir.x * this.particleSpeed, dir.x * this.particleSpeed],
        [dir.y * this.particleSpeed, dir.y * this.particleSpeed],
        [dir.z * this.particleSpeed, dir.z * this.particleSpeed]
    ]);

    // 轻微湍流：用局部速度噪声
    var n = Math.max(0, Math.min(1, this.turbulence));
    ps.localVelocityGraph = new pc.CurveSet([
        [-n, n], [-n, n], [-n, n]
    ]);

    ps.rate = this.emitterRate;
    ps.lifetime = this.particleLifetime;
    ps.numParticles = Math.max(32, this.emitterRate * (this.particleLifetime || 1));
    ps.emitterExtents = this._calcEmitterExtents();

    ps.reset();
    ps.play();
};

WindZone.prototype._orientParticlesToForce = function () {
    if (!this._fx) return;
    var dir = new pc.Vec3(this.force.x, this.force.y, this.force.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();

    // 让粒子实体朝向风向（Z+ 看向力方向）
    var pos = this._fx.getPosition();
    var look = new pc.Vec3().add2(pos, dir);
    this._fx.lookAt(look);
};

WindZone.prototype._onEnter = function (other) {
    if (!other || !other.rigidbody) return;
    // 风脉动：缓慢正弦放大/缩小
    var time = this.app?.time ?? pc.now() * 0.001;
    var pulse = 1 + Math.sin(time * 2.0) * this.pulseStrength;

    var f = new pc.Vec3(this.force.x * pulse, this.force.y * pulse, this.force.z * pulse);
    // 推荐把持续施力逻辑放到“玩家侧”的 WindAff 中
    if (other.script && other.script.windAff && other.script.windAff.enter) {
        other.script.windAff.enter(f);
    }
};

WindZone.prototype._onLeave = function (other) {
    if (!other || !other.rigidbody) return;
    if (other.script && other.script.windAff && other.script.windAff.leave) {
        other.script.windAff.leave();
    }
};

WindZone.prototype.update = function (dt) {
    // 风向或参数在编辑器里被改动时，保持粒子朝向一致
    // （可选：提高编辑时的实时反馈）
    var f = this.force;
    if (!this._lastF || this._lastF.x !== f.x || this._lastF.y !== f.y || this._lastF.z !== f.z) {
        this._lastF = { x:f.x, y:f.y, z:f.z };
        this._orientParticlesToForce();
        if (this._fx && this._fx.particlesystem) this._configureParticleComponent(this._fx.particlesystem);
    }
};
