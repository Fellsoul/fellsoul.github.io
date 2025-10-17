/* global pc, GlobalGame */
/**
 * @file DeathController.js
 * @desc 玩家死亡控制器：化作光点 → 黑幕 → 复活到存档点
 * @pc-attrs
 *   player:entity=null, playerModel:entity=null, uiRoot:entity=null, fadeOverlay:entity=null,
 *   respawnPoint:entity=null, defaultSpawnOffset:vec3=(0,0,0), scaleDownTime:number=0.6,
 *   fadeOutTime:number=0.5, blackHoldTime:number=0.3, fadeInTime:number=0.6,
 *   emissiveBoost:number=3.0, disableInputEvent:string="input:disable",
 *   enableInputEvent:string="input:enable", lightFxEntity:entity=null,
 *   useCheckpoint:boolean=true, enableDebugLog:boolean=false
 */
var DeathController = pc.createScript('deathController');

// 玩家根实体
DeathController.attributes.add('player', { 
    type: 'entity', 
    title: 'Player Root' 
});

// 玩家模型（用于缩放和发光）
DeathController.attributes.add('playerModel', { 
    type: 'entity', 
    title: 'Player Model/Render' 
});

// UI 根实体
DeathController.attributes.add('uiRoot', { 
    type: 'entity', 
    title: 'UI Root (Screen)' 
});

// 黑幕遮罩
DeathController.attributes.add('fadeOverlay', { 
    type: 'entity', 
    title: 'Fade Overlay (Image Element)' 
});

// 默认复活点（如果没有存档点）
DeathController.attributes.add('respawnPoint', { 
    type: 'entity', 
    title: 'Default Respawn Point' 
});

// 默认重生点位置偏移
DeathController.attributes.add('defaultSpawnOffset', { 
    type: 'vec3', 
    default: [0, 0, 0], 
    title: '默认重生点位置偏移' 
});

// 动画时间参数
DeathController.attributes.add('scaleDownTime', { 
    type: 'number', 
    default: 0.6, 
    title: '缩小到光点耗时(秒)' 
});

DeathController.attributes.add('fadeOutTime', { 
    type: 'number', 
    default: 0.5, 
    title: '黑幕淡出耗时(秒)' 
});

DeathController.attributes.add('blackHoldTime', { 
    type: 'number', 
    default: 0.3, 
    title: '黑幕停留(秒)' 
});

DeathController.attributes.add('fadeInTime', { 
    type: 'number', 
    default: 0.6, 
    title: '黑幕淡入耗时(秒)' 
});

// 视觉效果参数
DeathController.attributes.add('emissiveBoost', { 
    type: 'number', 
    default: 3.0, 
    title: '死亡缩小时的自发光增强(倍数)' 
});

// 输入控制事件
DeathController.attributes.add('disableInputEvent', { 
    type: 'string', 
    default: 'player:lock_action', 
    title: '禁用输入事件名' 
});

DeathController.attributes.add('enableInputEvent', { 
    type: 'string', 
    default: 'player:unlock_action', 
    title: '启用输入事件名' 
});

// 光点粒子效果
DeathController.attributes.add('lightFxEntity', { 
    type: 'entity', 
    title: 'Death Light FX (可选)' 
});

// 是否使用存档点
DeathController.attributes.add('useCheckpoint', { 
    type: 'boolean', 
    default: true, 
    title: '使用存档点（否则用默认复活点）' 
});

// 手动回档键位
DeathController.attributes.add('respawnKey', { 
    type: 'string', 
    default: 'G', 
    title: '手动回档键位' 
});

DeathController.attributes.add('respawnKeyCode', { 
    type: 'number', 
    default: 71, 
    title: '手动回档键码（G=71）' 
});

// 调试日志
DeathController.attributes.add('enableDebugLog', { 
    type: 'boolean', 
    default: false, 
    title: '调试日志' 
});

// ===== 初始化 =====
DeathController.prototype.initialize = function () {
    this._isDying = false;
    this._origScale = this.playerModel ? this.playerModel.getLocalScale().clone() : new pc.Vec3(0.02, 0.02, 0.02);

    // 确保 fadeOverlay 初始是透明的
    if (this.fadeOverlay && this.fadeOverlay.element) {
        this.fadeOverlay.element.opacity = 0;
        console.log('[DeathController] FadeOverlay opacity initialized to 0');
    }

    // 记录各 mesh 的标准材质（如果需要调 emissive）
    this._savedMats = [];
    if (this.playerModel && this.playerModel.model) {
        var meshInstances = this.playerModel.model.meshInstances || [];
        for (var i = 0; i < meshInstances.length; i++) {
            var mi = meshInstances[i];
            var mat = mi.material;
            if (mat && mat.emissive) {
                this._savedMats.push({ 
                    mi: mi, 
                    mat: mat, 
                    emissive: mat.emissive.clone(), 
                    emissiveIntensity: mat.emissiveIntensity || 1 
                });
            }
        }
    }

    // 监听全局"死亡"事件
    var self = this;
    this._onPlayerDie = function () {
        self.startDeathSequence();
    };
    this.app.on('player:die', this._onPlayerDie, this);

    // 监听手动回档事件（来自 UI 按钮）
    this._onManualRespawn = function () {
        self.manualRespawn();
    };
    this.app.on('player:respawn', this._onManualRespawn, this);

    // 监听键盘按键（G 键回档）
    this._onKeyDown = function (e) {
        if (e.key === self.respawnKeyCode && !self._isDying) {
            // 检查 UIManager 状态，如果是 typewriter 或 first_time_intro 状态则忽略
            if (typeof UIManager !== 'undefined') {
                var uiManager = UIManager.getInstance();
                if (uiManager && (uiManager.currentState === 'typewriter' || uiManager.currentState === 'first_time_intro')) {
                    if (self.enableDebugLog) {
                        console.log('[DeathController] Respawn key ignored during UIManager animation state:', uiManager.currentState);
                    }
                    return;
                }
            }
            self.manualRespawn();
        }
    };
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);

    // 监听场景切换事件，自动销毁
    this._onSceneChange = function () {
        console.log('[DeathController] Scene changing, cleaning up...');
        self.destroy();
    };
    this.app.on('scene:beforeunload', this._onSceneChange, this);

    if (this.enableDebugLog) {
        console.log('[DeathController] Initialized with', this._savedMats.length, 'materials');
    }
};

// ===== 手动回档（G 键或 UI 按钮） =====
DeathController.prototype.manualRespawn = function () {
    if (this._isDying) {
        console.log('[DeathController] Already in respawn sequence, ignoring manual respawn');
        return;
    }
    this._isDying = true;

    console.log('[DeathController] Manual respawn triggered');
    console.log('[DeathController] fadeOverlay:', this.fadeOverlay);
    if (this.fadeOverlay) {
        console.log('[DeathController] fadeOverlay.element:', this.fadeOverlay.element);
        if (this.fadeOverlay.element) {
            console.log('[DeathController] Current opacity:', this.fadeOverlay.element.opacity);
        }
    }

    // 禁止输入
    this.app.fire(this.disableInputEvent);

    // 直接开始黑幕淡出 → 复活 → 淡入（跳过死亡动画）
    var self = this;
    console.log('[DeathController] Starting fade to black...');
    this._fadeToBlack()
        .then(function () { 
            console.log('[DeathController] Fade to black done, starting respawn...');
            return self._respawnAtCheckpoint(); 
        })
        .then(function () { 
            console.log('[DeathController] Respawn done, starting fade in...');
            return self._fadeInFromBlack(); 
        })
        .then(function () { 
            console.log('[DeathController] Fade in done, restoring...');
            return self._restoreAfterDeath(); 
        })
        .catch(function (e) { 
            console.error('[DeathController] manual respawn error:', e); 
            self._isDying = false;
        });
};

// ===== 入口：开始死亡流程 =====
DeathController.prototype.startDeathSequence = function () {
    if (this._isDying) {
        if (this.enableDebugLog) {
            console.log('[DeathController] Already dying, ignoring');
        }
        return;
    }
    this._isDying = true;

    if (this.enableDebugLog) {
        console.log('[DeathController] Starting death sequence');
    }

    // 1) 禁止输入/移动/攻击
    this.app.fire(this.disableInputEvent);

    // 2) UI 隐藏（先隐藏 HUD、按钮等）
    if (this.uiRoot) this.uiRoot.enabled = false;

    // 3) "化作光点"：缩小 + 提升自发光 + 播放粒子
    var self = this;
    this._toLightPoint(this.scaleDownTime)
        .then(function () { return self._fadeToBlack(); })
        .then(function () { return self._respawnAtCheckpoint(); })
        .then(function () { return self._fadeInFromBlack(); })
        .then(function () { return self._restoreAfterDeath(); })
        .catch(function (e) { 
            console.error('[DeathController] sequence error:', e); 
            self._isDying = false;
        });
};

// ===== 3) 角色缩小 + 自发光增强 + 粒子光点 =====
DeathController.prototype._toLightPoint = function (duration) {
    var self = this;
    return new Promise(function (resolve) {
        if (!self.playerModel) {
            console.warn('[DeathController] No playerModel, skipping scale animation');
            resolve();
            return;
        }

        var t = 0;
        var startScale = self.playerModel.getLocalScale().clone();
        var endScale = new pc.Vec3(0.05, 0.05, 0.05); // 近似光点

        // 开启光点粒子
        if (self.lightFxEntity) {
            self.lightFxEntity.enabled = true;
            if (self.enableDebugLog) {
                console.log('[DeathController] Light FX enabled');
            }
        }

        // 帧更新
        var onUpdate = function (dt) {
            t += dt;
            var k = pc.math.clamp(t / duration, 0, 1);

            // scale
            var s = new pc.Vec3().lerp(startScale, endScale, k);
            self.playerModel.setLocalScale(s);

            // emissive boost（线性增强）
            for (var i = 0; i < self._savedMats.length; i++) {
                var rec = self._savedMats[i];
                var mat = rec.mat;
                var intens = pc.math.lerp(rec.emissiveIntensity, rec.emissiveIntensity * self.emissiveBoost, k);
                mat.emissive = rec.emissive.clone();
                mat.emissiveIntensity = intens;
                mat.update();
            }

            if (k >= 1) {
                self.app.off('update', onUpdate);
                if (self.enableDebugLog) {
                    console.log('[DeathController] Light point animation completed');
                }
                resolve();
            }
        };
        self.app.on('update', onUpdate);
    });
};

// ===== 4) 画布淡黑 =====
DeathController.prototype._fadeToBlack = function () {
    var self = this;
    var el = this.fadeOverlay && this.fadeOverlay.element;
    if (!el) {
        console.warn('[DeathController] No fadeOverlay element, skipping fade');
        return Promise.resolve();
    }

    return new Promise(function (resolve) {
        var t = 0, dur = self.fadeOutTime;
        var start = el.opacity;
        var end = 1.0;
        
        var onUpdate = function (dt) {
            t += dt;
            var k = pc.math.clamp(t / dur, 0, 1);
            el.opacity = pc.math.lerp(start, end, k);
            
            if (k >= 1) {
                self.app.off('update', onUpdate);

                // 黑幕停留片刻
                if (self.blackHoldTime > 0) {
                    var holdT = 0;
                    var holdUpdate = function (dt2) {
                        holdT += dt2;
                        if (holdT >= self.blackHoldTime) {
                            self.app.off('update', holdUpdate);
                            if (self.enableDebugLog) {
                                console.log('[DeathController] Fade to black completed');
                            }
                            resolve();
                        }
                    };
                    self.app.on('update', holdUpdate);
                } else {
                    if (self.enableDebugLog) {
                        console.log('[DeathController] Fade to black completed');
                    }
                    resolve();
                }
            }
        };
        self.app.on('update', onUpdate);
    });
};

// ===== 5) 回到存档点（复活点） =====
DeathController.prototype._respawnAtCheckpoint = function () {
    var respawnPos = null;
    var respawnRot = null;

    // 优先使用存档点
    if (this.useCheckpoint && typeof GlobalGame !== 'undefined') {
        var checkpoint = GlobalGame.getCheckpoint();
        if (checkpoint) {
            respawnPos = checkpoint.clone();
            console.log('[DeathController] Using checkpoint position:', respawnPos);
        } else {
            console.warn('[DeathController] No checkpoint found, using default respawn point');
        }
    }

    // 回退到默认复活点
    if (!respawnPos && this.respawnPoint) {
        var basePos = this.respawnPoint.getPosition().clone();
        console.log('[DeathController] Default respawn point base position:', basePos);
        console.log('[DeathController] defaultSpawnOffset raw value:', this.defaultSpawnOffset);
        
        respawnPos = basePos;
        
        // 应用位置偏移
        if (this.defaultSpawnOffset) {
            // 确保偏移量是 Vec3 对象
            var offset = this.defaultSpawnOffset;
            if (!(offset instanceof pc.Vec3)) {
                offset = new pc.Vec3(offset.x || offset[0] || 0, offset.y || offset[1] || 0, offset.z || offset[2] || 0);
            }
            
            console.log('[DeathController] Offset as Vec3:', offset);
            
            // 应用偏移
            respawnPos.add(offset);
            console.log('[DeathController] Final respawn position after offset:', respawnPos);
        } else {
            console.log('[DeathController] No offset specified, using base position:', respawnPos);
        }
        
        respawnRot = this.respawnPoint.getRotation().clone();
    } else if (!respawnPos) {
        console.error('[DeathController] No respawn position available! respawnPoint:', this.respawnPoint);
    }

    // 复原玩家 transform/速度等
    try {
        if (this.player) {
            // 若有刚体，先清零速度（防止传送后继续滑行）
            var rb = this.player.rigidbody;
            if (rb) { 
                rb.linearVelocity = new pc.Vec3(0, 0, 0);
                rb.angularVelocity = new pc.Vec3(0, 0, 0);
                // 确保刚体是 DYNAMIC 类型（以防之前被改成 STATIC）
                if (rb.type !== pc.BODYTYPE_DYNAMIC) {
                    rb.type = pc.BODYTYPE_DYNAMIC;
                }
                console.log('[DeathController] Rigidbody velocities cleared and type set to DYNAMIC');
            }

            // 传送到复活点（使用 teleport 更可靠）
            if (respawnPos) {
                if (rb && respawnRot) {
                    rb.teleport(respawnPos, respawnRot);
                } else if (rb) {
                    rb.teleport(respawnPos, this.player.getRotation());
                } else {
                    this.player.setPosition(respawnPos);
                    if (respawnRot) {
                        this.player.setRotation(respawnRot);
                    }
                }
            }

            console.log('[DeathController] Player respawned at:', this.player.getPosition());
        }
    } catch (e) { 
        console.error('[DeathController] Failed to respawn player:', e); 
    }
    
    // 更新重生次数统计
    this._updateRespawnStats();

    // 复原模型大小/材质
    if (this.playerModel) {
        this.playerModel.setLocalScale(this._origScale);
    }
    
    for (var i = 0; i < this._savedMats.length; i++) {
        var rec = this._savedMats[i];
        rec.mat.emissive = rec.emissive.clone();
        rec.mat.emissiveIntensity = rec.emissiveIntensity;
        rec.mat.update();
    }

    // 关闭粒子
    if (this.lightFxEntity) {
        this.lightFxEntity.enabled = false;
    }

    return Promise.resolve();
};

// ===== 6) 从黑幕淡入 =====
DeathController.prototype._fadeInFromBlack = function () {
    var self = this;
    var el = this.fadeOverlay && this.fadeOverlay.element;
    if (!el) {
        return Promise.resolve();
    }

    return new Promise(function (resolve) {
        var t = 0, dur = self.fadeInTime;
        var start = el.opacity;
        var end = 0.0;
        
        var onUpdate = function (dt) {
            t += dt;
            var k = pc.math.clamp(t / dur, 0, 1);
            el.opacity = pc.math.lerp(start, end, k);
            
            if (k >= 1) {
                self.app.off('update', onUpdate);
                if (self.enableDebugLog) {
                    console.log('[DeathController] Fade in completed');
                }
                resolve();
            }
        };
        self.app.on('update', onUpdate);
    });
};

// ===== 7) 恢复输入 / 恢复 UI =====
DeathController.prototype._restoreAfterDeath = function () {
    // UI 再显示
    if (this.uiRoot) {
        this.uiRoot.enabled = true;
    }

    // 允许输入
    this.app.fire(this.enableInputEvent);

    this._isDying = false;

    if (this.enableDebugLog) {
        console.log('[DeathController] Death sequence completed, player restored');
    }

    return Promise.resolve();
};

// ===== 更新重生次数统计 =====
DeathController.prototype._updateRespawnStats = function () {
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting && GlobalGame.setSetting) {
            // 使用 getSetting 方法获取当前数据
            var totalRespawns = GlobalGame.getSetting('totalRespawns', 0);
            var respawnsByScene = GlobalGame.getSetting('respawnsByScene', {});
            
            // 更新总重生次数
            totalRespawns++;
            GlobalGame.setSetting('totalRespawns', totalRespawns);
            
            // 更新当前场景的重生次数
            var currentScene = GlobalGame.getCurrentScene ? GlobalGame.getCurrentScene() : 'unknown';
            respawnsByScene[currentScene] = (respawnsByScene[currentScene] || 0) + 1;
            GlobalGame.setSetting('respawnsByScene', respawnsByScene);
            
            // 保存到持久化存储
            if (GlobalGame.saveSettings) {
                GlobalGame.saveSettings();
            }
            
            if (this.enableDebugLog) {
                console.log('[DeathController] Respawn stats updated - Total:', totalRespawns, 'Scene:', currentScene, ':', respawnsByScene[currentScene]);
            }
            
            // 触发事件通知其他系统
            if (this.app) {
                this.app.fire('player:respawn:stats_updated', {
                    totalRespawns: totalRespawns,
                    currentScene: currentScene,
                    sceneRespawns: respawnsByScene[currentScene]
                });
            }
        } else {
            if (this.enableDebugLog) {
                console.warn('[DeathController] GlobalGame not available, cannot update respawn stats');
                console.warn('[DeathController] Available methods:', typeof GlobalGame !== 'undefined' ? Object.keys(GlobalGame) : 'GlobalGame undefined');
            }
        }
    } catch (e) {
        console.error('[DeathController] Failed to update respawn stats:', e);
    }
};

// ===== 清理 =====
DeathController.prototype.destroy = function () {
    console.log('[DeathController] Destroying...');
    
    if (this.app && this._onPlayerDie) {
        this.app.off('player:die', this._onPlayerDie, this);
    }
    if (this.app && this._onManualRespawn) {
        this.app.off('player:respawn', this._onManualRespawn, this);
    }
    if (this.app && this.app.keyboard && this._onKeyDown) {
        this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }
    if (this.app && this._onSceneChange) {
        this.app.off('scene:beforeunload', this._onSceneChange, this);
    }
    
    // 清理任何正在进行的动画监听器
    if (this.app) {
        this.app.off('update');
    }
    
    console.log('[DeathController] Destroyed successfully');
};
