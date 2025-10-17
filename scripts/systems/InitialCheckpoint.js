/* global pc, GlobalGame */
/**
 * @file InitialCheckpoint.js
 * @desc 场景加载时设置玩家初始位置为存档点
 * @pc-attrs
 *   player:entity=null, setOnSceneLoad:boolean=true, enableDebugLog:boolean=false
 */
var InitialCheckpoint = pc.createScript('initialCheckpoint');

// 玩家实体
InitialCheckpoint.attributes.add('player', {
    type: 'entity',
    title: '玩家实体'
});

// 是否在场景加载时自动设置
InitialCheckpoint.attributes.add('setOnSceneLoad', {
    type: 'boolean',
    default: true,
    title: '场景加载时自动设置存档点'
});

// 调试日志
InitialCheckpoint.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

// ===== 初始化 =====
InitialCheckpoint.prototype.initialize = function () {
    var self = this;
    
    // 监听场景加载完成事件
    this._onSceneLoaded = function (data) {
        if (self.setOnSceneLoad) {
            self.setInitialCheckpoint();
        }
    };
    this.app.on('scene:loaded', this._onSceneLoaded, this);
    
    // 如果脚本在场景加载后才添加，立即设置
    if (this.setOnSceneLoad) {
        // 延迟一帧，确保玩家位置已经设置
        this.app.once('update', function () {
            self.setInitialCheckpoint();
        });
    }
    
    if (this.enableDebugLog) {
        console.log('[InitialCheckpoint] Initialized');
    }
};

// ===== 设置初始存档点 =====
InitialCheckpoint.prototype.setInitialCheckpoint = function () {
    if (!this.player) {
        console.warn('[InitialCheckpoint] No player entity configured');
        return;
    }
    
    try {
        // 检查是否已经有存档点
        if (typeof GlobalGame !== 'undefined') {
            var existingCheckpoint = GlobalGame.getCheckpoint();
            
            // 如果已经有存档点，不覆盖
            if (existingCheckpoint) {
                if (this.enableDebugLog) {
                    console.log('[InitialCheckpoint] Checkpoint already exists, skipping:', existingCheckpoint);
                }
                return;
            }
            
            // 获取玩家当前位置作为初始存档点
            var playerPos = this.player.getPosition().clone();
            GlobalGame.setCheckpoint(playerPos);
            
            console.log('[InitialCheckpoint] Initial checkpoint set at player position:', playerPos);
        } else {
            console.warn('[InitialCheckpoint] GlobalGame not found');
        }
    } catch (e) {
        console.error('[InitialCheckpoint] Failed to set initial checkpoint:', e);
    }
};

// ===== 清理 =====
InitialCheckpoint.prototype.destroy = function () {
    if (this.app && this._onSceneLoaded) {
        this.app.off('scene:loaded', this._onSceneLoaded, this);
    }
};
