/* global pc */
/**
 * @file audio-bus-manager.js
 * @desc 基于 WebAudio 的音频总线管理器（Master/Music/SFX/UI/Ambience/Voice）。
 * - 创建 master 与各子 bus 的 GainNode
 * - 提供音量、静音、快照、ducking 等事件接口
 * - 提供 audio:getBus 回调用于其他系统接入（BGM/SFX 等）
 */
var AudioBusManager = pc.createScript('audioBusManager');

AudioBusManager.attributes.add('buses', {
  type: 'string',
  array: true,
  default: ['master', 'music', 'sfx', 'ui', 'ambience', 'voice'],
  title: 'Bus 列表'
});
AudioBusManager.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

AudioBusManager.prototype.initialize = function () {
  var app = this.app;
  this.ctx = app.soundManager && app.soundManager.context;

  this.bus = {};
  this._shots = {};

  // 事件绑定（即便没有 ctx，也保留 getBus 以避免调用方崩溃）
  this._onSetVolume = this.setVolume.bind(this);
  this._onMute = this.mute.bind(this);
  this._onRegShot = this.registerSnapshot.bind(this);
  this._onApplyShot = this.applySnapshot.bind(this);
  this._onDuck = this.duck.bind(this);
  this._onGetBus = this._handleGetBus.bind(this);

  app.on('audio:bus:setVolume', this._onSetVolume, this);
  app.on('audio:bus:mute', this._onMute, this);
  app.on('audio:snapshot:register', this._onRegShot, this);
  app.on('audio:snapshot:apply', this._onApplyShot, this);
  app.on('audio:duck', this._onDuck, this);
  app.on('audio:getBus', this._onGetBus, this);

  if (!this.ctx) {
    if (this.enableDebugLog) console.warn('[AudioBusManager] No AudioContext; bus features limited.');
    return;
  }

  // 创建增益结构：master -> destination；子 bus -> master
  this.master = this.ctx.createGain();
  this.master.gain.value = 1.0;
  this.master.connect(this.ctx.destination);

  for (var i = 0; i < this.buses.length; i++) {
    var name = this.buses[i];
    var g = this.ctx.createGain();
    g.gain.value = 1.0;
    g.connect(this.master);
    this.bus[name] = g;
  }

  // 兜底 master 别名
  if (!this.bus.master) this.bus.master = this.master;
};

AudioBusManager.prototype._handleGetBus = function (name, cb) {
  if (typeof cb === 'function') {
    cb((this.bus && this.bus[name]) || this.master || null);
  }
};

AudioBusManager.prototype._ramp = function (param, v, dur) {
  if (!param) return;
  var now = this.ctx ? this.ctx.currentTime : 0;
  try {
    if (param.cancelScheduledValues) param.cancelScheduledValues(now);
    if (param.setValueAtTime) param.setValueAtTime(param.value, now);
    if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(v, now + Math.max(0.0001, dur || 0));
  } catch (e) {}
};

AudioBusManager.prototype.setVolume = function (opts) {
  if (!opts) return;
  var name = opts.bus || 'master';
  var b = this.bus[name];
  if (!b || !b.gain) return;
  var vol = Math.max(0, Math.min(1, opts.volume));
  this._ramp(b.gain, vol, opts.dur || 0);
};

AudioBusManager.prototype.mute = function (opts) {
  if (!opts) return;
  var name = opts.bus || 'master';
  var b = this.bus[name]; if (!b || !b.gain) return;
  this._ramp(b.gain, opts.mute ? 0 : 1, opts.dur || 0);
};

AudioBusManager.prototype.registerSnapshot = function (cfg) {
  if (!cfg || !cfg.name) return;
  this._shots[cfg.name] = cfg.values || {};
};

AudioBusManager.prototype.applySnapshot = function (cfg) {
  if (!cfg || !cfg.name) return;
  var shot = this._shots[cfg.name]; if (!shot) return;
  for (var k in shot) {
    if (shot.hasOwnProperty(k) && this.bus[k] && this.bus[k].gain) {
      var v = Math.max(0, Math.min(1, shot[k]));
      this._ramp(this.bus[k].gain, v, cfg.dur || 0);
    }
  }
};

AudioBusManager.prototype.duck = function (opts) {
  if (!opts) return;
  var b = this.bus[opts.duck]; if (!b || !b.gain || !this.ctx) return;
  var amount = Math.max(0, Math.min(1, opts.amount != null ? opts.amount : 0.5));
  var attack = opts.attack || 0.05, hold = opts.hold || 0.1, release = opts.release || 0.3;
  var ctx = this.ctx, now = ctx.currentTime, g = b.gain;

  try {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.max(0, g.value * (1 - amount)), now + attack);
    g.setValueAtTime(g.value, now + attack + hold);
    g.linearRampToValueAtTime(1.0, now + attack + hold + release);
  } catch (e) {}
};

AudioBusManager.prototype.destroy = function () {
  // 解绑事件
  var app = this.app;
  app.off('audio:bus:setVolume', this._onSetVolume, this);
  app.off('audio:bus:mute', this._onMute, this);
  app.off('audio:snapshot:register', this._onRegShot, this);
  app.off('audio:snapshot:apply', this._onApplyShot, this);
  app.off('audio:duck', this._onDuck, this);
  app.off('audio:getBus', this._onGetBus, this);
  // 不强制断开 WebAudio 节点（交由页面生命周期回收）
};
