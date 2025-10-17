/* global pc, GlobalBgm, GlobalSfx, GlobalAudioSettings, GlobalAudioSceneConfig */
/**
 * @file audio-global-initializer.js
 * @desc 全局音频模块初始化器
 * 
 * 使用说明：
 * 1. 将此脚本挂载到Root场景的一个实体上（建议AudioManager实体）
 * 2. 确保以下全局脚本已加载：
 *    - audio-bgm-global.js
 *    - audio-sfx-global.js
 *    - audio-settings-global.js
 *    - audio-scene-config-global.js
 * 3. 初始化完成后，可通过全局对象访问：
 *    - GlobalBgm.play(...)
 *    - GlobalSfx.play(...)
 *    - GlobalAudioSettings.set(...)
 *    - GlobalAudioSceneConfig.playScene(...)
 */

var AudioGlobalInitializer = pc.createScript('audioGlobalInitializer');

AudioGlobalInitializer.attributes.add('poolSize2D', { 
  type: 'number', 
  default: 8, 
  title: 'SFX 2D池大小' 
});

AudioGlobalInitializer.attributes.add('poolSize3D', { 
  type: 'number', 
  default: 16, 
  title: 'SFX 3D池大小' 
});

AudioGlobalInitializer.attributes.add('storageKey', { 
  type: 'string', 
  default: 'game.audio.v1', 
  title: '音频设置存储键' 
});

AudioGlobalInitializer.attributes.add('audioConfigAsset', {
  type: 'asset',
  assetType: 'json',
  title: '音频配置JSON',
  description: '场景音频配置文件（audio-config.json）'
});

AudioGlobalInitializer.attributes.add('enableDebugLog', { 
  type: 'boolean', 
  default: false, 
  title: '启用调试日志' 
});

AudioGlobalInitializer.prototype.initialize = function() {
  if (this.enableDebugLog) {
    console.log('[AudioGlobalInitializer] 开始初始化全局音频模块...');
  }
  
  // 设置AudioContext解锁（移动端必需）
  this._setupAudioUnlock();
  
  // 检查全局对象是否存在
  if (typeof GlobalBgm === 'undefined') {
    console.error('[AudioGlobalInitializer] GlobalBgm 未定义，请确保 audio-bgm-global.js 已加载');
    return;
  }
  
  if (typeof GlobalSfx === 'undefined') {
    console.error('[AudioGlobalInitializer] GlobalSfx 未定义，请确保 audio-sfx-global.js 已加载');
    return;
  }
  
  if (typeof GlobalAudioSettings === 'undefined') {
    console.error('[AudioGlobalInitializer] GlobalAudioSettings 未定义，请确保 audio-settings-global.js 已加载');
    return;
  }
  
  if (typeof GlobalAudioSceneConfig === 'undefined') {
    console.error('[AudioGlobalInitializer] GlobalAudioSceneConfig 未定义，请确保 audio-scene-config-global.js 已加载');
    return;
  }
  
  // 初始化音频设置（必须先初始化，因为它会设置bus音量）
  try {
    GlobalAudioSettings.initialize(this.app, this.storageKey);
    if (this.enableDebugLog) {
      console.log('[AudioGlobalInitializer] ✓ GlobalAudioSettings 初始化完成');
    }
  } catch (e) {
    console.error('[AudioGlobalInitializer] GlobalAudioSettings 初始化失败:', e);
  }
  
  // 初始化BGM管理器
  try {
    GlobalBgm.initialize(this.app);
    if (this.enableDebugLog) {
      console.log('[AudioGlobalInitializer] ✓ GlobalBgm 初始化完成');
    }
  } catch (e) {
    console.error('[AudioGlobalInitializer] GlobalBgm 初始化失败:', e);
  }
  
  // 初始化SFX管理器
  try {
    GlobalSfx.initialize(this.app, {
      poolSize2D: this.poolSize2D,
      poolSize3D: this.poolSize3D
    });
    if (this.enableDebugLog) {
      console.log('[AudioGlobalInitializer] ✓ GlobalSfx 初始化完成');
    }
  } catch (e) {
    console.error('[AudioGlobalInitializer] GlobalSfx 初始化失败:', e);
  }
  
  // 初始化场景音频配置
  try {
    if (this.audioConfigAsset) {
      GlobalAudioSceneConfig.initialize(this.app, this.audioConfigAsset);
      GlobalAudioSceneConfig.enableDebugLog = this.enableDebugLog;
      if (this.enableDebugLog) {
        console.log('[AudioGlobalInitializer] ✓ GlobalAudioSceneConfig 初始化完成');
      }
    } else {
      console.warn('[AudioGlobalInitializer] 未配置audioConfigAsset，GlobalAudioSceneConfig将使用空配置');
    }
  } catch (e) {
    console.error('[AudioGlobalInitializer] GlobalAudioSceneConfig 初始化失败:', e);
  }
  
  console.log('[AudioGlobalInitializer] ========================================');
  console.log('[AudioGlobalInitializer] 全局音频模块初始化完成！');
  console.log('[AudioGlobalInitializer] 可用模块:');
  console.log('[AudioGlobalInitializer]   - GlobalBgm (BGM管理)');
  console.log('[AudioGlobalInitializer]   - GlobalSfx (音效管理)');
  console.log('[AudioGlobalInitializer]   - GlobalAudioSettings (音频设置)');
  console.log('[AudioGlobalInitializer]   - GlobalAudioSceneConfig (场景音频配置)');
  console.log('[AudioGlobalInitializer] ========================================');
};

// ========== AudioContext 解锁（移动端必需）==========
AudioGlobalInitializer.prototype._setupAudioUnlock = function() {
  var ctx = this.app.soundManager && this.app.soundManager.context;
  if (!ctx) {
    console.warn('[AudioGlobalInitializer] AudioContext不可用');
    return;
  }
  
  var self = this;
  this._unlocked = false;
  
  this._unlock = function() {
    if (self._unlocked) return;
    
    try {
      if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume().then(function() {
          console.log('[AudioGlobalInitializer] ✓ AudioContext已解锁');
          self._unlocked = true;
          self.app.fire('audio:unlocked');
          self._removeDomListeners();
        }).catch(function(e) {
          console.error('[AudioGlobalInitializer] AudioContext解锁失败:', e);
        });
      }
    } catch (e) {
      console.error('[AudioGlobalInitializer] AudioContext解锁异常:', e);
    }
  };
  
  // 监听多种用户交互事件
  this._onPointerUp = function() { self._unlock(); };
  this._onTouchEnd = function() { self._unlock(); };
  this._onKeyDown = function() { self._unlock(); };
  this._onClick = function() { self._unlock(); };
  
  // 添加监听器
  document.addEventListener('pointerup', this._onPointerUp, { passive: true });
  document.addEventListener('touchend', this._onTouchEnd, { passive: true });
  document.addEventListener('keydown', this._onKeyDown, { passive: true });
  document.addEventListener('click', this._onClick, { passive: true });
  
  if (this.enableDebugLog) {
    console.log('[AudioGlobalInitializer] 已设置音频解锁监听器（等待用户交互）');
  }
};

AudioGlobalInitializer.prototype._removeDomListeners = function() {
  if (this._onPointerUp) document.removeEventListener('pointerup', this._onPointerUp);
  if (this._onTouchEnd) document.removeEventListener('touchend', this._onTouchEnd);
  if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
  if (this._onClick) document.removeEventListener('click', this._onClick);
};

AudioGlobalInitializer.prototype.destroy = function() {
  if (this.enableDebugLog) {
    console.log('[AudioGlobalInitializer] 开始销毁全局音频模块...');
  }
  
  // 移除音频解锁监听器
  this._removeDomListeners();
  
  // 销毁所有全局模块
  try {
    if (typeof GlobalBgm !== 'undefined') {
      GlobalBgm.destroy();
    }
  } catch (e) {
    console.warn('[AudioGlobalInitializer] GlobalBgm 销毁失败:', e);
  }
  
  try {
    if (typeof GlobalSfx !== 'undefined') {
      GlobalSfx.destroy();
    }
  } catch (e) {
    console.warn('[AudioGlobalInitializer] GlobalSfx 销毁失败:', e);
  }
  
  try {
    if (typeof GlobalAudioSettings !== 'undefined') {
      GlobalAudioSettings.destroy();
    }
  } catch (e) {
    console.warn('[AudioGlobalInitializer] GlobalAudioSettings 销毁失败:', e);
  }
  
  try {
    if (typeof GlobalAudioSceneConfig !== 'undefined') {
      GlobalAudioSceneConfig.destroy();
    }
  } catch (e) {
    console.warn('[AudioGlobalInitializer] GlobalAudioSceneConfig 销毁失败:', e);
  }
  
  if (this.enableDebugLog) {
    console.log('[AudioGlobalInitializer] 全局音频模块已销毁');
  }
};
