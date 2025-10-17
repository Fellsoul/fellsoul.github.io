/* global pc */
/**
 * @file climbable.js
 * @desc 可攀爬表面：玩家按住 F 键可以在大于 60 度的坡面上攀爬
 * @pc-attrs
 *   minClimbAngle:number=60, climbSpeed:number=2, climbKey:string="KeyF",
 *   enableDebugLog:boolean=false
 */
var Climbable = pc.createScript('climbable');

// 最小攀爬角度（度）
Climbable.attributes.add('minClimbAngle', {
    type: 'number',
    default: 60,
    title: '最小攀爬角度（度）'
});

// 攀爬速度
Climbable.attributes.add('climbSpeed', {
    type: 'number',
    default: 2,
    title: '攀爬速度'
});

// 攀爬按键
Climbable.attributes.add('climbKey', {
    type: 'string',
    default: 'KeyF',
    title: '攀爬按键'
});

// 调试日志
Climbable.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

// ===== 初始化 =====
Climbable.prototype.initialize = function () {
    // 确保实体有碰撞组件
    if (!this.entity.collision) {
        console.error('[Climbable] Entity missing collision component:', this.entity.name);
        console.error('[Climbable] Please add a Collision component in the editor');
        return;
    }
    
    // 确保实体有刚体组件（碰撞事件需要）
    if (!this.entity.rigidbody) {
        console.error('[Climbable] Entity missing rigidbody component:', this.entity.name);
        console.error('[Climbable] Please add a Rigidbody component (Type: Static) in the editor');
        return;
    }
    
    // 检查刚体类型
    if (this.entity.rigidbody.type !== pc.BODYTYPE_STATIC) {
        console.warn('[Climbable] Rigidbody type should be STATIC for climbable surfaces');
    }
    
    // 绑定碰撞事件
    this.entity.collision.on('collisionstart', this._onCollisionStart, this);
    this.entity.collision.on('collisionend', this._onCollisionEnd, this);
    
    // 当前接触的玩家
    this._playerInContact = null;
    
    console.log('[Climbable] Initialized:', this.entity.name, 'Rigidbody type:', this.entity.rigidbody.type);
};

// ===== 碰撞开始 =====
Climbable.prototype._onCollisionStart = function (result) {
    console.log('[Climbable] collisionstart event fired, other entity:', result.other.name);
    
    // 检查是否是玩家
    if (!this._isPlayer(result.other)) {
        console.log('[Climbable] Not a player, ignoring');
        return;
    }
    
    console.log('[Climbable] Player detected!');
    
    // 检查碰撞点
    if (!result.contacts || result.contacts.length === 0) {
        console.warn('[Climbable] No contact points in collision result');
        return;
    }
    
    // 检查碰撞角度
    var normal = result.contacts[0].normal;
    var angle = this._getAngleFromVertical(normal);
    
    console.log('[Climbable] Collision with player, angle:', angle.toFixed(1), '°', 'normal:', normal.toString());
    
    // 如果角度大于最小攀爬角度，通知玩家可以攀爬
    if (angle >= this.minClimbAngle) {
        this._playerInContact = result.other;
        
        // 通知玩家进入可攀爬区域
        this.app.fire('climbable:enter', {
            climbable: this.entity,
            normal: normal,
            angle: angle,
            climbSpeed: this.climbSpeed,
            climbKey: this.climbKey
        });
        
        if (this.enableDebugLog) {
            console.log('[Climbable] Player can climb (angle >= ' + this.minClimbAngle + '°)');
        }
    }
};

// ===== 碰撞结束 =====
Climbable.prototype._onCollisionEnd = function (result) {
    if (!this._isPlayer(result.other)) return;
    
    if (this._playerInContact === result.other) {
        this._playerInContact = null;
        
        // 通知玩家离开可攀爬区域
        this.app.fire('climbable:exit', {
            climbable: this.entity
        });
        
        if (this.enableDebugLog) {
            console.log('[Climbable] Player left climbable surface');
        }
    }
};

// ===== 检查是否是玩家 =====
Climbable.prototype._isPlayer = function (entity) {
    if (!entity) return false;
    return entity.name === 'Player' || (entity.tags && entity.tags.has('player'));
};

// ===== 计算法线与垂直方向的夹角 =====
Climbable.prototype._getAngleFromVertical = function (normal) {
    // 垂直向上方向
    var up = new pc.Vec3(0, 1, 0);
    
    // 计算法线与垂直方向的夹角（度）
    var dot = normal.dot(up);
    var angle = Math.acos(pc.math.clamp(dot, -1, 1)) * pc.math.RAD_TO_DEG;
    
    return angle;
};

// ===== 清理 =====
Climbable.prototype.destroy = function () {
    if (this.entity.collision) {
        this.entity.collision.off('collisionstart', this._onCollisionStart, this);
        this.entity.collision.off('collisionend', this._onCollisionEnd, this);
    }
    
    // 如果玩家还在接触中，通知离开
    if (this._playerInContact) {
        this.app.fire('climbable:exit', { climbable: this.entity });
    }
};
