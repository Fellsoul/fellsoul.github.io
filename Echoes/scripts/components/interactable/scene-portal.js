/* global pc */
/**
 * @file scene-portal.js
 * @desc 场景传送门：玩家靠近时弹出确认对话框，点击"是"后加载目标场景
 * @pc-attrs
 *   playerEntity:entity=null, triggerDistance:number=2.5,
 *   targetSceneName:string="level1", promptKey:string="portal.confirm",
 *   promptText:string="前往下一关？", yesButtonKey:string="ui.yes", noButtonKey:string="ui.no",
 *   yesButtonText:string="是", noButtonText:string="否",
 *   autoHideOnNo:boolean=true, cooldownSeconds:number=2,
 *   enableDebugLog:boolean=false
 */
var ScenePortal = pc.createScript('scenePortal');

// 玩家实体（可选，不填则自动查找）
ScenePortal.attributes.add('playerEntity', { 
    type: 'entity', 
    title: '玩家实体（可选）' 
});

// 触发距离
ScenePortal.attributes.add('triggerDistance', { 
    type: 'number', 
    default: 2.5, 
    title: '触发距离（米）' 
});

// 目标场景名称
ScenePortal.attributes.add('targetSceneName', { 
    type: 'string', 
    default: 'level1', 
    title: '目标场景名称' 
});

// 提示文本 i18n 键
ScenePortal.attributes.add('promptKey', { 
    type: 'string', 
    default: 'portal.confirm', 
    title: '提示文本 i18n 键' 
});

// 提示文本（兜底）
ScenePortal.attributes.add('promptText', { 
    type: 'string', 
    default: '前往下一关？', 
    title: '提示文本（兜底）' 
});

// "是"按钮 i18n 键
ScenePortal.attributes.add('yesButtonKey', { 
    type: 'string', 
    default: 'ui.yes', 
    title: '"是"按钮 i18n 键' 
});

// "是"按钮文本（兜底）
ScenePortal.attributes.add('yesButtonText', { 
    type: 'string', 
    default: '是', 
    title: '"是"按钮文本（兜底）' 
});

// "否"按钮 i18n 键
ScenePortal.attributes.add('noButtonKey', { 
    type: 'string', 
    default: 'ui.no', 
    title: '"否"按钮 i18n 键' 
});

// "否"按钮文本（兜底）
ScenePortal.attributes.add('noButtonText', { 
    type: 'string', 
    default: '否', 
    title: '"否"按钮文本（兜底）' 
});

// 点击"否"后自动隐藏对话框
ScenePortal.attributes.add('autoHideOnNo', { 
    type: 'boolean', 
    default: true, 
    title: '点击"否"自动隐藏' 
});

// 冷却时间（秒）
ScenePortal.attributes.add('cooldownSeconds', { 
    type: 'number', 
    default: 2, 
    title: '冷却时间（秒）' 
});

// 调试日志
ScenePortal.attributes.add('enableDebugLog', { 
    type: 'boolean', 
    default: false, 
    title: '调试日志' 
});

// ===== 初始化 =====
ScenePortal.prototype.initialize = function () {
    this._isPlayerNear = false;
    this._dialogVisible = false;
    this._lastTriggerTime = 0;
    
    // 查找玩家
    this._player = this.playerEntity || this.app.root.findByName('Player');
    if (!this._player) {
        console.error('[ScenePortal] Player entity not found');
        return;
    }
    
    // 临时向量（避免频繁创建）
    this._tmpVec = new pc.Vec3();
    
    // 绑定按钮点击事件
    var self = this;
    this._onYesClick = function () {
        self._handleYesClick();
    };
    this._onNoClick = function () {
        self._handleNoClick();
    };
    
    this.app.on('portal:yes', this._onYesClick, this);
    this.app.on('portal:no', this._onNoClick, this);
    
    if (this.enableDebugLog) {
        console.log('[ScenePortal] Initialized for scene:', this.targetSceneName);
    }
};

// ===== 每帧更新 =====
ScenePortal.prototype.update = function (dt) {
    if (!this._player) return;
    
    // 计算玩家与传送门的距离
    var portalPos = this.entity.getPosition();
    var playerPos = this._player.getPosition();
    var distance = this._tmpVec.sub2(portalPos, playerPos).length();
    
    var isNear = distance <= this.triggerDistance;
    
    // 状态变化：从远到近
    if (isNear && !this._isPlayerNear) {
        this._isPlayerNear = true;
        this._onPlayerEnter();
    }
    // 状态变化：从近到远
    else if (!isNear && this._isPlayerNear) {
        this._isPlayerNear = false;
        this._onPlayerLeave();
    }
};

// ===== 玩家进入范围 =====
ScenePortal.prototype._onPlayerEnter = function () {
    // 检查冷却时间
    var now = Date.now();
    if (now - this._lastTriggerTime < this.cooldownSeconds * 1000) {
        if (this.enableDebugLog) {
            console.log('[ScenePortal] Cooldown active, ignoring trigger');
        }
        return;
    }
    
    this._lastTriggerTime = now;
    
    if (this.enableDebugLog) {
        console.log('[ScenePortal] Player entered portal range');
    }
    
    // 显示确认对话框
    this._showConfirmDialog();
};

// ===== 玩家离开范围 =====
ScenePortal.prototype._onPlayerLeave = function () {
    if (this.enableDebugLog) {
        console.log('[ScenePortal] Player left portal range');
    }
    
    // 可选：玩家离开时自动隐藏对话框
    // this._hideConfirmDialog();
};

// ===== 显示确认对话框 =====
ScenePortal.prototype._showConfirmDialog = function () {
    if (this._dialogVisible) return;
    
    // 获取文本（支持 i18n）
    var promptText = this._getText(this.promptKey, this.promptText);
    var yesText = this._getText(this.yesButtonKey, this.yesButtonText);
    var noText = this._getText(this.noButtonKey, this.noButtonText);
    
    // 锁定玩家
    try {
        this.app.fire('player:lock_action');
        if (this.enableDebugLog) {
            console.log('[ScenePortal] Player locked');
        }
    } catch (e) {
        if (this.enableDebugLog) {
            console.warn('[ScenePortal] Failed to lock player:', e);
        }
    }
    
    // 发送显示对话框事件
    this.app.fire('ui:portal:show', {
        prompt: promptText,
        yesButton: yesText,
        noButton: noText,
        targetScene: this.targetSceneName,
        portal: this.entity
    });
    
    this._dialogVisible = true;
    console.log('[ScenePortal] _dialogVisible set to true');
    
    if (this.enableDebugLog) {
        console.log('[ScenePortal] Dialog shown:', promptText);
    }
};

// ===== 隐藏确认对话框 =====
ScenePortal.prototype._hideConfirmDialog = function () {
    if (!this._dialogVisible) return;
    
    this.app.fire('ui:portal:hide');
    this._dialogVisible = false;
    
    // 解锁玩家
    try {
        this.app.fire('player:unlock_action');
        if (this.enableDebugLog) {
            console.log('[ScenePortal] Player unlocked');
        }
    } catch (e) {
        if (this.enableDebugLog) {
            console.warn('[ScenePortal] Failed to unlock player:', e);
        }
    }
    
    if (this.enableDebugLog) {
        console.log('[ScenePortal] Dialog hidden');
    }
};

// ===== 获取文本（支持 i18n） =====
ScenePortal.prototype._getText = function (key, fallback) {
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            var text = I18n.get(key);
            if (text && typeof text === 'string') {
                return text;
            }
        }
    } catch (e) {
        if (this.enableDebugLog) {
            console.warn('[ScenePortal] i18n get failed for key:', key, e);
        }
    }
    return fallback || key;
};

// ===== 处理"是"按钮点击 =====
ScenePortal.prototype._handleYesClick = function () {
    console.log('[ScenePortal] _handleYesClick called, _dialogVisible:', this._dialogVisible);
    if (!this._dialogVisible) {
        console.warn('[ScenePortal] Dialog not visible, ignoring yes click');
        return;
    }
    
    console.log('[ScenePortal] Yes clicked, loading scene:', this.targetSceneName);
    
    this._hideConfirmDialog();
    
    // 加载目标场景
    this._loadScene(this.targetSceneName);
};

// ===== 处理"否"按钮点击 =====
ScenePortal.prototype._handleNoClick = function () {
    if (!this._dialogVisible) return;
    
    if (this.enableDebugLog) {
        console.log('[ScenePortal] No clicked');
    }
    
    if (this.autoHideOnNo) {
        this._hideConfirmDialog();
    }
};

// ===== 加载场景 =====
ScenePortal.prototype._loadScene = function (sceneName) {
    if (this.enableDebugLog) {
        console.log('[ScenePortal] _loadScene called with:', sceneName);
    }
    
    var self = this;
    
    // 使用 GlobalGame.loadScene（统一场景管理）
    if (typeof GlobalGame !== 'undefined' && GlobalGame.loadScene) {
        if (this.enableDebugLog) {
            console.log('[ScenePortal] Using GlobalGame.loadScene');
        }
        
        GlobalGame.loadScene(sceneName, function(err, loadedSceneRootEntity) {
            if (err) {
                console.error('[ScenePortal] Failed to load scene:', err);
            } else {
                if (self.enableDebugLog) {
                    console.log('[ScenePortal] Scene loaded successfully:', sceneName);
                }
            }
        });
        return;
    }
    
    // 回退：直接使用 app.scenes.changeScene
    if (this.enableDebugLog) {
        console.log('[ScenePortal] GlobalGame not available, using app.scenes.changeScene');
    }
    
    try {
        this.app.scenes.changeScene(sceneName, function(err, loadedSceneRootEntity) {
            if (err) {
                console.error('[ScenePortal] Failed to load scene:', err);
            } else {
                if (self.enableDebugLog) {
                    console.log('[ScenePortal] Scene loaded successfully:', sceneName);
                }
            }
        });
    } catch (e) {
        console.error('[ScenePortal] Exception loading scene:', e);
    }
};

// ===== 清理 =====
ScenePortal.prototype.destroy = function () {
    if (this.app) {
        this.app.off('portal:yes', this._onYesClick, this);
        this.app.off('portal:no', this._onNoClick, this);
    }
    
    if (this._dialogVisible) {
        this._hideConfirmDialog();
    }
};
