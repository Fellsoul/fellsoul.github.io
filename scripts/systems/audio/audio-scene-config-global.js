/* global pc, GlobalBgm, GlobalSfx */
/**
 * @file audio-scene-config-global.js
 * @desc 全局场景音频配置管理器
 * 
 * 使用方式：
 *   GlobalAudioSceneConfig.initialize(app, audioConfigAsset);
 *   GlobalAudioSceneConfig.playScene('start');
 */

(function(window) {
  'use strict';
  
  var GlobalAudioSceneConfig = {
    // 初始化标志
    _initialized: false,
    _app: null,
    
    // 配置数据
    _configMap: {},
    _currentScene: null,
    _currentAmbientKey: null,
    
    // 调试开关
    enableDebugLog: false,
    
    /**
     * 初始化场景音频配置（同时初始化所有音频管理器）
     * @param {pc.Application} app - PlayCanvas应用实例
     * @param {object} opts - 配置选项
     *   - configAsset: JSON配置资源
     *   - configData: 配置数据对象
     *   - poolSize2D: SFX 2D池大小（默认8）
     *   - poolSize3D: SFX 3D池大小（默认16）
     *   - storageKey: 音频设置存储键（默认'game.audio.v1'）
     *   - enableDebugLog: 启用调试日志（默认false）
     */
    initialize: function(app, opts) {
      if (this._initialized) {
        console.warn('[GlobalAudioSceneConfig] 已经初始化过了');
        return;
      }
      
      opts = opts || {};
      this._app = app;
      this.enableDebugLog = opts.enableDebugLog || false;
      
      console.log('[GlobalAudioSceneConfig] ========================================');
      console.log('[GlobalAudioSceneConfig] 开始初始化全局音频系统...');
      console.log('[GlobalAudioSceneConfig] ========================================');
      
      // 1. 初始化AudioSettings（必须先初始化，因为它会设置bus音量）
      this._initializeAudioSettings(opts.storageKey || 'game.audio.v1');
      
      // 2. 初始化BGM管理器
      this._initializeBGM();
      
      // 3. 初始化SFX管理器
      this._initializeSFX(opts.poolSize2D || 8, opts.poolSize3D || 16);
      
      // 4. 加载场景音频配置
      this._loadSceneConfig(opts.configAsset || opts.configData);
      
      this._initialized = true;
      
      console.log('[GlobalAudioSceneConfig] ========================================');
      console.log('[GlobalAudioSceneConfig] 全局音频系统初始化完成！');
      console.log('[GlobalAudioSceneConfig] 可用模块:');
      console.log('[GlobalAudioSceneConfig]   - GlobalBgm (BGM管理)');
      console.log('[GlobalAudioSceneConfig]   - GlobalSfx (音效管理)');
      console.log('[GlobalAudioSceneConfig]   - GlobalAudioSettings (音频设置)');
      console.log('[GlobalAudioSceneConfig]   - GlobalAudioSceneConfig (场景音频)');
      console.log('[GlobalAudioSceneConfig] ========================================');
    },
    
    /**
     * 初始化音频设置模块
     * @private
     */
    _initializeAudioSettings: function(storageKey) {
      if (typeof GlobalAudioSettings === 'undefined') {
        console.error('[GlobalAudioSceneConfig] GlobalAudioSettings未定义，请确保audio-settings-global.js已加载');
        return;
      }
      
      try {
        GlobalAudioSettings.initialize(this._app, storageKey);
        console.log('[GlobalAudioSceneConfig] ✓ GlobalAudioSettings初始化完成');
      } catch (e) {
        console.error('[GlobalAudioSceneConfig] GlobalAudioSettings初始化失败:', e);
      }
    },
    
    /**
     * 初始化BGM模块
     * @private
     */
    _initializeBGM: function() {
      if (typeof GlobalBgm === 'undefined') {
        console.error('[GlobalAudioSceneConfig] GlobalBgm未定义，请确保audio-bgm-global.js已加载');
        return;
      }
      
      try {
        GlobalBgm.initialize(this._app);
        // 同步调试日志设置
        GlobalBgm.enableDebugLog = this.enableDebugLog;
        console.log('[GlobalAudioSceneConfig] ✓ GlobalBgm初始化完成，调试日志:', this.enableDebugLog);
      } catch (e) {
        console.error('[GlobalAudioSceneConfig] GlobalBgm初始化失败:', e);
      }
    },
    
    /**
     * 初始化SFX模块
     * @private
     */
    _initializeSFX: function(poolSize2D, poolSize3D) {
      if (typeof GlobalSfx === 'undefined') {
        console.error('[GlobalAudioSceneConfig] GlobalSfx未定义，请确保audio-sfx-global.js已加载');
        return;
      }
      
      try {
        GlobalSfx.initialize(this._app, {
          poolSize2D: poolSize2D,
          poolSize3D: poolSize3D
        });
        console.log('[GlobalAudioSceneConfig] ✓ GlobalSfx初始化完成');
      } catch (e) {
        console.error('[GlobalAudioSceneConfig] GlobalSfx初始化失败:', e);
      }
    },
    
    /**
     * 加载场景配置
     * @private
     */
    _loadSceneConfig: function(configAssetOrData) {
      if (!configAssetOrData) {
        console.warn('[GlobalAudioSceneConfig] 未提供配置，将使用空配置');
        this._configMap = {};
        return;
      }
      
      if (configAssetOrData.resource) {
        // 是Asset对象
        this._loadFromAsset(configAssetOrData);
      } else if (typeof configAssetOrData === 'object') {
        // 是配置数据对象
        this._loadFromData(configAssetOrData);
      }
      
      console.log('[GlobalAudioSceneConfig] ✓ 场景配置加载完成');
      console.log('[GlobalAudioSceneConfig]   配置场景数:', Object.keys(this._configMap).length);
      console.log('[GlobalAudioSceneConfig]   配置的场景:', Object.keys(this._configMap));
    },
    
    /**
     * 从Asset加载配置
     * @private
     */
    _loadFromAsset: function(asset) {
      var jsonData = asset.resource;
      if (jsonData && jsonData.scenes) {
        this._configMap = jsonData.scenes;
        console.log('[GlobalAudioSceneConfig] ✓ 从Asset加载配置成功');
      } else {
        console.error('[GlobalAudioSceneConfig] Asset配置格式错误，缺少scenes字段');
      }
    },
    
    /**
     * 从数据对象加载配置
     * @private
     */
    _loadFromData: function(data) {
      if (data.scenes) {
        this._configMap = data.scenes;
        console.log('[GlobalAudioSceneConfig] ✓ 从数据对象加载配置成功');
      } else {
        console.error('[GlobalAudioSceneConfig] 配置数据格式错误，缺少scenes字段');
      }
    },
    
    /**
     * 播放场景音频
     * @param {string} sceneName - 场景名称
     * @param {object} opts - 选项 { forceReplay }
     */
    playScene: function(sceneName, opts) {
      if (!this._initialized) {
        console.warn('[GlobalAudioSceneConfig] 未初始化');
        return;
      }
      
      opts = opts || {};
      var sceneKey = sceneName.toLowerCase();
      
      if (this.enableDebugLog) {
        console.log('[GlobalAudioSceneConfig] 播放场景音频:', sceneName);
      }
      
      // 如果相同场景且不强制重播，跳过
      if (this._currentScene === sceneKey && !opts.forceReplay) {
        if (this.enableDebugLog) {
          console.log('[GlobalAudioSceneConfig] 相同场景，跳过');
        }
        return;
      }
      
      // 获取场景配置
      var config = this._configMap[sceneKey];
      if (!config) {
        console.warn('[GlobalAudioSceneConfig] 场景无配置:', sceneName);
        console.warn('[GlobalAudioSceneConfig] 可用场景:', Object.keys(this._configMap));
        return;
      }
      
      // 播放BGM
      if (config.bgm && config.bgm.assetId) {
        this._playBGM(config.bgm);
      }
      
      // 播放环境音
      if (config.ambient && config.ambient.assetId) {
        this._playAmbient(config.ambient);
      }
      
      this._currentScene = sceneKey;
      
      if (this.enableDebugLog) {
        console.log('[GlobalAudioSceneConfig] ✓ 场景音频播放完成');
      }
    },
    
    /**
     * 播放BGM
     * @private
     */
    _playBGM: function(bgmConfig) {
      var assetId = bgmConfig.assetId;
      var volume = bgmConfig.volume != null ? bgmConfig.volume : 0.7;
      var crossfade = bgmConfig.crossfade != null ? bgmConfig.crossfade : 0.8;
      
      var bgmAsset = this._app.assets.get(assetId);
      
      if (!bgmAsset) {
        console.error('[GlobalAudioSceneConfig] BGM资产未找到, ID:', assetId);
        return;
      }
      
      if (this.enableDebugLog) {
        console.log('[GlobalAudioSceneConfig] 播放BGM:', bgmAsset.name, 'ID:', assetId, '音量:', volume);
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
        console.warn('[GlobalAudioSceneConfig] GlobalBgm未初始化');
      }
    },
    
    /**
     * 播放环境音
     * @private
     */
    _playAmbient: function(ambientConfig) {
      var assetId = ambientConfig.assetId;
      var volume = ambientConfig.volume != null ? ambientConfig.volume : 0.5;
      
      // 停止之前的环境音
      if (this._currentAmbientKey) {
        if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
          GlobalSfx.stop({ key: this._currentAmbientKey });
        }
      }
      
      var ambientAsset = this._app.assets.get(assetId);
      
      if (!ambientAsset) {
        console.error('[GlobalAudioSceneConfig] 环境音资产未找到, ID:', assetId);
        return;
      }
      
      if (this.enableDebugLog) {
        console.log('[GlobalAudioSceneConfig] 播放环境音:', ambientAsset.name, 'ID:', assetId, '音量:', volume);
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
        console.warn('[GlobalAudioSceneConfig] GlobalSfx未初始化');
      }
      
      this._currentAmbientKey = ambientKey;
    },
    
    /**
     * 停止当前场景音频
     */
    stopScene: function() {
      if (!this._initialized) return;
      
      if (this.enableDebugLog) {
        console.log('[GlobalAudioSceneConfig] 停止场景音频');
      }
      
      // 停止所有SFX
      if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
        GlobalSfx.stopAll();
      }
      
      this._currentAmbientKey = null;
      this._currentScene = null;
    },
    
    /**
     * 获取场景配置
     * @param {string} sceneName - 场景名称
     * @returns {object|null}
     */
    getSceneConfig: function(sceneName) {
      if (!sceneName) return null;
      return this._configMap[sceneName.toLowerCase()] || null;
    },
    
    /**
     * 销毁管理器
     */
    destroy: function() {
      if (!this._initialized) return;
      
      this._configMap = {};
      this._currentScene = null;
      this._currentAmbientKey = null;
      this._initialized = false;
      
      console.log('[GlobalAudioSceneConfig] 已销毁');
    }
  };
  
  // 暴露到全局
  window.GlobalAudioSceneConfig = GlobalAudioSceneConfig;
  
})(window);
