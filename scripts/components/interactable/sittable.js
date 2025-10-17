/* global pc, UIManager */
/**
 * @file sittable.js
 * @desc 可坐下的交互组件：与 `interactable-hint.js` 配合，监听全局 `interactable:action`，当 action==='sit' 且目标为自身时：
 *       1) 将玩家传送到预设坐标与朝向（遵循物理：有刚体则 rigidbody.teleport）；
 *       2) 广播玩家坐姿状态：app.fire('player:set_sitting', true);
 *       3) 按属性切换 UI 控制模式：
 *          - 若 isMenu=true 且存在对应菜单机位组，则进入“玩家锁定+多机位(LOCKED_MULTI)”并尝试切到所填菜单机位；
 *          - 否则进入“玩家可移动+固定机位(FREE_FIXED)”。
 * @pc-attrs
 *   playerEntity:entity=null,
 *   isMenu:boolean=false, menuGroupName:string="mainMenu", menuSubPos:string="main",
 *   useEntityPosition:boolean=true, sitWorldPosition:vec3=(0,0,0),
 *   useOffset:boolean=false, sitOffset:vec3=(0,0,0),
 *   useEntityRotation:boolean=true, sitEuler:vec3=(0,0,0),
 *   enableDebugLog:boolean=false
 */
var Sittable = pc.createScript('sittable');

// 目标玩家（可选）
Sittable.attributes.add('playerEntity', { type: 'entity', title: '玩家实体(可选)' });
// 是否作为菜单座位：进入多机位视角
Sittable.attributes.add('isMenu', { type: 'boolean', default: false, title: '是否菜单座位(进入多机位)' });
Sittable.attributes.add('menuGroupName', { type: 'string', default: 'mainMenu', title: '菜单机位组名(如 mainMenu)' });
Sittable.attributes.add('menuSubPos', { type: 'string', default: 'main', title: '菜单子机位名(如 main)' });
// 坐下位置（世界坐标）与可选偏移
Sittable.attributes.add('useEntityPosition', { type: 'boolean', default: true, title: '使用实体位置(世界坐标)' });
Sittable.attributes.add('sitWorldPosition', { type: 'vec3', default: [0, 0, 0], title: '坐下位置(世界坐标)' });
Sittable.attributes.add('useOffset', { type: 'boolean', default: false, title: '是否叠加偏移' });
Sittable.attributes.add('sitOffset', { type: 'vec3', default: [0, 0, 0], title: '坐下偏移(可选，叠加到上面的位置)' });
// 坐下朝向（绝对 3D 旋转）
Sittable.attributes.add('useEntityRotation', { type: 'boolean', default: true, title: '使用玩家当前朝向' });
Sittable.attributes.add('sitEuler', { type: 'vec3', default: [0, 0, 0], title: '坐下朝向Euler(绝对°: x,y,z)' });
Sittable.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

Sittable.prototype.initialize = function () {
  this._player = this.playerEntity || this.app.root.findByName('Player') || null;
  if (this.enableDebugLog) {
    console.log('[Sittable:init]', this.entity && this.entity.name, 'player=', this._player && this._player.name);
  }
  // 绑定交互事件
  this._onInteract = this._handleInteract.bind(this);
  this.app.on('interactable:action', this._onInteract, this);
};

Sittable.prototype.destroy = function () {
  if (this.app && this._onInteract) this.app.off('interactable:action', this._onInteract, this);
};

Sittable.prototype._handleInteract = function (payload) {
  // 仅处理针对自身实体，且动作为 sit 的交互
  if (!payload || payload.entity !== this.entity) return;
  var action = (payload.action || '').toLowerCase();
  if (action !== 'sit') return;

  var player = this._player || payload.player || null;
  if (!player) return;

  // 1) 计算坐下位置（世界坐标）与朝向（绝对旋转）
  var targetPos = new pc.Vec3();
  if (this.useEntityPosition) {
    targetPos.copy(this.entity.getPosition());
  } else {
    var p = this.sitWorldPosition || { x:0, y:0, z:0 };
    targetPos.set(p.x|0, p.y|0, p.z|0);
  }
  if (this.useOffset) {
    var off = this.sitOffset || { x:0, y:0, z:0 };
    targetPos.add(new pc.Vec3(off.x||0, off.y||0, off.z||0));
  }

  var q = new pc.Quat();
  if (this.useEntityRotation) {
    // 按需求：修改的是“玩家”的转向，使用玩家当前朝向为基准
    if (player && player.getRotation) q.copy(player.getRotation());
    else q.copy(this.entity.getRotation());
  } else {
    var e = this.sitEuler || { x:0, y:0, z:0 };
    q.setFromEulerAngles(e.x||0, e.y||0, e.z||0);
  }

  // 2) 传送玩家到坐姿（遵循物理规则）
  try {
    var rb = player.rigidbody;
    if (rb) {
      rb.teleport(targetPos, q);
      // 锁定角速度，避免物理扭转坐姿
      try { rb.angularFactor = new pc.Vec3(0,0,0); } catch (e) {}
    } else {
      player.setPosition(targetPos);
      player.setRotation(q);
    }
  } catch (e) { /* 安全兜底 */ }

  // 3) 切换 UI 控制模式
  try { this.app.fire('player:set_sitting', true); } catch (e) {}
  // 同步到 PlayerManager：记录坐姿旗标（位置/朝向不由 PlayerManager 持久化）
  try {
    if (typeof window !== 'undefined' && window.PlayerManagerAPI && window.PlayerManagerAPI.setFlag) {
      window.PlayerManagerAPI.setFlag('sitting', true);
    } else if (typeof PlayerManager !== 'undefined' && PlayerManager.get) {
      var pm = PlayerManager.get();
      if (pm && pm.setFlag) pm.setFlag('sitting', true);
    }
  } catch (e) {}
  // Remove invalid PlayerManager.setPosition usage (no-op)

  var ui = (typeof UIManager !== 'undefined' && UIManager.getInstance) ? UIManager.getInstance() : null;
  if (this.isMenu) {
    // 进入多机位菜单视角
    try { this.app.fire('ui:control:set', 'LOCKED_MULTI'); } catch (e) {}
    // 尝试切换到指定菜单机位（若存在）
    try {
      var cam = (ui && (ui.camera || (ui.entity && ui.entity.screen && ui.entity.screen.camera))) || this.app.root.findByName('Camera') || null;
      var trans = (cam && cam.script) ? cam.script.cameraTransition : null;
      if (trans) {
        // 若该组存在则瞬切过去；否则 UIManager 仍处于 LOCKED_MULTI，会回到默认主菜单机位
        var groups = trans.getAvailablePositions ? trans.getAvailablePositions() : null;
        var groupOK = !!(groups && this.menuGroupName && groups[this.menuGroupName]);
        if (groupOK) {
          try { trans.snapToPosition(this.menuGroupName, this.menuSubPos || null); } catch (e) {}
          try { trans.setCurrentPositionGroup(this.menuGroupName, this.menuSubPos || null); } catch (e) {}
        }
      }
    } catch (e) { if (this.enableDebugLog) console.warn('[Sittable] switch menu failed:', e); }
  } else {
    // 进入固定机位（自由移动）
    try { this.app.fire('ui:control:set', 'FREE_FIXED'); } catch (e) {}
  }

  if (this.enableDebugLog) {
    console.log('[Sittable] sit triggered ->', {
      isMenu: !!this.isMenu,
      menuGroup: this.menuGroupName,
      menuSub: this.menuSubPos,
      pos: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      rot: q
    });
  }
};
