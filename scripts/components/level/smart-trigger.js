/* global pc */

/**
 * @file smart-trigger.js
 * @desc 可复用的触发器组件：支持碰撞触发或距离触发，可配置一次性/冷却/目标筛选
 * @pc-attrs
 *   targetEntity:entity, targetTag:string='player',
 *   useCollision:boolean=true, useDistance:boolean=false, distance:number=4, ignoreY:boolean=false,
 *   once:boolean=false, cooldown:number=0,
 *   enterEvent:string='trigger:enter', leaveEvent:string='trigger:leave',
 *   debugLog:boolean=false
 * 
 * @使用方法
 * 1. 碰撞触发：实体需有 collision 组件（无 rigidbody），useCollision=true
 * 2. 距离触发：useDistance=true，设置 distance 和 target
 * 3. 触发对象需有 rigidbody 或匹配 targetTag/targetEntity
 * 4. 触发时向实体自身和全局 app 发送 enterEvent/leaveEvent 事件
 */

var SmartTrigger = pc.createScript('smartTrigger');

/* ---------- 属性定义 ---------- */

// 触发目标：优先使用 targetEntity；若为空且 targetTag 非空，则按 tag 匹配
SmartTrigger.attributes.add('targetEntity', { 
    type: 'entity', 
    title: '目标实体',
    description: '指定触发对象（通常是玩家），留空则使用 targetTag'
});

SmartTrigger.attributes.add('targetTag', { 
    type: 'string', 
    default: 'player', 
    title: '目标Tag',
    description: '按标签筛选触发对象（targetEntity 为空时生效）'
});

// 触发方式
SmartTrigger.attributes.add('useCollision', { 
    type: 'boolean', 
    default: true, 
    title: '使用碰撞触发',
    description: '需要实体有 collision 组件但无 rigidbody（trigger volume）'
});

SmartTrigger.attributes.add('useDistance', { 
    type: 'boolean', 
    default: false, 
    title: '使用距离触发',
    description: '基于球形范围的距离检测'
});

SmartTrigger.attributes.add('distance', { 
    type: 'number', 
    default: 4, 
    min: 0,
    title: '距离阈值',
    description: '距离触发的半径（米），useDistance=true 时生效'
});

SmartTrigger.attributes.add('ignoreY', { 
    type: 'boolean', 
    default: false, 
    title: '忽略Y轴',
    description: '距离计算仅在水平面（XZ平面）'
});

// 行为控制
SmartTrigger.attributes.add('once', { 
    type: 'boolean', 
    default: false, 
    title: '一次性触发',
    description: '触发一次后失效（如检查点、拾取物）'
});

SmartTrigger.attributes.add('cooldown', { 
    type: 'number', 
    default: 0, 
    min: 0,
    title: '冷却时间',
    description: '触发后的冷却秒数，0 表示无冷却'
});

// 事件名称（会发到 this.entity 和 app）
SmartTrigger.attributes.add('enterEvent', { 
    type: 'string', 
    default: 'trigger:enter', 
    title: '进入事件名',
    description: '触发进入时的事件名'
});

SmartTrigger.attributes.add('leaveEvent', { 
    type: 'string', 
    default: 'trigger:leave', 
    title: '离开事件名',
    description: '触发离开时的事件名'
});

// 调试
SmartTrigger.attributes.add('debugLog', { 
    type: 'boolean', 
    default: false, 
    title: '调试日志',
    description: '在控制台输出触发信息'
});

/* ---------- 生命周期 ---------- */

SmartTrigger.prototype.initialize = function () {
    // 内部状态
    this._active = false;      // 当前是否处于"已触发"状态
    this._firedOnce = false;   // 一次性触发标记
    this._cd = 0;              // 冷却计时器
    this._other = null;        // 最近一次触发的对象

    // 碰撞触发：绑定 triggerenter/triggerleave 事件
    if (this.useCollision) {
        if (this.entity.collision) {
            this.entity.collision.on('triggerenter', this._onTriggerEnter, this);
            this.entity.collision.on('triggerleave', this._onTriggerLeave, this);
            
            if (this.debugLog) {
                console.log('[SmartTrigger] 碰撞触发已启用:', this.entity.name);
            }
        } else {
            console.warn('[SmartTrigger] useCollision=true 但实体缺少 collision 组件:', this.entity.name);
        }
    }

    // 距离触发在 update 中轮询，无需绑定事件
    if (this.useDistance && this.debugLog) {
        console.log('[SmartTrigger] 距离触发已启用:', this.entity.name, '阈值:', this.distance);
    }
};

SmartTrigger.prototype.update = function (dt) {
    // 冷却计时
    if (this._cd > 0) {
        this._cd = Math.max(0, this._cd - dt);
    }

    // 一次性触发已完成，直接返回
    if (this.once && this._firedOnce) {
        return;
    }

    // 距离触发逻辑
    if (this.useDistance) {
        var target = this._resolveTargetEntity();
        if (target) {
            var inRange = this._checkDistance(target);
            
            // 进入触发范围
            if (inRange && !this._active && this._cd <= 0) {
                this._active = true;
                this._firedOnce = this.once;
                this._other = target;
                this._fireEnter(target);
            }
            // 离开触发范围
            else if (!inRange && this._active) {
                this._active = false;
                this._fireLeave(target);
                if (this.cooldown > 0) {
                    this._cd = this.cooldown;
                }
            }
        }
    }
};

SmartTrigger.prototype.destroy = function () {
    // 解绑碰撞事件
    if (this.entity.collision) {
        this.entity.collision.off('triggerenter', this._onTriggerEnter, this);
        this.entity.collision.off('triggerleave', this._onTriggerLeave, this);
    }
};

/* ---------- 碰撞触发回调 ---------- */

SmartTrigger.prototype._onTriggerEnter = function (other) {
    if (!this.useCollision) return;
    if (!this._isValidTarget(other)) return;
    if (this._cd > 0 || (this.once && this._firedOnce)) return;

    this._active = true;
    this._firedOnce = this.once;
    this._other = other;
    this._fireEnter(other);
};

SmartTrigger.prototype._onTriggerLeave = function (other) {
    if (!this.useCollision) return;
    if (!this._isValidTarget(other)) return;

    // 只有当前活动对象离开时才算离开
    if (this._active && (this._other === null || this._other === other)) {
        this._active = false;
        this._fireLeave(other);
        if (this.cooldown > 0) {
            this._cd = this.cooldown;
        }
    }
};

/* ---------- 工具方法 ---------- */

/**
 * 检查实体是否为有效触发目标
 */
SmartTrigger.prototype._isValidTarget = function (ent) {
    // 优先匹配显式指定的 targetEntity
    if (this.targetEntity) {
        return ent === this.targetEntity;
    }

    // 否则按 tag 匹配
    if (this.targetTag && this.targetTag.length > 0) {
        return ent.tags && ent.tags.has(this.targetTag);
    }

    // 默认：任何带 rigidbody 的实体都可触发
    return !!ent.rigidbody;
};

/**
 * 解析目标实体（用于距离触发）
 */
SmartTrigger.prototype._resolveTargetEntity = function () {
    if (this.targetEntity) {
        return this.targetEntity;
    }

    if (this.targetTag && this.targetTag.length > 0) {
        var list = this.app.root.findByTag(this.targetTag);
        return list && list.length > 0 ? list[0] : null;
    }

    return null;
};

/**
 * 检查目标是否在触发距离内
 */
SmartTrigger.prototype._checkDistance = function (ent) {
    var a = this.entity.getPosition().clone();
    var b = ent.getPosition().clone();
    
    // 忽略 Y 轴：仅计算水平距离
    if (this.ignoreY) {
        a.y = 0;
        b.y = 0;
    }
    
    var dist = a.sub(b).length();
    return dist <= Math.max(0, this.distance || 0);
};

/* ---------- 事件派发 ---------- */

SmartTrigger.prototype._fireEnter = function (other) {
    if (this.debugLog) {
        console.log('[SmartTrigger] ENTER ->', this.entity.name, 'by', other.name);
    }

    // 发送到当前实体（局部事件）
    this.entity.fire(this.enterEvent, other);
    
    // 发送到全局 app（方便跨系统监听）
    this.app.fire(this.enterEvent, this.entity, other);

    // 可选回调钩子（供子类或外部覆盖）
    if (this.onEnter) {
        try {
            this.onEnter(other);
        } catch (e) {
            console.error('[SmartTrigger] onEnter 回调错误:', e);
        }
    }
};

SmartTrigger.prototype._fireLeave = function (other) {
    if (this.debugLog) {
        console.log('[SmartTrigger] LEAVE ->', this.entity.name, 'by', other.name);
    }

    // 发送到当前实体（局部事件）
    this.entity.fire(this.leaveEvent, other);
    
    // 发送到全局 app（方便跨系统监听）
    this.app.fire(this.leaveEvent, this.entity, other);

    // 可选回调钩子
    if (this.onLeave) {
        try {
            this.onLeave(other);
        } catch (e) {
            console.error('[SmartTrigger] onLeave 回调错误:', e);
        }
    }
};
