/**
 * @file menu-sprite-triple-fader.js
 * @desc 给挂了 Button 的实体增加“三状态图片”覆盖层（Normal / Hover / Pressed），
 *       通过 **Button 组件事件** 触发渐隐/渐显，不做射线检测；
 *       生成三个子 Image（不再反复创建，避免内存泄漏），层级从上到下：
 *       Pressed（最高） > Hover > Normal（最底）。
 *
 * 行为：
 *   - 初始：Normal 不透明度=1；Hover=0；Pressed=0。
 *   - 鼠标悬停：Hover 在 Normal 之上淡入/淡出（Normal 不动）。
 *   - 按下：Pressed 在最上层淡入；松开：Pressed 淡出；若仍悬停 Hover 保持。
 *   - 仅响应 Button 的 mouseenter/mouseleave/mousedown/mouseup/touchstart/touchend。
 *   - 动画期间按需注册 update，动画结束自动注销；不常驻 update，不积累误差，不会“越用越透明”。
 *
 * 使用：
 *   1) 目标实体需包含 Element(Image) + Button。
 *   2) 本脚本只改变子层三张图片的 sprite 与透明度，不改你的其他设置。
 */

/* global pc */

var MenuSpriteTripleFader = pc.createScript('menuSpriteTripleFader');

// ---------- 属性 ----------
MenuSpriteTripleFader.attributes.add('normalSprite',  { type: 'asset', assetType: 'sprite', title: 'Normal Sprite (默认取父Element)', default: null });
MenuSpriteTripleFader.attributes.add('hoverSprite',   { type: 'asset', assetType: 'sprite', title: 'Hover Sprite',   default: null });
MenuSpriteTripleFader.attributes.add('pressedSprite', { type: 'asset', assetType: 'sprite', title: 'Pressed Sprite', default: null });

// 多帧 sprite 可用（从0开始）
MenuSpriteTripleFader.attributes.add('normalFrame',  { type: 'number', title: 'Normal Frame',  default: 0 });
MenuSpriteTripleFader.attributes.add('hoverFrame',   { type: 'number', title: 'Hover Frame',   default: 0 });
MenuSpriteTripleFader.attributes.add('pressedFrame', { type: 'number', title: 'Pressed Frame', default: 0 });

MenuSpriteTripleFader.attributes.add('fadeDuration', { type: 'number', title: '淡入/淡出时长(秒)', default: 0.15, min: 0 });
MenuSpriteTripleFader.attributes.add('ease', {
  type: 'string', title: '缓动',
  enum: [
    { 'Smoothstep': 'smooth' },
    { 'Linear': 'linear' },
    { 'Ease In': 'in' },
    { 'Ease Out': 'out' }
  ],
  default: 'smooth'
});

// 是否关闭 Button 自带的视觉过渡（避免与本插件动画打架）
MenuSpriteTripleFader.attributes.add('disableButtonTransitions', { type: 'boolean', default: true, title: '禁用 Button 视觉过渡' });


// ---------- 生命周期 ----------
MenuSpriteTripleFader.prototype.initialize = function () {
  this._baseEl = this.entity.element;
  this._btn    = this.entity.button;

  if (!this._baseEl || this._baseEl.type !== pc.ELEMENTTYPE_IMAGE) {
    console.warn('[menu-sprite-triple-fader] 需要挂在带 Element(Image) 的实体上');
    return;
  }
  if (!this._btn) {
    console.warn('[menu-sprite-triple-fader] 需要 Button 组件提供输入事件');
    return;
  }

  // 关闭 Button 自带状态过渡（只影响视觉，不影响点击逻辑）
  if (this.disableButtonTransitions && typeof pc.BUTTON_TRANSITION_MODE_NONE !== 'undefined') {
    this._prevTransitionMode = this._btn.transitionMode;
    this._btn.transitionMode = pc.BUTTON_TRANSITION_MODE_NONE;
    this._btn.hoverSpriteAsset = null;
    this._btn.pressedSpriteAsset = null;
    this._btn.inactiveSpriteAsset = null;
  }

  // 兜底 normal sprite
  if (!this.normalSprite && this._baseEl.spriteAsset) {
    this.normalSprite = this._baseEl.spriteAsset;
    this.normalFrame  = this._baseEl.spriteFrame || 0;
  }

  // 创建三张覆盖图（一次性，不泄漏）
  this._layerNormal  = this._createLayer('__fader_normal__',  0); // 最底
  this._layerHover   = this._createLayer('__fader_hover__',   1); // 中
  this._layerPressed = this._createLayer('__fader_pressed__', 2); // 最高

  // 赋 sprite / frame
  this._applySprite(this._layerNormal.element,  this.normalSprite,  this.normalFrame);
  this._applySprite(this._layerHover.element,   this.hoverSprite   || this.normalSprite,  this.hoverSprite ? this.hoverFrame : this.normalFrame);
  this._applySprite(this._layerPressed.element, this.pressedSprite || this.hoverSprite || this.normalSprite,
                    this.pressedSprite ? this.pressedFrame : (this.hoverSprite ? this.hoverFrame : this.normalFrame));

  // 初始透明度：Normal=1, Hover=0, Pressed=0
  this._setOpacity(this._layerNormal.element, 1);
  this._setOpacity(this._layerHover.element,  0);
  this._setOpacity(this._layerPressed.element,0);

  // 记录层级基线（确保 Pressed>Hover>Normal）
  this._baseOrder = this._baseEl.drawOrder || 0;
  this._applyDrawOrders();

  // 动画管理：为每一层维护独立动画状态
  this._anims = {
    normal:  null,
    hover:   null,
    pressed: null
  };
  this._updateBound = this._onUpdate.bind(this);
  this._animating = false;

  // 悬停标志由 Button 事件维护（不用射线）
  this._isHovering = false;

  // 绑定 **仅 Button** 的输入事件
  this._bound = [];
  this._bind(this._btn, 'mouseenter', this._onEnter);
  this._bind(this._btn, 'mouseleave', this._onLeave);
  this._bind(this._btn, 'mousedown',  this._onDown);
  this._bind(this._btn, 'mouseup',    this._onUp);
  this._bind(this._btn, 'touchstart', this._onDown);
  this._bind(this._btn, 'touchend',   this._onUp);
};

MenuSpriteTripleFader.prototype.destroy = function () {
  // 解绑事件
  if (this._bound) {
    for (var i = 0; i < this._bound.length; i++) {
      var b = this._bound[i];
      b.tgt.off(b.ev, b.cb, this);
    }
    this._bound.length = 0;
  }
  // 停止动画
  if (this._animating) {
    this.app.off('update', this._updateBound, this);
    this._animating = false;
  }
  // 恢复 Button 过渡设置
  if (this._btn && this._prevTransitionMode != null) {
    this._btn.transitionMode = this._prevTransitionMode;
  }
  // 不销毁子节点（交由 PlayCanvas 场景生命周期）；若需要可手动 removeChild + destroy
};


// ---------- 事件 ----------
MenuSpriteTripleFader.prototype._bind = function (tgt, ev, fn) {
  var cb = fn.bind(this);
  tgt.on(ev, cb, this);
  this._bound.push({ tgt: tgt, ev: ev, cb: cb });
};

MenuSpriteTripleFader.prototype._onEnter = function () {
  this._isHovering = true;
  // Hover层：淡到1
  this._fade(this._layerHover.element, 'hover', 1);
};

MenuSpriteTripleFader.prototype._onLeave = function () {
  this._isHovering = false;
  // Hover层：淡到0；Pressed层也确保回0（防止鼠标拖出时留着）
  this._fade(this._layerHover.element,   'hover',   0);
  this._fade(this._layerPressed.element, 'pressed', 0);
};

MenuSpriteTripleFader.prototype._onDown = function () {
  // Pressed层：淡到1
  this._fade(this._layerPressed.element, 'pressed', 1);
};

MenuSpriteTripleFader.prototype._onUp = function () {
  // Pressed层：淡到0
  this._fade(this._layerPressed.element, 'pressed', 0);
  // 若仍悬停，确保 Hover=1（有时 mouseup 后 PC 不再派发 enter）
  if (this._isHovering) {
    this._fade(this._layerHover.element, 'hover', 1);
  }
};


// ---------- 动画 ----------
MenuSpriteTripleFader.prototype._fade = function (el, key, target) {
  var dur = Math.max(0, this.fadeDuration);
  if (dur === 0) {
    this._setOpacity(el, target);
    this._anims[key] = null;
    this._checkStopUpdate();
    return;
  }
  // 启动/更新此层动画：从当前透明度 → target
  var start = el.opacity;
  if (this._anims[key] && this._anims[key].target === target) {
    // 已在向同一目标变化——不重复开新动画
    return;
  }
  this._anims[key] = {
    el: el,
    t: 0,
    dur: dur,
    start: start,
    target: target
  };
  this._ensureUpdate();
};

MenuSpriteTripleFader.prototype._onUpdate = function (dt) {
  var any = false;
  any = this._stepAnim('hover', dt) || any;
  any = this._stepAnim('pressed', dt) || any;
  // Normal 层不参与动画（保持为1），如果你要做“禁用/隐藏整钮”的总淡入淡出，另行在外部控制父节点或三层一起 _fade

  if (!any) {
    this._checkStopUpdate();
  }
};

MenuSpriteTripleFader.prototype._stepAnim = function (key, dt) {
  var a = this._anims[key];
  if (!a) return false;

  a.t += dt;
  var t = Math.min(1, a.t / Math.max(0.0001, a.dur));
  var k = this._ease(t);
  var v = a.start + (a.target - a.start) * k;
  this._setOpacity(a.el, v);

  if (t >= 1) {
    this._setOpacity(a.el, a.target);
    this._anims[key] = null;
    return false;
  }
  return true;
};

MenuSpriteTripleFader.prototype._ensureUpdate = function () {
  if (!this._animating) {
    this.app.on('update', this._updateBound, this);
    this._animating = true;
  }
};

MenuSpriteTripleFader.prototype._checkStopUpdate = function () {
  if (!this._anims.hover && !this._anims.pressed) {
    if (this._animating) {
      this.app.off('update', this._updateBound, this);
      this._animating = false;
    }
  }
};

MenuSpriteTripleFader.prototype._ease = function (t) {
  switch (this.ease) {
    case 'linear': return t;
    case 'in':     return t * t;
    case 'out':    return t * (2 - t);
    case 'smooth':
    default:       return t * t * (3 - 2 * t);
  }
};


// ---------- 工具 ----------
MenuSpriteTripleFader.prototype._createLayer = function (name, zOffset) {
  var e = new pc.Entity(name);

  // 继承父 Element 的尺寸、锚点、层；drawOrder 叠加
  var layers =
    (this._baseEl.layers && this._baseEl.layers.length) ? this._baseEl.layers.slice()
      : (this.entity.element && this.entity.element.layers && this.entity.element.layers.length)
        ? this.entity.element.layers.slice()
        : [pc.LAYERID_UI];

  e.addComponent('element', {
    type: pc.ELEMENTTYPE_IMAGE,
    anchor: this._baseEl.anchor.clone(),
    pivot:  this._baseEl.pivot.clone(),
    width:  this._baseEl.width,
    height: this._baseEl.height,
    useInput: false,
    opacity: 0,
    layers: layers
  });

  this.entity.addChild(e);

  // 设置绘制顺序：Pressed 最高，Hover 其次，Normal 最低
  // base + 0 (normal) / +1 (hover) / +2 (pressed)
  e.element.drawOrder = (this._baseEl.drawOrder || 0) + zOffset;

  return e;
};

MenuSpriteTripleFader.prototype._applySprite = function (el, spriteAsset, frameIdx) {
  if (spriteAsset) el.spriteAsset = spriteAsset;
  if (typeof frameIdx === 'number') el.spriteFrame = frameIdx | 0;
};

MenuSpriteTripleFader.prototype._applyDrawOrders = function () {
  var base = this._baseOrder;
  this._layerNormal.element.drawOrder  = base + 0;
  this._layerHover.element.drawOrder   = base + 1;
  this._layerPressed.element.drawOrder = base + 2;
};

MenuSpriteTripleFader.prototype._setOpacity = function (el, v) {
  // 限制范围，避免累积计算误差导致“越用越透明”
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  el.opacity = v;
};
