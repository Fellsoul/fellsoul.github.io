/* global pc */
/**
 * @file audio-settings.js
 * @desc 音频设置：持久化并应用用户音量/静音到 Bus。
 */
var AudioSettings = pc.createScript('audioSettings');

AudioSettings.attributes.add('storageKey', { type: 'string', default: 'game.audio.v1', title: '存储键' });

AudioSettings.prototype.initialize = function () {
  this.key = this.storageKey || 'game.audio.v1';
  this.data = this._load() || { music: 1, sfx: 1, ui: 1, master: 1, mute: false };

  this._onSet = this._onSetEvent.bind(this);
  this._onLoad = this._onLoadEvent.bind(this);
  this._onSave = this._onSaveEvent.bind(this);

  this._applyAll();

  this.app.on('audio:settings:set', this._onSet, this);
  this.app.on('audio:settings:load', this._onLoad, this);
  this.app.on('audio:settings:save', this._onSave, this);
};

AudioSettings.prototype._onSetEvent = function (o) {
  o = o || {};
  if (o.bus) {
    var v = (o.volume != null) ? o.volume : this.data[o.bus];
    this.data[o.bus] = Math.max(0, Math.min(1, v));
  }
  if (o.mute != null) this.data.mute = !!o.mute;
  this._applyAll();
  this._save();
};

AudioSettings.prototype._onLoadEvent = function () {
  this.data = this._load() || this.data;
  this._applyAll();
};

AudioSettings.prototype._onSaveEvent = function () {
  this._save();
};

AudioSettings.prototype._applyAll = function () {
  // master 受 mute 影响
  this.app.fire('audio:bus:setVolume', { bus: 'master', volume: this.data.mute ? 0 : this.data.master, dur: 0 });
  this.app.fire('audio:bus:setVolume', { bus: 'music',  volume: this.data.music,  dur: 0 });
  this.app.fire('audio:bus:setVolume', { bus: 'sfx',    volume: this.data.sfx,    dur: 0 });
  this.app.fire('audio:bus:setVolume', { bus: 'ui',     volume: this.data.ui,     dur: 0 });
};

AudioSettings.prototype._load = function () {
  try { return JSON.parse(localStorage.getItem(this.key)); } catch (e) { return null; }
};

AudioSettings.prototype._save = function () {
  try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
};

AudioSettings.prototype.destroy = function () {
  this.app.off('audio:settings:set', this._onSet, this);
  this.app.off('audio:settings:load', this._onLoad, this);
  this.app.off('audio:settings:save', this._onSave, this);
};
