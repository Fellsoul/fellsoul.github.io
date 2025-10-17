/* global pc, PlayerManager */
/**
 * @file Collectible.js
 * @desc 收藏品组件：在关卡中放置可拾取的收藏品
 * 
 * 使用方法：
 * 1. 将本脚本挂到收藏品实体上
 * 2. 设置 collectibleId（唯一标识符）
 * 3. 可选：设置模型、特效、声音
 * 4. 玩家靠近时自动拾取或按键拾取
 * 
 * 依赖：
 * - PlayerManager（用于保存收藏品状态）
 * - SmartTrigger 或自定义触发检测
 */

var Collectible = pc.createScript('collectible');

/* ---------- 属性 ---------- */
Collectible.attributes.add('collectibleId', { 
    type: 'string', 
    title: '收藏品ID',
    description: '唯一标识符，如 "crystal_blue_1"'
});

Collectible.attributes.add('displayName', { 
    type: 'string', 
    default: '神秘收藏品',
    title: '显示名称',
    description: '在UI中显示的名称'
});

Collectible.attributes.add('autoCollect', { 
    type: 'boolean', 
    default: true, 
    title: '自动拾取',
    description: '玩家靠近时自动拾取，否则需要按键'
});

Collectible.attributes.add('collectKey', { 
    type: 'string', 
    default: 'e',
    title: '拾取按键',
    description: '手动拾取时的按键（autoCollect=false时生效）'
});

Collectible.attributes.add('collectDistance', { 
    type: 'number', 
    default: 2, 
    min: 0,
    title: '拾取距离',
    description: '玩家距离多少米内可拾取'
});

Collectible.attributes.add('rotateSpeed', { 
    type: 'number', 
    default: 50, 
    title: '旋转速度',
    description: '收藏品旋转速度（度/秒），0=不旋转'
});

Collectible.attributes.add('floatAmplitude', { 
    type: 'number', 
    default: 0.3, 
    min: 0,
    title: '浮动幅度',
    description: '上下浮动的幅度（米），0=不浮动'
});

Collectible.attributes.add('floatSpeed', { 
    type: 'number', 
    default: 2, 
    title: '浮动速度',
    description: '上下浮动的速度'
});

Collectible.attributes.add('collectEffect', { 
    type: 'entity', 
    title: '拾取特效',
    description: '拾取时播放的粒子特效实体（可选）'
});

Collectible.attributes.add('collectSound', { 
    type: 'asset', 
    assetType: 'audio',
    title: '拾取音效',
    description: '拾取时播放的音效（可选）'
});

Collectible.attributes.add('showHint', { 
    type: 'boolean', 
    default: true, 
    title: '显示提示',
    description: '玩家靠近时显示"按E拾取"提示'
});

Collectible.attributes.add('enableDebugLog', { 
    type: 'boolean', 
    default: false, 
    title: '调试日志'
});

/* ---------- 生命周期 ---------- */
Collectible.prototype.initialize = function () {
    this._collected = false;
    this._playerNearby = false;
    this._player = null;
    this._initialY = this.entity.getLocalPosition().y;
    this._floatTime = 0;
    
    // 检查是否已被收集
    this._checkIfAlreadyCollected();
    
    // 如果已收集，直接隐藏
    if (this._collected) {
        this.entity.enabled = false;
        return;
    }
    
    // 绑定输入（如果非自动拾取）
    if (!this.autoCollect) {
        this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }
    
    // 查找玩家
    this._findPlayer();
    
    if (this.enableDebugLog) {
        console.log('[Collectible] Initialized:', this.collectibleId);
    }
};

Collectible.prototype.update = function (dt) {
    if (this._collected) return;
    
    // 旋转动画
    if (this.rotateSpeed > 0) {
        this.entity.rotateLocal(0, this.rotateSpeed * dt, 0);
    }
    
    // 浮动动画
    if (this.floatAmplitude > 0) {
        this._floatTime += dt * this.floatSpeed;
        var offset = Math.sin(this._floatTime) * this.floatAmplitude;
        var pos = this.entity.getLocalPosition();
        pos.y = this._initialY + offset;
        this.entity.setLocalPosition(pos);
    }
    
    // 检测玩家距离
    if (this._player) {
        var distance = this._getDistanceToPlayer();
        var wasNearby = this._playerNearby;
        this._playerNearby = distance <= this.collectDistance;
        
        // 进入/离开范围
        if (this._playerNearby && !wasNearby) {
            this._onPlayerEnter();
        } else if (!this._playerNearby && wasNearby) {
            this._onPlayerLeave();
        }
        
        // 自动拾取
        if (this.autoCollect && this._playerNearby) {
            this._collect();
        }
    }
};

Collectible.prototype.destroy = function () {
    // 解绑输入
    if (!this.autoCollect) {
        this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }
    
    // 隐藏提示
    if (this.showHint && this._playerNearby) {
        this._hideHint();
    }
};

/* ---------- 检测与拾取 ---------- */
Collectible.prototype._checkIfAlreadyCollected = function () {
    try {
        var pm = (typeof PlayerManager !== 'undefined') ? PlayerManager.get() : null;
        if (pm && pm.hasCollectible(this.collectibleId)) {
            this._collected = true;
            if (this.enableDebugLog) {
                console.log('[Collectible] Already collected:', this.collectibleId);
            }
        }
    } catch (e) {
        console.warn('[Collectible] Failed to check collected status:', e);
    }
};

Collectible.prototype._findPlayer = function () {
    // 查找带有 'player' tag 的实体
    var players = this.app.root.findByTag('player');
    if (players && players.length > 0) {
        this._player = players[0];
    }
};

Collectible.prototype._getDistanceToPlayer = function () {
    if (!this._player) return Infinity;
    var pos1 = this.entity.getPosition();
    var pos2 = this._player.getPosition();
    return pos1.distance(pos2);
};

Collectible.prototype._onPlayerEnter = function () {
    if (this.showHint && !this.autoCollect) {
        this._showHint();
    }
    
    this.app.fire('collectible:nearby', this.entity, this._player);
    
    if (this.enableDebugLog) {
        console.log('[Collectible] Player nearby:', this.collectibleId);
    }
};

Collectible.prototype._onPlayerLeave = function () {
    if (this.showHint) {
        this._hideHint();
    }
    
    this.app.fire('collectible:far', this.entity, this._player);
    
    if (this.enableDebugLog) {
        console.log('[Collectible] Player left:', this.collectibleId);
    }
};

Collectible.prototype._onKeyDown = function (event) {
    if (this._collected || !this._playerNearby) return;
    
    var key = String.fromCharCode(event.key).toLowerCase();
    if (key === this.collectKey.toLowerCase()) {
        this._collect();
    }
};

Collectible.prototype._collect = function () {
    if (this._collected) return;
    
    this._collected = true;
    
    // 保存到 PlayerManager
    var location = this._getCurrentLocation();
    var pm = (typeof PlayerManager !== 'undefined') ? PlayerManager.get() : null;
    if (pm) {
        pm.addCollectible(this.collectibleId, location, {
            displayName: this.displayName,
            position: this.entity.getPosition().clone()
        });
    }
    
    // 播放特效
    if (this.collectEffect && this.collectEffect.particlesystem) {
        this.collectEffect.particlesystem.reset();
        this.collectEffect.particlesystem.play();
    }
    
    // 播放音效
    if (this.collectSound && this.entity.sound) {
        this.entity.sound.play(this.collectSound.name);
    }
    
    // 隐藏提示
    if (this.showHint) {
        this._hideHint();
    }
    
    // 触发全局事件
    this.app.fire('collectible:collected', {
        id: this.collectibleId,
        name: this.displayName,
        entity: this.entity,
        player: this._player
    });
    
    // 延迟销毁（等特效播放完）
    var self = this;
    setTimeout(function() {
        if (self.entity && self.entity.destroy) {
            self.entity.destroy();
        }
    }, 1000);
    
    if (this.enableDebugLog) {
        console.log('[Collectible] Collected:', this.collectibleId);
    }
};

Collectible.prototype._getCurrentLocation = function () {
    // 尝试获取当前场景/关卡名称
    try {
        if (this.app.scene && this.app.scene.name) {
            return this.app.scene.name;
        }
    } catch (e) {}
    return 'unknown';
};

/* ---------- UI 提示 ---------- */
Collectible.prototype._showHint = function () {
    // 触发显示提示的事件（由 UI 系统处理）
    this.app.fire('ui:show_hint', {
        text: '按 ' + this.collectKey.toUpperCase() + ' 拾取',
        target: this.entity
    });
};

Collectible.prototype._hideHint = function () {
    // 触发隐藏提示的事件
    this.app.fire('ui:hide_hint');
};

/* ---------- 公共 API ---------- */
Collectible.prototype.forceCollect = function () {
    if (!this._collected) {
        this._collect();
    }
};

Collectible.prototype.reset = function () {
    this._collected = false;
    this.entity.enabled = true;
    
    // 从 PlayerManager 移除
    var pm = (typeof PlayerManager !== 'undefined') ? PlayerManager.get() : null;
    if (pm) {
        pm.removeCollectible(this.collectibleId);
    }
    
    if (this.enableDebugLog) {
        console.log('[Collectible] Reset:', this.collectibleId);
    }
};
