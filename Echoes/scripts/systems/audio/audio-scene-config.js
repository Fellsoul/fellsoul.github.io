/* global pc, GlobalBgm, GlobalSfx */
/**
 * @file audio-scene-config.js
 * @desc 场景音频配置管理器：为每个场景配置BGM和环境音
 * @pc-attrs
 *   sceneConfigs:json[]=[] - 场景音频配置数组
 *   enableDebugLog:boolean=false - 启用调试日志
 */

var AudioSceneConfig = pc.createScript('audioSceneConfig');

// 配置属性：音频配置JSON文件
AudioSceneConfig.attributes.add('audioConfigAsset', {
  type: 'asset',
  assetType: 'json',
  title: '音频配置JSON',
  description: '包含所有场景音频配置的JSON文件（audio-config.json）'
});

AudioSceneConfig.attributes.add('enableDebugLog', {
  type: 'boolean',
  default: false,
  title: '启用调试日志'
});

// ---- 生命周期 ----
AudioSceneConfig.prototype.initialize = function() {
  console.log('[AudioSceneConfig] 初始化场景音频配置管理器...');
  
  // 加载JSON配置
  this._configMap = {};
  if (this.audioConfigAsset && this.audioConfigAsset.resource) {
    var jsonData = this.audioConfigAsset.resource;
    if (jsonData.scenes) {
      this._configMap = jsonData.scenes;
      console.log('[AudioSceneConfig] ✓ JSON配置加载成功，场景数:', Object.keys(this._configMap).length);
      console.log('[AudioSceneConfig] 配置的场景:', Object.keys(this._configMap));
    } else {
      console.error('[AudioSceneConfig] JSON配置格式错误，缺少scenes字段');
    }
  } else {
    console.warn('[AudioSceneConfig] 未配置audioConfigAsset，将使用空配置');
  }
  
  // 当前播放的场景音频
  this._currentScene = null;
  this._currentAmbientKey = null;
  
  // 监听场景切换事件
  this._onSceneAudioPlay = this.playSceneAudio.bind(this);
  this.app.on('audio:scene:play', this._onSceneAudioPlay, this);
  
  // 监听场景音频停止事件
  this._onSceneAudioStop = this.stopSceneAudio.bind(this);
  this.app.on('audio:scene:stop', this._onSceneAudioStop, this);
  
  console.log('[AudioSceneConfig] ========================================');
  console.log('[AudioSceneConfig] 音频配置管理器初始化完成！');
  console.log('[AudioSceneConfig] ========================================');
};

/**
 * 播放场景音频（BGM + 环境音）
 * @param {string|object} sceneNameOrOpts - 场景名称或配置对象 { sceneName, forceReplay }
 */
AudioSceneConfig.prototype.playSceneAudio = function(sceneNameOrOpts) {
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] ========== playSceneAudio 被调用 ==========');
    console.log('[AudioSceneConfig] 参数:', sceneNameOrOpts);
  }
  
  // 解析场景名
  var sceneName = typeof sceneNameOrOpts === 'string' ? sceneNameOrOpts : (sceneNameOrOpts && sceneNameOrOpts.sceneName);
  var forceReplay = sceneNameOrOpts && sceneNameOrOpts.forceReplay;
  
  if (!sceneName) {
    console.warn('[AudioSceneConfig] 场景名称无效');
    return;
  }
  
  var sceneKey = sceneName.toLowerCase();
  
  // 如果相同场景且不强制重播，跳过
  if (this._currentScene === sceneKey && !forceReplay) {
    if (this.enableDebugLog) {
      console.log('[AudioSceneConfig] 相同场景，跳过');
    }
    return;
  }
  
  // 获取场景配置
  var config = this._configMap[sceneKey];
  if (!config) {
    console.warn('[AudioSceneConfig] 场景无配置:', sceneName, '可用场景:', Object.keys(this._configMap));
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] 播放场景音频:', sceneName, '配置:', config);
  }
  
  // 播放BGM
  if (config.bgm && config.bgm.assetId) {
    this._playBGMByAssetId(config.bgm);
  }
  
  // 播放环境音
  if (config.ambient && config.ambient.assetId) {
    this._playAmbientByAssetId(config.ambient);
  }
  
  this._currentScene = sceneKey;
  
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] ========================================');
  }
};

/**
 * 通过Asset ID播放BGM
 * @private
 */
AudioSceneConfig.prototype._playBGMByAssetId = function(bgmConfig) {
  var assetId = bgmConfig.assetId;
  var volume = bgmConfig.volume != null ? bgmConfig.volume : 0.7;
  var crossfade = bgmConfig.crossfade != null ? bgmConfig.crossfade : 0.8;
  
  // 直接通过ID获取资源
  var bgmAsset = this.app.assets.get(assetId);
  
  if (!bgmAsset) {
    console.error('[AudioSceneConfig] BGM资产未找到, ID:', assetId);
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] 播放BGM:', bgmAsset.name, 'ID:', assetId, '音量:', volume);
  }
  
  // 使用全局BGM管理器
  if (typeof GlobalBgm !== 'undefined' && GlobalBgm._initialized) {
    GlobalBgm.play({
      asset: bgmAsset,
      id: assetId,
      crossfade: crossfade,
      volume: volume,
      loop: true  // 确保BGM循环播放
    });
  } else {
    // 降级：使用事件系统
    this.app.fire('bgm:play', {
      asset: bgmAsset,
      id: assetId,
      crossfade: crossfade,
      volume: volume,
      loop: true  // 确保BGM循环播放
    });
  }
};

/**
 * 通过Asset ID播放环境音
 * @private
 */
AudioSceneConfig.prototype._playAmbientByAssetId = function(ambientConfig) {
  var assetId = ambientConfig.assetId;
  var volume = ambientConfig.volume != null ? ambientConfig.volume : 0.5;
  
  // 停止之前的环境音
  if (this._currentAmbientKey) {
    if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
      GlobalSfx.stop({ key: this._currentAmbientKey });
    } else {
      this.app.fire('sfx:stop', { key: this._currentAmbientKey });
    }
  }
  
  // 直接通过ID获取资源
  var ambientAsset = this.app.assets.get(assetId);
  
  if (!ambientAsset) {
    console.error('[AudioSceneConfig] 环境音资产未找到, ID:', assetId);
    return;
  }
  
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] 播放环境音:', ambientAsset.name, 'ID:', assetId, '音量:', volume);
  }
  
  var ambientKey = 'ambient_' + assetId;
  
  // 使用全局SFX管理器
  if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
    GlobalSfx.play({
      key: ambientKey,
      asset: ambientAsset,
      vol: volume,
      loop: true
    });
  } else {
    // 降级：使用事件系统
    this.app.fire('sfx:play', {
      key: ambientKey,
      asset: ambientAsset,
      vol: volume,
      loop: true
    });
  }
  
  this._currentAmbientKey = ambientKey;
};

/**
 * 停止当前场景音频
 */
AudioSceneConfig.prototype.stopSceneAudio = function() {
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] ========== stopSceneAudio 被调用 ==========');
    console.log('[AudioSceneConfig] 当前场景:', this._currentScene);
    console.log('[AudioSceneConfig] 当前环境音:', this._currentAmbient);
  }
  
  // 停止所有SFX（包括环境音）
  if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
    GlobalSfx.stopAll();
    if (this.enableDebugLog) {
      console.log('[AudioSceneConfig] ✓ GlobalSfx.stopAll() 调用完成');
    }
  } else {
    // 降级：使用事件系统（向后兼容）
    this.app.fire('sfx:stopAll');
    if (this.enableDebugLog) {
      console.log('[AudioSceneConfig] 使用事件系统停止SFX');
    }
  }
  
  // 清除标记
  this._currentAmbient = null;
  this._currentScene = null;
  
  if (this.enableDebugLog) {
    console.log('[AudioSceneConfig] 场景音频已停止');
    console.log('[AudioSceneConfig] ==========================================');
  }
};

/**
 * 获取场景配置
 * @param {string} sceneName - 场景名称
 * @returns {object|null} 场景配置对象
 */
AudioSceneConfig.prototype.getSceneConfig = function(sceneName) {
  if (!sceneName) return null;
  return this._configMap[sceneName.toLowerCase()] || null;
};


AudioSceneConfig.prototype.destroy = function() {
  this.app.off('audio:scene:play', this._onSceneAudioPlay, this);
  this.app.off('audio:scene:stop', this._onSceneAudioStop, this);
  
  console.log('[AudioSceneConfig] 已销毁');
};
