/* global pc */
/**
 * @file audio-sfx-manager.js
 * @desc 音效管理：2D/3D 实例池、冷却、简单播放/停止。
 */
var SfxManager = pc.createScript('sfxManager');

SfxManager.attributes.add('poolSize2D', { type: 'number', default: 8, title: '2D 池大小' });
SfxManager.attributes.add('poolSize3D', { type: 'number', default: 16, title: '3D 池大小' });
SfxManager.attributes.add('sfxBusName', { type: 'string', default: 'sfx', title: 'SFX Bus 名称' });

SfxManager.prototype.initialize = function () {
  var self = this;
  this.app.fire('audio:getBus', this.sfxBusName, function (bus) { self.bus = bus || null; });

  this.db = {};           // 外部可注入：key -> { assets:[name...], vol, is3D, cooldown }
  this.cooldown = {};     // key -> lastTime
  this.instancesByKey = {};
  
  // Bus 音量模拟（用于未接入 WebAudio 路由时的兜底）：master * sfx
  this._busMaster = 1.0;
  this._busSfx = 1.0;
  this._onBusVol = function (o) {
    if (!o) return;
    var v = (o.volume != null) ? Math.max(0, Math.min(1, o.volume)) : null;
    if (v == null) return;
    if (o.bus === 'master') self._busMaster = v;
    if (o.bus === self.sfxBusName) self._busSfx = v;
  };
  this.app.on('audio:bus:setVolume', this._onBusVol, this);

  this.pool2D = this._makePool(this.poolSize2D, false);
  this.pool3D = this._makePool(this.poolSize3D, true);

  this._onPlay = this.play.bind(this);
  this._onStop = this.stop.bind(this);
  this._onStopAll = this.stopAll.bind(this);
  this.app.on('sfx:play', this._onPlay, this);
  this.app.on('sfx:stop', this._onStop, this);
  this.app.on('sfx:stopAll', this._onStopAll, this);
};

SfxManager.prototype._makePool = function (n, is3D) {
  var list = [];
  for (var i = 0; i < n; i++) {
    var e = new pc.Entity(is3D ? 'sfx3D' : 'sfx2D');
    e.addComponent('sound');
    e.sound.volume = 1.0;
    e.sound.addSlot('one', { loop: false, autoPlay: false, overlap: true, volume: 1.0 });
    this.app.root.addChild(e);
    list.push(e);
  }
  return list;
};

/**
 * 重新创建实体池（场景切换后实体可能失效）
 * @private
 */
SfxManager.prototype._recreatePools = function() {
  console.log('[SFX] 重新创建音频实体池...');
  
  // 销毁旧的实体
  var i;
  for (i = 0; i < this.pool2D.length; i++) {
    try { if (this.pool2D[i]) this.pool2D[i].destroy(); } catch (e) {}
  }
  for (i = 0; i < this.pool3D.length; i++) {
    try { if (this.pool3D[i]) this.pool3D[i].destroy(); } catch (e) {}
  }
  
  // 重新创建池
  this.pool2D = this._makePool(8, false);
  this.pool3D = this._makePool(8, true);
  
  console.log('[SFX] 音频实体池重新创建完成');
};

SfxManager.prototype._borrow = function (is3D) {
  var pool = is3D ? this.pool3D : this.pool2D;
  var allInvalid = true;
  
  for (var i = 0; i < pool.length; i++) {
    var ent = pool[i];
    
    // 检查实体和sound组件是否有效
    if (!ent || !ent.sound) {
      continue;
    }
    
    allInvalid = false; // 至少有一个有效实体
    
    // 确保实体被启用
    if (!ent.enabled) {
      ent.enabled = true;
    }
    
    var slot = ent.sound.slot('one');
    if (!slot || !slot.isPlaying) {
      return ent;
    }
  }
  
  // 如果所有实体都无效，重新创建池
  if (allInvalid) {
    console.warn('[SFX] _borrow: 所有实体都无效，重新创建池');
    this._recreatePools();
    pool = is3D ? this.pool3D : this.pool2D;
    return pool[0];
  }
  
  // 如果所有实体都在使用，返回第一个（但需要检查有效性）
  var fallback = pool[0];
  if (fallback && !fallback.enabled) {
    fallback.enabled = true;
  }
  return fallback;
};

SfxManager.prototype.play = function (opts) {
  if (!opts || !opts.id) return;
  var cfg = this.db[opts.id] || {};
  var chosen = (cfg.assets && cfg.assets.length) ? cfg.assets[Math.floor(Math.random() * cfg.assets.length)] : opts.id;
  var asset = opts.asset || this.app.assets.find(chosen, 'audio');
  if (!asset) { console.warn('[SFX] audio not found:', opts.id); return; }

  // cooldown
  var now = this.app.time;
  var cd = cfg.cooldown || 0;
  if (cd > 0) {
    var last = this.cooldown[opts.id] || -999;
    if (now - last < cd) return;
    this.cooldown[opts.id] = now;
  }

  var is3D = !!(opts.pos || opts.follow || cfg.is3D);
  var ent = this._borrow(is3D);
  
  // 检查借用的实体是否有效
  if (!ent || !ent.sound) {
    console.warn('[SFX] play: 无法借用有效的音频实体，opts.id=', opts.id);
    return;
  }
  
  if (opts.pos) ent.setPosition(opts.pos);
  // 可选：跟随（需要项目存在对应脚本）
  if (opts.follow && ent.script && ent.script.create) {
    try { ent.script.create('followTarget', { attributes: { target: opts.follow } }); } catch (e) {}
  }

  var slot = ent.sound.slot('one');
  
  // 检查slot是否有效
  if (!slot) {
    console.warn('[SFX] play: slot无效，opts.id=', opts.id);
    return;
  }
  try { slot.stop(); } catch (e) {}
  slot.asset = asset;
  
  // 计算最终音量：配置音量 * master音量 * sfx音量
  var configVolume = (typeof opts.vol === 'number') ? opts.vol : (cfg.vol != null ? cfg.vol : 1.0);
  var finalVolume = configVolume * this._busMaster * this._busSfx;
  slot.volume = finalVolume;
  
  if (this.debug) {
    console.log('[SFX] 音量计算 - 配置:', configVolume, 'Master:', this._busMaster, 'SFX:', this._busSfx, '最终:', finalVolume);
  }
  
  // 设置循环播放（用于环境音）
  if (typeof opts.loop === 'boolean') {
    slot.loop = opts.loop;
  } else {
    slot.loop = cfg.loop || false;
  }
  
  slot.play();
};

SfxManager.prototype.stop = function (opts) {
  if (!opts || !opts.id) {
    console.warn('[SFX] stop: 缺少id参数');
    return;
  }
  
  // 查找并停止所有播放该音频的实体
  var i;
  var stopped = false;
  
  // 检查2D音频池
  for (i = 0; i < this.pool2D.length; i++) {
    var ent2D = this.pool2D[i];
    if (ent2D && ent2D.sound && ent2D.enabled) {
      var slot2D = ent2D.sound.slot('one');
      if (slot2D && slot2D.isPlaying) {
        // 停止音频
        try {
          slot2D.stop();
          // 回收实体到池中（禁用而非销毁）
          ent2D.enabled = false;
          stopped = true;
        } catch (e) {
          console.warn('[SFX] stop error (2D):', e);
        }
      }
    }
  }
  
  // 检查3D音频池
  for (i = 0; i < this.pool3D.length; i++) {
    var ent3D = this.pool3D[i];
    if (ent3D && ent3D.sound && ent3D.enabled) {
      var slot3D = ent3D.sound.slot('one');
      if (slot3D && slot3D.isPlaying) {
        try {
          slot3D.stop();
          ent3D.enabled = false;
          stopped = true;
        } catch (e) {
          console.warn('[SFX] stop error (3D):', e);
        }
      }
    }
  }
  
  if (stopped && this.debug) {
    console.log('[SFX] Stopped:', opts.id);
  }
};

/**
 * 停止所有SFX音效
 */
SfxManager.prototype.stopAll = function() {
  console.log('[SFX] ========== stopAll 被调用 ==========');
  var stoppedCount = 0;
  var i;
  
  // 停止所有2D音频池
  for (i = 0; i < this.pool2D.length; i++) {
    var ent2D = this.pool2D[i];
    if (ent2D && ent2D.sound && ent2D.enabled) {
      var slot2D = ent2D.sound.slot('one');
      if (slot2D && slot2D.isPlaying) {
        try {
          slot2D.stop();
          ent2D.enabled = false;
          stoppedCount++;
        } catch (e) {
          console.warn('[SFX] stopAll error (2D):', e);
        }
      } else if (slot2D) {
        // 即使没有播放，也禁用实体确保清理
        ent2D.enabled = false;
      }
    }
  }
  
  // 停止所有3D音频池
  for (i = 0; i < this.pool3D.length; i++) {
    var ent3D = this.pool3D[i];
    if (ent3D && ent3D.sound && ent3D.enabled) {
      var slot3D = ent3D.sound.slot('one');
      if (slot3D && slot3D.isPlaying) {
        try {
          slot3D.stop();
          ent3D.enabled = false;
          stoppedCount++;
        } catch (e) {
          console.warn('[SFX] stopAll error (3D):', e);
        }
      } else if (slot3D) {
        ent3D.enabled = false;
      }
    }
  }
  
  console.log('[SFX] 已停止所有SFX，停止数量:', stoppedCount);
  console.log('[SFX] ==========================================');
};

SfxManager.prototype.destroy = function () {
  this.app.off('sfx:play', this._onPlay, this);
  this.app.off('sfx:stop', this._onStop, this);
  this.app.off('sfx:stopAll', this._onStopAll, this);
  this.app.off('audio:bus:setVolume', this._onBusVol, this);
  // 回收池实体
  var i;
  for (i = 0; i < this.pool2D.length; i++) try { this.pool2D[i].destroy(); } catch (e) {}
  for (i = 0; i < this.pool3D.length; i++) try { this.pool3D[i].destroy(); } catch (e) {}
};
