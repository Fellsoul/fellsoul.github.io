/* global pc */
/**
 * @file audio-sfx-global.js
 * @desc 全局SFX管理器：2D/3D音效池管理
 * 使用方式：
 *   GlobalSfx.play({ key: 'click', vol: 0.8 });
 *   GlobalSfx.play({ key: 'footstep', pos: playerPos, is3D: true });
 *   GlobalSfx.stopAll();
 */

(function(window) {
  'use strict';
  
  var GlobalSfx = {
    // 初始化标志
    _initialized: false,
    _app: null,
    
    // 音频池
    pool2D: [],
    pool3D: [],
    
    // 配置
    db: {},              // key -> { assets:[name...], vol, is3D, cooldown }
    cooldown: {},        // key -> lastTime
    instancesByKey: {},  // key -> [entities]
    instancesData: {},   // entity._guid -> { key, configVol, isLoop } - 存储实例配置
    
    // Bus音量
    _busMaster: 1.0,
    _busSfx: 1.0,
    
    /**
     * 初始化SFX管理器
     * @param {pc.Application} app - PlayCanvas应用实例
     * @param {object} opts - { poolSize2D, poolSize3D }
     */
    initialize: function(app, opts) {
      if (this._initialized) {
        console.warn('[GlobalSfx] 已经初始化过了');
        return;
      }
      
      opts = opts || {};
      this._app = app;
      this._initialized = true;
      
      console.log('[GlobalSfx] 全局SFX管理器初始化');
      
      // 不在初始化时创建音频池，延迟到首次播放时创建
      // 这样即使场景切换销毁了实体，下次播放时会自动重建
      this.pool2D = [];
      this.pool3D = [];
      this._poolSize2D = opts.poolSize2D || 8;
      this._poolSize3D = opts.poolSize3D || 16;
      
      // 监听bus音量
      var self = this;
      this._onBusVol = function(o) {
        if (!o) return;
        var v = (o.volume != null) ? Math.max(0, Math.min(1, o.volume)) : null;
        if (v == null) return;
        if (o.bus === 'master') self._busMaster = v;
        if (o.bus === 'sfx') self._busSfx = v;
        
        // 更新所有正在播放的音频音量
        self._updateAllPlayingVolumes();
      };
      this._app.on('audio:bus:setVolume', this._onBusVol, this);
      
      // 监听播放事件
      this._app.on('sfx:play', this.play, this);
      this._app.on('sfx:stop', this.stop, this);
      this._app.on('sfx:stopAll', this.stopAll, this);
    },
    
    /**
     * 更新所有正在播放音频的音量
     * @private
     */
    _updateAllPlayingVolumes: function() {
      var updateCount = 0;
      
      // 遍历所有实例数据
      for (var guid in this.instancesData) {
        var data = this.instancesData[guid];
        if (!data) continue;
        
        // 找到对应的实体
        var ent = null;
        for (var i = 0; i < this.pool2D.length; i++) {
          if (this.pool2D[i]._guid === guid) {
            ent = this.pool2D[i];
            break;
          }
        }
        if (!ent) {
          for (var j = 0; j < this.pool3D.length; j++) {
            if (this.pool3D[j]._guid === guid) {
              ent = this.pool3D[j];
              break;
            }
          }
        }
        
        if (ent && ent.enabled && ent.sound) {
          var slot = ent.sound.slot('one');
          if (slot && slot.isPlaying) {
            // 重新计算音量：配置音量 × master × sfx
            var finalVol = data.configVol * this._busMaster * this._busSfx;
            slot.volume = finalVol;
            updateCount++;
          }
        }
      }
      
      if (updateCount > 0) {
        console.log('[GlobalSfx] 更新了', updateCount, '个正在播放音频的音量');
      }
    },
    
    /**
     * 创建音频池
     * @private
     */
    _makePool: function(n, is3D) {
      var list = [];
      var prefix = is3D ? 'SFX3D_' : 'SFX2D_';
      
      for (var i = 0; i < n; i++) {
        var e = new pc.Entity(prefix + i + '_' + Date.now());
        e.addComponent('sound', {
          volume: 1.0,
          slots: [{
            name: 'one',
            loop: false,
            autoPlay: false,
            overlap: true,
            volume: 1.0
          }]
        });
        
        // 添加到root确保持久化
        this._app.root.addChild(e);
        list.push(e);
      }
      
      console.log('[GlobalSfx] 创建音频池:', is3D ? '3D' : '2D', '数量:', n);
      return list;
    },
    
    /**
     * 验证实体有效性
     * @private
     */
    _validateEntity: function(ent) {
      if (!ent) return false;
      if (!ent.sound) return false;
      var slot = ent.sound.slot('one');
      return !!slot;
    },
    
    /**
     * 借用一个音频实体
     * @private
     */
    _borrow: function(is3D) {
      var pool = is3D ? this.pool3D : this.pool2D;
      var poolSize = is3D ? this._poolSize3D : this._poolSize2D;
      
      // 如果池为空，创建初始池
      if (pool.length === 0) {
        console.log('[GlobalSfx] 首次创建音频池:', is3D ? '3D' : '2D', '数量:', poolSize);
        for (var k = 0; k < poolSize; k++) {
          pool.push(this._createSingleEntity(is3D));
        }
      }
      
      // 找空闲的
      for (var i = 0; i < pool.length; i++) {
        var ent = pool[i];
        if (!this._validateEntity(ent)) {
          // 实体无效，重新创建
          console.log('[GlobalSfx] 检测到无效实体，重新创建...');
          pool[i] = this._createSingleEntity(is3D);
          ent = pool[i];
        }
        
        var slot = ent.sound.slot('one');
        if (!slot.isPlaying && !ent.enabled) {
          return ent;
        }
      }
      
      // 找最老的正在播放的
      for (var j = 0; j < pool.length; j++) {
        var e = pool[j];
        if (this._validateEntity(e)) {
          return e;
        }
      }
      
      // 如果都无效，返回第一个（会被重新创建）
      if (pool.length > 0 && !this._validateEntity(pool[0])) {
        pool[0] = this._createSingleEntity(is3D);
      }
      return pool[0] || this._createSingleEntity(is3D);
    },
    
    /**
     * 创建单个音频实体
     * @private
     */
    _createSingleEntity: function(is3D) {
      var prefix = is3D ? 'SFX3D_' : 'SFX2D_';
      var e = new pc.Entity(prefix + Date.now());
      e.addComponent('sound', {
        volume: 1.0,
        slots: [{
          name: 'one',
          loop: false,
          autoPlay: false,
          overlap: true,
          volume: 1.0
        }]
      });
      this._app.root.addChild(e);
      return e;
    },
    
    /**
     * 播放音效
     * @param {object} opts - { key, vol, pos, is3D, loop, asset }
     */
    play: function(opts) {
      if (!this._initialized) {
        console.warn('[GlobalSfx] 未初始化');
        return null;
      }
      
      opts = opts || {};
      var key = opts.key;
      var cfg = this.db[key] || {};
      
      // 冷却检查
      if (cfg.cooldown && cfg.cooldown > 0) {
        var now = Date.now();
        var last = this.cooldown[key] || 0;
        if (now - last < cfg.cooldown) {
          return null;
        }
        this.cooldown[key] = now;
      }
      
      var is3D = opts.is3D != null ? opts.is3D : cfg.is3D;
      var ent = this._borrow(is3D);
      if (!ent || !ent.sound) return null;
      
      var slot = ent.sound.slot('one');
      if (!slot) return null;
      
      // 设置资源
      var asset = opts.asset;
      if (!asset && cfg.assets && cfg.assets.length > 0) {
        var randomName = cfg.assets[Math.floor(Math.random() * cfg.assets.length)];
        asset = this._app.assets.find(randomName, 'audio');
      }
      
      if (!asset) {
        console.warn('[GlobalSfx] 音频资源未找到:', key);
        return null;
      }
      
      var self = this;
      
      // 配置函数
      var configureAndPlay = function() {
        // 配置
        slot.asset = asset.id;
        var isLoop = opts.loop || false;
        slot.loop = isLoop;
        
        // 音量 = 配置音量 × master × sfx
        var configVol = opts.vol != null ? opts.vol : (cfg.vol != null ? cfg.vol : 1.0);
        var finalVol = configVol * self._busMaster * self._busSfx;
        slot.volume = finalVol;
        
        // 3D位置
        if (is3D && opts.pos) {
          ent.setPosition(opts.pos);
        }
        
        // 存储实例数据（用于动态音量更新）
        self.instancesData[ent._guid] = {
          key: key,
          configVol: configVol,
          isLoop: isLoop
        };
        
        // 播放
        ent.enabled = true;
        slot.play();
        
        // 记录实例（用于按key停止）
        if (key) {
          if (!self.instancesByKey[key]) {
            self.instancesByKey[key] = [];
          }
          self.instancesByKey[key].push(ent);
        }
        
        // 如果是loop，添加监听，播放结束时清理数据
        if (!isLoop) {
          var onEnd = function() {
            delete self.instancesData[ent._guid];
            slot.off('end', onEnd);
          };
          slot.on('end', onEnd);
        }
      };
      
      // 确保资源已加载
      if (asset.resource) {
        // 资源已加载，直接播放
        configureAndPlay();
      } else if (!asset.loaded) {
        // 资源未加载，等待加载完成
        var onLoad = function() {
          asset.off('load', onLoad);
          configureAndPlay();
        };
        
        asset.once('load', onLoad);
        
        // 如果资源还未开始加载，手动加载
        if (!asset.loading) {
          this._app.assets.load(asset);
        }
      } else {
        configureAndPlay();
      }
      
      return ent;
    },
    
    /**
     * 停止指定key的音效
     * @param {object} opts - { key }
     */
    stop: function(opts) {
      if (!this._initialized) return;
      
      opts = opts || {};
      var key = opts.key;
      if (!key) return;
      
      var instances = this.instancesByKey[key];
      if (!instances || instances.length === 0) return;
      
      for (var i = 0; i < instances.length; i++) {
        var ent = instances[i];
        if (ent && ent.sound && ent.enabled) {
          var slot = ent.sound.slot('one');
          if (slot && slot.isPlaying) {
            slot.stop();
          }
          ent.enabled = false;
          
          // 清理实例数据
          delete this.instancesData[ent._guid];
        }
      }
      
      this.instancesByKey[key] = [];
    },
    
    /**
     * 停止所有音效
     */
    stopAll: function() {
      if (!this._initialized) return;
      
      console.log('[GlobalSfx] ========== stopAll 被调用 ==========');
      
      var stoppedCount = 0;
      var i;
      
      // 停止2D池
      for (i = 0; i < this.pool2D.length; i++) {
        var ent2D = this.pool2D[i];
        if (ent2D && ent2D.sound && ent2D.enabled) {
          var slot2D = ent2D.sound.slot('one');
          if (slot2D && slot2D.isPlaying) {
            slot2D.stop();
            stoppedCount++;
          }
          ent2D.enabled = false;
          
          // 清理实例数据
          delete this.instancesData[ent2D._guid];
        }
      }
      
      // 停止3D池
      for (i = 0; i < this.pool3D.length; i++) {
        var ent3D = this.pool3D[i];
        if (ent3D && ent3D.sound && ent3D.enabled) {
          var slot3D = ent3D.sound.slot('one');
          if (slot3D && slot3D.isPlaying) {
            slot3D.stop();
            stoppedCount++;
          }
          ent3D.enabled = false;
          
          // 清理实例数据
          delete this.instancesData[ent3D._guid];
        }
      }
      
      // 清空实例记录
      this.instancesByKey = {};
      this.instancesData = {};
      
      console.log('[GlobalSfx] 已停止所有SFX，停止数量:', stoppedCount);
      console.log('[GlobalSfx] ==========================================');
    },
    
    /**
     * 销毁管理器
     */
    destroy: function() {
      if (!this._initialized) return;
      
      // 解绑事件
      this._app.off('sfx:play', this.play, this);
      this._app.off('sfx:stop', this.stop, this);
      this._app.off('sfx:stopAll', this.stopAll, this);
      this._app.off('audio:bus:setVolume', this._onBusVol, this);
      
      // 销毁实体
      var i;
      for (i = 0; i < this.pool2D.length; i++) {
        try { if (this.pool2D[i]) this.pool2D[i].destroy(); } catch (e) {}
      }
      for (i = 0; i < this.pool3D.length; i++) {
        try { if (this.pool3D[i]) this.pool3D[i].destroy(); } catch (e) {}
      }
      
      this.pool2D = [];
      this.pool3D = [];
      this.db = {};
      this.cooldown = {};
      this.instancesByKey = {};
      
      this._initialized = false;
      console.log('[GlobalSfx] 已销毁');
    }
  };
  
  // 暴露到全局
  window.GlobalSfx = GlobalSfx;
  
})(window);
