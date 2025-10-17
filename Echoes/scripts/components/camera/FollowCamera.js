/* global pc */
var FollowCamera = pc.createScript('followCamera');

FollowCamera.attributes.add('targetEntity', { type: 'entity', title: '目标实体' });
FollowCamera.attributes.add('offset', { type: 'vec3', default: [0, 2, 0], title: '围绕锚点偏移(世界空间)' });

FollowCamera.attributes.add('smoothFactor', { type: 'number', default: 3, title: '平滑系数' });

// 轨道
FollowCamera.attributes.add('mouseSensitivity', { type: 'number', default: 0.25, title: '鼠标灵敏度(°/像素)' });
FollowCamera.attributes.add('minPitch', { type: 'number', default: -20, title: '最小俯仰(°)' });
FollowCamera.attributes.add('maxPitch', { type: 'number', default: 60, title: '最大俯仰(°)' });
FollowCamera.attributes.add('distance', { type: 'number', default: 4, title: '初始距离' });
FollowCamera.attributes.add('minDistance', { type: 'number', default: 0.5, title: '最小距离' });
FollowCamera.attributes.add('maxDistance', { type: 'number', default: 8, title: '最大距离' });
FollowCamera.attributes.add('zoomSensitivity', { type: 'number', default: 0.5, title: '滚轮缩放灵敏度' });

// 初始朝向
FollowCamera.attributes.add('initialYaw', { type: 'number', default: 0, title: '初始水平角(°)' });
FollowCamera.attributes.add('initialPitch', { type: 'number', default: 15, title: '初始俯仰(°)' });

// 防穿墙
FollowCamera.attributes.add('enableCollision', { type: 'boolean', default: true, title: '启用碰撞检测' });
FollowCamera.attributes.add('collisionMask', { type: 'number', default: 0xffffffff, title: '碰撞组过滤(按 collision.group 的位与)' });
FollowCamera.attributes.add('safetyDistance', { type: 'number', default: 0.15, title: '安全间隙' });
FollowCamera.attributes.add('ignoreSelf', { type: 'boolean', default: true, title: '忽略目标自身碰撞' });

// FOV
FollowCamera.attributes.add('fov', { type: 'number', default: 60, title: 'FOV(°)' });

// Debug
FollowCamera.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '启用调试日志' });

// === Touch 旋转配置（新增） ===
FollowCamera.attributes.add('enableTouchRotate', { type: 'boolean', default: true, title: '启用触摸旋转' });
FollowCamera.attributes.add('touchZone', { type: 'string', default: 'right', title: '触摸区域: right | full' });
FollowCamera.attributes.add('touchDeadZone', { type: 'number', default: 2, title: '触摸死区(像素，防误触)' });
FollowCamera.attributes.add('touchSensitivityScale', { type: 'number', default: 1.0, title: '触摸灵敏度缩放(相对鼠标)' });


FollowCamera.prototype.initialize = function () {
  this._yaw = this.initialYaw;
  this._pitch = this.initialPitch;
  this._distance = this.distance;
  
  // 移动端触摸平滑（避免抖动）
  this._smoothedDx = 0;
  this._smoothedDy = 0;
  this._touchSmoothFactor = 0.3; // 触摸输入平滑系数

  this.canvas = this.app.graphicsDevice.canvas;
  this._pointerLocked = false;
  this._onPointerLockChange = () => { this._pointerLocked = (document.pointerLockElement === this.canvas); };
  document.addEventListener('pointerlockchange', this._onPointerLockChange);

  // 从GameManager读取鼠标灵敏度和反转Y轴设置
  this._sensitivityMultiplier = 1.0;
  this._invertY = false;
  this._loadMouseSettings();

  // 监听设置变化事件
  this._onMouseSensitivityChanged = (data) => {
    if (data && typeof data.sensitivity === 'number') {
      this._sensitivityMultiplier = data.sensitivity;
      if (this.enableDebugLog) {
        console.log('[FollowCamera] Mouse sensitivity changed to:', this._sensitivityMultiplier);
      }
    }
  };
  this.app.on('input:mouse_sensitivity:changed', this._onMouseSensitivityChanged, this);

  this._onInvertYChanged = (data) => {
    if (data && typeof data.inverted === 'boolean') {
      this._invertY = data.inverted;
      if (this.enableDebugLog) {
        console.log('[FollowCamera] Invert Y changed to:', this._invertY);
      }
    }
  };
  this.app.on('input:invert_y:changed', this._onInvertYChanged, this);

  // 默认禁用，等待 UI 控制（free_follow）再启用
  this._isEnabled = false;
  // 对话模式：不使用 pointer lock，但允许有限角度的鼠标视角
  this._dialogueMode = false;
  this._dialogueCenterYaw = 0;
  this._dialogueCenterPitch = 0;
  this._dialogueYawRange = 40;
  this._dialoguePitchRange = 30;

  // 鼠标
  if (this.app.mouse) {
    this.app.mouse.on(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    this.app.mouse.on(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
    this.app.mouse.on(pc.EVENT_MOUSEWHEEL, this.onMouseWheel, this);
  }

  // 监听 UI 控制状态：仅当进入 free_follow 才允许相机跟随与指针锁定
  this._onUiControlChanged = (e) => {
    var to = e && e.to;
    this._currentControl = to;
    if (to === 'free_follow') {
      // 自由跟随：正常启用
      this._dialogueMode = false;
      this.enable();
    } else if (to === 'dialogue') {
      // 对话：启用相机更新，但不申请 pointer lock
      this._dialogueMode = true;
      this._syncDialogueRanges();
      this._captureDialogueCenter();
      this._isEnabled = true;
      // 退出可能残留的 pointer lock
      try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e2) {}
      this._pointerLocked = false;
    } else {
      // 其他控制态：禁用相机更新
      this._dialogueMode = false;
      this.disable();
    }
  };
  this.app.on('ui:control_state_changed', this._onUiControlChanged, this);

  // 对话开始/结束：更新中心点与范围
  this._onDialogueBegin = (info) => {
    this._dialogueMode = true;
    this._syncDialogueRanges();
    this._captureDialogueCenter();
    // 在某些流程中，可能未切换 control state，这里确保相机更新开启
    this._isEnabled = true;
  };
  this._onDialogueEnd = () => {
    this._dialogueMode = false;
  };
  this.app.on('ui:dialogue:begin', this._onDialogueBegin, this);
  this.app.on('ui:dialogue:end', this._onDialogueEnd, this);

  // 监听移动端相机旋转事件（带平滑处理）
  this._onMobileCameraRotate = (data) => {
    if (!this._isEnabled) {
      if (this.enableDebugLog) console.log('[FollowCamera] Mobile rotate ignored: not enabled');
      return;
    }
    if (data && (data.dx || data.dy)) {
      // 平滑触摸输入，避免抖动
      this._smoothedDx = this._smoothedDx * (1 - this._touchSmoothFactor) + (data.dx || 0) * this._touchSmoothFactor;
      this._smoothedDy = this._smoothedDy * (1 - this._touchSmoothFactor) + (data.dy || 0) * this._touchSmoothFactor;
      
      if (this.enableDebugLog) console.log('[FollowCamera] Mobile rotate:', data.dx, data.dy, 'smoothed:', this._smoothedDx.toFixed(2), this._smoothedDy.toFixed(2));
      // 移动端反转 dy：向下滑 → 俯视
      this._applyRotation(this._smoothedDx, -this._smoothedDy);
    }
  };
  this.app.on('mobile:camera:rotate', this._onMobileCameraRotate, this);

  // 预分配临时向量
  this._vOffset = new pc.Vec3();
  this._anchor = new pc.Vec3();
  this._ideal = new pc.Vec3();
  this._final = new pc.Vec3();
  this._dir   = new pc.Vec3();
  this._safe  = new pc.Vec3();

  // —— Touch 旋转支持（新增）——
  this._touchRotId = null;       // 当前用于镜头旋转的手指 id
  this._touchLastX = 0;
  this._touchLastY = 0;

  if (this.app.touch && this.enableTouchRotate) {
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove  = this._handleTouchMove.bind(this);
    this._onTouchEnd   = this._handleTouchEnd.bind(this);
    this.app.touch.on(pc.EVENT_TOUCHSTART, this._onTouchStart, this);
    this.app.touch.on(pc.EVENT_TOUCHMOVE,  this._onTouchMove,  this);
    this.app.touch.on(pc.EVENT_TOUCHEND,   this._onTouchEnd,   this);
    this.app.touch.on(pc.EVENT_TOUCHCANCEL,this._onTouchEnd,   this);
  }

  // 当前实际距离（用于碰撞时的平滑调整）
  this._currentDistance = this._distance;
  
  if (this.enableDebugLog) {
    console.log('[FollowCamera] 基于射线的碰撞检测已启用');
  }

  // FOV
  if (this.entity.camera) this.entity.camera.fov = this.fov;
};

FollowCamera.prototype.update = function (dt) {
  if (!this._isEnabled || !this.targetEntity) return;

  // 由 yaw/pitch/distance 计算相对偏移（右手系，-Z前）
  var yawRad = this._yaw * Math.PI / 180;
  var pitchRad = this._pitch * Math.PI / 180;
  var cosP = Math.cos(pitchRad), sinP = Math.sin(pitchRad);
  var sinY = Math.sin(yawRad),   cosY = Math.cos(yawRad);

  // 使用当前实际距离（考虑碰撞调整）
  var actualDistance = this._currentDistance;
  
  this._vOffset.set(
    actualDistance * sinY * cosP,
    actualDistance * sinP,  // pitch正值 = 相机升高 = 向下看玩家
    actualDistance * cosY * cosP
  );

  // 锚点 = 目标位置 + UI 配置的偏移（抬高/平移观察中心）
  this._anchor.copy(this.targetEntity.getPosition()).add(this.offset);

  // 理想机位
  this._ideal.copy(this._anchor).add(this._vOffset);

  // 防穿墙：找到“目标→理想机位”路径上**最近的有效 solid**，把相机放到命中点前 safetyDistance
  if (this.enableCollision) {
    var safeDistance = this._raycastSafeDistance(this._anchor, this._ideal, this._distance);
    var isColliding = safeDistance < this._distance - 0.01;
    
    if (isColliding) {
      var smoothSpeed = this.smoothFactor * 5;
      this._currentDistance = pc.math.lerp(this._currentDistance, safeDistance, Math.min(1, smoothSpeed * dt));
    } else {
      var recoverSpeed = this.smoothFactor * 2;
      this._currentDistance = pc.math.lerp(this._currentDistance, this._distance, Math.min(1, recoverSpeed * dt));
    }
    
    this._vOffset.set(this._currentDistance * sinY * cosP, this._currentDistance * sinP, this._currentDistance * cosY * cosP);
    this._final.copy(this._anchor).add(this._vOffset);
  } else {
    this._currentDistance = this._distance;
    this._final.copy(this._ideal);
  }

  // 平滑位置（移动端优化：使用指数平滑，避免抖动）
  var cur = this.entity.getPosition();
  var k = 1 - Math.exp(-this.smoothFactor * dt);
  k = Math.min(1, k);
  cur.lerp(cur, this._final, k);
  this.entity.setPosition(cur);

  // 朝向锚点
  this.entity.lookAt(this._anchor);

  // FOV 同步
  if (this.entity.camera && this.entity.camera.fov !== this.fov) {
    this.entity.camera.fov = this.fov;
  }
};

// ---------- 启用/禁用 ----------
FollowCamera.prototype.enable = function () {
  this._isEnabled = true;
};

FollowCamera.prototype.disable = function () {
  this._isEnabled = false;
  // 退出指针锁，防止在锁定机位时仍可鼠标操控
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  this._pointerLocked = false;
};

// ---------- 射线检测计算安全距离 ----------
FollowCamera.prototype._raycastSafeDistance = function (from, to, idealDistance) {
  if (!this.app.systems || !this.app.systems.rigidbody) return idealDistance;
  
  var dir = this._dir.copy(to).sub(from);
  var dist = dir.length();
  if (dist <= 1e-4) return idealDistance;
  dir.scale(1 / dist);
  
  var result = this.app.systems.rigidbody.raycastFirst(from, to);
  
  if (result) {
    var hitEntity = result.entity;
    
    // 仅忽略玩家自身
    if (this.ignoreSelf && this._isInSubtree(hitEntity, this.targetEntity)) {
      return idealDistance;
    }
    
    // 所有其他物体都参与碰撞检测（移除了碰撞组过滤）
    var hitPoint = result.point;
    var hitDistance = hitPoint.distance(from);
    var safeDistance = Math.max(this.minDistance, hitDistance - this.safetyDistance);
    
    if (this.enableDebugLog) {
      console.log('[FollowCamera] 射线检测:', hitEntity.name, '碰撞距离:', hitDistance.toFixed(2), '安全距离:', safeDistance.toFixed(2));
    }
    
    return safeDistance;
  }
  
  return idealDistance;
};

// ---------- 碰撞 / 贴近最近 solid ----------
// from = 锚点(玩家)；to = 理想相机位；outPos = 计算后的安全机位
FollowCamera.prototype._computeCollisionSafePosition = function (from, to, outPos) {
  // 默认用理想位
  outPos.copy(to);

  // 确保场景里真的有物理体；否则直接返回
  if (!this.app.systems || !this.app.systems.rigidbody) return;

  var results = [];
  var dir = this._dir.copy(to).sub(from);
  var dist = dir.length();
  if (dist <= 1e-4) return;
  dir.scale(1 / dist); // 归一化

  // --- 关键 1：把起止点都往外“退”一点，避免起点/终点刚好在体内 ---
  var eps = 0.06; // 起点/终点缩进（可调）
  var from2 = this._tmpFrom || (this._tmpFrom = new pc.Vec3());
  var to2   = this._tmpTo   || (this._tmpTo   = new pc.Vec3());
  from2.copy(from).add(dir.clone().scale(eps));                // 锚点沿相机方向前进一点
  to2.copy(to).sub(dir.clone().scale(Math.min(eps, dist*0.5)));// 相机位后退一点

  // --- 关键 2：双向 raycastAll，并做过滤/取最近 ---
  var nearest = null, nearestDist = Infinity;

  var pickNearest = (list, a, b) => {
    for (var i = 0; i < list.length; i++) {
      var r = list[i], ent = r.entity;
      // 忽略玩家自身子树
      if (this.ignoreSelf && this._isInSubtree(ent, this.targetEntity)) continue;
      // 需要是有效 solid（有 collision 并且 enabled，且不是 trigger）
      if (!ent.collision || !ent.collision.enabled) continue;
      // 按组过滤（可选）
      if (this.collisionMask != null && this.collisionMask !== 0xffffffff) {
        var grp = ent.collision.group || 0;
        if ((grp & this.collisionMask) === 0) continue;
      }
      var p = r.point || r.hitPoint; if (!p) continue;
      var d = p.distance(a);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }
  };

  results.length = 0;
  this.app.systems.rigidbody.raycastAll(from2, to2, results);
  pickNearest(results, from2, to2);

  results.length = 0;
  this.app.systems.rigidbody.raycastAll(to2, from2, results);  // 反向再打一遍
  pickNearest(results, to2, from2);

  if (!nearest) return; // 仍然没有命中：要么真的没 collider，要么都被过滤掉

  // 命中：把相机放到命中点前 safetyDistance
  var safe = this._safe.copy(nearest).sub(dir.clone().scale(this.safetyDistance));

  // 距离下限
  var dToAnchor = safe.distance(from);
  if (dToAnchor < this.minDistance) {
    var n = safe.clone().sub(from).normalize();
    safe.copy(from).add(n.scale(this.minDistance));
  }

  outPos.copy(safe);
};

// ---------- 工具：判断 ent 是否在 target 子树内（正确的“忽略自己”） ----------
FollowCamera.prototype._isInSubtree = function (ent, root) {
  var cur = ent;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parent;
  }
  return false;
};


// ---------- 鼠标控制 ----------
FollowCamera.prototype.onMouseDown = function (e) {
  if (!this._isEnabled) return;
  // 仅在自由跟随时申请 pointer lock；对话模式不锁定指针
  if (!this._dialogueMode && this._currentControl === 'free_follow' && e.button === pc.MOUSEBUTTON_LEFT && this.canvas && this.canvas.requestPointerLock) {
    try {
      this.canvas.requestPointerLock();
    } catch (err) {
      // 忽略 SecurityError（用户刚退出锁定）
      if (err.name !== 'SecurityError') {
        console.warn('[FollowCamera] requestPointerLock failed:', err);
      }
    }
  }
};

// 从GameManager加载鼠标设置
FollowCamera.prototype._loadMouseSettings = function () {
  try {
    if (typeof GameManager !== 'undefined' && GameManager.getInstance) {
      var gm = GameManager.getInstance();
      if (gm && gm.getSettings) {
        var settings = gm.getSettings();
        if (settings) {
          this._sensitivityMultiplier = settings.mouseSensitivity || 1.0;
          this._invertY = settings.invertY || false;
          
          if (this.enableDebugLog) {
            console.log('[FollowCamera] Loaded settings - sensitivity:', this._sensitivityMultiplier, 'invertY:', this._invertY);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[FollowCamera] Failed to load mouse settings:', e);
  }
};

// 通用旋转方法（供鼠标和移动端调用）
// pitch定义：正值=相机升高(俯视)，负值=相机降低(仰视)
// 鼠标向下(dy>0) → pitch减小 → 相机降低 → 仰视玩家
FollowCamera.prototype._applyRotation = function (dx, dy) {
  // 应用灵敏度倍数和反转Y轴
  var sensitivity = this.mouseSensitivity * (this._sensitivityMultiplier || 1.0);
  var dyFinal = this._invertY ? -dy : dy; // 反转Y轴
  
  if (this._dialogueMode) {
    // 对话模式：无需 pointer lock，也允许改变角度
    this._yaw   -= dx * sensitivity;
    this._pitch -= dyFinal * sensitivity; // 鼠标向下 → pitch减小 → 仰视

    // 以中心为基准做夹角限制
    var yaw = this._normalizeAngle(this._yaw);
    var cy = this._normalizeAngle(this._dialogueCenterYaw);
    var dy2 = this._shortestAngleDelta(cy, yaw);
    dy2 = pc.math.clamp(dy2, -this._dialogueYawRange, this._dialogueYawRange);
    this._yaw = this._normalizeAngle(cy + dy2);

    var cp = this._dialogueCenterPitch;
    var dp = this._pitch - cp;
    dp = pc.math.clamp(dp, -this._dialoguePitchRange, this._dialoguePitchRange);
    this._pitch = pc.math.clamp(cp + dp, this.minPitch, this.maxPitch);
    return;
  }
  
  // 自由跟随模式
  this._yaw   -= dx * sensitivity;
  this._pitch -= dyFinal * sensitivity; // 鼠标向下 → pitch减小 → 仰视

  // 归一/限制
  this._yaw = ((this._yaw % 360) + 360) % 360; // [0,360)
  if (this._yaw > 180) this._yaw -= 360;       // (-180,180]
  this._pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this._pitch));
};

FollowCamera.prototype.onMouseMove = function (e) {
  if (!this._isEnabled) return;
  // 对话模式不需要 pointer lock
  if (this._dialogueMode) {
    this._applyRotation(e.dx, e.dy);
    return;
  }
  // 自由跟随：需要 pointer lock
  if (!this._pointerLocked) return;
  this._applyRotation(e.dx, e.dy);
};

FollowCamera.prototype.onMouseWheel = function (e) {
  if (!this._isEnabled) return;
  var delta = (e.wheelDelta ? -e.wheelDelta : e.deltaY) * 0.01 * this.zoomSensitivity;
  this._distance = pc.math.clamp(this._distance + delta, this.minDistance, this.maxDistance);
};


// ---------- 清理 ----------
FollowCamera.prototype.destroy = function () {
  if (this.app && this.app.mouse) {
    this.app.mouse.off(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    this.app.mouse.off(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
    this.app.mouse.off(pc.EVENT_MOUSEWHEEL, this.onMouseWheel, this);
  }
  if (this.app && this._onMobileCameraRotate) {
    this.app.off('mobile:camera:rotate', this._onMobileCameraRotate, this);
  }
  // 触摸解绑（新增）
  if (this.app && this.app.touch) {
    if (this._onTouchStart) this.app.touch.off(pc.EVENT_TOUCHSTART, this._onTouchStart, this);
    if (this._onTouchMove)  this.app.touch.off(pc.EVENT_TOUCHMOVE,  this._onTouchMove,  this);
    if (this._onTouchEnd)   this.app.touch.off(pc.EVENT_TOUCHEND,   this._onTouchEnd,   this);
    if (this._onTouchEnd)   this.app.touch.off(pc.EVENT_TOUCHCANCEL,this._onTouchEnd,   this);
  }
  if (this.app && this._onUiControlChanged) {
    this.app.off('ui:control_state_changed', this._onUiControlChanged, this);
    this._onUiControlChanged = null;
  }
  if (this.app && this._onDialogueBegin) {
    this.app.off('ui:dialogue:begin', this._onDialogueBegin, this);
    this._onDialogueBegin = null;
  }
  // 解绑设置变化事件
  if (this.app && this._onMouseSensitivityChanged) {
    this.app.off('input:mouse_sensitivity:changed', this._onMouseSensitivityChanged, this);
    this._onMouseSensitivityChanged = null;
  }
  if (this.app && this._onInvertYChanged) {
    this.app.off('input:invert_y:changed', this._onInvertYChanged, this);
    this._onInvertYChanged = null;
  }
  if (this.app && this._onDialogueEnd) {
    this.app.off('ui:dialogue:end', this._onDialogueEnd, this);
    this._onDialogueEnd = null;
  }
  if (this._onPointerLockChange) {
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this._onPointerLockChange = null;
  }
};

// —— 工具：判断触点是否在可用触摸区域（新增）——
FollowCamera.prototype._isTouchInRotateZone = function (touch) {
  if (this.touchZone === 'full') return true;
  // 默认 right：画布右半屏
  var canvas = this.app.graphicsDevice.canvas;
  var halfX = canvas.clientWidth ? canvas.clientWidth / 2 : canvas.width / 2;
  // touch.x / touch.y 是相对画布的坐标（PlayCanvas 已处理）
  return touch.x >= halfX;
};

// —— TouchStart：选定"控制镜头"的那根手指（新增）——
FollowCamera.prototype._handleTouchStart = function (e) {
  if (!this._isEnabled) return;
  // 对话模式和自由模式都允许旋转（自由模式等于鼠标拖动）
  var touches = e.touches;
  for (var i = 0; i < touches.length; i++) {
    var t = touches[i];
    if (this._touchRotId == null && this._isTouchInRotateZone(t)) {
      this._touchRotId = t.id;
      this._touchLastX = t.x;
      this._touchLastY = t.y;
      // 防止页面滚动
      if (e.event && e.event.preventDefault) e.event.preventDefault();
      break;
    }
  }
};

// —— TouchMove：把位移转为 dx/dy 调用 _applyRotation（新增）——
FollowCamera.prototype._handleTouchMove = function (e) {
  if (!this._isEnabled || this._touchRotId == null) return;
  var touches = e.touches;
  for (var i = 0; i < touches.length; i++) {
    var t = touches[i];
    if (t.id === this._touchRotId) {
      var dx = t.x - this._touchLastX;
      var dy = t.y - this._touchLastY;

      // 死区过滤，避免微抖
      var dead = this.touchDeadZone || 0;
      if (Math.abs(dx) < dead) dx = 0;
      if (Math.abs(dy) < dead) dy = 0;

      if (dx !== 0 || dy !== 0) {
        // 触摸灵敏度缩放（在鼠标敏感度基础上乘一个系数）
        var scale = this.touchSensitivityScale || 1.0;
        // 移动端反转 dy：向下滑(dy>0) → 传入负值 → pitch增大 → 俯视
        // 走统一的旋转入口（内含对话与自由模式的夹角限制）
        this._applyRotation(dx * scale, -dy * scale);  // 注意这里 dy 取反
      }

      this._touchLastX = t.x;
      this._touchLastY = t.y;

      if (e.event && e.event.preventDefault) e.event.preventDefault();
      break;
    }
  }
};

// —— TouchEnd/Cancel：释放控制权（新增）——
FollowCamera.prototype._handleTouchEnd = function (e) {
  if (this._touchRotId == null) return;
  var touches = e.changedTouches || e.touches || [];
  for (var i = 0; i < touches.length; i++) {
    if (touches[i].id === this._touchRotId) {
      this._touchRotId = null;
      if (e.event && e.event.preventDefault) e.event.preventDefault();
      break;
    }
  }
};

// ---------- 工具：角度工具与对话范围同步 ----------
FollowCamera.prototype._normalizeAngle = function (a) {
  a = ((a % 360) + 360) % 360; if (a > 180) a -= 360; return a;
};

FollowCamera.prototype._shortestAngleDelta = function (fromDeg, toDeg) {
  var a = this._normalizeAngle(toDeg) - this._normalizeAngle(fromDeg);
  a = ((a + 540) % 360) - 180; // 映射到 [-180,180)
  return a;
};

FollowCamera.prototype._captureDialogueCenter = function () {
  this._dialogueCenterYaw = this._normalizeAngle(this._yaw);
  this._dialogueCenterPitch = this._pitch;
};

FollowCamera.prototype._syncDialogueRanges = function () {
  // 从 UIManager 单例读取可配置范围，若不可用则使用默认
  try {
    var UIM = (typeof UIManager !== 'undefined') ? UIManager.getInstance && UIManager.getInstance() : null;
    if (UIM) {
      if (typeof UIM.dialogueYawRange === 'number') this._dialogueYawRange = Math.max(0, UIM.dialogueYawRange|0);
      if (typeof UIM.dialoguePitchRange === 'number') this._dialoguePitchRange = Math.max(0, UIM.dialoguePitchRange|0);
    }
  } catch (e) {}
};
