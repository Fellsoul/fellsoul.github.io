/* global pc */
/**
 * @file camera-collision-avoider.js
 * @desc 相机碰撞检测辅助组件：为FollowCamera提供碰撞检测和安全距离计算
 * 
 * 工作原理（被动模式）：
 * 1. 提供 checkCollision(target, idealPos) 方法供FollowCamera调用
 * 2. 执行射线检测，返回安全距离
 * 3. FollowCamera负责应用位置和平滑插值
 * 
 * @pc-attrs
 *   targetEntity:entity - 相机跟随的目标（玩家）
 *   collisionRadius:number=0.3 - 碰撞检测半径（避免贴太近）
 *   raycastLayers:number[] - 射线检测的碰撞层
 *   enableDebugLog:boolean=false - 启用调试日志
 */

var CameraCollisionAvoider = pc.createScript('cameraCollisionAvoider');

// 目标实体（玩家）
CameraCollisionAvoider.attributes.add('targetEntity', {
  type: 'entity',
  title: '目标实体',
  description: '相机跟随的目标实体（通常是玩家）'
});

// 碰撞检测半径
CameraCollisionAvoider.attributes.add('collisionRadius', {
  type: 'number',
  default: 0.3,
  min: 0.1,
  max: 1,
  title: '碰撞半径',
  description: '碰撞检测的安全半径，防止相机贴太近墙壁'
});

// 射线检测层
CameraCollisionAvoider.attributes.add('raycastLayers', {
  type: 'number',
  array: true,
  default: [0], // Layer 0 = World
  title: '碰撞层',
  description: '参与碰撞检测的层ID数组'
});

// 调试开关
CameraCollisionAvoider.attributes.add('enableDebugLog', {
  type: 'boolean',
  default: false,
  title: '调试日志'
});

// ---- 生命周期 ----

CameraCollisionAvoider.prototype.initialize = function() {
  // 临时向量（复用，避免频繁new）
  this._rayStart = new pc.Vec3();
  this._rayEnd = new pc.Vec3();
  
  if (this.enableDebugLog) {
    console.log('[CameraCollisionAvoider] 碰撞检测组件初始化完成');
    console.log('[CameraCollisionAvoider] 目标:', this.targetEntity ? this.targetEntity.name : 'null');
    console.log('[CameraCollisionAvoider] 碰撞半径:', this.collisionRadius);
    console.log('[CameraCollisionAvoider] 碰撞层:', this.raycastLayers);
  }
};

// ---- 公共API（供FollowCamera调用）----

/**
 * 检查碰撞并返回安全距离
 * @param {pc.Vec3} targetPos - 目标位置（玩家）
 * @param {pc.Vec3} idealCameraPos - 理想相机位置（无碰撞时）
 * @param {number} idealDistance - 理想距离
 * @returns {number} 安全距离（如有碰撞则小于idealDistance）
 */
CameraCollisionAvoider.prototype.checkCollision = function(targetPos, idealCameraPos, idealDistance) {
  if (!targetPos || !idealCameraPos || !idealDistance) {
    if (this.enableDebugLog) {
      console.warn('[CameraCollisionAvoider] checkCollision参数无效');
    }
    return idealDistance;
  }
  
  return this._performRaycast(targetPos, idealCameraPos, idealDistance);
};

/**
 * 执行射线检测，返回安全距离
 * @private
 * @param {pc.Vec3} targetPos - 目标位置
 * @param {pc.Vec3} idealCameraPos - 理想相机位置
 * @param {number} idealDistance - 理想距离
 * @returns {number} 安全距离
 */
CameraCollisionAvoider.prototype._performRaycast = function(targetPos, idealCameraPos, idealDistance) {
  // 射线起点：目标位置
  this._rayStart.copy(targetPos);
  
  // 射线终点：理想相机位置
  this._rayEnd.copy(idealCameraPos);
  
  // 执行射线检测
  var result = this.app.systems.rigidbody.raycastFirst(this._rayStart, this._rayEnd);
  
  if (result) {
    // 检测到碰撞，检查是否在指定的碰撞层
    var hitEntity = result.entity;
    
    // 如果有碰撞层限制，检查是否匹配
    if (this.raycastLayers.length > 0) {
      var isInLayer = false;
      for (var i = 0; i < this.raycastLayers.length; i++) {
        if (hitEntity.collision && hitEntity.collision.group === this.raycastLayers[i]) {
          isInLayer = true;
          break;
        }
      }
      
      if (!isInLayer) {
        // 不在指定层，忽略碰撞
        return idealDistance;
      }
    }
    
    // 计算碰撞点到目标的距离
    var hitPoint = result.point;
    var hitDistance = hitPoint.distance(targetPos);
    
    // 减去碰撞半径，避免贴太近
    var safeDistance = Math.max(0.5, hitDistance - this.collisionRadius);
    
    if (this.enableDebugLog) {
      console.log('[CameraCollisionAvoider] 检测到碰撞:', hitEntity.name, '理想距离:', idealDistance.toFixed(2), '碰撞距离:', hitDistance.toFixed(2), '→ 安全距离:', safeDistance.toFixed(2));
    }
    
    return safeDistance;
  }
  
  // 无碰撞，返回理想距离
  return idealDistance;
};
