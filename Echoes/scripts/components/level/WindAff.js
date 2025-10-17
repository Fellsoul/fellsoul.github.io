/* global pc */
var WindAff = pc.createScript('windAff');

/** === 属性 === */
WindAff.attributes.add('accelerationMode', { type: 'boolean', default: false, title: '按加速度施力(与质量无关)' });
WindAff.attributes.add('airDrag', { type: 'number', default: 0.6, title: '空气阻力(越大越刹)' });
WindAff.attributes.add('liftFactor', { type: 'number', default: 0.0, title: '升力系数(基于水平速度)' });
WindAff.attributes.add('maxWindSpeed', { type: 'number', default: 12, title: '风下最大速度(米/秒, 0=不限)' });

/** === 内部 === */
WindAff.prototype.initialize = function () {
    this.force = null;             // 当前风力向量（世界系）
    this._tmp = new pc.Vec3();
};

WindAff.prototype.enter = function (force) {
    // 接收风带传入的力（世界系）
    this.force = new pc.Vec3(force.x, force.y, force.z);
};

WindAff.prototype.leave = function () {
    this.force = null;
};

WindAff.prototype.update = function (dt) {
    var rb = this.entity.rigidbody;
    if (!rb) return;

    // 空气阻力（与当前速度反向）
    var v = rb.linearVelocity.clone();
    if (v.lengthSq() > 1e-6 && this.airDrag > 0) {
        var drag = v.scale(-this.airDrag);
        rb.applyForce(drag);
    }

    // 升力（可选：当有水平风速时给予少量向上力，营造“托举感”）
    if (this.liftFactor > 0) {
        var horiz = v.clone(); horiz.y = 0;
        var lift = horiz.length() * this.liftFactor;
        if (lift > 0) rb.applyForce(0, lift, 0);
    }

    // 施加风力
    if (this.force) {
        if (this.accelerationMode) {
            // 施加“加速度”：F = a * m  ->  a 给定，则 F = a * mass
            var a = this.force; // 用 force 作为“加速度矢量”
            var mass = rb.mass || 1;
            rb.applyForce(a.x * mass, a.y * mass, a.z * mass);
        } else {
            // 直接当作力（牛顿/帧）
            rb.applyForce(this.force);
        }

        // 限速（在风作用方向上的最大速度）
        if (this.maxWindSpeed > 0) {
            var dir = this.force.clone().normalize();
            var speedAlong = v.dot(dir); // 投影速度
            if (speedAlong > this.maxWindSpeed) {
                // 反向削减超出的分量
                var excess = (speedAlong - this.maxWindSpeed);
                var counter = dir.scale(-excess * 10); // 系数大一点，快速收敛
                rb.applyForce(counter);
            }
        }
    }
};
