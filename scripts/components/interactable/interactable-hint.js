/* global pc, UIManager, I18n */
/**
 * @file interactable-hint.js
 * @desc 可交互提示插件：绑定到场景物体上，当玩家靠近时在右侧弹出提示（支持 i18n）；
 *       玩家按下指定键位后，发出“动作名:键名”的事件供其他脚本监听。
 * @pc-attrs
 *   playerEntity:entity=null, distance:number=2.0,
 *   cameraEntity:entity=null, viewAngleThreshold:number=30, emissiveBoost:number=0.6, uniqueMaterial:boolean=true,
 *   i18nKey:string="", hintText:string="按E键交互",
 *   keyCode:number=69, keyName:string="E", actionName:string="sit",
 *   showHintWhenNear:boolean=true, hideHintOnExit:boolean=true,
 *   oneTimeOnly:boolean=false, enableDebugLog:boolean=false
 */
var InteractableHint = pc.createScript('interactableHint');

// 目标玩家（可选，不填则按名称回退 Player）
InteractableHint.attributes.add('playerEntity', { type: 'entity', title: '玩家实体(可选)' });
// 触发距离
InteractableHint.attributes.add('distance', { type: 'number', default: 2.0, title: '提示距离(米)' });
// 视角检测相机（可选，不填则自动寻找主摄像机，否则退化使用玩家 forward）
InteractableHint.attributes.add('cameraEntity', { type: 'entity', title: '主摄像机(可选)' });
// 视角夹角阈值（度）：小于等于该值判定为“正朝向”
InteractableHint.attributes.add('viewAngleThreshold', { type: 'number', default: 30, title: '选中角度阈值(°)' });
// 高亮发光强度增量
InteractableHint.attributes.add('emissiveBoost', { type: 'number', default: 0.6, title: '高亮：Emissive 增量' });
// 是否为该实体的网格克隆独立材质（避免影响共享材质）
InteractableHint.attributes.add('uniqueMaterial', { type: 'boolean', default: true, title: '高亮：克隆独立材质' });
// i18n 键；若未填写或找不到，将使用 hintText
InteractableHint.attributes.add('i18nKey', { type: 'string', default: '', title: '提示文本 i18n 键' });
// 直接文本（无 i18n 时兜底）
InteractableHint.attributes.add('hintText', { type: 'string', default: '按E键交互', title: '提示文本(兜底)' });
// 键位配置
InteractableHint.attributes.add('keyCode', { type: 'number', default: 69, title: '触发键 KeyCode (E=69)' });
InteractableHint.attributes.add('keyName', { type: 'string', default: 'E', title: '键名(事件名展示用)' });
// 动作名（用于事件名前缀）
InteractableHint.attributes.add('actionName', { type: 'string', default: 'sit', title: '动作名(如 sit / open / talk)'});
// 提示显示与隐藏行为
InteractableHint.attributes.add('showHintWhenNear', { type: 'boolean', default: true, title: '靠近时显示提示' });
InteractableHint.attributes.add('hideHintOnExit', { type: 'boolean', default: true, title: '离开时隐藏提示' });
// 单次性交互
InteractableHint.attributes.add('oneTimeOnly', { type: 'boolean', default: false, title: '单次交互（交互后禁用）' });
// 调试
InteractableHint.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

InteractableHint.prototype.initialize = function () {
  // 玩家引用 
  this._player = this.playerEntity || this.app.root.findByName('Player') || null;
  // 就近状态
  this._near = false;
  this._hintVisible = false; // 基于"距离+朝向"的提示可见性
  this._highlighted = false;
  this._origMats = null; // [{mi, mat, emissive:Color, emissiveIntensity:number}]
  this._hasInteracted = false; // 单次性：是否已经交互过
  this._dialogueActive = false; // 对话是否进行中
  // 临时向量，避免在 update 中频繁 new
  this._tmpA = new pc.Vec3();
  this._tmpB = new pc.Vec3();

  // if (this.enableDebugLog) {
  //   console.log('[InteractableHint:init]', this.entity && this.entity.name, 'player= ', this._player && this._player.name || '(null)');
  // }

  // i18n 就绪标记与回调：就绪后若当前在近距范围，刷新一次提示文本
  this._i18nReady = false;
  var self = this;
  this._onI18nReady = function () {
    self._i18nReady = true;
    // if (self.enableDebugLog) console.log('[InteractableHint] i18n:ready received');
    if (self._near && self.showHintWhenNear) {
      // 刷新提示（以便从占位文本切换为多语言文案）
      self._showHint();
    }
  };
  
  // 移动端互动按钮监听
  this._onMobileInteract = function () {
    if (self._hintVisible) {
      self._handleInteract();
    }
  };
  this.app.on('mobile:interact', this._onMobileInteract, this);
  
  // 对话状态监听
  this._onDialogueStarted = function () {
    self._dialogueActive = true;
    if (self._hintVisible) {
      self._hideHint();
    }
  };
  this._onDialogueStopped = function () {
    self._dialogueActive = false;
    // 对话结束后，如果玩家仍在范围内且不是单次性已交互，重新显示提示
    if (self._near && self.showHintWhenNear && !(self.oneTimeOnly && self._hasInteracted)) {
      self._showHint();
    }
  };
  this.app.on('dialogue:started', this._onDialogueStarted, this);
  this.app.on('dialogue:stopped', this._onDialogueStopped, this);
  
  // 监听 i18n 就绪事件监听
  this.app.on('i18n:ready', this._onI18nReady, this);

  // 键盘按下监听（只在靠近时触发动作）
  this._onKeyDown = this._handleKeyDown.bind(this);
  this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
};

// ======== Highlight helpers ========
InteractableHint.prototype._setHighlight = function (active) {
  var rend = this.entity && (this.entity.render || this.entity.model) || null;
  var meshInstances = null;
  if (rend && rend.meshInstances) meshInstances = rend.meshInstances;
  else if (rend && rend.model && rend.model.meshInstances) meshInstances = rend.model.meshInstances;
  if (!meshInstances || !meshInstances.length) { this._highlighted = false; return; }

  if (active) {
    // 缓存原参数并（可选）克隆材质
    if (!this._origMats) this._origMats = [];
    if (this._origMats.length === 0) {
      for (var i = 0; i < meshInstances.length; i++) {
        var mi = meshInstances[i];
        var mat = mi.material;
        if (!mat) continue;
        // 可选：克隆避免影响共享材质
        if (this.uniqueMaterial && !mat._interactableCloned) {
          var cloned = mat.clone();
          cloned._interactableCloned = true;
          mi.material = cloned; mat = cloned;
        }
        var rec = { mi: mi, mat: mat, emissive: null, emissiveIntensity: null };
        try {
          if (mat.emissive) rec.emissive = mat.emissive.clone();
          if (typeof mat.emissiveIntensity === 'number') rec.emissiveIntensity = mat.emissiveIntensity;
        } catch (e) {}
        this._origMats.push(rec);
      }
    }
    // 应用高亮
    for (var j = 0; j < this._origMats.length; j++) {
      var r = this._origMats[j]; var m = r.mat; if (!m) continue;
      try {
        // 提升 emissiveIntensity；若没有该字段，则提升 emissive 颜色亮度
        if (typeof m.emissiveIntensity === 'number') {
          m.emissiveIntensity = (r.emissiveIntensity != null ? r.emissiveIntensity : 0) + (this.emissiveBoost || 0);
        } else if (m.emissive) {
          m.emissive = new pc.Color(
            Math.min(1, (r.emissive ? r.emissive.r : m.emissive.r) + this.emissiveBoost),
            Math.min(1, (r.emissive ? r.emissive.g : m.emissive.g) + this.emissiveBoost),
            Math.min(1, (r.emissive ? r.emissive.b : m.emissive.b) + this.emissiveBoost),
            1
          );
        }
        m.update();
      } catch (e) {}
    }
    this._highlighted = true;
  } else {
    // 恢复
    if (this._origMats) {
      for (var k = 0; k < this._origMats.length; k++) {
        var rr = this._origMats[k]; var mm = rr.mat; if (!mm) continue;
        try {
          if (rr.emissive && mm.emissive) mm.emissive.copy(rr.emissive);
          if (rr.emissiveIntensity != null && typeof mm.emissiveIntensity === 'number') mm.emissiveIntensity = rr.emissiveIntensity;
          mm.update();
        } catch (e) {}
      }
    }
    this._highlighted = false;
  }
};

InteractableHint.prototype._tryFindMainCamera = function () {
  try {
    // 优先 active camera
    var layer = this.app.scene && this.app.scene.layers; // not public API; fallback by name
    var byName = this.app.root.findByName && this.app.root.findByName('Camera');
    return byName || null;
  } catch (e) { return null; }
};

InteractableHint.prototype.update = function (dt) {
  var player = this._player;
  if (!player || !player.getPosition) return;

  var a = this._tmpA.copy(this.entity.getPosition());
  var b = this._tmpB.copy(player.getPosition());
  var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  var nearNow = (dx*dx + dy*dy + dz*dz) <= (this.distance * this.distance);

  if (this.enableDebugLog) {
    var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  // 视角朝向判断（仅使用玩家“正向”——本项目按本地 +Z 视为正向）
  var inView = false;
  try {
    var forward = this._tmpForward || (this._tmpForward = new pc.Vec3());
    var toObj   = this._tmpToObj   || (this._tmpToObj   = new pc.Vec3());
    if (player && player.forward) {
      // PlayCanvas 的 entity.forward 通常是世界空间的 -Z；
      // 本项目“玩家正向”定义为本地 +Z，因此这里取反以对齐“正向”语义。
      forward.copy(player.forward).mulScalar(-1);
    } else {
      // 回退：根据玩家旋转推导“本地 +Z”到世界空间
      forward.set(0, 0, 1);
      try { player.getWorldTransform().transformVector(forward, forward); } catch (e) {}
    }
    toObj.sub2(a, b).normalize();
    var dot = pc.math.clamp(forward.normalize().dot(toObj), -1, 1);
    var deg = Math.acos(dot) * 180 / Math.PI;
    inView = (deg <= (this.viewAngleThreshold|0) || 0);
  } catch (e) { inView = false; }

  // 提示显示逻辑：需要同时满足“距离内 + 朝向内”
  var shouldShow = nearNow && inView;
  if (shouldShow !== this._hintVisible) {
    this._hintVisible = shouldShow;
    if (shouldShow) {
      if (this.showHintWhenNear) this._showHint();
    } else {
      if (this.hideHintOnExit) this._hideHint();
    }
  }

  // 高亮逻辑与提示一致：在“靠近且正朝向”时加发光；否则恢复
  var shouldHighlight = shouldShow;
  if (shouldHighlight !== this._highlighted) {
    this._setHighlight(shouldHighlight);
  }
};

InteractableHint.prototype._handleKeyDown = function (e) {
  // 仅在提示可见（靠近且正朝向）时响应
  if (!this._hintVisible) return;
  // 必须匹配配置的键位
  var need = (this.keyCode | 0) || 0;
  if ((e && e.key) !== need) return;
  // 忽略长按重复触发（若环境提供 repeat 字段）
  if (e && e.repeat) return;
  
  this._handleInteract();
};

// 通用交互处理（PC键盘和移动端按钮共用）
InteractableHint.prototype._handleInteract = function () {
  // 单次性检查：如果已经交互过且启用了单次性，则不处理交互
  if (this.oneTimeOnly && this._hasInteracted) {
    return;
  }
  
  // 对话状态检查：如果对话进行中，则不处理交互
  if (this._dialogueActive) {
    return;
  }
  
  // 事件名要求：插件name + 键位名，例如 "interactableHint:E"
  var id = 'interactableHint' + ':' + (this.keyName || String(this.keyCode));
  // 向全局广播一个明确的事件，便于其他脚本订阅
  this.app.fire(id, {
    entity: this.entity,
    player: this._player,
    key: this.keyName || this.keyCode,
    action: this.actionName || 'action'
  });

  // 也广播一个通用交互事件（可选消费）
  this.app.fire('interactable:action', {
    id: id,
    entity: this.entity,
    player: this._player,
    key: this.keyName || this.keyCode,
    action: this.actionName || 'action'
  });
  
  // 单次性处理：标记已交互并隐藏提示
  if (this.oneTimeOnly) {
    this._hasInteracted = true;
    this._hideHint();
    // 触发单次交互完成事件
    this.app.fire('interactable:one_time_completed', {
      entity: this.entity,
      action: this.actionName || 'action'
    });
  }
};

// 重置单次性状态（允许重新交互）
InteractableHint.prototype.resetOneTimeInteraction = function () {
  this._hasInteracted = false;
  // 如果当前在范围内，重新显示提示
  if (this._near && this.showHintWhenNear) {
    this._showHint();
  }
};

// 检查是否已经交互过
InteractableHint.prototype.hasInteracted = function () {
  return this._hasInteracted;
};

InteractableHint.prototype._getHintText = function () {
  // 优先从 i18n 的 'ui' 命名空间读取 i18nKey
  var text = this.hintText || '';
  try {
    if (this.i18nKey && typeof I18n !== 'undefined' && I18n.get) {
      var t = I18n.get('ui', this.i18nKey);
      // if (this.enableDebugLog) console.log('[InteractableHint][i18n] read ui.%s -> %o', this.i18nKey, t);
      if (t && typeof t === 'string') text = t;
      // else if (this.enableDebugLog) console.log('[InteractableHint][i18n] missing or non-string, fallback to hintText:', this.hintText);
    }
    // else if (this.enableDebugLog) {
    //   console.log('[InteractableHint][i18n] skip: invalid key or I18n.get unavailable. key=', this.i18nKey);
    // }
  } catch (e) {}

  if (!text) text = 'Press ' + (this.keyName || 'E');
  // if (this.enableDebugLog) console.log('[InteractableHint][i18n] final hint text =', text);
  return text;
};

// 调 UIManager 的右侧提示；若 UIManager 未实现右侧提示，则走事件兜底
InteractableHint.prototype._showHint = function () {
  // 单次性检查：如果已经交互过且启用了单次性，则不显示提示
  if (this.oneTimeOnly && this._hasInteracted) {
    return;
  }
  
  // 对话状态检查：如果对话进行中，则不显示提示
  if (this._dialogueActive) {
    return;
  }
  
  var text = this._getHintText();
  
  // 检查是否为移动端
  var isMobile = this._detectMobileDevice();
  
  // 移动端事件：显示互动按钮和提示文字
  this.app.fire('interactable:hint:show', { 
    hintKey: this.i18nKey || this.hintText,
    hint: text,
    entity: this.entity,
    source: 'interactableHint'
  });
  
  // 只在非移动端显示右侧按键提示
  if (!isMobile) {
    var ui = (typeof UIManager !== 'undefined' && UIManager.getInstance) ? UIManager.getInstance() : null;
    if (ui && typeof ui.showRightHint === 'function') {
      try {
        // if (this.enableDebugLog) console.log('[InteractableHint:showHint] PC - text=', text, 'key=', this.keyName || String(this.keyCode));
        ui.showRightHint(text, { source: 'interactableHint', entity: this.entity, keyName: this.keyName || String(this.keyCode), slideMs: 160 });
        return;
      } catch (e) {}
    }
    // 事件兜底（交由 UI 层统一实现）
    this.app.fire('ui:hint:show', { side: 'right', text: text, entity: this.entity, source: 'interactableHint', keyName: this.keyName || String(this.keyCode), slideMs: 160 });
  }
  
  // if (this.enableDebugLog) console.log('[InteractableHint] hint show ->', text, 'isMobile:', isMobile);
};

InteractableHint.prototype._hideHint = function () {
  // 检查是否为移动端
  var isMobile = this._detectMobileDevice();
  
  // 移动端事件：隐藏互动按钮和提示文字
  this.app.fire('interactable:hint:hide', { 
    entity: this.entity,
    source: 'interactableHint'
  });
  
  // 只在非移动端隐藏右侧按键提示
  if (!isMobile) {
    var ui = (typeof UIManager !== 'undefined' && UIManager.getInstance) ? UIManager.getInstance() : null;
    if (ui && typeof ui.hideRightHint === 'function') {
      try {
        // if (this.enableDebugLog) console.log('[InteractableHint:hideHint] PC');
        ui.hideRightHint({ source: 'interactableHint', entity: this.entity, slideMs: 140 });
        return;
      } catch (e) {}
    }
    this.app.fire('ui:hint:hide', { side: 'right', entity: this.entity, source: 'interactableHint', slideMs: 140 });
  }
  
  // if (this.enableDebugLog) console.log('[InteractableHint] hint hide, isMobile:', isMobile);
};

// 移动端检测方法
InteractableHint.prototype._detectMobileDevice = function () {
  // 优先检查 GlobalGame 的设备信息
  if (typeof GlobalGame !== 'undefined' && GlobalGame.device) {
    return GlobalGame.device.isMobile || false;
  }
  
  // 检查 UIMobile 实例是否存在且启用
  if (typeof UIMobile !== 'undefined' && UIMobile.getInstance) {
    var uiMobile = UIMobile.getInstance();
    return uiMobile && uiMobile.enabled;
  }
  
  // 回退：检测 user agent
  var ua = navigator.userAgent || navigator.vendor || window.opera || '';
  var isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase());
  
  // 检测触摸支持
  var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  
  return isMobile || (hasTouch && window.innerWidth < 1024);
};

InteractableHint.prototype.destroy = function () {
  // 清理UI状态
  if (this._hintVisible) {
    this._hideHint();
    this._hintVisible = false;
  }
  
  // 清理高亮状态
  if (this._highlighted) {
    this._setHighlight(false);
    this._highlighted = false;
  }
  
  // 清理键盘事件监听
  if (this.app && this.app.keyboard && this._onKeyDown) {
    this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    this._onKeyDown = null;
  }
  
  // 清理应用级事件监听
  if (this.app) {
    if (this._onI18nReady) {
      this.app.off('i18n:ready', this._onI18nReady, this);
      this._onI18nReady = null;
    }
    
    if (this._onMobileInteract) {
      this.app.off('mobile:interact', this._onMobileInteract, this);
      this._onMobileInteract = null;
    }
    
    if (this._onDialogueStarted) {
      this.app.off('dialogue:started', this._onDialogueStarted, this);
      this._onDialogueStarted = null;
    }
    
    if (this._onDialogueStopped) {
      this.app.off('dialogue:stopped', this._onDialogueStopped, this);
      this._onDialogueStopped = null;
    }
  }
  
  // 清理引用
  this._player = null;
  this._origMats = null;
  this._tmpA = null;
  this._tmpB = null;
  this._tmpForward = null;
  this._tmpToObj = null;
  
  // 重置状态
  this._near = false;
  this._dialogueActive = false;
  this._hasInteracted = false;
  this._i18nReady = false;
  
  if (this.enableDebugLog) {
    console.log('[InteractableHint] Destroyed and cleaned up:', this.entity && this.entity.name);
  }
};
