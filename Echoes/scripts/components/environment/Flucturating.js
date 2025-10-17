/**
 * @file fluctuating.js
 * @desc 通用“上下起伏”插件：按正弦在Y轴上下移动，适用于任意实体（水体/浮物/特效等）。
 * @pc-attrs
 *   amplitude:number=0.25, speed:number=1.0, phaseOffset:number=0.0,
 *   useWorldSpace:boolean=true, centerOffsetY:number=0
 */
/* global pc */
var Flucturating = pc.createScript('flucturating');

// ----- 属性 -----
Flucturating.attributes.add('amplitude',     { type: 'number', default: 0.25, title: '振幅(米)' });
Flucturating.attributes.add('speed',         { type: 'number', default: 1.0,  title: '速度(Hz比例)' });
Flucturating.attributes.add('phaseOffset',   { type: 'number', default: 0.0,  title: '相位偏移' });
Flucturating.attributes.add('useWorldSpace', { type: 'boolean', default: true, title: '世界空间(否则本地)' });
Flucturating.attributes.add('centerOffsetY', { type: 'number', default: 0.0,  title: '中心额外偏移Y(米)' });

// 摇摆（旋转）参数：单位为度，频率单位为 Hz 比例（与 speed 同概念）
Flucturating.attributes.add('swayEnabled', { type: 'boolean', default: true, title: '启用摇摆(旋转)' });
Flucturating.attributes.add('swayAmpX',   { type: 'number',  default: 0.0,  title: '摇摆幅度X(度)' });
Flucturating.attributes.add('swayAmpY',   { type: 'number',  default: 12.0, title: '摇摆幅度Y(度)' });
Flucturating.attributes.add('swayAmpZ',   { type: 'number',  default: 0.0,  title: '摇摆幅度Z(度)' });
Flucturating.attributes.add('swayFreqX',  { type: 'number',  default: 0.7,  title: '摇摆频率X' });
Flucturating.attributes.add('swayFreqY',  { type: 'number',  default: 1.0,  title: '摇摆频率Y' });
Flucturating.attributes.add('swayFreqZ',  { type: 'number',  default: 0.9,  title: '摇摆频率Z' });
Flucturating.attributes.add('swayPhaseX', { type: 'number',  default: 0.0,  title: '相位X' });
Flucturating.attributes.add('swayPhaseY', { type: 'number',  default: 0.0,  title: '相位Y' });
Flucturating.attributes.add('swayPhaseZ', { type: 'number',  default: 0.0,  title: '相位Z' });

// ----- 内部状态 -----
Flucturating.prototype.initialize = function () {
    // 记录初始位置（世界/本地）
    this._t = 0;
    this._hasRb = !!this.entity.rigidbody;
    this._rb = this.entity.rigidbody || null;

    if (this.useWorldSpace) {
        this._basePos = this.entity.getPosition().clone();
    } else {
        this._basePos = this.entity.getLocalPosition().clone();
    }

    // 记录基础旋转（始终以世界旋转为基准，便于 teleport 使用）
    this._baseRot = this.entity.getRotation().clone();
    // 复用的临时对象
    this._tmpQuat = new pc.Quat();
    this._tmpEuler = new pc.Vec3();

    // 可选：给一点随机相位避免完全同步
    if (!this._hasOwnPhase) {
        this.phaseOffset = (this.phaseOffset || 0) + Math.random() * 0.5;
        this._hasOwnPhase = true;
    }
};

Flucturating.prototype.update = function (dt) {
    this._t += dt * (this.speed || 1.0);

    var y = this._basePos.y + this.centerOffsetY + Math.sin(this._t + this.phaseOffset) * (this.amplitude || 0);

    // 生成目标位置
    var pos;
    if (this.useWorldSpace) {
        var w = this.entity.getPosition();
        pos = new pc.Vec3(w.x, y, w.z);
    } else {
        var l = this.entity.getLocalPosition();
        pos = new pc.Vec3(l.x, y, l.z);
    }

    // 生成目标旋转（世界旋转基于 _baseRot 叠加欧拉偏移）
    var rot = this._baseRot;
    if (this.swayEnabled) {
        var t = this._t; // 已经乘了 speed
        var rx = (this.swayAmpX || 0) * Math.sin(t * (this.swayFreqX || 0) + (this.swayPhaseX || 0));
        var ry = (this.swayAmpY || 0) * Math.sin(t * (this.swayFreqY || 0) + (this.swayPhaseY || 0));
        var rz = (this.swayAmpZ || 0) * Math.sin(t * (this.swayFreqZ || 0) + (this.swayPhaseZ || 0));
        // 以度为单位叠加：rot = base * Q(rx,ry,rz)
        this._tmpQuat.setFromEulerAngles(rx, ry, rz);
        rot = this._baseRot.clone().mul(this._tmpQuat);
    }

    // 写回位置：若存在刚体，使用 rigidbody.teleport，保持当前旋转
    if (this._rb) {
        // 注意：teleport 需要世界坐标
        if (this.useWorldSpace) {
            this._rb.teleport(pos, rot);
        } else {
            // 本地空间目标需要换算到世界坐标
            var wp = this.entity.parent ? this.entity.parent.getWorldTransform().transformPoint(pos, new pc.Vec3()) : pos;
            this._rb.teleport(wp, rot);
        }
    } else {
        if (this.useWorldSpace) {
            this.entity.setPosition(pos);
            if (this.swayEnabled) this.entity.setRotation(rot);
        } else {
            this.entity.setLocalPosition(pos);
            if (this.swayEnabled) this.entity.setRotation(rot); // 直接写世界旋转，视觉一致
        }
    }
};

Flucturating.prototype.destroy = function () {
    // 复位到基准位置
    try {
        if (this._rb) {
            var wp = this.useWorldSpace ? this._basePos.clone() : (this.entity.parent ? this.entity.parent.getWorldTransform().transformPoint(this._basePos, new pc.Vec3()) : this._basePos.clone());
            this._rb.teleport(wp, this._baseRot);
        } else {
            if (this.useWorldSpace) this.entity.setPosition(this._basePos); else this.entity.setLocalPosition(this._basePos);
            this.entity.setRotation(this._baseRot);
        }
    } catch (e) {}
};
