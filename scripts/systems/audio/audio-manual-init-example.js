/* global pc, GlobalBgm, GlobalSfx, GlobalAudioSettings */
/**
 * @file audio-manual-init-example.js
 * @desc 手动初始化全局音频模块的示例
 * 
 * 如果不想使用AudioGlobalInitializer脚本，可以在GameManager或其他
 * 初始化脚本中手动初始化全局音频模块。
 */

// 示例1：在GameManager中初始化
GameManager.prototype.initialize = function() {
  // ... 其他初始化代码 ...
  
  // 初始化全局音频模块
  this._initializeGlobalAudio();
};

GameManager.prototype._initializeGlobalAudio = function() {
  console.log('[GameManager] 开始初始化全局音频模块...');
  
  // 检查全局对象是否存在
  if (typeof GlobalBgm === 'undefined') {
    console.error('[GameManager] GlobalBgm未定义，请确保audio-bgm-global.js已加载');
    return;
  }
  
  if (typeof GlobalSfx === 'undefined') {
    console.error('[GameManager] GlobalSfx未定义，请确保audio-sfx-global.js已加载');
    return;
  }
  
  if (typeof GlobalAudioSettings === 'undefined') {
    console.error('[GameManager] GlobalAudioSettings未定义，请确保audio-settings-global.js已加载');
    return;
  }
  
  try {
    // 1. 初始化音频设置（必须先初始化）
    GlobalAudioSettings.initialize(this.app, 'game.audio.v1');
    console.log('[GameManager] ✓ GlobalAudioSettings初始化完成');
    
    // 2. 初始化BGM管理器
    GlobalBgm.initialize(this.app);
    console.log('[GameManager] ✓ GlobalBgm初始化完成');
    
    // 3. 初始化SFX管理器
    GlobalSfx.initialize(this.app, {
      poolSize2D: 8,
      poolSize3D: 16
    });
    console.log('[GameManager] ✓ GlobalSfx初始化完成');
    
    console.log('[GameManager] ========================================');
    console.log('[GameManager] 全局音频模块初始化完成！');
    console.log('[GameManager] ========================================');
    
  } catch (e) {
    console.error('[GameManager] 全局音频模块初始化失败:', e);
  }
};

// 示例2：在应用启动时初始化
pc.Application.prototype.start = function() {
  // 原始start代码...
  
  // 初始化全局音频模块
  if (typeof GlobalBgm !== 'undefined' && !GlobalBgm._initialized) {
    GlobalAudioSettings.initialize(this, 'game.audio.v1');
    GlobalBgm.initialize(this);
    GlobalSfx.initialize(this, { poolSize2D: 8, poolSize3D: 16 });
  }
};

// 示例3：检查初始化状态
function checkGlobalAudioStatus() {
  console.log('========== 全局音频模块状态 ==========');
  console.log('GlobalBgm存在:', typeof GlobalBgm !== 'undefined');
  console.log('GlobalBgm已初始化:', typeof GlobalBgm !== 'undefined' && GlobalBgm._initialized);
  console.log('GlobalSfx存在:', typeof GlobalSfx !== 'undefined');
  console.log('GlobalSfx已初始化:', typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized);
  console.log('GlobalAudioSettings存在:', typeof GlobalAudioSettings !== 'undefined');
  console.log('GlobalAudioSettings已初始化:', typeof GlobalAudioSettings !== 'undefined' && GlobalAudioSettings._initialized);
  console.log('=======================================');
}

// 在控制台运行以检查状态
// checkGlobalAudioStatus();
