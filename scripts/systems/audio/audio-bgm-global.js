/* global pc */
/**
 * @file audio-bgm-global.js
 * @desc 全局BGM管理器：双通道交叉淡入淡出
 * 使用方式：
 *   GlobalBgm.play({ asset: bgmAsset, id: 'bgm1', crossfade: 0.8, volume: 0.7, loop: true });
 *   GlobalBgm.stop({ fadeOut: 0.3 });
 *   GlobalBgm.pause();
 *   GlobalBgm.resume();
 * 参数说明：
 *   - asset: pc.Asset 音频资源
 *   - id: string 唯一标识（可选，默认'default'）
 *   - crossfade: number 交叉淡入淡出时间（秒，可选，默认0.8）
 *   - volume: number 音量（0-1，可选，默认1.0）
 *   - loop: boolean 是否循环播放（可选，默认true）
 */

(function(window) {
  'use strict';
  
  var GlobalBgm = {
    // 初始化标志
    _initialized: false,
    _app: null,
    
    // 音量设置
    _busMaster: 1.0,
    _busMusic: 1.0,
    _configVolume: 1.0,
    
    // 双通道播放器
    _trackA: null,
    _trackB: null,
    _active: null,
    _idle: null,
    _currentId: null,
    
    // 更新处理器
    _updateHandlers: [],
    
    // 调试开关
    enableDebugLog: false,
    
    /**
     * 初始化BGM管理器
     * @param {pc.Application} app - PlayCanvas应用实例
     */
    initialize: function(app) {
      if (this._initialized) {
        console.warn('[GlobalBgm] 已经初始化过了');
        return;
      }
      this._app = app;
      this._initialized = true;
      
      console.log('[GlobalBgm] 全局BGM管理器初始化');
      
      // 不在初始化时创建播放器，延迟到首次播放时创建
      // 这样即使场景切换销毁了实体，下次播放时会自动重建
      this._trackA = null;
      this._trackB = null;
      this._active = null;
      this._idle = null;
      
      // 监听bus音量
      var self = this;
      this._onBusVol = function(o) {
        if (!o) return;
        var v = (o.volume != null) ? Math.max(0, Math.min(1, o.volume)) : null;
        if (v == null) return;
        if (o.bus === 'master') self._busMaster = v;
        if (o.bus === 'music') self._busMusic = v;
        
        // 若当前不在淡入淡出中，立即应用
        if (self._active && self._updateHandlers.length === 0 && self._active.slot) {
          var configVol = self._configVolume || 1.0;
          try { 
            self._active.slot.volume = configVol * self._busMaster * self._busMusic; 
          } catch (e) {}
        }
      };
      this._app.on('audio:bus:setVolume', this._onBusVol, this);
      
      // 监听播放事件
      this._app.on('bgm:play', this.play, this);
      this._app.on('bgm:stop', this.stop, this);
      this._app.on('bgm:pause', this.pause, this);
      this._app.on('bgm:resume', this.resume, this);
    },
    
    /**
     * 创建一个播放器
     * @private
     */
    _makePlayer: function() {
      var e = new pc.Entity('BGM_Player_' + Date.now());
      e.addComponent('sound', {
        volume: 1.0,
        slots: [{
          name: 'bgm',
          loop: true,
          autoPlay: false,
          overlap: false,
          volume: 1.0
        }]
      });
      
      // 添加到root确保持久化
      this._app.root.addChild(e);
      
      var s = e.sound.slot('bgm');
      
      console.log('[GlobalBgm] 创建播放器:', e.name, '实体有效:', !!e, 'sound组件有效:', !!e.sound, 'slot有效:', !!s);
      
      return { ent: e, slot: s };
    },
    
    /**
     * 验证播放器有效性
     * @private
     */
    _validatePlayer: function(player) {
      if (!player || !player.ent || !player.slot) {
        return false;
      }
      
      // 检查实体是否被销毁
      if (!player.ent.sound) {
        return false;
      }
      
      // 检查slot是否有效
      var slot = player.ent.sound.slot('bgm');
      if (!slot) {
        return false;
      }
      
      // 更新slot引用
      player.slot = slot;
      return true;
    },
    /**
     * 设置音频资源
     * @private
     * @param {object} player - 播放器对象
     * @param {pc.Asset} audioAsset - 音频资源
     * @param {boolean} loop - 是否循环播放
     */
    _setClip: function(player, audioAsset, loop) {
      if (!audioAsset || !audioAsset.resource) {
        console.warn('[GlobalBgm] 无效的音频资源');
        return false;
      }
      
      // 播放器应该已经在play()中验证过了
      if (!this._validatePlayer(player)) {
        console.error('[GlobalBgm] 播放器仍然无效');
        return false;
      }
      
      try {
        // 先停止当前播放（如果有的话）
        if (player.slot.isPlaying) {
          player.slot.stop();
        }
        
        // 设置音频资源
        player.slot.asset = audioAsset.id;
        
        // 确保循环播放设置（在设置asset之后立即设置）
        var shouldLoop = (loop != null) ? loop : true;
        player.slot.loop = shouldLoop;
        
        // 双重保险：再次验证并设置
        if (player.slot.loop !== shouldLoop) {
          console.warn('[GlobalBgm] loop 设置被重置，再次设置');
          player.slot.loop = shouldLoop;
        }
        
        if (this.enableDebugLog) {
          console.log('[GlobalBgm] ✓ 音频资源设置成功:', audioAsset.name, 'loop:', player.slot.loop, '期望 loop:', shouldLoop);
        }
        return true;
      } catch (e) {
        console.error('[GlobalBgm] 设置音频失败:', e);
        return false;
      }
    },
    
    /**
     * 播放BGM
     * @param {object} opts - { asset, id, crossfade, volume, loop }
     */
    play: function(opts) {
      if (!this._initialized) {
        console.warn('[GlobalBgm] 未初始化');
        return;
      }
      
      opts = opts || {};
      var asset = opts.asset;
      var id = opts.id || 'default';
      var crossfade = (opts.crossfade != null) ? opts.crossfade : 0.8;
      var loop = (opts.loop != null) ? opts.loop : true;  // 默认循环播放
      
      // 保存配置音量
      this._configVolume = opts.volume || 1.0;
      
      // 确保播放器存在且有效（首次播放或场景切换后重建）
      if (!this._trackA || !this._validatePlayer(this._trackA)) {
        console.log('[GlobalBgm] 创建/重建 TrackA...');
        this._trackA = this._makePlayer();
      }
      if (!this._trackB || !this._validatePlayer(this._trackB)) {
        console.log('[GlobalBgm] 创建/重建 TrackB...');
        this._trackB = this._makePlayer();
      }
      
      // 设置active和idle
      if (!this._active) {
        this._active = this._trackA;
        this._idle = this._trackB;
      } else {
        // 确保active和idle仍然有效
        if (!this._validatePlayer(this._active)) {
          this._active = this._trackA;
        }
        if (!this._validatePlayer(this._idle)) {
          this._idle = this._trackB;
        }
      }
      
      // 如果是同一首，跳过
      if (this._currentId === id && this._active && this._active.slot && this._active.slot.isPlaying) {
        return;
      }
      
      this._currentId = id;
      
      // 设置新资源到idle通道，并确保循环播放
      if (!this._setClip(this._idle, asset, loop)) {
        console.warn('[GlobalBgm] 无法设置音频资源');
        return;
      }
      
      var self = this;
      var oldTrack = this._active;
      var newTrack = this._idle;
      
      // 交换active/idle
      this._active = newTrack;
      this._idle = oldTrack;
      
      // 确保资源已加载后再播放
      if (asset && asset.resource) {
        // 资源已加载，直接播放
        this._crossfade(oldTrack, newTrack, crossfade);
      } else if (asset && !asset.loaded) {
        // 资源未加载，等待加载完成
        console.log('[GlobalBgm] 等待资源加载:', asset.name);
        
        var onLoad = function() {
          console.log('[GlobalBgm] 资源加载完成:', asset.name);
          asset.off('load', onLoad);
          self._crossfade(oldTrack, newTrack, crossfade);
        };
        
        asset.once('load', onLoad);
        
        // 如果资源还未开始加载，手动加载
        if (!asset.loading) {
          this._app.assets.load(asset);
        }
      } else {
        // 开始淡入淡出
        this._crossfade(oldTrack, newTrack, crossfade);
      }
    },
    
    /**
     * 交叉淡入淡出
     * @private
     */
    _crossfade: function(oldTrack, newTrack, duration) {
      var self = this;
      var elapsed = 0;
      var scale = this._busMaster * this._busMusic * this._configVolume;
      
      // 启动新轨道
      newTrack.slot.volume = 0;
      
      // 在播放前再次确保循环设置（防止某些情况下被重置）
      if (newTrack.slot.loop === false || newTrack.slot.loop === undefined) {
        console.warn('[GlobalBgm] 检测到 loop 为 false，强制设置为 true');
        newTrack.slot.loop = true;
      }
      
      if (this.enableDebugLog) {
        console.log('[GlobalBgm] 开始播放，loop 状态:', newTrack.slot.loop);
      }
      
      newTrack.slot.play();
      
      var handler = function(dt) {
        elapsed += dt;
        var t = Math.min(1, elapsed / duration);
        
        // 淡入新轨道
        newTrack.slot.volume = t * scale;
        
        // 淡出旧轨道
        if (oldTrack && oldTrack.slot) {
          oldTrack.slot.volume = (1 - t) * scale;
        }
        
        if (t >= 1) {
          // 停止旧轨道
          if (oldTrack && oldTrack.slot) {
            try { oldTrack.slot.stop(); } catch (e) {}
          }
          
          // 移除update监听
          self._app.off('update', handler);
          var idx = self._updateHandlers.indexOf(handler);
          if (idx !== -1) self._updateHandlers.splice(idx, 1);
        }
      };
      
      this._updateHandlers.push(handler);
      this._app.on('update', handler);
    },
    
    /**
     * 停止BGM
     * @param {object} opts - { fadeOut }
     */
    stop: function(opts) {
      if (!this._initialized) return;
      
      opts = opts || {};
      var fadeOut = opts.fadeOut || 0;
      
      if (fadeOut > 0) {
        this._fadeOut(this._active, fadeOut);
      } else {
        if (this._active && this._active.slot) {
          try { this._active.slot.stop(); } catch (e) {}
        }
      }
      
      this._currentId = null;
    },
    
    /**
     * 淡出
     * @private
     */
    _fadeOut: function(track, duration) {
      if (!track || !track.slot || !track.slot.isPlaying) return;
      
      var self = this;
      var elapsed = 0;
      var startVol = track.slot.volume;
      
      var handler = function(dt) {
        elapsed += dt;
        var t = Math.min(1, elapsed / duration);
        
        track.slot.volume = startVol * (1 - t);
        
        if (t >= 1) {
          try { track.slot.stop(); } catch (e) {}
          self._app.off('update', handler);
          var idx = self._updateHandlers.indexOf(handler);
          if (idx !== -1) self._updateHandlers.splice(idx, 1);
        }
      };
      
      this._updateHandlers.push(handler);
      this._app.on('update', handler);
    },
    
    /**
     * 暂停BGM
     */
    pause: function() {
      if (!this._initialized) return;
      if (this._active && this._active.slot) {
        try { this._active.slot.pause(); } catch (e) {}
      }
    },
    
    /**
     * 恢复BGM
     */
    resume: function() {
      if (!this._initialized) return;
      if (this._active && this._active.slot) {
        try { this._active.slot.resume(); } catch (e) {}
      }
    },
    
    /**
     * 销毁管理器
     */
    destroy: function() {
      if (!this._initialized) return;
      
      // 解绑事件
      this._app.off('bgm:play', this.play, this);
      this._app.off('bgm:stop', this.stop, this);
      this._app.off('bgm:pause', this.pause, this);
      this._app.off('bgm:resume', this.resume, this);
      this._app.off('audio:bus:setVolume', this._onBusVol, this);
      
      // 清理update handlers
      for (var i = 0; i < this._updateHandlers.length; i++) {
        this._app.off('update', this._updateHandlers[i]);
      }
      this._updateHandlers = [];
      
      // 销毁实体
      try { if (this._trackA && this._trackA.ent) this._trackA.ent.destroy(); } catch (e) {}
      try { if (this._trackB && this._trackB.ent) this._trackB.ent.destroy(); } catch (e) {}
      
      this._initialized = false;
      console.log('[GlobalBgm] 已销毁');
    }
  };
  
  // 暴露到全局
  window.GlobalBgm = GlobalBgm;
  
})(window);
