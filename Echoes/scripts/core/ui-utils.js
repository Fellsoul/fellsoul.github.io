/* global pc */

/**
 * @file ui-utils.js
 * @desc PlayCanvas UI 工具函数集合（全局模块）
 * 提供坐标转换、边界检测等常用功能
 */
var UIUtils = (function () {
    'use strict';

    /**
     * 获取 UI Element 的屏幕坐标边界
     * @param {pc.Entity} entity - UI 实体
     * @returns {Object|null} 返回 { minX, maxX, minY, maxY, centerX, centerY, width, height } 或 null
     */
    function getElementScreenBounds(entity) {
        if (!entity || !entity.element) return null;

        var el = entity.element;
        var corners = el.screenCorners;

        if (!corners || corners.length < 4) return null;

        var minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
        var maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
        var minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
        var maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);

        return {
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * 获取 UI Element 的屏幕中心坐标
     * @param {pc.Entity} entity - UI 实体
     * @returns {pc.Vec2|null} 返回屏幕中心坐标或 null
     */
    function getElementScreenCenter(entity) {
        var bounds = getElementScreenBounds(entity);
        if (!bounds) return null;
        return new pc.Vec2(bounds.centerX, bounds.centerY);
    }

    /**
     * 检查屏幕坐标点是否在 UI Element 内
     * @param {pc.Vec2} screenPos - 屏幕坐标 (x, y)
     * @param {pc.Entity} entity - UI 实体
     * @returns {boolean} 是否在元素内
     */
    function isPointInElement(screenPos, entity) {
        var bounds = getElementScreenBounds(entity);
        if (!bounds) return false;

        return screenPos.x >= bounds.minX && 
               screenPos.x <= bounds.maxX && 
               screenPos.y >= bounds.minY && 
               screenPos.y <= bounds.maxY;
    }

    /**
     * 将世界坐标转换为屏幕坐标（使用矩阵变换）
     * @param {pc.Vec3} worldPos - 世界坐标
     * @param {pc.Entity} containerEntity - 容器实体（用于获取变换矩阵）
     * @param {pc.Entity} targetEntity - 目标实体（相对于容器的本地坐标）
     * @returns {pc.Vec3} 本地坐标
     */
    function worldToLocal(worldPos, containerEntity, targetEntity) {
        if (!containerEntity || !targetEntity) return worldPos.clone();

        // 获取目标的世界变换矩阵
        var worldTransform = targetEntity.getWorldTransform();
        var world = new pc.Vec3();
        worldTransform.transformPoint(worldPos, world);

        // 转换为容器的本地坐标
        var inv = new pc.Mat4();
        inv.copy(containerEntity.getWorldTransform()).invert();
        var local = new pc.Vec3();
        inv.transformPoint(world, local);

        return local;
    }

    /**
     * 获取触摸/鼠标事件的屏幕坐标
     * @param {Object} touch - PlayCanvas 触摸对象或鼠标事件
     * @returns {pc.Vec2} 屏幕坐标
     */
    function getTouchScreenPosition(touch) {
        return new pc.Vec2(touch.x, touch.y);
    }

    /**
     * 计算两个屏幕坐标点之间的距离
     * @param {pc.Vec2} pos1 - 第一个点
     * @param {pc.Vec2} pos2 - 第二个点
     * @returns {number} 距离
     */
    function getScreenDistance(pos1, pos2) {
        var dx = pos2.x - pos1.x;
        var dy = pos2.y - pos1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * 将屏幕坐标限制在圆形范围内
     * @param {pc.Vec2} pos - 当前位置
     * @param {pc.Vec2} center - 圆心
     * @param {number} radius - 半径
     * @returns {pc.Vec2} 限制后的位置
     */
    function clampToCircle(pos, center, radius) {
        var dx = pos.x - center.x;
        var dy = pos.y - center.y;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
            return pos.clone();
        }

        var ratio = radius / distance;
        return new pc.Vec2(
            center.x + dx * ratio,
            center.y + dy * ratio
        );
    }

    /**
     * 将屏幕坐标限制在矩形范围内
     * @param {pc.Vec2} pos - 当前位置
     * @param {Object} bounds - 边界 { minX, maxX, minY, maxY }
     * @returns {pc.Vec2} 限制后的位置
     */
    function clampToRect(pos, bounds) {
        return new pc.Vec2(
            Math.max(bounds.minX, Math.min(bounds.maxX, pos.x)),
            Math.max(bounds.minY, Math.min(bounds.maxY, pos.y))
        );
    }

    /**
     * 线性插值两个屏幕坐标
     * @param {pc.Vec2} from - 起始位置
     * @param {pc.Vec2} to - 目标位置
     * @param {number} t - 插值因子 (0~1)
     * @returns {pc.Vec2} 插值后的位置
     */
    function lerpScreenPos(from, to, t) {
        t = Math.max(0, Math.min(1, t));
        return new pc.Vec2(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t
        );
    }

    /**
     * 获取 UI Element 的实际尺寸（像素）
     * @param {pc.Entity} entity - UI 实体
     * @returns {Object|null} 返回 { width, height } 或 null
     */
    function getElementSize(entity) {
        if (!entity || !entity.element) return null;

        var el = entity.element;
        return {
            width: el.calculatedWidth || el.width || 0,
            height: el.calculatedHeight || el.height || 0
        };
    }

    /**
     * 检查两个 UI 元素是否重叠
     * @param {pc.Entity} entity1 - 第一个实体
     * @param {pc.Entity} entity2 - 第二个实体
     * @returns {boolean} 是否重叠
     */
    function areElementsOverlapping(entity1, entity2) {
        var bounds1 = getElementScreenBounds(entity1);
        var bounds2 = getElementScreenBounds(entity2);

        if (!bounds1 || !bounds2) return false;

        return !(bounds1.maxX < bounds2.minX || 
                 bounds1.minX > bounds2.maxX || 
                 bounds1.maxY < bounds2.minY || 
                 bounds1.minY > bounds2.maxY);
    }

    // 导出公共 API
    return {
        getElementScreenBounds: getElementScreenBounds,
        getElementScreenCenter: getElementScreenCenter,
        isPointInElement: isPointInElement,
        worldToLocal: worldToLocal,
        getTouchScreenPosition: getTouchScreenPosition,
        getScreenDistance: getScreenDistance,
        clampToCircle: clampToCircle,
        clampToRect: clampToRect,
        lerpScreenPos: lerpScreenPos,
        getElementSize: getElementSize,
        areElementsOverlapping: areElementsOverlapping
    };
})();

// 全局暴露
if (typeof window !== 'undefined') {
    window.UIUtils = UIUtils;
}
