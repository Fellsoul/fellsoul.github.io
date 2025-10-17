/* global pc */
/**
 * @file audio-unlocker.js
 * @desc 解决移动端首交互前 AudioContext 处于 suspended 导致无声的问题。
 */
var AudioUnlocker = pc.createScript('audioUnlocker');

AudioUnlocker.prototype.initialize = function () {
  var app = this.app;
  var ctx = app.soundManager && app.soundManager.context;
  if (!ctx) return;

  var self = this;
  this._unlocked = false;

  this._unlock = function () {
    try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) {}
    self._removeDomListeners();
    self._unlocked = true;
    try { app.fire('audio:unlocked'); } catch (e) {}
  };

  this._onPointerUp = function () { self._unlock(); };
  this._onTouchEnd = function () { self._unlock(); };
  this._onKeyDown  = function () { self._unlock(); };

  window.addEventListener('pointerup', this._onPointerUp, { once: true });
  window.addEventListener('touchend', this._onTouchEnd, { once: true });
  window.addEventListener('keydown',  this._onKeyDown,  { once: true });
};

AudioUnlocker.prototype._removeDomListeners = function () {
  if (this._onPointerUp) window.removeEventListener('pointerup', this._onPointerUp);
  if (this._onTouchEnd) window.removeEventListener('touchend', this._onTouchEnd);
  if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
};

AudioUnlocker.prototype.destroy = function () {
  this._removeDomListeners();
};
