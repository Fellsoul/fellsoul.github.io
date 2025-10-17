/* global pc */
/**
 * @file audio-bgm-manager.js
 * @desc 背景音乐管理：双通道交叉淡入淡出、播放/停止/暂停/恢复。
 */
var BgmManager = pc.createScript('bgmManager');

BgmManager.attributes.add('musicBusName', { type: 'string', default: 'music', title: '音乐 Bus 名称' });

BgmManager.prototype.initialize = function () {
  var self = this;
  this.bus = null;
  // 获取 bus（若无 AudioBusManager，cb 可能拿到 null，但不影响本地淡入淡出）
  this.app.fire('audio:getBus', this.musicBusName, function (bus) { self.bus = bus || null; });

  // Bus 音量模拟（用于未接入 WebAudio 路由时的兜底）：master * music
  this._busMaster = 1.0;
  this._busMusic = 1.0;
  this._onBusVol = function (o) {
    if (!o) return;
    var v = (o.volume != null) ? Math.max(0, Math.min(1, o.volume)) : null;
    if (v == null) return;
    if (o.bus === 'master') self._busMaster = v;
    if (o.bus === self.musicBusName) self._busMusic = v;
    // 若当前不在淡入淡出中，立即应用到当前曲目
    if (self._active && self._updateHandlers.length === 0 && self._active.slot) {
      var configVol = self._configVolume || 1.0;
      try { self._active.slot.volume = configVol * self._busMaster * self._busMusic; } catch (e) {}
    }
  };
  this.app.on('audio:bus:setVolume', this._onBusVol, this);

  this._trackA = this._makePlayer();
  this._trackB = this._makePlayer();
  this._active = this._trackA; this._idle = this._trackB;
  this._currentId = null;
  this._configVolume = 1.0; // 默认配置音量

  this._updateHandlers = [];

  this._onPlay = this.play.bind(this);
  this._onStop = this.stop.bind(this);
  this._onPause = this.pause.bind(this);
  this._onResume = this.resume.bind(this);

  this.app.on('bgm:play', this._onPlay, this);
  this.app.on('bgm:stop', this._onStop, this);
  this.app.on('bgm:pause', this._onPause, this);
  this.app.on('bgm:resume', this._onResume, this);
};

BgmManager.prototype._makePlayer = function () {
  var e = new pc.Entity('bgmPlayer');
  e.addComponent('sound');
  // 统一使用一个 slot 名称，方便管理
  var s = e.sound.addSlot('bgm', { loop: true, volume: 1.0, autoPlay: false, overlap: false });
  
  // 标记为全局实体，防止场景切换时被销毁
  if (this.app.root && this.app.root.addChild) {
    this.app.root.addChild(e);
  }
  
  return { ent: e, slot: s };
};

/**
 * 重新创建音频播放器（场景切换后实体可能失效）
 * @private
 */
BgmManager.prototype._recreatePlayers = function() {
  console.log('[BGM] 重新创建音频播放器...');
  
  // 销毁旧的实体
  try { if (this._trackA && this._trackA.ent) this._trackA.ent.destroy(); } catch (e) {}
  try { if (this._trackB && this._trackB.ent) this._trackB.ent.destroy(); } catch (e) {}
  
  // 创建新的播放器
  this._trackA = this._makePlayer();
  this._trackB = this._makePlayer();
  this._active = this._trackA;
  this._idle = this._trackB;
  this._currentId = null;
  
  console.log('[BGM] 音频播放器重新创建完成');
};

BgmManager.prototype._setClip = function (player, audioAsset) {
  if (!audioAsset || !audioAsset.resource) return false;
  
  // 检查player和slot是否有效（可能在场景切换时被销毁）
  if (!player || !player.slot) {
    console.warn('[BGM] _setClip: player或slot无效，可能已被销毁');
    return false;
  }
  
  // 检查实体是否仍然有效
  if (!player.ent || !player.ent.sound) {
    console.warn('[BGM] _setClip: 实体或sound组件无效');
    return false;
  }
  
  try { player.slot.stop(); } catch (e) {}
  player.slot.asset = audioAsset;
  return true;
};

BgmManager.prototype.play = function (opts) {
  opts = opts || {};
  var asset = opts.asset || this.app.assets.find(opts.id, 'audio');
  if (!asset) { console.warn('[BGM] audio not found:', opts && opts.id); return; }

  var next = this._idle, cur = this._active;
  
  // 检查实体是否有效，如果无效则重新创建
  if (!next || !next.ent || !next.ent.sound) {
    console.warn('[BGM] play: 检测到播放器无效，重新创建...');
    this._recreatePlayers();
    next = this._idle;
    cur = this._active;
  }
  
  // 检查_setClip是否成功
  if (!this._setClip(next, asset)) {
    console.warn('[BGM] play: 设置音频失败，中止播放');
    return;
  }

  // 再次检查next.slot是否有效（双重保险）
  if (!next || !next.slot) {
    console.warn('[BGM] play: next.slot无效，中止播放');
    return;
  }

  try { next.slot.stop(); } catch (e) {}
  next.slot.volume = 0.0;
  next.slot.play();

  var dur = Math.max(0, opts.crossfade != null ? opts.crossfade : 0.8);
  
  // 保存配置的音量比例（用于淡入淡出）
  var configVolume = (opts.volume != null && opts.volume >= 0) ? opts.volume : 1.0;
  this._configVolume = configVolume;
  
  this._xfade(cur, next, dur);

  this._active = next; this._idle = cur;
  this._currentId = opts.id || asset.name;
};

BgmManager.prototype._xfade = function (from, to, dur) {
  var self = this;
  var t = 0;
  function up(dt) {
    t += dt; var k = Math.min(1, t / (dur || 0.0001));
    var s = k * k * (3 - 2 * k);
    
    // 使用配置音量 * bus音量作为最终音量
    var configVol = self._configVolume || 1.0;
    var scale = self._busMaster * self._busMusic * configVol;
    
    if (from && from.slot) from.slot.volume = (1.0 - s) * scale;
    if (to && to.slot) to.slot.volume = s * scale;
    if (k >= 1) {
      try { if (from && from.slot) from.slot.stop(); } catch (e) {}
      self.app.off('update', up, self);
      var idx = self._updateHandlers.indexOf(up);
      if (idx !== -1) self._updateHandlers.splice(idx, 1);
    }
  }
  this._updateHandlers.push(up);
  this.app.on('update', up, this);
};

BgmManager.prototype.stop = function (opts) {
  opts = opts || {};
  var d = Math.max(0, opts.fadeOut != null ? opts.fadeOut : 0.3);
  var self = this;
  var t = 0;
  var p = this._active;
  function up(dt) {
    t += dt; var k = Math.min(1, t / (d || 0.0001));
    var configVol = self._configVolume || 1.0;
    var scale = self._busMaster * self._busMusic * configVol;
    if (p && p.slot) p.slot.volume = (1.0 - k) * scale;
    if (k >= 1) {
      try { if (p && p.slot) p.slot.stop(); } catch (e) {}
      self.app.off('update', up, self);
      var idx = self._updateHandlers.indexOf(up);
      if (idx !== -1) self._updateHandlers.splice(idx, 1);
    }
  }
  this._updateHandlers.push(up);
  this.app.on('update', up, this);
};

BgmManager.prototype.pause = function () {
  try { if (this._active && this._active.slot) this._active.slot.pause(); } catch (e) {}
};

BgmManager.prototype.resume = function () {
  try {
    if (this._active && this._active.slot) {
      this._active.slot.resume();
      var configVol = this._configVolume || 1.0;
      this._active.slot.volume = configVol * this._busMaster * this._busMusic;
    }
  } catch (e) {}
};

BgmManager.prototype.destroy = function () {
  // 解绑事件
  this.app.off('bgm:play', this._onPlay, this);
  this.app.off('bgm:stop', this._onStop, this);
  this.app.off('bgm:pause', this._onPause, this);
  this.app.off('bgm:resume', this._onResume, this);
  this.app.off('audio:bus:setVolume', this._onBusVol, this);
  // 解绑 update 回调
  for (var i = 0; i < this._updateHandlers.length; i++) {
    this.app.off('update', this._updateHandlers[i], this);
  }
  this._updateHandlers.length = 0;
  // 移除实体
  try { if (this._trackA && this._trackA.ent) this._trackA.ent.destroy(); } catch (e) {}
  try { if (this._trackB && this._trackB.ent) this._trackB.ent.destroy(); } catch (e) {}
};
