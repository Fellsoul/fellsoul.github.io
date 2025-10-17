/* global pc */

/**
 * @file LevelManager.js
 * @desc 关卡部分（Part）管理器，控制关卡中不同区域的显示和隐藏
 * @pc-attrs
 *   parts:entity[]=[] - Part 实体数组（按顺序 part-0, part-1, part-2...）
 *   enableDebugLog:boolean=false - 启用调试日志
 */

var LevelManager = pc.createScript('levelManager');

// ---- 属性定义 ----
LevelManager.attributes.add('sceneName', {
  type: 'string',
  default: '',
  title: '场景名称',
  description: '当前场景的名称，用于保存/恢复Part状态（如：level1, ethans_wind等）'
});

LevelManager.attributes.add('parts', {
  type: 'entity',
  array: true,
  title: 'Part 实体列表',
  description: '按顺序挂载 part-0, part-1, part-2 等实体'
});

LevelManager.attributes.add('enableDebugLog', {
  type: 'boolean',
  default: false,
  title: '启用调试日志'
});

// ---- 静态单例 ----
LevelManager._instance = null;

/**
 * 获取 LevelManager 单例
 * @returns {LevelManager|null}
 */
LevelManager.getInstance = function() {
  return LevelManager._instance;
};

// ---- 生命周期 ----
LevelManager.prototype.initialize = function() {
  // 单例模式 - 改进版：支持场景切换时的实例替换
  if (LevelManager._instance && LevelManager._instance !== this) {
    if (this.enableDebugLog) {
      console.log('[LevelManager] 检测到场景切换，替换旧实例');
    }
    // 清理旧实例
    var oldInstance = LevelManager._instance;
    if (oldInstance && typeof oldInstance.destroy === 'function') {
      oldInstance.destroy();
    }
  }
  
  LevelManager._instance = this;
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 初始化');
    console.log('[LevelManager] Part 数量:', this.parts.length);
  }
  
  // 通知GlobalGame当前场景名称
  if (this.sceneName && this.sceneName.trim() !== '') {
    if (typeof GlobalGame !== 'undefined') {
      // 方式1：使用setCurrentScene方法（传递skipInitialization=true跳过场景初始化逻辑）
      if (typeof GlobalGame.setCurrentScene === 'function') {
        GlobalGame.setCurrentScene(this.sceneName, true);
        if (this.enableDebugLog) {
          console.log('[LevelManager] 已通过setCurrentScene通知GlobalGame当前场景:', this.sceneName, '(skipInitialization)');
        }
      } 
      // 方式2：直接设置属性
      else {
        GlobalGame.currentScene = this.sceneName;
        if (this.enableDebugLog) {
          console.log('[LevelManager] 已直接设置GlobalGame.currentScene:', this.sceneName);
        }
      }
    } else {
      console.warn('[LevelManager] GlobalGame不可用，无法设置当前场景名称');
    }
  } else {
    if (this.enableDebugLog) {
      console.warn('[LevelManager] sceneName未配置，无法通知GlobalGame');
    }
  }
  
  // 缓存：临时向量
  this._tempScale = new pc.Vec3();
  
  // 当前激活的 Part 索引
  this._currentPartIndex = 0;
  
  // 原始缩放记录：{ partIndex: { childIndex: pc.Vec3 } }
  this._originalScales = {};
  
  // 初始化标志，防止重复初始化
  this._partsInitialized = false;
  
  // 监听场景加载事件
  this._onSceneLoaded = this._onSceneLoaded.bind(this);
  this.app.on('scene:loaded', this._onSceneLoaded, this);
  
  // 立即初始化 Parts（无论什么场景都执行，因为脚本只会在需要的场景中被挂载）
  if (this.enableDebugLog) {
    console.log('[LevelManager] 立即初始化 Parts');
  }
  
  // 延迟一帧确保所有实体都已加载完成
  var self = this;
  setTimeout(function() {
    self._initializeParts();
    // 初始化完成后，从本地存储恢复Part状态
    self._restorePartStateFromStorage();
  }, 0);
};

LevelManager.prototype.destroy = function() {
  // 解绑事件
  if (this.app) {
    this.app.off('scene:loaded', this._onSceneLoaded, this);
  }
  
  // 清除单例
  if (LevelManager._instance === this) {
    LevelManager._instance = null;
  }
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 已销毁');
  }
};

// ---- 场景事件处理 ----
LevelManager.prototype._onSceneLoaded = function(data) {
  var sceneName = data && data.sceneName;
  
  if (!sceneName) return;
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 场景已加载:', sceneName);
  }
  
  // 检查是否为 level 场景
  if (this._isLevelScene(sceneName)) {
    if (this.enableDebugLog) {
      console.log('[LevelManager] 检测到 level 场景，初始化 Parts');
    }
    this._initializeParts();
  }
};

// ---- 核心逻辑 ----

/**
 * 初始化 Parts：记录原始缩放并隐藏除 index 0 外的所有 Part 的所有子节点
 */
LevelManager.prototype._initializeParts = function() {
  // 防止重复初始化
  if (this._partsInitialized) {
    if (this.enableDebugLog) {
      console.log('[LevelManager] Parts 已经初始化过，跳过重复初始化');
    }
    return;
  }
  
  if (!this.parts || this.parts.length === 0) {
    if (this.enableDebugLog) {
      console.warn('[LevelManager] Parts 列表为空，跳过初始化');
    }
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 开始初始化 Parts（记录原始缩放并隐藏 Part[1+]）');
  }
  
  // 清空原始缩放记录
  this._originalScales = {};
  
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    
    if (!part) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] Part[' + i + '] 为空，跳过');
      }
      continue;
    }
    
    // 记录该 Part 所有子节点的原始缩放
    this._recordPartOriginalScales(part, i);
    
    if (i === 0) {
      // Part-0：保持可见
      if (this.enableDebugLog) {
        console.log('[LevelManager] Part[0] (' + part.name + ') 保持可见');
      }
    } else {
      // Part-1+：初始化时隐藏
      this._setPartChildrenScale(part, 0, 0, 0);
      if (this.enableDebugLog) {
        console.log('[LevelManager] Part[' + i + '] (' + part.name + ') 初始化时隐藏');
      }
    }
  }
  
  this._currentPartIndex = 0;
  
  // 标记为已初始化
  this._partsInitialized = true;
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] Parts 初始化完成，当前激活 Part:', this._currentPartIndex);
    console.log('[LevelManager] 原始缩放记录:', this._originalScales);
  }
  
  // 检查是否需要设置玩家初始位置
  this._setInitialPlayerPosition();
};

/**
 * 记录 Part 所有子节点的原始缩放
 * @param {pc.Entity} part - Part 实体
 * @param {number} partIndex - Part 索引
 */
LevelManager.prototype._recordPartOriginalScales = function(part, partIndex) {
  if (!part) return;
  
  this._originalScales[partIndex] = {};
  
  var children = part.children;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child) {
      var currentScale = child.getLocalScale();
      
      // 如果当前缩放为 0 或接近 0，使用默认缩放 (1,1,1)
      if (currentScale.x < 0.001 && currentScale.y < 0.001 && currentScale.z < 0.001) {
        this._originalScales[partIndex][i] = new pc.Vec3(1, 1, 1);
        if (this.enableDebugLog) {
          console.log('[LevelManager] Part[' + partIndex + '] 子节点[' + i + '] (' + child.name + ') 缩放为 0，使用默认缩放 (1,1,1)');
        }
      } else {
        // 克隆当前缩放作为原始缩放
        this._originalScales[partIndex][i] = currentScale.clone();
        if (this.enableDebugLog) {
          console.log('[LevelManager] 记录 Part[' + partIndex + '] 子节点[' + i + '] (' + child.name + ') 原始缩放:', 
                     this._originalScales[partIndex][i]);
        }
      }
    }
  }
};

/**
 * 恢复 Part 所有子节点的原始缩放和启用状态
 * @param {pc.Entity} part - Part 实体
 * @param {number} partIndex - Part 索引
 */
LevelManager.prototype._restorePartChildrenScale = function(part, partIndex) {
  if (!part || !this._originalScales[partIndex]) return;
  
  var children = part.children;
  var originalScales = this._originalScales[partIndex];
  
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child && originalScales[i]) {
      child.setLocalScale(originalScales[i]);
      
      // 恢复缩放时同时启用实体（性能优化）
      child.enabled = true;
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 恢复 Part[' + partIndex + '] 子节点[' + i + '] (' + child.name + ') 原始缩放:', 
                   originalScales[i]);
      }
    }
  }
};

/**
 * 设置 Part 的所有子节点缩放和启用状态（性能优化）
 * @param {pc.Entity} part - Part 实体
 * @param {number} x - X 轴缩放
 * @param {number} y - Y 轴缩放
 * @param {number} z - Z 轴缩放
 */
LevelManager.prototype._setPartChildrenScale = function(part, x, y, z) {
  if (!part) return;
  
  this._tempScale.set(x, y, z);
  var isHiding = (x === 0 && y === 0 && z === 0);
  
  var children = part.children;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child) {
      child.setLocalScale(this._tempScale);
      

    }
  }
};

/**
 * 激活指定 Part（显示该 Part 的所有子节点，前面所有 Part 也恢复缩放）
 * @param {number} partIndex - Part 索引
 */
LevelManager.prototype.activatePart = function(partIndex) {
  if (partIndex < 0 || partIndex >= this.parts.length) {
    console.warn('[LevelManager] 无效的 Part 索引:', partIndex);
    return;
  }
  
  if (partIndex === this._currentPartIndex) {
    if (this.enableDebugLog) {
      console.log('[LevelManager] Part[' + partIndex + '] 已经激活，跳过');
    }
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 激活 Part[' + partIndex + '] 并恢复前面所有 Part');
  }
  
  // 保存旧的索引用于事件
  var previousIndex = this._currentPartIndex;
  
  // 恢复从 Part-0 到目标 Part 的所有缩放
  for (var i = 0; i <= partIndex; i++) {
    var part = this.parts[i];
    if (part) {
      // 首先确保Part实体本身的缩放是正常的
      var partScale = part.getLocalScale();
      if (partScale.x < 0.001 || partScale.y < 0.001 || partScale.z < 0.001) {
        part.setLocalScale(1, 1, 1);
        if (this.enableDebugLog) {
          console.log('[LevelManager] Part[' + i + '] 本身缩放为0，恢复为(1,1,1)');
        }
      }
      
      // 恢复子节点的缩放
      this._restorePartChildrenScale(part, i);
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 已恢复 Part[' + i + '] (' + part.name + ') 的原始缩放');
      }
    }
  }
  
  // 隐藏目标 Part 之后的所有 Part
  for (var j = partIndex + 1; j < this.parts.length; j++) {
    var laterPart = this.parts[j];
    if (laterPart) {
      this._setPartChildrenScale(laterPart, 0, 0, 0);
      if (this.enableDebugLog) {
        console.log('[LevelManager] 隐藏 Part[' + j + '] (' + laterPart.name + ')');
      }
    }
  }
  
  // 更新当前索引
  this._currentPartIndex = partIndex;
  
  // 保存Part状态到本地存储
  this._savePartStateToStorage(partIndex);
  
  // 触发事件
  this.app.fire('level:part:changed', {
    previousIndex: previousIndex,
    currentIndex: partIndex,
    currentPart: this.parts[partIndex]
  });
};

/**
 * 获取当前激活的 Part 索引
 * @returns {number}
 */
LevelManager.prototype.getCurrentPartIndex = function() {
  return this._currentPartIndex;
};

/**
 * 获取当前激活的 Part 实体
 * @returns {pc.Entity|null}
 */
LevelManager.prototype.getCurrentPart = function() {
  return this.parts[this._currentPartIndex] || null;
};

/**
 * 重新记录所有 Parts 的原始缩放（用于运行时更新）
 */
LevelManager.prototype.recordAllOriginalScales = function() {
  if (!this.parts || this.parts.length === 0) {
    if (this.enableDebugLog) {
      console.warn('[LevelManager] Parts 列表为空，无法记录原始缩放');
    }
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 重新记录所有 Parts 的原始缩放');
  }
  
  this._originalScales = {};
  
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part) {
      this._recordPartOriginalScales(part, i);
    }
  }
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 原始缩放记录完成:', this._originalScales);
  }
};

/**
 * 手动强制初始化 Parts（调试用）
 */
LevelManager.prototype.forceInitializeParts = function() {
  if (this.enableDebugLog) {
    console.log('[LevelManager] 手动强制初始化 Parts');
  }
  this._initializeParts();
};

/**
 * 从本地存储恢复Part状态
 */
LevelManager.prototype._restorePartStateFromStorage = function() {
  var self = this;
  
  try {
    // 获取当前场景名
    var currentScene = this._getCurrentSceneName();
    if (!currentScene) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 无法获取当前场景名，尝试延迟重试...');
      }
      
      // 延迟重试，给GlobalGame和场景更多时间初始化
      setTimeout(function() {
        self._restorePartStateFromStorageRetry();
      }, 1000); // 延迟1秒重试
      return;
    }
    
    // 从GlobalGame获取Part状态
    if (typeof GlobalGame !== 'undefined' && GlobalGame.getScenePartState) {
      var savedPartIndex = GlobalGame.getScenePartState(currentScene);
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 从本地存储恢复Part状态，场景:', currentScene, '激活Part索引:', savedPartIndex);
      }
      
      // 如果有保存的Part状态且不是默认的Part-0，则激活对应的Part
      if (savedPartIndex > 0 && savedPartIndex < this.parts.length) {
        if (this.enableDebugLog) {
          console.log('[LevelManager] 恢复到Part[' + savedPartIndex + ']');
        }
        this.activatePart(savedPartIndex);
      } else {
        if (this.enableDebugLog) {
          console.log('[LevelManager] 保持默认Part[0]激活状态');
        }
      }
      
      // 恢复玩家重生点位置
      this._restorePlayerRespawnPoint(currentScene);
      
    } else {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] GlobalGame不可用，无法恢复Part状态');
      }
    }
  } catch (e) {
    console.error('[LevelManager] 恢复Part状态失败:', e);
  }
};

/**
 * 恢复玩家重生点位置
 */
LevelManager.prototype._restorePlayerRespawnPoint = function(currentScene) {
  try {
    // 从GlobalGame获取当前场景的存档点位置
    if (typeof GlobalGame === 'undefined') {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] GlobalGame不可用，无法恢复重生点');
      }
      return;
    }
    
    // 优先使用场景专属的存档点API
    var checkpointPos = null;
    if (currentScene && typeof GlobalGame.getSceneCheckpoint === 'function') {
      checkpointPos = GlobalGame.getSceneCheckpoint(currentScene);
      
      if (this.enableDebugLog && checkpointPos) {
        console.log('[LevelManager] 从场景专属存档点获取位置，场景:', currentScene);
      }
    }
    
    // 如果场景专属API不存在或没有数据，回退到全局API
    if (!checkpointPos && typeof GlobalGame.getCheckpoint === 'function') {
      checkpointPos = GlobalGame.getCheckpoint();
      
      if (this.enableDebugLog && checkpointPos) {
        console.log('[LevelManager] 从全局存档点获取位置');
      }
    }
    
    // 查找玩家实体
    var player = this.app.root.findByName('Player') || 
                 this.app.root.findByName('player') || 
                 this.app.root.findByTag('player')[0];
    
    if (!player) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 未找到玩家实体，无法设置重生点');
      }
      return;
    }
    
    // 如果没有保存的存档点，使用玩家当前位置作为初始存档点
    if (!checkpointPos) {
      checkpointPos = player.getPosition().clone();
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 当前场景没有保存的存档点，使用玩家当前位置作为初始存档点');
        console.log('[LevelManager] 初始存档点位置:', checkpointPos);
      }
      
      // 保存这个初始存档点到localStorage
      if (typeof GlobalGame !== 'undefined' && typeof GlobalGame.saveCurrentSceneCheckpoint === 'function') {
        GlobalGame.saveCurrentSceneCheckpoint(checkpointPos, 'initial_spawn_' + currentScene);
        if (this.enableDebugLog) {
          console.log('[LevelManager] 已保存初始存档点到localStorage');
        }
      }
    }
    
    // 查找deathController脚本
    var deathController = player.script && player.script.deathController;
    if (!deathController) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 玩家实体上未找到deathController脚本');
      }
      return;
    }
    
    // 设置默认重生点
    if (deathController.defaultRespawnPoint) {
      deathController.defaultRespawnPoint.copy(checkpointPos);
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 已设置玩家重生点:', checkpointPos);
      }
    } else {
      // 如果defaultRespawnPoint不存在，创建一个
      deathController.defaultRespawnPoint = checkpointPos.clone();
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 已创建并设置玩家重生点:', checkpointPos);
      }
    }
    
    // 同时设置为全局存档点，确保DeathController能找到
    if (typeof GlobalGame !== 'undefined' && typeof GlobalGame.setCheckpoint === 'function') {
      GlobalGame.setCheckpoint(checkpointPos, 'level_restored_' + Date.now());
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 已设置全局存档点:', checkpointPos);
      }
    }
    
  } catch (e) {
    console.error('[LevelManager] 恢复玩家重生点失败:', e);
  }
};

/**
 * 延迟重试恢复Part状态
 */
LevelManager.prototype._restorePartStateFromStorageRetry = function() {
  try {
    var currentScene = this._getCurrentSceneName();
    if (!currentScene) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 重试后仍无法获取当前场景名，放弃Part状态恢复');
      }
      return;
    }
    
    if (this.enableDebugLog) {
      console.log('[LevelManager] 重试成功，获取到场景名:', currentScene);
    }
    
    // 从GlobalGame获取Part状态
    if (typeof GlobalGame !== 'undefined' && GlobalGame.getScenePartState) {
      var savedPartIndex = GlobalGame.getScenePartState(currentScene);
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 重试恢复Part状态，场景:', currentScene, '激活Part索引:', savedPartIndex);
      }
      
      // 如果有保存的Part状态且不是默认的Part-0，则激活对应的Part
      if (savedPartIndex > 0 && savedPartIndex < this.parts.length) {
        if (this.enableDebugLog) {
          console.log('[LevelManager] 重试恢复到Part[' + savedPartIndex + ']');
        }
        this.activatePart(savedPartIndex);
      } else {
        if (this.enableDebugLog) {
          console.log('[LevelManager] 重试后保持默认Part[0]激活状态');
        }
      }
      
      // 恢复玩家重生点位置
      this._restorePlayerRespawnPoint(currentScene);
      
    } else {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 重试时GlobalGame仍不可用，无法恢复Part状态');
      }
    }
  } catch (e) {
    console.error('[LevelManager] 重试恢复Part状态失败:', e);
  }
};

/**
 * 保存Part状态到本地存储
 * @param {number} partIndex - Part索引
 */
LevelManager.prototype._savePartStateToStorage = function(partIndex) {
  try {
    var currentScene = this._getCurrentSceneName();
    if (!currentScene) {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] 无法获取当前场景名，跳过Part状态保存');
      }
      return;
    }
    
    // 保存到GlobalGame
    if (typeof GlobalGame !== 'undefined' && GlobalGame.setScenePartState) {
      GlobalGame.setScenePartState(currentScene, partIndex);
      
      if (this.enableDebugLog) {
        console.log('[LevelManager] 已保存Part状态到本地存储，场景:', currentScene, 'Part索引:', partIndex);
      }
    } else {
      if (this.enableDebugLog) {
        console.warn('[LevelManager] GlobalGame不可用，无法保存Part状态');
      }
    }
  } catch (e) {
    console.error('[LevelManager] 保存Part状态失败:', e);
  }
};

/**
 * 激活指定 Part 并播放弹出动画
 * @param {number} partIndex - Part 索引
 * @param {Object} animOptions - 动画选项
 * @param {number} animOptions.duration - 单个动画时长（秒），默认 0.8
 * @param {number} animOptions.delay - 开始前延迟（秒），默认 0.3
 * @param {number} animOptions.itemDelay - 每个子节点间的延迟（秒），默认 0.05
 * @param {number} animOptions.overshoot - 过冲缩放倍数，默认 1.2
 * @param {boolean} animOptions.hidePrevious - 是否隐藏当前 Part，默认 false
 */
LevelManager.prototype.activatePartWithAnimation = function(partIndex, animOptions) {
  if (partIndex < 0 || partIndex >= this.parts.length) {
    console.warn('[LevelManager] 无效的 Part 索引:', partIndex);
    return;
  }
  
  if (partIndex === this._currentPartIndex) {
    if (this.enableDebugLog) {
      console.log('[LevelManager] Part[' + partIndex + '] 已经激活，跳过动画');
    }
    return;
  }
  
  // 默认动画参数
  var options = animOptions || {};
  var duration = options.duration || 0.8;
  var delay = options.delay || 0.3;
  var itemDelay = options.itemDelay || 0.05;
  var overshoot = options.overshoot || 1.2;
  var hidePrevious = options.hidePrevious === true; // 默认为 false，不隐藏
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 激活 Part[' + partIndex + '] 并播放弹出动画');
    console.log('[LevelManager] 动画参数:', { duration: duration, delay: delay, itemDelay: itemDelay, overshoot: overshoot, hidePrevious: hidePrevious });
  }
  
  // 保存旧的索引用于事件
  var previousIndex = this._currentPartIndex;
  
  // 恢复从 Part-0 到目标 Part 前一个的所有缩放（如果不是隐藏模式）
  if (!hidePrevious) {
    for (var k = 0; k < partIndex; k++) {
      var prevPart = this.parts[k];
      if (prevPart) {
        // 确保Part实体本身的缩放是正常的
        var prevPartScale = prevPart.getLocalScale();
        if (prevPartScale.x < 0.001 || prevPartScale.y < 0.001 || prevPartScale.z < 0.001) {
          prevPart.setLocalScale(1, 1, 1);
          if (this.enableDebugLog) {
            console.log('[LevelManager] Part[' + k + '] 本身缩放为0，恢复为(1,1,1)');
          }
        }
        
        // 恢复子节点的缩放
        this._restorePartChildrenScale(prevPart, k);
        
        if (this.enableDebugLog) {
          console.log('[LevelManager] 已恢复前置 Part[' + k + '] (' + prevPart.name + ') 的原始缩放');
        }
      }
    }
  } else {
    // 隐藏模式：隐藏当前 Part
    var currentPart = this.parts[this._currentPartIndex];
    if (currentPart) {
      this._setPartChildrenScale(currentPart, 0, 0, 0);
      if (this.enableDebugLog) {
        console.log('[LevelManager] 隐藏 Part[' + this._currentPartIndex + '] (' + currentPart.name + ')');
      }
    }
  }
  
  // 隐藏目标 Part 之后的所有 Part
  for (var m = partIndex + 1; m < this.parts.length; m++) {
    var laterPart = this.parts[m];
    if (laterPart) {
      this._setPartChildrenScale(laterPart, 0, 0, 0);
      if (this.enableDebugLog) {
        console.log('[LevelManager] 隐藏后续 Part[' + m + '] (' + laterPart.name + ')');
      }
    }
  }
  
  // 获取目标 Part
  var targetPart = this.parts[partIndex];
  if (!targetPart) {
    console.warn('[LevelManager] Part[' + partIndex + '] 不存在');
    return;
  }
  
  // 更新当前索引
  this._currentPartIndex = partIndex;
  
  // 保存Part状态到本地存储
  this._savePartStateToStorage(partIndex);
  
  // 首先确保Part实体本身的缩放是正常的
  var partScale = targetPart.getLocalScale();
  if (partScale.x < 0.001 || partScale.y < 0.001 || partScale.z < 0.001) {
    targetPart.setLocalScale(1, 1, 1);
    if (this.enableDebugLog) {
      console.log('[LevelManager] Part[' + partIndex + '] 本身缩放为0，恢复为(1,1,1)');
    }
  }
  
  // 先将目标 Part 的所有子节点设为缩放 0
  this._setPartChildrenScale(targetPart, 0, 0, 0);
  
  // 延迟后开始弹出动画
  var self = this;
  setTimeout(function() {
    self._animatePartChildrenPopIn(targetPart, partIndex, duration, itemDelay, overshoot);
  }, delay * 1000);
  
  // 触发事件
  this.app.fire('level:part:changed', {
    previousIndex: previousIndex,
    currentIndex: partIndex,
    currentPart: targetPart,
    animated: true
  });
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] Part[' + partIndex + '] 弹出动画已启动');
  }
};

/**
 * 播放 Part 子节点的弹出动画
 * @param {pc.Entity} part - Part 实体
 * @param {number} partIndex - Part 索引
 * @param {number} duration - 单个动画时长（秒）
 * @param {number} itemDelay - 子节点间延迟（秒）
 * @param {number} overshoot - 过冲缩放倍数
 */
LevelManager.prototype._animatePartChildrenPopIn = function(part, partIndex, duration, itemDelay, overshoot) {
  if (!part || !this._originalScales[partIndex]) {
    if (this.enableDebugLog) {
      console.warn('[LevelManager] 无法播放弹出动画，Part 或原始缩放数据缺失');
    }
    return;
  }
  
  var children = part.children;
  var originalScales = this._originalScales[partIndex];
  var self = this;
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 开始播放 Part[' + partIndex + '] 弹出动画，子节点数量:', children.length);
  }
  
  // 为每个子节点启动延迟动画
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var originalScale = originalScales[i];
    
    if (child && originalScale) {
      // 计算延迟时间
      var delay = i * itemDelay * 1000; // 转换为毫秒
      
      // 启动单个子节点的弹出动画
      (function(childEntity, targetScale, delayMs, index) {
        setTimeout(function() {
          self._animateScalePopIn(childEntity, targetScale, duration, overshoot, index);
        }, delayMs);
      })(child, originalScale, delay, i);
    }
  }
};

/**
 * 单个子节点的弹出动画（从 0 → overshoot → 原始缩放）
 * @param {pc.Entity} entity - 子节点实体
 * @param {pc.Vec3} targetScale - 目标缩放（原始缩放）
 * @param {number} duration - 动画时长（秒）
 * @param {number} overshoot - 过冲缩放倍数
 * @param {number} index - 子节点索引（用于调试）
 */
LevelManager.prototype._animateScalePopIn = function(entity, targetScale, duration, overshoot, index) {
  if (!entity || !targetScale) return;
  
  // 重要：弹出动画开始前先启用实体
  entity.enabled = true;
  
  var startTime = Date.now();
  var durationMs = duration * 1000;
  var self = this;
  
  // 缓存向量，避免频繁创建
  var currentScale = new pc.Vec3();
  
  if (this.enableDebugLog) {
    console.log('[LevelManager] 子节点[' + index + '] (' + entity.name + ') 开始弹出动画，目标缩放:', targetScale);
  }
  
  function animate() {
    var now = Date.now();
    var elapsed = now - startTime;
    var progress = Math.min(elapsed / durationMs, 1);
    
    // 使用 easeOutBack 缓动函数
    var eased = self._easeOutBackScale(progress, overshoot);
    
    // 计算当前缩放：从 0 到 targetScale
    currentScale.set(
      targetScale.x * eased,
      targetScale.y * eased,
      targetScale.z * eased
    );
    
    entity.setLocalScale(currentScale);
    
    // 继续动画或结束
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // 确保最终缩放精确
      entity.setLocalScale(targetScale);
      
      if (self.enableDebugLog) {
        console.log('[LevelManager] 子节点[' + index + '] (' + entity.name + ') 弹出动画完成');
      }
    }
  }
  
  // 开始动画
  requestAnimationFrame(animate);
};

/**
 * easeOutBack 缓动函数（支持自定义过冲值）
 * @param {number} t - 进度 (0-1)
 * @param {number} overshoot - 过冲倍数
 * @returns {number} 缓动后的值
 */
LevelManager.prototype._easeOutBackScale = function(t, overshoot) {
  var c1 = 1.70158 * (overshoot - 1);
  var c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ---- 工具方法 ----

/**
 * 检查场景名是否为 level 场景
 * @param {string} sceneName - 场景名称
 * @returns {boolean}
 */
LevelManager.prototype._isLevelScene = function(sceneName) {
  if (!sceneName) return false;
  return sceneName.toLowerCase().indexOf('level') === 0;
};

/**
 * 获取当前场景名称
 * @returns {string|null}
 */
LevelManager.prototype._getCurrentSceneName = function() {
  // 方式0：优先使用配置的场景名称属性（最可靠）
  if (this.sceneName && this.sceneName.trim() !== '') {
    if (this.enableDebugLog) {
      console.log('[LevelManager] 使用配置的场景名称:', this.sceneName);
    }
    return this.sceneName.trim();
  }
  
  // 方式1：从 GlobalGame 获取
  if (typeof GlobalGame !== 'undefined' && GlobalGame.getCurrentScene) {
    var sceneName = GlobalGame.getCurrentScene();
    if (sceneName) {
      if (this.enableDebugLog) {
        console.log('[LevelManager] 从GlobalGame获取场景名称:', sceneName);
      }
      return sceneName;
    }
  }
  
  // 方式2：从 PlayCanvas Scene API 获取
  if (this.app && this.app.scene) {
    if (this.app.scene.name) {
      return this.app.scene.name;
    }
    
    // 尝试从scene的其他属性获取
    if (this.app.scene._name) {
      return this.app.scene._name;
    }
  }
  
  // 方式3：从 PlayCanvas Root 获取
  if (this.app && this.app.root && this.app.root.name) {
    // 有时场景名存储在root实体的名称中
    var rootName = this.app.root.name;
    if (rootName && rootName !== 'Root' && rootName !== 'root' && rootName !== 'Untitled') {
      return rootName;
    }
  }
  
  if (this.enableDebugLog) {
    console.warn('[LevelManager] 无法获取场景名，建议在LevelManager属性中配置sceneName');
    console.log('[LevelManager] Debug info:');
    console.log('  - sceneName配置:', this.sceneName);
    console.log('  - GlobalGame available:', typeof GlobalGame !== 'undefined');
    console.log('  - app.scene.name:', this.app && this.app.scene && this.app.scene.name);
    console.log('  - app.root.name:', this.app && this.app.root && this.app.root.name);
  }
  
  return null;
};

/**
 * 设置玩家初始位置（第一次进入场景时）
 * 如果没有存档点数据，将玩家位置设置为 DeathController 的默认重生点
 */
LevelManager.prototype._setInitialPlayerPosition = function() {
  try {
    // 检查是否有存档点数据
    var hasCheckpoint = false;
    if (typeof GlobalGame !== 'undefined') {
      var checkpoint = GlobalGame.getCheckpoint();
      if (checkpoint) {
        hasCheckpoint = true;
        if (this.enableDebugLog) {
          console.log('[LevelManager] 已有存档点数据，跳过初始位置设置');
        }
      }
    }
    
    // 如果没有存档点数据，设置玩家到 DeathController 的默认重生点
    if (!hasCheckpoint) {
      // 查找 DeathController
      var deathController = null;
      var entities = this.app.root.findByName('DeathController');
      if (entities && entities.length > 0) {
        deathController = entities[0].script && entities[0].script.deathController;
      }
      
      // 如果没找到，尝试在场景中搜索
      if (!deathController) {
        var allEntities = this.app.root.findComponents('script');
        for (var i = 0; i < allEntities.length; i++) {
          var entity = allEntities[i];
          if (entity.script && entity.script.deathController) {
            deathController = entity.script.deathController;
            break;
          }
        }
      }
      
      if (deathController && deathController.respawnPoint) {
        // 获取默认重生点位置
        var respawnPos = deathController.respawnPoint.getPosition().clone();
        
        // 应用位置偏移
        if (deathController.defaultSpawnOffset) {
          var offset = deathController.defaultSpawnOffset;
          if (!(offset instanceof pc.Vec3)) {
            offset = new pc.Vec3(offset.x || offset[0] || 0, offset.y || offset[1] || 0, offset.z || offset[2] || 0);
          }
          respawnPos.add(offset);
        }
        
        // 查找玩家实体
        var player = null;
        if (deathController.player) {
          player = deathController.player;
        } else {
          // 尝试通过名称查找玩家
          var playerEntities = this.app.root.findByName('Player');
          if (playerEntities && playerEntities.length > 0) {
            player = playerEntities[0];
          }
        }
        
        if (player) {
          // 设置玩家位置
          var rb = player.rigidbody;
          if (rb) {
            // 使用 teleport 更可靠
            rb.teleport(respawnPos, deathController.respawnPoint.getRotation());
          } else {
            player.setPosition(respawnPos);
            player.setRotation(deathController.respawnPoint.getRotation());
          }
          
          if (this.enableDebugLog) {
            console.log('[LevelManager] 第一次进入场景，设置玩家初始位置为 DeathController 重生点:', respawnPos);
          }
        } else {
          if (this.enableDebugLog) {
            console.warn('[LevelManager] 未找到玩家实体，无法设置初始位置');
          }
        }
      } else {
        if (this.enableDebugLog) {
          console.warn('[LevelManager] 未找到 DeathController 或其重生点，无法设置玩家初始位置');
        }
      }
    }
  } catch (e) {
    if (this.enableDebugLog) {
      console.error('[LevelManager] 设置玩家初始位置时出错:', e);
    }
  }
};
