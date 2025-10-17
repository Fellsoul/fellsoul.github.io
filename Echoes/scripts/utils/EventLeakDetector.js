/* global pc */

/**
 * @file EventLeakDetector.js
 * @desc 事件监听器泄漏检测工具：诊断场景切换时的内存泄漏问题
 * 
 * 使用方法：
 * 1. 将此脚本挂载到任意持久化实体上（不会被场景切换销毁的实体）
 * 2. 启用 enableDebugLog = true
 * 3. 切换场景并查看控制台输出
 * 4. 检查是否有事件监听器数量持续增长
 */

var EventLeakDetector = pc.createScript('eventLeakDetector');

EventLeakDetector.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: true,
    title: '启用调试日志'
});

EventLeakDetector.attributes.add('checkInterval', {
    type: 'number',
    default: 5.0,
    title: '检查间隔（秒）'
});

EventLeakDetector.prototype.initialize = function () {
    this._timer = 0;
    this._lastCounts = {};
    
    console.log('[EventLeakDetector] Initialized - monitoring event listeners...');
    
    // 监听场景切换
    var self = this;
    this._onSceneChange = function () {
        console.log('[EventLeakDetector] ===== Scene changing =====');
        self._checkEventListeners('Before Scene Change');
    };
    this.app.on('scene:beforeunload', this._onSceneChange, this);
};

EventLeakDetector.prototype.update = function (dt) {
    this._timer += dt;
    
    if (this._timer >= this.checkInterval) {
        this._timer = 0;
        this._checkEventListeners('Periodic Check');
    }
};

EventLeakDetector.prototype._checkEventListeners = function (label) {
    if (!this.enableDebugLog) return;
    
    console.log('[EventLeakDetector] ===== ' + label + ' =====');
    
    // 检查关键事件的监听器数量
    var events = [
        'player:set_sitting',
        'player:respawn',
        'ui:dialogue:begin',
        'ui:dialogue:end',
        'ui:control_state_changed',
        'player:die',
        'mobile:joystick:move',
        'mobile:jump'
    ];
    
    var counts = {};
    var hasLeak = false;
    
    for (var i = 0; i < events.length; i++) {
        var eventName = events[i];
        var count = this._getListenerCount(eventName);
        counts[eventName] = count;
        
        // 检查是否有增长
        if (this._lastCounts[eventName] && count > this._lastCounts[eventName]) {
            console.warn('[EventLeakDetector] ⚠️ LEAK DETECTED:', eventName, 
                'count increased from', this._lastCounts[eventName], 'to', count);
            hasLeak = true;
        }
        
        console.log('[EventLeakDetector]', eventName + ':', count, 'listeners');
    }
    
    this._lastCounts = counts;
    
    if (hasLeak) {
        console.error('[EventLeakDetector] ❌ Memory leak detected! Some event listeners are not being cleaned up.');
    } else {
        console.log('[EventLeakDetector] ✓ No leaks detected in this check');
    }
    
    // 检查实体数量
    this._checkEntityCounts();
};

EventLeakDetector.prototype._getListenerCount = function (eventName) {
    try {
        // 尝试访问 PlayCanvas 内部的事件回调
        if (this.app._callbacks && this.app._callbacks.has(eventName)) {
            var callbacks = this.app._callbacks.get(eventName);
            return callbacks ? callbacks.length : 0;
        }
    } catch (e) {
        // 如果无法访问内部结构，返回 -1
        return -1;
    }
    return 0;
};

EventLeakDetector.prototype._checkEntityCounts = function () {
    try {
        // 统计关键实体数量
        var entities = {
            'UIManager': this.app.root.findByName('UIManager'),
            'GameManager': this.app.root.findByName('GameManager'),
            'DeathController': this.app.root.findByName('DeathController'),
            'Player': this.app.root.findByTag('player')
        };
        
        console.log('[EventLeakDetector] Entity counts:');
        for (var name in entities) {
            var entity = entities[name];
            var count = 0;
            
            if (Array.isArray(entity)) {
                count = entity.length;
            } else if (entity) {
                count = 1;
            }
            
            console.log('[EventLeakDetector]  -', name + ':', count);
            
            if (count > 1 && name !== 'Player') {
                console.warn('[EventLeakDetector] ⚠️ Multiple instances of', name, 'detected!');
            }
        }
    } catch (e) {
        console.error('[EventLeakDetector] Failed to check entity counts:', e);
    }
};

// 公共API：手动触发检查
EventLeakDetector.prototype.checkNow = function () {
    this._checkEventListeners('Manual Check');
};

// 公共API：重置计数器（场景切换后调用）
EventLeakDetector.prototype.reset = function () {
    console.log('[EventLeakDetector] Resetting counters...');
    this._lastCounts = {};
};

EventLeakDetector.prototype.destroy = function () {
    if (this.app && this._onSceneChange) {
        this.app.off('scene:beforeunload', this._onSceneChange, this);
    }
    console.log('[EventLeakDetector] Destroyed');
};
