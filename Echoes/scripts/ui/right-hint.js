/* global pc */
/**
 * @file RightHint.js
 * @desc 右侧提示面板的无依赖模块。处理进出场动画、并发/抢占、基线漂移等问题。
 *
 * API:
 *   RightHint.init(app, { panel, text, key, debug })
 *   RightHint.configure({ panel, text, key, debug })     // 可热更新绑定
 *   RightHint.show(text, { keyName, slideMs=160 })
 *   RightHint.hide({ slideMs=140 })
 *   RightHint.isVisible()
 *   RightHint.reset()                                     // 复位到“隐藏位”
 */
var RightHint = (function () {
    var _app = null;
    var _panelEnt = null, _textEnt = null, _keyEnt = null;
    var _panelEl = null, _textEl = null, _keyEl = null;
    var _shownPos = null, _hiddenPos = null;     // 只在(首次)绑定时记录基线
    var _anim = null;                             // {t,dur,fromPos,toPos, fromOps,toOps, killToken}
    var _visible = false;
    var _debug = false;
  
    // 移除了 debug log 函数
  
    function _stopAnim() {
      if (_anim && _anim.killToken) _anim.killToken.dead = true;
      if (_app && _anim && _anim.tick) _app.off('update', _anim.tick);
      _anim = null;
    }
  
    // 只在首次或变更绑定时计算“显示/隐藏”的基线；之后 show/hide 均以它为目标，避免漂移
    function _captureBaselines() {
      if (!_panelEnt) return;
      var lp = _panelEnt.getLocalPosition().clone();
      // 初始状态视为“显示位”的基线
      _shownPos = lp.clone();
  
      // 向右移出屏的距离（用 element 宽度做估算）
      var w = 200;
      try {
        var calcW = (_panelEl && (_panelEl.calculatedWidth || _panelEl.width)) || 0;
        if (calcW > 0) w = calcW + 24;
      } catch (e) {}
  
      _hiddenPos = lp.clone();
      _hiddenPos.x += w;
  
      // 初始放到隐藏位（但保留一个“显示位”的基线）
      _panelEnt.setLocalPosition(_hiddenPos);
      if (_panelEl) _panelEl.opacity = 0;
      if (_textEl)  _textEl.opacity  = 0;
      if (_keyEl)   _keyEl.opacity   = 0;
  
      _panelEnt.enabled = false;
      if (_textEnt) _textEnt.enabled = false;
      if (_keyEnt)  _keyEnt.enabled  = false;
  
      _visible = false;
    }
  
    function _bind(opts) {
      opts = opts || {};
      _panelEnt = opts.panel || _panelEnt;
      _textEnt  = opts.text  || _textEnt;
      _keyEnt   = opts.key   || _keyEnt;
      _panelEl = (_panelEnt && _panelEnt.element) || null;
      _textEl  = (_textEnt  && _textEnt.element)  || null;
      _keyEl   = (_keyEnt   && _keyEnt.element)   || null;
  
      // 初始透明（防闪烁）
      if (_panelEl) _panelEl.opacity = _panelEl.opacity || 0;
      if (_textEl)  _textEl.opacity  = _textEl.opacity  || 0;
      if (_keyEl)   _keyEl.opacity   = _keyEl.opacity   || 0;
  
      // 仅在首次建立或缺失基线时抓一次；避免反复 configure 造成基线漂移
      if (!_shownPos || !_hiddenPos) _captureBaselines();
    }
  
    function init(app, opts) {
      _app = app;
      _debug = !!(opts && opts.debug);
      _bind(opts);
      // RightHint init
    }
  
    function configure(opts) {
      if (opts && typeof opts.debug !== 'undefined') _debug = !!opts.debug;
      _bind(opts);
      // RightHint configured
    }
  
    // 统一的补间驱动（互斥、可抢占）
    function _animate(toPos, toOps, durMs) {
      if (!_app || !_panelEnt) return;
  
      _stopAnim();
  
      var fromPos = _panelEnt.getLocalPosition().clone();
      var fromOps = {
        p: _panelEl ? _panelEl.opacity : 1,
        t: _textEl  ? _textEl.opacity  : 1,
        k: _keyEl   ? _keyEl.opacity   : 1
      };
      var dur = Math.max(0, durMs|0);
      var token = { dead: false };
      var t = 0;
  
      // 开始前确保可见（显示流程）
      _panelEnt.enabled = true;
      if (_textEnt) _textEnt.enabled = true;
      if (_keyEnt)  _keyEnt.enabled  = true;
  
      var tick = function (dt) {
        if (token.dead) return; // 被抢占
        t += dt * 1000;
        var k = dur > 0 ? Math.min(1, t / dur) : 1;
        // easeInOut (smoothstep)
        var s = k * k * (3 - 2 * k);
  
        var x = fromPos.x + (toPos.x - fromPos.x) * s;
        var y = fromPos.y + (toPos.y - fromPos.y) * s;
        var z = fromPos.z + (toPos.z - fromPos.z) * s;
        _panelEnt.setLocalPosition(x, y, z);
  
        if (_panelEl) _panelEl.opacity = fromOps.p + (toOps.p - fromOps.p) * s;
        if (_textEl)  _textEl.opacity  = fromOps.t + (toOps.t - fromOps.t) * s;
        if (_keyEl)   _keyEl.opacity   = fromOps.k + (toOps.k - fromOps.k) * s;
  
        if (k >= 1) {
          _app.off('update', tick);
          // 隐藏流程收尾：禁用实体，彻底不可点
          if (toOps.p === 0) {
            _panelEnt.enabled = false;
            if (_textEnt) _textEnt.enabled = false;
            if (_keyEnt)  _keyEnt.enabled  = false;
            _visible = false;
          } else {
            _visible = true;
          }
          _anim = null;
        }
      };
  
      _anim = { tick: tick, killToken: token };
      _app.on('update', tick);
    }
  
    function show(text, options) {
      options = options || {};
      if (!_panelEnt) { return; }
  
      // 文本赋值（确保字体/元素存在）
      if (_textEl) {
        try { _textEl.text = text || ''; } catch (e) { /* set text failed */ }
      }
      if (_keyEl) {
        try { _keyEl.text = options.keyName || ''; } catch (e) { /* ignore */ }
      }
  
      // 目标：显示位 + 透明度 1
      var toPos = (_shownPos || _panelEnt.getLocalPosition()).clone();
      var dur = Math.max(0, options.slideMs|0) || 160;
      _animate(toPos, { p:1, t:1, k:1 }, dur);
    }
  
    function hide(options) {
      options = options || {};
      if (!_panelEnt) return;
      var toPos = (_hiddenPos || _panelEnt.getLocalPosition()).clone();
      var dur = Math.max(0, options.slideMs|0) || 140;
      _animate(toPos, { p:0, t:0, k:0 }, dur);
    }
  
    // 将面板立即复位到“隐藏位”，清理一切动画
    function reset() {
      _stopAnim();
      if (_panelEnt && _hiddenPos) _panelEnt.setLocalPosition(_hiddenPos);
      if (_panelEl) _panelEl.opacity = 0;
      if (_textEl)  _textEl.opacity  = 0;
      if (_keyEl)   _keyEl.opacity   = 0;
      if (_panelEnt) _panelEnt.enabled = false;
      if (_textEnt)  _textEnt.enabled  = false;
      if (_keyEnt)   _keyEnt.enabled   = false;
      _visible = false;
    }
  
    function isVisible() { return _visible; }
  
    return { init, configure, show, hide, reset, isVisible };
  })();
  