/* global pc */

/**
 * @file windzone-trigger-example.js
 * @desc SmartTrigger + WindZone 集成示例：自动管理风带的受影响对象
 * @使用方法
 *   1. 风带实体（WindZone）添加 smart-trigger.js 脚本：
 *      - useCollision = true
 *      - targetTag = 'windAffected'
 *      - enterEvent = 'windzone:enter'
 *      - leaveEvent = 'windzone:leave'
 *   2. 风带实体挂载 WindZone.js 和本脚本
 *   3. 玩家/可推动物体添加 tag: "windAffected"
 *   4. 进入风带时自动施加力，离开时停止
 */

var WindZoneTriggerExample = pc.createScript('windZoneTriggerExample');

/* ---------- 属性 ---------- */
WindZoneTriggerExample.attributes.add('windZoneScript', { 
    type: 'string', 
    default: 'windZone',
    title: 'WindZone 脚本名',
    description: '风带脚本的名称（小驼峰）'
});

WindZoneTriggerExample.attributes.add('showVisualFeedback', { 
    type: 'boolean', 
    default: true, 
    title: '显示视觉反馈',
    description: '进入风带时播放粒子效果或音效'
});

WindZoneTriggerExample.attributes.add('particleEffect', { 
    type: 'entity', 
    title: '粒子效果实体',
    description: '风带的粒子效果（可选）'
});

WindZoneTriggerExample.attributes.add('windSound', { 
    type: 'asset', 
    assetType: 'audio',
    title: '风声音效',
    description: '进入风带时的音效（可选）'
});

WindZoneTriggerExample.attributes.add('debugLog', { 
    type: 'boolean', 
    default: true, 
    title: '调试日志'
});

/* ---------- 生命周期 ---------- */
WindZoneTriggerExample.prototype.initialize = function () {
    this._affectedEntities = new Set(); // 当前在风带中的实体

    // 监听风带触发事件（局部事件）
    this.entity.on('windzone:enter', this.onEntityEnter, this);
    this.entity.on('windzone:leave', this.onEntityLeave, this);

    // 获取 WindZone 脚本引用
    this._windZone = this.entity.script[this.windZoneScript];
    if (!this._windZone) {
        console.warn('[WindZoneTriggerExample] 未找到 WindZone 脚本:', this.windZoneScript);
    }

    // 初始化粒子效果（默认隐藏）
    if (this.particleEffect && this.particleEffect.particlesystem) {
        this.particleEffect.particlesystem.stop();
    }

    if (this.debugLog) {
        console.log('[WindZoneTriggerExample] 风带触发器已初始化:', this.entity.name);
    }
};

WindZoneTriggerExample.prototype.destroy = function () {
    // 解绑事件
    this.entity.off('windzone:enter', this.onEntityEnter, this);
    this.entity.off('windzone:leave', this.onEntityLeave, this);

    // 清理所有受影响实体
    this._affectedEntities.forEach(function(ent) {
        this.removeFromWindZone(ent);
    }.bind(this));
    this._affectedEntities.clear();
};

/* ---------- 触发器事件 ---------- */
WindZoneTriggerExample.prototype.onEntityEnter = function (other) {
    if (!other || !other.rigidbody) return;

    // 避免重复添加
    if (this._affectedEntities.has(other)) return;

    this._affectedEntities.add(other);
    this.addToWindZone(other);

    // 视觉反馈
    if (this.showVisualFeedback) {
        this.playVisualFeedback(true);
    }

    if (this.debugLog) {
        console.log('[WindZoneTriggerExample] 实体进入风带:', other.name);
    }
};

WindZoneTriggerExample.prototype.onEntityLeave = function (other) {
    if (!this._affectedEntities.has(other)) return;

    this._affectedEntities.delete(other);
    this.removeFromWindZone(other);

    // 如果没有实体在风带中，停止视觉反馈
    if (this._affectedEntities.size === 0 && this.showVisualFeedback) {
        this.playVisualFeedback(false);
    }

    if (this.debugLog) {
        console.log('[WindZoneTriggerExample] 实体离开风带:', other.name);
    }
};

/* ---------- WindZone 集成 ---------- */
WindZoneTriggerExample.prototype.addToWindZone = function (entity) {
    if (!this._windZone) return;

    // 假设 WindZone 脚本有 addAffectedEntity 方法
    if (typeof this._windZone.addAffectedEntity === 'function') {
        this._windZone.addAffectedEntity(entity);
    } else {
        // 手动添加到受影响列表
        if (!this._windZone.affectedEntities) {
            this._windZone.affectedEntities = [];
        }
        if (this._windZone.affectedEntities.indexOf(entity) === -1) {
            this._windZone.affectedEntities.push(entity);
        }
    }
};

WindZoneTriggerExample.prototype.removeFromWindZone = function (entity) {
    if (!this._windZone) return;

    // 假设 WindZone 脚本有 removeAffectedEntity 方法
    if (typeof this._windZone.removeAffectedEntity === 'function') {
        this._windZone.removeAffectedEntity(entity);
    } else {
        // 手动移除
        if (this._windZone.affectedEntities) {
            var idx = this._windZone.affectedEntities.indexOf(entity);
            if (idx !== -1) {
                this._windZone.affectedEntities.splice(idx, 1);
            }
        }
    }
};

/* ---------- 视觉反馈 ---------- */
WindZoneTriggerExample.prototype.playVisualFeedback = function (enable) {
    // 粒子效果
    if (this.particleEffect && this.particleEffect.particlesystem) {
        if (enable) {
            this.particleEffect.particlesystem.play();
        } else {
            this.particleEffect.particlesystem.stop();
        }
    }

    // 音效（仅在第一个实体进入时播放）
    if (enable && this.windSound && this.entity.sound) {
        this.entity.sound.play(this.windSound.name);
    } else if (!enable && this.entity.sound) {
        this.entity.sound.stop();
    }
};

/* ---------- 调试辅助 ---------- */
WindZoneTriggerExample.prototype.update = function (dt) {
    // 可选：绘制风带边界（仅调试模式）
    if (this.debugLog && this.app.renderNextFrame) {
        var color = this._affectedEntities.size > 0 
            ? new pc.Color(0, 1, 0, 0.3)  // 绿色：有实体
            : new pc.Color(1, 1, 0, 0.3); // 黄色：无实体

        // 获取碰撞体边界
        if (this.entity.collision) {
            var aabb = this.entity.collision.data.halfExtents;
            var pos = this.entity.getPosition();
            
            // 绘制边界框（需要 Debug Draw API，此处为示意）
            // this.app.drawWireBox(pos, aabb, color);
        }
    }
};

/* ---------- 公共 API ---------- */

/**
 * 获取当前在风带中的实体列表
 */
WindZoneTriggerExample.prototype.getAffectedEntities = function () {
    return Array.from(this._affectedEntities);
};

/**
 * 强制清除所有受影响实体（如禁用风带）
 */
WindZoneTriggerExample.prototype.clearAllAffected = function () {
    this._affectedEntities.forEach(function(ent) {
        this.removeFromWindZone(ent);
    }.bind(this));
    this._affectedEntities.clear();

    if (this.showVisualFeedback) {
        this.playVisualFeedback(false);
    }

    if (this.debugLog) {
        console.log('[WindZoneTriggerExample] 已清除所有受影响实体');
    }
};

/**
 * 启用/禁用风带（保留已进入的实体状态）
 */
WindZoneTriggerExample.prototype.setEnabled = function (enabled) {
    var trigger = this.entity.script.smartTrigger;
    if (trigger) {
        trigger.enabled = enabled;
    }

    if (!enabled) {
        this.clearAllAffected();
    }

    if (this.debugLog) {
        console.log('[WindZoneTriggerExample] 风带状态:', enabled ? '启用' : '禁用');
    }
};
