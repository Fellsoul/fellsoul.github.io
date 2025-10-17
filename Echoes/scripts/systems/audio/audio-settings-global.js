/* global pc, GlobalGame */
/**
 * @file audio-settings-global.js
 * @desc 全局音频设置管理器：持久化音量设置
 * 使用方式：
 *   GlobalAudioSettings.set({ bus: 'music', volume: 0.7 });
 *   GlobalAudioSettings.set({ mute: true });
 *   var data = GlobalAudioSettings.load();
 */

(function(window) {
  'use strict';
  
  var GlobalAudioSettings = {
    // 初始化标志
    _initialized: false,
    _app: null,
    
    // 存储键
    storageKey: 'game.audio.v1',
    
    // 音量数据
    data: {
      music: 1,
      sfx: 1,
      ui: 1,
      master: 1,
      mute: false
    },
    
    /**
     * 初始化音频设置管理器
     * @param {pc.Application} app - PlayCanvas应用实例
     * @param {string} key - 存储键
     */
    initialize: function(app, key) {
      if (this._initialized) {
        console.warn('[GlobalAudioSettings] 已经初始化过了');
        return;
      }
      
      this._app = app;
      this._initialized = true;
      
      if (key) this.storageKey = key;
      
      console.log('[GlobalAudioSettings] 全局音频设置管理器初始化');
      
      // 优先从GameManager加载设置，如果没有则从localStorage加载
      this._loadFromGameManager();
      
      // 应用设置
      this._applyAll();
      
      // 监听GameManager的设置变化事件
      var self = this;
      this._onSettingChanged = function(key, value) {
        self._handleGameManagerSetting(key, value);
      };
      this._app.on('setting:changed', this._onSettingChanged, this);
      
      // 监听事件
      this._app.on('audio:settings:set', this.set, this);
      this._app.on('audio:settings:load', this.load, this);
      this._app.on('audio:settings:save', this.save, this);
    },
    
    /**
     * 从GameManager加载音频设置
     * @private
     */
    _loadFromGameManager: function() {
      // 尝试从GlobalGame获取设置
      if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting) {
        // 音量范围：GameManager使用0-100，我们使用0-1
        var masterVol = GlobalGame.getSetting('masterVolume', 80) / 100;
        var musicVol = GlobalGame.getSetting('musicVolume', 70) / 100;
        var sfxVol = GlobalGame.getSetting('sfxVolume', 80) / 100;
        var uiVol = GlobalGame.getSetting('uiVolume', 80) / 100;
        var mute = GlobalGame.getSetting('mute', false);
        
        this.data = {
          master: masterVol,
          music: musicVol,
          sfx: sfxVol,
          ui: uiVol,
          mute: mute
        };
        
        console.log('[GlobalAudioSettings] ✓ 从GameManager加载设置:', this.data);
      } else {
        // 降级：从localStorage加载
        this.data = this._load() || { music: 1, sfx: 1, ui: 1, master: 1, mute: false };
        console.log('[GlobalAudioSettings] 从localStorage加载设置:', this.data);
      }
    },
    
    /**
     * 处理GameManager的设置变化
     * @private
     */
    _handleGameManagerSetting: function(key, value) {
      if (!key) return;
      
      var needUpdate = false;
      
      // 音量设置（0-100 → 0-1）
      if (key === 'masterVolume') {
        this.data.master = value / 100;
        needUpdate = true;
      } else if (key === 'musicVolume') {
        this.data.music = value / 100;
        needUpdate = true;
      } else if (key === 'sfxVolume') {
        this.data.sfx = value / 100;
        needUpdate = true;
      } else if (key === 'uiVolume') {
        this.data.ui = value / 100;
        needUpdate = true;
      } else if (key === 'mute') {
        this.data.mute = !!value;
        needUpdate = true;
      }
      
      if (needUpdate) {
        console.log('[GlobalAudioSettings] GameManager设置变更:', key, '=', value);
        this._applyAll();
      }
    },
    
    /**
     * 设置音量
     * @param {object} o - { bus, volume, mute }
     */
    set: function(o) {
      if (!this._initialized) {
        console.warn('[GlobalAudioSettings] 未初始化');
        return;
      }
      
      o = o || {};
      
      if (o.bus) {
        var v = (o.volume != null) ? o.volume : this.data[o.bus];
        this.data[o.bus] = Math.max(0, Math.min(1, v));
      }
      
      if (o.mute != null) {
        this.data.mute = !!o.mute;
      }
      
      this._applyAll();
      this._save();
    },
    
    /**
     * 加载设置
     */
    load: function() {
      if (!this._initialized) return null;
      
      this.data = this._load() || this.data;
      this._applyAll();
      return this.data;
    },
    
    /**
     * 保存设置
     */
    save: function() {
      if (!this._initialized) return;
      this._save();
    },
    
    /**
     * 应用所有设置到bus
     * @private
     */
    _applyAll: function() {
      if (!this._app) return;
      
      // master受mute影响
      this._app.fire('audio:bus:setVolume', { 
        bus: 'master', 
        volume: this.data.mute ? 0 : this.data.master, 
        dur: 0 
      });
      
      this._app.fire('audio:bus:setVolume', { 
        bus: 'music', 
        volume: this.data.music, 
        dur: 0 
      });
      
      this._app.fire('audio:bus:setVolume', { 
        bus: 'sfx', 
        volume: this.data.sfx, 
        dur: 0 
      });
      
      this._app.fire('audio:bus:setVolume', { 
        bus: 'ui', 
        volume: this.data.ui, 
        dur: 0 
      });
    },
    
    /**
     * 从localStorage加载
     * @private
     */
    _load: function() {
      try {
        var str = localStorage.getItem(this.storageKey);
        return str ? JSON.parse(str) : null;
      } catch (e) {
        console.warn('[GlobalAudioSettings] 加载失败:', e);
        return null;
      }
    },
    
    /**
     * 保存到localStorage
     * @private
     */
    _save: function() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      } catch (e) {
        console.warn('[GlobalAudioSettings] 保存失败:', e);
      }
    },
    
    /**
     * 销毁管理器
     */
    destroy: function() {
      if (!this._initialized) return;
      
      // 解绑事件
      this._app.off('setting:changed', this._onSettingChanged, this);
      this._app.off('audio:settings:set', this.set, this);
      this._app.off('audio:settings:load', this.load, this);
      this._app.off('audio:settings:save', this.save, this);
      
      this._initialized = false;
      console.log('[GlobalAudioSettings] 已销毁');
    }
  };
  
  // 暴露到全局
  window.GlobalAudioSettings = GlobalAudioSettings;
  
})(window);
