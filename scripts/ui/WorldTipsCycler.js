/* global pc */

/**
 * @file WorldTipsCycler.js
 * @desc 世界提示文字循环器：控制Text Element淡入淡出，循环显示world-tips的i18n键
 * @pc-attrs
 *   fadeInDuration:number=1.0 - 淡入时长（秒）
 *   displayDuration:number=5.0 - 显示时长（秒）
 *   fadeOutDuration:number=1.0 - 淡出时长（秒）
 *   pauseDuration:number=0.5 - 两条提示之间的停顿时长（秒）
 *   i18nCategory:string='world-tips' - i18n分类名
 *   autoStart:boolean=true - 是否自动开始
 *   enableDebugLog:boolean=false - 调试日志
 * 
 * 使用方法：
 * 1. 在PlayCanvas Editor中，将此脚本挂载到Text Element实体上
 * 2. 确保i18n中有world-tips分类，包含tip_1, tip_2, tip_3等键
 * 3. 设置淡入淡出和显示时长
 * 4. 脚本会自动循环显示所有提示
 */

var WorldTipsCycler = pc.createScript('worldTipsCycler');

// ----- 属性 -----
WorldTipsCycler.attributes.add('fadeInDuration', {
    type: 'number',
    default: 1.0,
    title: '淡入时长(秒)',
    description: '文字从透明到不透明的时长'
});

WorldTipsCycler.attributes.add('displayDuration', {
    type: 'number',
    default: 5.0,
    title: '显示时长(秒)',
    description: '文字完全显示的停留时长'
});

WorldTipsCycler.attributes.add('fadeOutDuration', {
    type: 'number',
    default: 1.0,
    title: '淡出时长(秒)',
    description: '文字从不透明到透明的时长'
});

WorldTipsCycler.attributes.add('pauseDuration', {
    type: 'number',
    default: 0.5,
    title: '停顿时长(秒)',
    description: '两条提示之间的停顿时长'
});

WorldTipsCycler.attributes.add('i18nCategory', {
    type: 'string',
    default: 'world-tips',
    title: 'i18n分类名',
    description: '从i18n中读取的分类名称'
});

WorldTipsCycler.attributes.add('autoStart', {
    type: 'boolean',
    default: true,
    title: '自动开始',
    description: '脚本初始化时自动开始循环'
});

WorldTipsCycler.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

// ----- 初始化 -----
WorldTipsCycler.prototype.initialize = function () {
    // 检查是否挂载到Text Element上
    if (!this.entity.element || this.entity.element.type !== pc.ELEMENTTYPE_TEXT) {
        console.error('[WorldTipsCycler] This script must be attached to a Text Element entity!');
        return;
    }

    // 状态
    this._state = 'idle'; // idle|fadeIn|display|fadeOut|pause
    this._currentIndex = 0;
    this._timer = 0;
    this._isRunning = false;
    this._tipKeys = [];

    // 初始透明度为0
    this.entity.element.opacity = 0;

    // 等待i18n就绪后加载提示列表
    var self = this;
    if (typeof I18n !== 'undefined' && I18n.isReady && I18n.isReady()) {
        this._loadTipKeys();
        if (this.autoStart) {
            this.start();
        }
    } else {
        this.app.once('i18n:ready', function () {
            self._loadTipKeys();
            if (self.autoStart) {
                self.start();
            }
        });
    }

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Initialized on entity:', this.entity.name);
    }
};

// ----- 从i18n加载提示键列表 -----
WorldTipsCycler.prototype._loadTipKeys = function () {
    this._tipKeys = [];

    try {
        if (typeof I18n === 'undefined' || !I18n.get) {
            console.warn('[WorldTipsCycler] I18n not available');
            return;
        }

        var category = I18n.get(this.i18nCategory);
        if (!category) {
            console.warn('[WorldTipsCycler] i18n category not found:', this.i18nCategory);
            return;
        }

        // 收集所有tip_开头的键
        for (var key in category) {
            if (key.indexOf('tip_') === 0) {
                this._tipKeys.push(key);
            }
        }

        // 按键名排序（tip_1, tip_2, tip_3...）
        this._tipKeys.sort();

        if (this.enableDebugLog) {
            console.log('[WorldTipsCycler] Loaded tip keys:', this._tipKeys);
        }

        if (this._tipKeys.length === 0) {
            console.warn('[WorldTipsCycler] No tips found in category:', this.i18nCategory);
        }
    } catch (e) {
        console.error('[WorldTipsCycler] Failed to load tip keys:', e);
    }
};

// ----- 公共API：开始循环 -----
WorldTipsCycler.prototype.start = function () {
    if (this._isRunning) {
        if (this.enableDebugLog) {
            console.log('[WorldTipsCycler] Already running');
        }
        return;
    }

    if (this._tipKeys.length === 0) {
        console.warn('[WorldTipsCycler] No tips to display');
        return;
    }

    this._isRunning = true;
    this._currentIndex = 0;
    this._startFadeIn();

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Started cycling tips');
    }
};

// ----- 公共API：停止循环 -----
WorldTipsCycler.prototype.stop = function () {
    this._isRunning = false;
    this._state = 'idle';
    this._timer = 0;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Stopped');
    }
};

// ----- 公共API：暂停/恢复 -----
WorldTipsCycler.prototype.pause = function () {
    this._isRunning = false;
};

WorldTipsCycler.prototype.resume = function () {
    if (this._tipKeys.length > 0) {
        this._isRunning = true;
    }
};

// ----- 状态机：淡入 -----
WorldTipsCycler.prototype._startFadeIn = function () {
    if (!this._isRunning || this._tipKeys.length === 0) return;

    // 设置当前提示文字
    var tipKey = this._tipKeys[this._currentIndex];
    var tipText = '';
    
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            var category = I18n.get(this.i18nCategory);
            if (category && category[tipKey]) {
                tipText = category[tipKey];
            }
        }
    } catch (e) {
        console.error('[WorldTipsCycler] Failed to get tip text:', e);
    }

    if (!tipText) {
        tipText = 'Tip ' + (this._currentIndex + 1);
    }

    this.entity.element.text = tipText;
    this.entity.element.opacity = 0;

    this._state = 'fadeIn';
    this._timer = 0;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] FadeIn started, index:', this._currentIndex, 'text:', tipText);
    }
};

// ----- 状态机：显示 -----
WorldTipsCycler.prototype._startDisplay = function () {
    this.entity.element.opacity = 1;
    this._state = 'display';
    this._timer = 0;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Display started');
    }
};

// ----- 状态机：淡出 -----
WorldTipsCycler.prototype._startFadeOut = function () {
    this._state = 'fadeOut';
    this._timer = 0;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] FadeOut started');
    }
};

// ----- 状态机：停顿 -----
WorldTipsCycler.prototype._startPause = function () {
    this.entity.element.opacity = 0;
    this._state = 'pause';
    this._timer = 0;

    // 切换到下一个提示
    this._currentIndex = (this._currentIndex + 1) % this._tipKeys.length;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Pause started, next index:', this._currentIndex);
    }
};

// ----- Update：状态机驱动 -----
WorldTipsCycler.prototype.update = function (dt) {
    if (!this._isRunning || !this.entity.element) return;

    this._timer += dt;

    switch (this._state) {
        case 'fadeIn':
            this._updateFadeIn(dt);
            break;
        case 'display':
            this._updateDisplay(dt);
            break;
        case 'fadeOut':
            this._updateFadeOut(dt);
            break;
        case 'pause':
            this._updatePause(dt);
            break;
    }
};

WorldTipsCycler.prototype._updateFadeIn = function (dt) {
    var progress = Math.min(1, this._timer / Math.max(0.001, this.fadeInDuration));
    this.entity.element.opacity = progress;

    if (progress >= 1) {
        this._startDisplay();
    }
};

WorldTipsCycler.prototype._updateDisplay = function (dt) {
    if (this._timer >= this.displayDuration) {
        this._startFadeOut();
    }
};

WorldTipsCycler.prototype._updateFadeOut = function (dt) {
    var progress = Math.min(1, this._timer / Math.max(0.001, this.fadeOutDuration));
    this.entity.element.opacity = 1 - progress;

    if (progress >= 1) {
        this._startPause();
    }
};

WorldTipsCycler.prototype._updatePause = function (dt) {
    if (this._timer >= this.pauseDuration) {
        this._startFadeIn();
    }
};

// ----- 公共API：设置提示键列表（手动指定，不从i18n加载）-----
WorldTipsCycler.prototype.setTipKeys = function (keys) {
    if (!Array.isArray(keys)) {
        console.error('[WorldTipsCycler] setTipKeys requires an array');
        return;
    }

    this._tipKeys = keys.slice();
    this._currentIndex = 0;

    if (this.enableDebugLog) {
        console.log('[WorldTipsCycler] Tip keys manually set:', this._tipKeys);
    }
};

// ----- 公共API：获取当前提示索引 -----
WorldTipsCycler.prototype.getCurrentIndex = function () {
    return this._currentIndex;
};

// ----- 公共API：跳转到指定提示 -----
WorldTipsCycler.prototype.goToIndex = function (index) {
    if (index < 0 || index >= this._tipKeys.length) {
        console.warn('[WorldTipsCycler] Invalid index:', index);
        return;
    }

    this._currentIndex = index;
    if (this._isRunning) {
        this._startFadeIn();
    }
};

// ----- 清理 -----
WorldTipsCycler.prototype.destroy = function () {
    this.stop();
};
