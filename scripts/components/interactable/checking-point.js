/* global pc */
/**
 * @file checking-point.js
 * @desc 存档点：玩家互动后触发存档动画并记录复活位置（默认只能激活一次）
 * @pc-attrs
 *   visualEntities:entity[]=[], scaleAmount:number=1.3, scaleDuration:number=0.3,
 *   emissiveBoost:number=2.0, emissiveDuration:number=0.5,
 *   interactKey:string="interact.checkpoint", interactHint:string="存档",
 *   cooldownSeconds:number=2, onlyOnce:boolean=true, sceneName:string='',
 *   hidePreviousPart:boolean=true, enableDebugLog:boolean=false
 * @note
 *   sceneName 设置为 "Start" 时，存档点激活但不保存位置到 GameManager
 */
var CheckingPoint = pc.createScript('checkingPoint');

// 视觉反馈实体列表
CheckingPoint.attributes.add('visualEntities', {
    type: 'entity',
    array: true,
    title: '视觉反馈实体列表'
});

// 缩放动画参数
CheckingPoint.attributes.add('scaleAmount', {
    type: 'number',
    default: 1.3,
    title: '缩放倍数'
});

// 发光增强参数
CheckingPoint.attributes.add('emissiveBoost', {
    type: 'number',
    default: 2.0,
    title: '发光增强倍数'
});

CheckingPoint.attributes.add('emissiveDuration', {
    type: 'number',
    default: 0.5,
    title: '发光持续时间（秒）'
});

// 交互提示
CheckingPoint.attributes.add('interactKey', {
    type: 'string',
    default: 'interact.checkpoint',
    title: '交互提示 i18n 键'
});

CheckingPoint.attributes.add('interactHint', {
    type: 'string',
    default: '存档',
    title: '交互提示文本（兜底）'
});

// 冷却时间
CheckingPoint.attributes.add('cooldownSeconds', {
    type: 'number',
    default: 2,
    title: '冷却时间（秒）'
});

// 只能激活一次
CheckingPoint.attributes.add('onlyOnce', {
    type: 'boolean',
    default: true,
    title: '只能激活一次'
});

// 存档点ID（用于跟踪和管理）
CheckingPoint.attributes.add('checkpointId', {
    type: 'string',
    default: '',
    title: '存档点ID',
    description: '用于跟踪和管理的唯一标识符，留空则自动生成'
});

// 粒子系统（动画完成后播放）
CheckingPoint.attributes.add('particleEntity', {
    type: 'entity',
    title: '粒子系统实体（可选）'
});

// 场景名称（用于判断是否保存位置）
CheckingPoint.attributes.add('sceneName', {
    type: 'string',
    default: '',
    title: '场景名称',
    description: '如果设置为 "Start"，则不会保存存档点位置到 GameManager'
});

// 调试日志
CheckingPoint.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

// ===== 关卡存档点功能 =====
CheckingPoint.attributes.add('isLevelCheckpoint', {
    type: 'boolean',
    default: false,
    title: '关卡存档点',
    description: '勾选后，到达存档点时会自动加载并淡入显示下一部分内容'
});

CheckingPoint.attributes.add('nextPartIndex', {
    type: 'number',
    default: 1,
    title: '下一部分索引',
    description: '激活存档点时要显示的 Part 索引（配合 LevelManager 使用）'
});

CheckingPoint.attributes.add('hidePreviousPart', {
    type: 'boolean',
    default: false,
    title: '隐藏前一部分',
    description: '激活下一部分时是否隐藏当前部分（勾选可隐藏前一部分）'
});

// ===== Prologue 播放功能 =====
CheckingPoint.attributes.add('prologueKey', {
    type: 'string',
    default: '',
    title: 'Prologue 键名',
    description: '要播放的 prologue 内容键名（如 ethanShell, ethanMind 等），留空则不播放'
});

CheckingPoint.attributes.add('playPrologueBeforeUnlock', {
    type: 'boolean',
    default: true,
    title: '播放 Prologue 后解锁',
    description: '勾选后会先播放 prologue，播放完成后再解锁玩家和激活下一部分'
});

// ===== 标题显示功能 =====
CheckingPoint.attributes.add('titleKey', {
    type: 'string',
    default: '',
    title: '主标题 i18n 键名',
    description: '激活 Part 动画时显示的主标题键名（如 level.ethans_wind.shell.title），留空则不显示'
});

CheckingPoint.attributes.add('subtitleKey', {
    type: 'string',
    default: '',
    title: '副标题 i18n 键名',
    description: '激活 Part 动画时显示的副标题键名（如 level.ethans_wind.shell.subtitle），留空则不显示'
});

CheckingPoint.attributes.add('showTitleWithAnimation', {
    type: 'boolean',
    default: true,
    title: '与动画同步显示标题',
    description: '勾选后标题会在 Part 弹出动画完成后显示'
});

CheckingPoint.attributes.add('titleDisplayDelay', {
    type: 'number',
    default: 0.2,
    title: '副标题延迟（秒）',
    description: '副标题相对于主标题的显示延迟时间'
});

CheckingPoint.attributes.add('scaleDuration', {
    type: 'number',
    default: 0.8,
    title: '缩放动画时长（秒）',
    description: '下一部分子节点的缩放动画时长'
});

CheckingPoint.attributes.add('scaleDelay', {
    type: 'number',
    default: 0.3,
    title: '缩放延迟（秒）',
    description: '激活存档点后，延迟多久开始缩放'
});

CheckingPoint.attributes.add('scaleOvershoot', {
    type: 'number',
    default: 1.2,
    title: '缩放过冲值',
    description: '弹出动画的最大缩放值（会超出然后回弹）'
});

CheckingPoint.attributes.add('itemDelay', {
    type: 'number',
    default: 0.05,
    title: '子节点间隔（秒）',
    description: '每个子节点顺序弹出的时间间隔'
});

// ===== 初始化 =====
CheckingPoint.prototype.initialize = function () {
    this._isActivated = false;
    this._lastActivateTime = 0;
    this._animatingEntities = []; // 存储正在动画的实体信息
    
    // 生成或使用指定的存档点ID
    this._checkpointId = this.checkpointId || (this.entity.name + '_' + this.entity.getGuid());
    
    // 检查是否已经激活过（如果设置了onlyOnce）
    if (this.onlyOnce && typeof GlobalGame !== 'undefined' && GlobalGame.isCheckpointActivated) {
        this._isActivated = GlobalGame.isCheckpointActivated(this._checkpointId);
        if (this._isActivated) {
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] Checkpoint already activated:', this._checkpointId);
            }
            
            // 如果已经激活过，禁用交互提示组件
            var interactableHint = this.entity.script && this.entity.script.interactableHint;
            if (interactableHint) {
                interactableHint.enabled = false;
                if (this.enableDebugLog) {
                    console.log('[CheckingPoint] Disabled InteractableHint component (already activated)');
                }
            }
        }
    }
    
    // 存储原始状态
    this._originalStates = [];
    for (var i = 0; i < this.visualEntities.length; i++) {
        var entity = this.visualEntities[i];
        if (entity) {
            var state = {
                entity: entity,
                originalScale: entity.getLocalScale().clone(),
                originalEmissive: null,
                material: null
            };
            
            // 获取材质和原始 emissive
            if (entity.model && entity.model.meshInstances && entity.model.meshInstances.length > 0) {
                var meshInstance = entity.model.meshInstances[0];
                if (meshInstance.material) {
                    state.material = meshInstance.material;
                    state.originalEmissive = meshInstance.material.emissive.clone();
                }
            }
            
            this._originalStates.push(state);
        }
    }
    
    // 监听交互事件（来自 interactable-hint）
    var self = this;
    this._onInteractableAction = function (data) {
        // 检查是否是针对此实体的交互
        if (data && data.entity === self.entity) {
            self._activate();
        }
    };
    this.app.on('interactable:action', this._onInteractableAction, this);
    
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] Initialized with ID:', this._checkpointId, 'visual entities:', this.visualEntities.length);
    }
};

// ===== 激活存档点 =====
CheckingPoint.prototype._activate = function () {
    console.log('[CheckingPoint] _activate called');
    
    // 重新检查GameManager中的激活状态（防止页面刷新后状态丢失）
    if (this.onlyOnce && typeof GlobalGame !== 'undefined' && GlobalGame.isCheckpointActivated) {
        var isActivatedInGameManager = GlobalGame.isCheckpointActivated(this._checkpointId);
        if (isActivatedInGameManager) {
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] 存档点已在GameManager中标记为激活，ID:', this._checkpointId);
            }
            this._isActivated = true; // 同步本地状态
            return;
        }
    }
    
    // 检查本地激活状态
    if (this.onlyOnce && this._isActivated) {
        if (this.enableDebugLog) {
            console.log('[CheckingPoint] 存档点已激活，只能激活一次');
        }
        return;
    }
    
    // 检查冷却时间
    var now = Date.now() / 1000;
    var timeSinceLastActivate = now - this._lastActivateTime;
    
    console.log('[CheckingPoint] Time since last activate:', timeSinceLastActivate, 'cooldown:', this.cooldownSeconds);
    
    if (timeSinceLastActivate < this.cooldownSeconds) {
        console.log('[CheckingPoint] Still in cooldown, remaining:', this.cooldownSeconds - timeSinceLastActivate);
        return;
    }
    
    // 立即隐藏交互提示（防止重复触发）
    this.app.fire('ui:hint:hide', { side: 'right' });
    
    this._lastActivateTime = now;
    this._isActivated = true;
    
    // 如果设置为只能激活一次，立即禁用交互提示组件
    if (this.onlyOnce) {
        var interactableHint = this.entity.script && this.entity.script.interactableHint;
        if (interactableHint) {
            interactableHint.enabled = false;
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] Disabled InteractableHint component');
            }
        }
        
        // 隐藏任何显示的提示
        this.app.fire('ui:hint:hide', { side: 'right' });
    }
    
    console.log('[CheckingPoint] Activated at position:', this.entity.getPosition());
    
    // 保存存档点位置到 GameManager
    this._saveCheckpoint();
    
    // 播放视觉反馈动画
    this._playVisualFeedback();
    
    // 触发存档事件
    this.app.fire('checkpoint:saved', {
        position: this.entity.getPosition().clone(),
        checkpoint: this.entity
    });
    
    // 检查是否需要播放 prologue
    if (this.prologueKey && this.prologueKey.trim() !== '') {
        if (this.playPrologueBeforeUnlock) {
            // 先锁定玩家，播放 prologue，完成后再处理后续逻辑
            this._lockPlayerAndPlayPrologue();
        } else {
            // 直接播放 prologue，不影响其他逻辑
            this._playPrologue();
            if (this.isLevelCheckpoint) {
                this._activateNextPart();
            }
        }
    } else {
        // 没有 prologue，直接处理关卡存档点逻辑
        if (this.isLevelCheckpoint) {
            this._activateNextPart();
        }
    }
};

// ===== 保存存档点到 GameManager =====
CheckingPoint.prototype._saveCheckpoint = function () {
    console.log('[CheckingPoint] _saveCheckpoint 被调用');
    
    // 检查场景名称，如果是 "Start" 则不保存位置
    if (this.sceneName && this.sceneName.trim().toLowerCase() === 'start') {
        if (this.enableDebugLog) {
            console.log('[CheckingPoint] 场景名称为 "Start"，跳过保存存档点位置');
        }
        
        // 仍然标记存档点为已激活（防止重复触发）
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.markCheckpointActivated) {
                GlobalGame.markCheckpointActivated(this._checkpointId);
                if (this.enableDebugLog) {
                    console.log('[CheckingPoint] 已标记存档点为已激活（不保存位置）:', this._checkpointId);
                }
            }
        } catch (e) {
            console.error('[CheckingPoint] 标记存档点激活失败:', e);
        }
        
        return; // 不继续执行保存逻辑
    }
    
    try {
        if (typeof GlobalGame !== 'undefined') {
            if (GlobalGame && typeof GlobalGame.setCheckpoint === 'function') {
                // 获取当前场景名称
                var currentScene = null;
                if (typeof GlobalGame.getCurrentScene === 'function') {
                    currentScene = GlobalGame.getCurrentScene();
                    console.log('[CheckingPoint] 获取到场景名称:', currentScene);
                } else {
                    console.warn('[CheckingPoint] GlobalGame.getCurrentScene 方法不存在');
                }
                
                // 准备额外数据
                var additionalData = {};
                if (this.isLevelCheckpoint && typeof this.nextPartIndex === 'number') {
                    additionalData.partIndex = this.nextPartIndex;
                }
                if (this.prologueKey && this.prologueKey.trim() !== '') {
                    additionalData.prologueKey = this.prologueKey;
                }
                additionalData.entityName = this.entity.name;
                
                // 保存当前场景名称
                if (currentScene) {
                    additionalData.sceneName = currentScene;
                }
                
                // 保存存档点位置（全局）
                var checkpointPos = this.entity.getPosition().clone();
                console.log('[CheckingPoint] 保存全局存档点，位置:', checkpointPos);
                GlobalGame.setCheckpoint(checkpointPos, this._checkpointId, additionalData);
                
                // 如果有场景名称，额外保存到场景专属的存档点记录
                console.log('[CheckingPoint] 检查场景专属API，currentScene:', currentScene, 
                           'setSceneCheckpoint存在:', typeof GlobalGame.setSceneCheckpoint === 'function');
                
                if (currentScene && typeof GlobalGame.setSceneCheckpoint === 'function') {
                    console.log('[CheckingPoint] 调用 setSceneCheckpoint，场景:', currentScene, '位置:', checkpointPos);
                    GlobalGame.setSceneCheckpoint(currentScene, checkpointPos);
                    console.log('[CheckingPoint] 场景存档点已保存');
                } else {
                    if (!currentScene) {
                        console.warn('[CheckingPoint] 无法保存场景存档点：场景名称为空');
                    } else if (typeof GlobalGame.setSceneCheckpoint !== 'function') {
                        console.warn('[CheckingPoint] 无法保存场景存档点：GlobalGame.setSceneCheckpoint 方法不存在');
                    }
                }
                
                console.log('[CheckingPoint] 存档点保存完成，ID:', this._checkpointId);
            } else {
                console.warn('[CheckingPoint] GlobalGame.setCheckpoint not found');
            }
        } else {
            console.warn('[CheckingPoint] GlobalGame not found');
        }
    } catch (e) {
        console.error('[CheckingPoint] Failed to save checkpoint:', e);
    }
};

// ===== 播放视觉反馈动画 =====
CheckingPoint.prototype._playVisualFeedback = function () {
    for (var i = 0; i < this._originalStates.length; i++) {
        var state = this._originalStates[i];
        if (state.entity && state.entity.enabled) {
            this._animateEntity(state);
        }
    }
};

// ===== 动画单个实体 =====
CheckingPoint.prototype._animateEntity = function (state) {
    var entity = state.entity;
    var originalScale = state.originalScale;
    
    // 缩放动画
    var targetScale = originalScale.clone().mulScalar(this.scaleAmount);
    var animInfo = {
        entity: entity,
        originalScale: originalScale,
        targetScale: targetScale,
        scaleProgress: 0,
        scalingUp: true,
        emissiveProgress: 0,
        material: state.material,
        originalEmissive: state.originalEmissive
    };
    
    this._animatingEntities.push(animInfo);
    
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] Started animation for entity:', entity.name);
    }
};

// ===== 更新动画 =====
CheckingPoint.prototype.update = function (dt) {
    if (this._animatingEntities.length === 0) return;
    
    var scaleDuration = this.scaleDuration;
    var emissiveDuration = this.emissiveDuration;
    var emissiveBoost = this.emissiveBoost;
    
    for (var i = this._animatingEntities.length - 1; i >= 0; i--) {
        var anim = this._animatingEntities[i];
        var entity = anim.entity;
        
        if (!entity || !entity.enabled) {
            this._animatingEntities.splice(i, 1);
            continue;
        }
        
        // 缩放动画
        if (anim.scalingUp) {
            anim.scaleProgress += dt / scaleDuration;
            if (anim.scaleProgress >= 1) {
                anim.scaleProgress = 1;
                anim.scalingUp = false;
            }
        } else {
            anim.scaleProgress -= dt / scaleDuration;
            if (anim.scaleProgress <= 0) {
                anim.scaleProgress = 0;
            }
        }
        
        // 应用缩放（使用 easeOutBack 缓动）
        var scaleT = this._easeOutBack(anim.scaleProgress);
        var currentScale = new pc.Vec3();
        currentScale.lerp(anim.originalScale, anim.targetScale, scaleT);
        
        // 只缩放 Z 轴
        var finalScale = anim.originalScale.clone();
        finalScale.z = currentScale.z;
        entity.setLocalScale(finalScale);
        
        // 发光动画
        if (anim.material && anim.originalEmissive) {
            anim.emissiveProgress += dt / emissiveDuration;
            if (anim.emissiveProgress > 1) {
                anim.emissiveProgress = 1;
            }
            
            // 使用 sin 曲线实现脉冲效果
            var emissiveT = Math.sin(anim.emissiveProgress * Math.PI);
            var boostedEmissive = anim.originalEmissive.clone().mulScalar(1 + (emissiveBoost - 1) * emissiveT);
            anim.material.emissive.copy(boostedEmissive);
            anim.material.update();
        }
        
        // 检查动画是否完成
        if (anim.scaleProgress <= 0 && anim.emissiveProgress >= 1) {
            // 恢复原始状态
            entity.setLocalScale(anim.originalScale);
            if (anim.material && anim.originalEmissive) {
                anim.material.emissive.copy(anim.originalEmissive);
                anim.material.update();
            }
            this._animatingEntities.splice(i, 1);
            
            console.log('[CheckingPoint] Animation completed for entity:', entity.name);
            
            // 如果所有动画都完成了，播放粒子系统
            if (this._animatingEntities.length === 0) {
                this._playParticleSystem();
            }
        }
    }
};

// ===== 播放粒子系统 =====
CheckingPoint.prototype._playParticleSystem = function () {
    if (!this.particleEntity) {
        console.log('[CheckingPoint] No particle entity configured');
        return;
    }
    
    try {
        // 查找粒子系统组件
        var particleSystem = this.particleEntity.particlesystem;
        if (particleSystem) {
            particleSystem.play();
            console.log('[CheckingPoint] Particle system started:', this.particleEntity.name);
        } else {
            console.warn('[CheckingPoint] Particle entity has no particlesystem component:', this.particleEntity.name);
        }
    } catch (e) {
        console.error('[CheckingPoint] Failed to play particle system:', e);
    }
};

// ===== 缓动函数：easeOutBack =====
CheckingPoint.prototype._easeOutBack = function (t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ===== 关卡存档点：通过 LevelManager 激活下一部分 =====

/**
 * 通过 LevelManager 激活下一部分并播放弹出动画
 */
CheckingPoint.prototype._activateNextPart = function () {
    // 检查 LevelManager 是否可用
    if (typeof LevelManager === 'undefined' || !LevelManager.getInstance) {
        if (this.enableDebugLog) {
            console.warn('[CheckingPoint] LevelManager 不可用，跳过 Part 激活');
        }
        return;
    }
    
    var levelManager = LevelManager.getInstance();
    if (!levelManager) {
        if (this.enableDebugLog) {
            console.warn('[CheckingPoint] LevelManager 实例不存在');
        }
        return;
    }
    
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] 通过 LevelManager 激活 Part[' + this.nextPartIndex + ']');
    }
    
    // 构建动画选项
    var animOptions = {
        duration: this.scaleDuration || 0.8,
        delay: this.scaleDelay || 0.3,
        itemDelay: this.itemDelay || 0.05,
        overshoot: this.scaleOvershoot || 1.2,
        hidePrevious: this.hidePreviousPart
    };
    
    // 调用 LevelManager 的弹出动画方法
    levelManager.activatePartWithAnimation(this.nextPartIndex, animOptions);
    
    // 计算Part弹出动画的总时长，在动画完成后显示标题
    if (this.showTitleWithAnimation && (this.titleKey || this.subtitleKey)) {
        var self = this;
        
        // 计算动画总时长：延迟 + 动画时长 + 一些缓冲时间
        var totalAnimationTime = (animOptions.delay + animOptions.duration + 0.2) * 1000; // 转换为毫秒
        
        if (this.enableDebugLog) {
            console.log('[CheckingPoint] 将在Part动画完成后显示双标题，延迟时间:', totalAnimationTime + 'ms');
            if (this.titleKey) console.log('[CheckingPoint] 主标题键名:', this.titleKey);
            if (this.subtitleKey) console.log('[CheckingPoint] 副标题键名:', this.subtitleKey);
        }
        
        // 在Part弹出动画完成后显示标题
        setTimeout(function() {
            self._showDualTitles();
        }, totalAnimationTime);
    }
    
    // 触发存档点激活事件
    this.app.fire('checkpoint:activated', {
        checkpoint: this.entity,
        nextPartIndex: this.nextPartIndex,
        animOptions: animOptions,
        titleKey: this.titleKey || null,
        subtitleKey: this.subtitleKey || null
    });
    
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] Part 激活请求已发送，动画参数:', animOptions);
        if (this.titleKey && this.titleKey.trim() !== '') {
            console.log('[CheckingPoint] 标题键名:', this.titleKey);
        }
    }
};

// ===== 标题显示功能 =====

/**
 * 显示双标题（支持独立的主标题和副标题属性）
 * 策略：先播放完主标题，然后再播放副标题（避免互相中断）
 */
CheckingPoint.prototype._showDualTitles = function () {
    // 检查是否有任何标题需要显示
    var hasMainTitle = this.titleKey && this.titleKey.trim() !== '';
    var hasSubtitle = this.subtitleKey && this.subtitleKey.trim() !== '';
    
    if (!hasMainTitle && !hasSubtitle) {
        if (this.enableDebugLog) {
            console.warn('[CheckingPoint] 主标题和副标题键名都为空，跳过标题显示');
        }
        return;
    }
    
    try {
        if (this.enableDebugLog) {
            console.log('[CheckingPoint] 准备显示双标题（顺序播放）:');
            if (hasMainTitle) console.log('  - 主标题键名:', this.titleKey);
            if (hasSubtitle) console.log('  - 副标题键名:', this.subtitleKey);
        }
        
        var self = this;
        
        // 如果只有主标题，直接显示
        if (hasMainTitle && !hasSubtitle) {
            this.app.fire('title:show', this.titleKey);
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] 显示主标题（无副标题）:', this.titleKey);
            }
            return;
        }
        
        // 如果只有副标题，直接显示
        if (!hasMainTitle && hasSubtitle) {
            this.app.fire('title:show', this.subtitleKey);
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] 显示副标题（无主标题）:', this.subtitleKey);
            }
            return;
        }
        
        // 如果两者都有，先播放主标题，等完成后再播放副标题
        if (hasMainTitle && hasSubtitle) {
            // 监听主标题播放完成事件
            var onTitleComplete = function (data) {
                // 确保是主标题完成了
                if (data && data.i18nKey === self.titleKey) {
                    // 移除监听器
                    self.app.off('title:complete', onTitleComplete);
                    
                    // 延迟后播放副标题
                    var subtitleDelay = (self.titleDisplayDelay || 0.2) * 1000;
                    setTimeout(function() {
                        self.app.fire('title:show', self.subtitleKey);
                        if (self.enableDebugLog) {
                            console.log('[CheckingPoint] 主标题完成，开始显示副标题:', self.subtitleKey);
                        }
                    }, subtitleDelay);
                }
            };
            
            // 绑定监听器
            this.app.on('title:complete', onTitleComplete, this);
            
            // 显示主标题
            this.app.fire('title:show', this.titleKey);
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] 开始显示主标题（等待完成后播放副标题）:', this.titleKey);
            }
        }
        
        // 触发标题显示事件（供其他系统监听）
        this.app.fire('checkpoint:title:show', {
            checkpoint: this.entity,
            mainTitleKey: hasMainTitle ? this.titleKey : null,
            subtitleKey: hasSubtitle ? this.subtitleKey : null,
            titleDisplayDelay: this.titleDisplayDelay || 0.2
        });
        
    } catch (e) {
        console.error('[CheckingPoint] 显示双标题失败:', e);
    }
};

// ===== Prologue 播放功能 =====

/**
 * 锁定玩家并播放 prologue
 */
CheckingPoint.prototype._lockPlayerAndPlayPrologue = function () {
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] 锁定玩家并播放 prologue:', this.prologueKey);
    }
    
    try {
        // 锁定玩家
        this.app.fire('player:set_sitting', true);
        
        // 设置相机为锁定多机位状态
        if (typeof GlobalCameraManager !== 'undefined') {
            var gcam = GlobalCameraManager.getInstance();
            if (gcam) {
                gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
                if (this.enableDebugLog) {
                    console.log('[CheckingPoint] 相机状态设置为 LOCKED_MULTI');
                }
            }
        } else {
            this.app.fire('ui:control:set', 'LOCKED_MULTI');
        }
        
        // 播放 prologue
        this._playPrologue();
        
    } catch (e) {
        console.error('[CheckingPoint] 锁定玩家失败:', e);
        // 如果锁定失败，直接处理后续逻辑
        this._onPrologueComplete();
    }
};

/**
 * 播放指定的 prologue 内容
 */
CheckingPoint.prototype._playPrologue = function () {
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] 开始播放 prologue:', this.prologueKey);
    }
    
    try {
        // 记录 prologue 播放到 GameManager
        if (typeof GlobalGame !== 'undefined' && GlobalGame.recordProloguePlay) {
            GlobalGame.recordProloguePlay(this.prologueKey, this._checkpointId, {
                entityName: this.entity.name,
                position: {
                    x: this.entity.getPosition().x,
                    y: this.entity.getPosition().y,
                    z: this.entity.getPosition().z
                }
            });
            
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] Prologue play recorded in GameManager for:', this._checkpointId);
            }
        }
        
        // 检查 UIManager 是否可用
        if (typeof UIManager === 'undefined' || !UIManager.getInstance) {
            console.warn('[CheckingPoint] UIManager 不可用，无法播放 prologue');
            this._onPrologueComplete();
            return;
        }
        
        var uiManager = UIManager.getInstance();
        if (!uiManager) {
            console.warn('[CheckingPoint] UIManager 实例不存在');
            this._onPrologueComplete();
            return;
        }
        
        // 调用 UIManager 播放指定的 prologue，使用回调方式
        var self = this;
        if (typeof uiManager.playLevelPrologue === 'function') {
            uiManager.playLevelPrologue(this.prologueKey, function() {
                self._onPrologueComplete();
            });
        } else {
            console.warn('[CheckingPoint] UIManager.playLevelPrologue 方法不存在');
            this._onPrologueComplete();
        }
        
    } catch (e) {
        console.error('[CheckingPoint] 播放 prologue 失败:', e);
        this._onPrologueComplete();
    }
};

/**
 * Prologue 播放完成后的处理
 */
CheckingPoint.prototype._onPrologueComplete = function () {
    if (this.enableDebugLog) {
        console.log('[CheckingPoint] Prologue 播放完成，处理后续逻辑');
    }
    
    try {
        // 如果之前锁定了玩家，现在解锁
        if (this.playPrologueBeforeUnlock) {
            if (this.enableDebugLog) {
                console.log('[CheckingPoint] 解锁玩家坐姿状态');
            }
            this.app.fire('player:set_sitting', false);
            
            // 恢复相机为自由跟随状态
            if (typeof GlobalCameraManager !== 'undefined') {
                var gcam = GlobalCameraManager.getInstance();
                if (gcam) {
                    gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
                    if (this.enableDebugLog) {
                        console.log('[CheckingPoint] 相机状态恢复为 FREE_FOLLOW');
                    }
                }
            } else {
                this.app.fire('ui:control:set', 'FREE_FOLLOW');
            }
        }
        
        // 处理关卡存档点逻辑
        if (this.isLevelCheckpoint) {
            this._activateNextPart();
        }
        
        // 触发 prologue 完成事件
        this.app.fire('checkpoint:prologue:complete', {
            checkpoint: this.entity,
            prologueKey: this.prologueKey
        });
        
    } catch (e) {
        console.error('[CheckingPoint] Prologue 完成处理失败:', e);
    }
};

// ===== 清理 =====
CheckingPoint.prototype.destroy = function () {
    if (this.app && this._onInteractableAction) {
        this.app.off('interactable:action', this._onInteractableAction, this);
    }
    
    // prologue 使用回调方式，无需清理事件监听
    
    // 恢复所有实体的原始状态
    for (var i = 0; i < this._originalStates.length; i++) {
        var state = this._originalStates[i];
        if (state.entity && state.entity.enabled) {
            state.entity.setLocalScale(state.originalScale);
            if (state.material && state.originalEmissive) {
                state.material.emissive.copy(state.originalEmissive);
                state.material.update();
            }
        }
    }
};
