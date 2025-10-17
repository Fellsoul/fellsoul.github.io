/* global pc, GlobalBgm, GlobalSfx, GlobalAudioSettings */
/**
 * @file audio-quick-fix.js
 * @desc 快速诊断和初始化全局音频模块
 * 
 * 临时脚本：用于快速验证和初始化全局音频模块
 * 将此脚本挂载到Root场景的任意实体上，优先级设为最高（-100）
 * 初始化成功后可以移除此脚本
 */

var AudioQuickFix = pc.createScript('audioQuickFix');

AudioQuickFix.attributes.add('autoInitialize', {
  type: 'boolean',
  default: true,
  title: '自动初始化'
});

AudioQuickFix.attributes.add('poolSize2D', {
  type: 'number',
  default: 8,
  title: 'SFX 2D池大小'
});

AudioQuickFix.attributes.add('poolSize3D', {
  type: 'number',
  default: 16,
  title: 'SFX 3D池大小'
});

AudioQuickFix.prototype.initialize = function() {
  console.log('%c[AudioQuickFix] 开始诊断全局音频模块...', 'color: #00ff00; font-weight: bold');
  
  this._diagnose();
  
  if (this.autoInitialize) {
    this._autoFix();
  }
};

/**
 * 诊断全局音频模块状态
 */
AudioQuickFix.prototype._diagnose = function() {
  console.log('========================================');
  console.log('全局音频模块诊断报告');
  console.log('========================================');
  
  // 检查全局对象
  var bgmExists = typeof GlobalBgm !== 'undefined';
  var sfxExists = typeof GlobalSfx !== 'undefined';
  var settingsExists = typeof GlobalAudioSettings !== 'undefined';
  
  console.log('1. 全局对象检查:');
  console.log('   GlobalBgm:', bgmExists ? '✓ 存在' : '✗ 不存在');
  console.log('   GlobalSfx:', sfxExists ? '✓ 存在' : '✗ 不存在');
  console.log('   GlobalAudioSettings:', settingsExists ? '✓ 存在' : '✗ 不存在');
  
  if (!bgmExists || !sfxExists || !settingsExists) {
    console.error('   ⚠️ 缺少全局对象！请检查以下脚本是否已加载：');
    if (!bgmExists) console.error('      - audio-bgm-global.js');
    if (!sfxExists) console.error('      - audio-sfx-global.js');
    if (!settingsExists) console.error('      - audio-settings-global.js');
    return;
  }
  
  // 检查初始化状态
  console.log('2. 初始化状态:');
  console.log('   GlobalBgm:', GlobalBgm._initialized ? '✓ 已初始化' : '✗ 未初始化');
  console.log('   GlobalSfx:', GlobalSfx._initialized ? '✓ 已初始化' : '✗ 未初始化');
  console.log('   GlobalAudioSettings:', GlobalAudioSettings._initialized ? '✓ 已初始化' : '✗ 未初始化');
  
  // 检查音频池
  if (GlobalSfx._initialized) {
    console.log('3. SFX音频池:');
    console.log('   2D池大小:', GlobalSfx.pool2D ? GlobalSfx.pool2D.length : 0);
    console.log('   3D池大小:', GlobalSfx.pool3D ? GlobalSfx.pool3D.length : 0);
  }
  
  // 检查音量设置
  if (GlobalAudioSettings._initialized) {
    console.log('4. 音量设置:');
    console.log('   Master:', GlobalAudioSettings.data.master);
    console.log('   Music:', GlobalAudioSettings.data.music);
    console.log('   SFX:', GlobalAudioSettings.data.sfx);
    console.log('   Mute:', GlobalAudioSettings.data.mute);
  }
  
  console.log('========================================');
};

/**
 * 自动修复：初始化未初始化的模块
 */
AudioQuickFix.prototype._autoFix = function() {
  console.log('%c[AudioQuickFix] 开始自动修复...', 'color: #ffaa00; font-weight: bold');
  
  var fixed = false;
  
  try {
    // 初始化AudioSettings
    if (typeof GlobalAudioSettings !== 'undefined' && !GlobalAudioSettings._initialized) {
      console.log('[AudioQuickFix] 正在初始化 GlobalAudioSettings...');
      GlobalAudioSettings.initialize(this.app, 'game.audio.v1');
      console.log('[AudioQuickFix] ✓ GlobalAudioSettings 初始化完成');
      fixed = true;
    }
    
    // 初始化BGM
    if (typeof GlobalBgm !== 'undefined' && !GlobalBgm._initialized) {
      console.log('[AudioQuickFix] 正在初始化 GlobalBgm...');
      GlobalBgm.initialize(this.app);
      console.log('[AudioQuickFix] ✓ GlobalBgm 初始化完成');
      fixed = true;
    }
    
    // 初始化SFX
    if (typeof GlobalSfx !== 'undefined' && !GlobalSfx._initialized) {
      console.log('[AudioQuickFix] 正在初始化 GlobalSfx...');
      GlobalSfx.initialize(this.app, {
        poolSize2D: this.poolSize2D,
        poolSize3D: this.poolSize3D
      });
      console.log('[AudioQuickFix] ✓ GlobalSfx 初始化完成');
      fixed = true;
    }
    
    if (fixed) {
      console.log('%c[AudioQuickFix] ========================================', 'color: #00ff00; font-weight: bold');
      console.log('%c[AudioQuickFix] 修复完成！全局音频模块已就绪', 'color: #00ff00; font-weight: bold');
      console.log('%c[AudioQuickFix] ========================================', 'color: #00ff00; font-weight: bold');
      console.log('[AudioQuickFix] 提示：初始化成功后，您可以：');
      console.log('[AudioQuickFix]   1. 移除此audioQuickFix脚本');
      console.log('[AudioQuickFix]   2. 使用audioGlobalInitializer替代');
    } else {
      console.log('[AudioQuickFix] 所有模块已初始化，无需修复');
    }
    
  } catch (e) {
    console.error('[AudioQuickFix] 自动修复失败:', e);
  }
};

/**
 * 提供调试方法
 */
AudioQuickFix.prototype.postInitialize = function() {
  var self = this;
  
  // 暴露测试方法到全局
  window.testGlobalAudio = function() {
    console.log('%c========== 测试全局音频模块 ==========', 'color: #00ffff; font-weight: bold');
    
    // 测试BGM
    if (typeof GlobalBgm !== 'undefined' && GlobalBgm._initialized) {
      console.log('测试 GlobalBgm...');
      var testBgm = self.app.assets.find(function(asset) {
        return asset.type === 'audio';
      });
      if (testBgm) {
        GlobalBgm.play({
          asset: testBgm,
          id: 'test',
          volume: 0.3,
          crossfade: 0.5,
          loop: true  // 确保BGM循环播放
        });
        console.log('✓ BGM测试播放:', testBgm.name);
        setTimeout(function() {
          GlobalBgm.stop({ fadeOut: 0.5 });
          console.log('✓ BGM已停止');
        }, 2000);
      } else {
        console.warn('未找到音频资源用于测试');
      }
    } else {
      console.error('✗ GlobalBgm未初始化');
    }
    
    // 测试SFX
    if (typeof GlobalSfx !== 'undefined' && GlobalSfx._initialized) {
      console.log('测试 GlobalSfx...');
      console.log('✓ SFX模块可用');
      console.log('  2D池:', GlobalSfx.pool2D.length, '个实体');
      console.log('  3D池:', GlobalSfx.pool3D.length, '个实体');
    } else {
      console.error('✗ GlobalSfx未初始化');
    }
    
    console.log('%c========================================', 'color: #00ffff; font-weight: bold');
  };
  
  console.log('[AudioQuickFix] 提示：在控制台运行 testGlobalAudio() 可测试音频系统');
};
