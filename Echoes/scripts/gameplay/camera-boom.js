/* global pc */
var CameraBoom = pc.createScript('cameraBoom');

/** ——— 属性 ——— **/
CameraBoom.attributes.add('target',   { type: 'entity', title: '跟随目标（一般是 Player/Hips 的空节点）' });
CameraBoom.attributes.add('pivotOffset', { type: 'vec3', default: [0, 1.6, 0], title: '枢点相对target偏移(头/肩高度)' });
CameraBoom.attributes.add('distance', { type: 'number', default: 4.0, title: '理想距离' });
CameraBoom.attributes.add('minDistance', { type: 'number', default: 0.4, title: '最小距离(贴近时下限)' });
CameraBoom.attributes.add('height',   { type: 'number', default: 0.2, title: '相机额外抬高' });
CameraBoom.attributes.add('safety',   { type: 'number', default: 0.15, title: '安全间隙(防止嵌入)' });
CameraBoom.attributes.add('smoothPos',{ type: 'number', default: 12,   title: '位置平滑(越大越跟手)' });
CameraBoom.attributes.add('mask',     { type: 'number', default: 1,    title: '碰撞遮罩(只和这些层碰撞)' });
CameraBoom.attributes.add('ignoreSelf', { type: 'boolean', default: true, title: '忽略玩家自身碰撞' });

/** ——— 缓存 ——— **/
CameraBoom.prototype.initialize = function () {
    this._curPos = this.entity.getPosition().clone();
    this._hitPoint = new pc.Vec3();
    this._tmp = {
        from: new pc.Vec3(),
        to:   new pc.Vec3(),
        dir:  new pc.Vec3()
    };
    if (!this.target) {
        console.error('[CameraBoom] 请在属性中设置 target');
        this.enabled = false;
    }
};

CameraBoom.prototype.update = function (dt) {
    if (!this.enabled || !this.target) return;

    // 1) 计算枢点（从 target 的世界位置 + pivotOffset）
    var targetPos = this.target.getPosition();
    var pivot = this._tmp.from;
    pivot.set(targetPos.x + this.pivotOffset.x,
              targetPos.y + this.pivotOffset.y,
              targetPos.z + this.pivotOffset.z + 0);

    // 2) 以 target 的朝向（其世界 forward）反向拉出理想相机点
    //    若你有独立的玩家 yaw，可改用它来计算方向
    var forward = this.target.forward; // world forward（注意 PC 的 forward 是 -Z）
    var backDir = this._tmp.dir.set(-forward.x, -forward.y, -forward.z).normalize();

    var ideal = this._tmp.to;
    ideal.set(
        pivot.x + backDir.x * this.distance,
        pivot.y + this.height + backDir.y * this.distance,
        pivot.z + backDir.z * this.distance
    );

    // 3) Raycast：从 pivot → ideal 检查遮挡
    var result = this.app.systems.rigidbody.raycastFirst(pivot, ideal, this.mask);
    var finalPos;

    if (result && (!this.ignoreSelf || !this._isSelf(result.entity))) {
        // 被遮挡：把相机放到命中点前 safety
        var hit = result.point || this._hitPoint.copy(result.hitPoint); // API 版本差异处理
        var toCam = this._tmp.dir.set(ideal.x - pivot.x, ideal.y - pivot.y, ideal.z - pivot.z).normalize();
        finalPos = this._curPos; // 复用
        finalPos.set(
            hit.x - toCam.x * this.safety,
            hit.y - toCam.y * this.safety,
            hit.z - toCam.z * this.safety
        );
        // 同时限制最小距离，防止完全贴在 pivot 上
        var dist = finalPos.sub(pivot).length();
        if (dist < this.minDistance) {
            finalPos.normalize().scale(this.minDistance).add(pivot);
        }
    } else {
        // 不遮挡：使用理想位置
        finalPos = ideal.clone();
    }

    // 4) 平滑移动相机
    var t = 1 - Math.exp(-this.smoothPos * dt);
    this._curPos.lerp(this._curPos, finalPos, t);
    this.entity.setPosition(this._curPos);

    // 5) 让相机朝向目标（如果你是第三人称跟随）
    this.entity.lookAt(pivot);
};

/** 忽略玩家自身（可按标签/名字/层判断） */
CameraBoom.prototype._isSelf = function (ent) {
    // 常用判断：命中实体在 target 的层级树内
    while (ent) {
        if (ent === this.target || ent === this.target.root) return true;
        ent = ent.parent;
    }
    return false;
};
