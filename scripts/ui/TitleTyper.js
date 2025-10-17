/* global pc, I18n */
/**
 * @file TitleTyper.js
 * @desc 标题打字机效果：逐字符/逐词淡入动画，支持多语言、对象池、自动排布
 * @pc-attrs
 *   titleGroup:entity, sampleChar:entity,
 *   align:string="center", monoSpacing:number=0, letterSpacing:number=2, maxWidth:number=0,
 *   duration:number=1.5, fadeIn:number=0.25, fadeOutDelay:number=0, fadeOut:number=0.4,
 *   yRise:number=6, splitMode:string="char", usePool:boolean=true, poolSize:number=64
 * 
 * @usage
 *   // 显示标题
 *   app.fire('title:show', 'story.chapter1.title', {
 *     duration: 1.6,
 *     fadeIn: 0.25,
 *     fadeOutDelay: 1.0,
 *     fadeOut: 0.5,
 *     align: 'center',
 *     splitMode: 'char',
 *     letterSpacing: 4
 *   });
 * 
 *   // 监听标题播放完成（包括淡出）
 *   app.on('title:complete', function(data) {
 *     console.log('标题播放完成:', data.i18nKey);
 *     // 可以在此触发下一个标题
 *   });
 * 
 * @events
 *   title:show - 触发标题显示
 *   title:complete - 标题播放完成（包括淡出），参数: { i18nKey, hasSubtitle }
 */
var TitleTyper = pc.createScript('titleTyper');

/** ===== 属性 ===== */
TitleTyper.attributes.add('titleGroup', { 
    type: 'entity', 
    title: 'Title Group（容器）' 
});

TitleTyper.attributes.add('sampleChar', { 
    type: 'entity', 
    title: 'Sample Single Text（模板）' 
});

TitleTyper.attributes.add('align', { 
    type: 'string', 
    default: 'center', 
    enum: [
        { 'Left': 'left' }, 
        { 'Center': 'center' }, 
        { 'Right': 'right' }
    ],
    title: '对齐方式'
});

TitleTyper.attributes.add('monoSpacing', { 
    type: 'number', 
    default: 0, 
    title: '等宽排布(0=关闭)' 
});

TitleTyper.attributes.add('letterSpacing', { 
    type: 'number', 
    default: 2, 
    title: '额外字距(px)' 
});

TitleTyper.attributes.add('maxWidth', { 
    type: 'number', 
    default: 0, 
    title: '最大宽度(0=不限制)' 
});

TitleTyper.attributes.add('duration', { 
    type: 'number', 
    default: 1.5, 
    title: '播放总时长(秒)' 
});

TitleTyper.attributes.add('fadeIn', { 
    type: 'number', 
    default: 0.25, 
    title: '单字淡入(秒)' 
});

TitleTyper.attributes.add('fadeOutDelay', { 
    type: 'number', 
    default: 0.0, 
    title: '整体淡出延迟(秒, 0不淡出)' 
});

TitleTyper.attributes.add('fadeOut', { 
    type: 'number', 
    default: 0.4, 
    title: '整体淡出(秒)' 
});

TitleTyper.attributes.add('yRise', { 
    type: 'number', 
    default: 6, 
    title: '淡入上飘(px)' 
});

TitleTyper.attributes.add('splitMode', { 
    type: 'string', 
    default: 'char', 
    enum: [
        { 'Character': 'char' }, 
        { 'Word': 'word' }
    ],
    title: '拆分模式'
});

TitleTyper.attributes.add('usePool', { 
    type: 'boolean', 
    default: true, 
    title: '使用对象池' 
});

TitleTyper.attributes.add('poolSize', { 
    type: 'number', 
    default: 64, 
    title: '池大小' 
});

TitleTyper.attributes.add('floatAmplitude', { 
    type: 'number', 
    default: 3, 
    title: '浮动幅度(px)' 
});

TitleTyper.attributes.add('floatSpeed', { 
    type: 'number', 
    default: 2, 
    title: '浮动速度(Hz)' 
});

TitleTyper.attributes.add('configAsset', { 
    type: 'asset', 
    assetType: 'json',
    title: 'Title 配置 JSON（可选）' 
});

/** ===== 内部状态 ===== */
TitleTyper.prototype.initialize = function () {
    this._pool = [];
    this._inUse = [];
    this._tweens = [];
    this._playing = false;
    this._floatItems = []; // 正在浮动的字符列表
    this._config = {}; // title 配置
    this._isDestroyed = false; // 销毁标志
    this._configReady = false; // 配置是否就绪

    if (this.sampleChar) this.sampleChar.enabled = false;
    if (this.usePool) this._warmPool();
    this._loadConfig();

    // 事件接口：title:show
    var self = this;
    this._onTitleShow = function (i18nKey, options) {
        self.showTitle(i18nKey, options);
    };
    this.app.on('title:show', this._onTitleShow, this);
    
    // 监听场景卸载事件，自动清理
    this._onSceneBeforeUnload = function (data) {
        self._isDestroyed = true;
        self._recycleAll();
        
        if (self.app && self._onTitleShow) {
            self.app.off('title:show', self._onTitleShow, self);
        }
        
        self.titleGroup = null;
        self.sampleChar = null;
        self._pool.length = 0;
        self._inUse.length = 0;
    };
    this.app.on('scene:beforeunload', this._onSceneBeforeUnload, this);
    
    // Initialization complete
};

TitleTyper.prototype._loadConfig = function () {
    if (!this.configAsset) {
        this._configReady = true;
        return;
    }
    
    try {
        var asset;
        
        // 支持两种情况：Asset 对象或 Asset ID
        if (typeof this.configAsset === 'object' && this.configAsset.resource !== undefined) {
            asset = this.configAsset;
        } else {
            asset = this.app.assets.get(this.configAsset);
        }
        
        if (asset) {
            if (asset.resource) {
                this._config = asset.resource;
                this._configReady = true;
            } else if (!asset.loaded) {
                var self = this;
                asset.once('load', function (loadedAsset) {
                    self._config = loadedAsset.resource || {};
                    self._configReady = true;
                });
                asset.once('error', function () {
                    self._config = {};
                    self._configReady = true;
                });
                this.app.assets.load(asset);
            } else {
                this._config = {};
                this._configReady = true;
            }
        }
    } catch (e) {}
};

TitleTyper.prototype._warmPool = function () {
    for (var i = 0; i < this.poolSize; i++) {
        var e = this._spawnCharEntity();
        if (e) {
            this._pool.push(e);
        }
    }
};

TitleTyper.prototype._spawnCharEntity = function () {
    if (!this.sampleChar || !this.titleGroup) return null;
    
    var e = this.sampleChar.clone();
    e.enabled = false;
    this.titleGroup.addChild(e);

    var el = e.element;
    if (!el) {
        try {
            e.addComponent('element', {
                type: pc.ELEMENTTYPE_TEXT,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                text: '',
                fontAsset: this.sampleChar.element ? this.sampleChar.element.fontAsset : null,
                fontSize: this.sampleChar.element ? this.sampleChar.element.fontSize : 48,
                opacity: 0
            });
        } catch (err) {
            return null;
        }
    } else {
        // 统一 anchor/pivot，便于水平排布
        el.anchor = new pc.Vec4(0, 0.5, 0, 0.5);
        el.pivot = new pc.Vec2(0, 0.5);
        el.opacity = 0;
        el.text = '';
    }
    
    if (!e.element) return null;
    
    return e;
};

TitleTyper.prototype._getCharEntity = function () {
    var e = (this.usePool && this._pool.length > 0) ? this._pool.pop() : this._spawnCharEntity();
    if (!e) return null;
    
    this._inUse.push(e);
    e.enabled = true;
    return e;
};

TitleTyper.prototype._getConfig = function (i18nKey) {
    if (!this._config || !i18nKey) return null;
    
    return this._config[i18nKey] || null;
};

TitleTyper.prototype._applyStyle = function (element, config) {
    // 应用配置到文本元素
    if (!element || !config) return;
    
    try {
        // 颜色（格式：#RRGGBB 或 #RRGGBBAA）
        if (config.color) {
            element.color = this._parseColor(config.color);
        }
        
        // 描边颜色
        if (config.outlineColor) {
            element.outlineColor = this._parseColor(config.outlineColor);
        }
        
        // 描边厚度
        if (config.outlineThickness !== undefined) {
            element.outlineThickness = config.outlineThickness;
        }
        
        // 字体大小
        if (config.fontSize !== undefined) {
            element.fontSize = config.fontSize;
        }
    } catch (e) {
        console.warn('[TitleTyper] Failed to apply style:', e);
    }
};

TitleTyper.prototype._parseColor = function (colorStr) {
    // 解析颜色字符串（#RRGGBB 或 #RRGGBBAA）到 pc.Color
    if (!colorStr || !colorStr.startsWith('#')) return new pc.Color(1, 1, 1);
    
    var hex = colorStr.substring(1);
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    var a = hex.length > 6 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    
    return new pc.Color(r, g, b, a);
};

TitleTyper.prototype._recycleAll = function () {
    // 停掉旧 tween
    for (var i = 0; i < this._tweens.length; i++) {
        var tw = this._tweens[i];
        if (tw && tw.stop) tw.stop();
    }
    this._tweens.length = 0;

    // 清空浮动列表
    this._floatItems.length = 0;

    // 回收
    for (var j = 0; j < this._inUse.length; j++) {
        var e = this._inUse[j];
        if (e.element) {
            e.element.text = '';
            e.element.opacity = 0;
        }
        e.enabled = false;
        if (this.usePool) this._pool.push(e);
        else e.destroy();
    }
    this._inUse.length = 0;
};

TitleTyper.prototype._splitText = function (s) {
    if (this.splitMode === 'word') {
        // 英文按空格/标点切词（简单版）
        return s.match(/[^\s]+|\s/g) || [];
    }
    // 默认逐字符（中文/英文都可）
    return Array.from(s); // 处理 emoji/多字节字符更安全
};

TitleTyper.prototype._measureWidth = function (charEntity, text) {
    // 1) 等宽模式：直接用 fontSize 近似或 monoSpacing
    if (this.monoSpacing > 0) return this.monoSpacing;

    // 2) 实测宽：设置文本后读取 calculatedWidth（Text Element）
    var el = charEntity.element;
    el.text = text;
    // 让 autoWidth 生效：大多数情况下立即就能拿到
    var w = el.calculatedWidth || el.width || (el.fontSize * 0.6);
    return w;
};

TitleTyper.prototype._layoutLine = function (items) {
    // items: [{entity, text, width}]
    var totalW = 0;
    for (var i = 0; i < items.length; i++) {
        totalW += items[i].width + (i > 0 ? this.letterSpacing : 0);
    }

    // 对齐计算：起始 x
    var startX = 0;
    if (this.align === 'center') startX = -totalW / 2;
    else if (this.align === 'right') startX = -totalW;
    // left 默认 0

    // 当 maxWidth > 0 且超宽：整体缩放（保持不换行的视觉）
    var scale = 1;
    if (this.maxWidth > 0 && totalW > this.maxWidth) {
        scale = this.maxWidth / totalW;
    }

    var x = startX;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var px = startX + (x - startX) * scale; // 线性压缩
        it.entity.setLocalPosition(px, 0, 0);
        x += it.width + this.letterSpacing;
    }
};

TitleTyper.prototype.showTitle = function (i18nKey, options) {
    if (this._isDestroyed) return;
    
    if (!this.titleGroup) return;
    
    if (!this.titleGroup.enabled === undefined || this.titleGroup._destroyed) return;
    
    if (!this.sampleChar) return;
    
    if (!this.sampleChar.enabled === undefined || this.sampleChar._destroyed) return;
    
    if (!this.sampleChar.element) return;

    // 停旧 → 回收
    this._recycleAll();

    var titleConfig = this._getConfig(i18nKey);
    
    // 读取文案（优先使用 I18n.t() 方法，支持嵌套路径）
    var raw = '';
    if (options && options.text) {
        raw = options.text; // 允许直接传文本
    } else if (typeof I18n !== 'undefined' && I18n.t) {
        raw = I18n.t('title.' + i18nKey, ''); // 使用 t() 方法，自动加 title 命名空间
    } else if (typeof I18n !== 'undefined' && I18n.get) {
        // fallback：使用旧方法
        var titleNs = I18n.get('title');
        if (titleNs) {
            // 支持嵌套路径：level.mind_shore.entrance
            var parts = i18nKey.split('.');
            var cur = titleNs;
            for (var i = 0; i < parts.length; i++) {
                if (cur == null) break;
                cur = cur[parts[i]];
            }
            raw = cur || '';
        }
    }
    
    if (!raw) return;

    // Showing title

    // 合并可选项（优先级：options > titleConfig > defaults）
    var cfg = {
        duration: this.duration,
        fadeIn: this.fadeIn,
        fadeOutDelay: this.fadeOutDelay,
        fadeOut: this.fadeOut,
        yRise: this.yRise,
        align: this.align,
        monoSpacing: this.monoSpacing,
        letterSpacing: this.letterSpacing,
        splitMode: this.splitMode,
        floatAmplitude: this.floatAmplitude,
        floatSpeed: this.floatSpeed,
        offsetX: 0,
        offsetY: 0
    };
    
    // 应用 titleConfig
    if (titleConfig) {
        for (var k in titleConfig) {
            if (titleConfig.hasOwnProperty(k)) {
                cfg[k] = titleConfig[k];
            }
        }
    }
    
    // 应用 options（最高优先级）
    if (options) {
        for (var k in options) {
            if (options.hasOwnProperty(k)) {
                cfg[k] = options[k];
            }
        }
    }

    // 拆分文本
    var parts = this._splitText(raw);
    var count = parts.length;
    var perDelay = (count > 0) ? (cfg.duration / count) : 0.03;

    // 生成字符实体并测宽
    var items = [];
    for (var i = 0; i < parts.length; i++) {
        var ch = parts[i];
        var e = this._getCharEntity();
        if (!e || !e.element) continue;
        
        var el = e.element;
        el.opacity = 0;
        el.text = ch;
        
        // 应用样式（颜色、描边、字体大小等）
        this._applyStyle(el, titleConfig);

        // 先放到原点，待会儿统一排布
        e.setLocalPosition(0, 0, 0);

        var w = this._measureWidth(e, ch);
        items.push({ entity: e, text: ch, width: w });
    }

    // 排布（应用偏移）
    this._layoutLine(items);
    
    // 应用整体偏移
    if (cfg.offsetX !== 0 || cfg.offsetY !== 0) {
        for (var i = 0; i < items.length; i++) {
            var pos = items[i].entity.getLocalPosition();
            items[i].entity.setLocalPosition(pos.x + cfg.offsetX, pos.y + cfg.offsetY, pos.z);
        }
    }

    // 动画（打字机 + 淡入 + 上飘）
    var self = this;
    this._playing = true;

    items.forEach(function (it, idx) {
        var el = it.entity.element;
        var startY = it.entity.getLocalPosition().y - cfg.yRise;
        var endY = it.entity.getLocalPosition().y;

        // 保存原始 outlineColor 和 shadowColor（在应用样式后）
        var originalOutlineColor = el.outlineColor ? el.outlineColor.clone() : null;
        var originalShadowColor = el.shadowColor ? el.shadowColor.clone() : null;

        // 初始状态
        it.entity.setLocalPosition(it.entity.getLocalPosition().x, startY, 0);
        el.opacity = 0;
        
        // 同时将 outline 的透明度设为 0
        if (el.outlineColor) {
            el.outlineColor = new pc.Color(
                el.outlineColor.r, 
                el.outlineColor.g, 
                el.outlineColor.b, 
                0
            );
        }
        
        // 同时将 shadow 的透明度设为 0
        if (el.shadowColor) {
            el.shadowColor = new pc.Color(
                el.shadowColor.r,
                el.shadowColor.g,
                el.shadowColor.b,
                0
            );
        }

        // 延时启动
        self._delayedRun(perDelay * idx, function () {
            // 在 cfg.fadeIn 时间里从 0→1，Y 从 startY→endY
            // 传递原始 outlineColor 和 shadowColor 给动画函数
            self._animate(el, it.entity, cfg.fadeIn, startY, endY, originalOutlineColor, originalShadowColor, function () {
                // 淡入完成后添加到浮动列表
                self._floatItems.push({
                    entity: it.entity,
                    baseY: endY,
                    phase: Math.random() * Math.PI * 2, // 随机相位
                    amplitude: cfg.floatAmplitude,
                    speed: cfg.floatSpeed
                });
            });
        });
    });

    if (cfg.fadeOutDelay > 0 && cfg.fadeOut > 0) {
        var totalDelay = cfg.duration + cfg.fadeOutDelay;
        this._delayedRun(totalDelay, function () {
            self._fadeOutAll(cfg.fadeOut, i18nKey);
        });
    } else {
        // 如果没有淡出，立即触发完成事件
        var completeDelay = cfg.duration + 0.1;
        this._delayedRun(completeDelay, function () {
            self.app.fire('title:complete', {
                i18nKey: i18nKey,
                hasSubtitle: false
            });
        });
    }
};

/** 简单延时器（基于 update） */
TitleTyper.prototype._delayedRun = function (delay, fn) {
    var t = 0, self = this;
    var h = function (dt) {
        t += dt;
        if (t >= delay) {
            self.app.off('update', h);
            fn && fn();
        }
    };
    this.app.on('update', h);
    this._tweens.push({ stop: function () { self.app.off('update', h); } });
};

/** 单字淡入+上飘 */
TitleTyper.prototype._animate = function (el, entity, dur, startY, endY, originalOutlineColor, originalShadowColor, callback) {
    var t = 0, self = this;
    
    var h = function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var eased = 1 - Math.pow(1 - k, 3); // easeOutCubic

        // 同时调整 opacity、outlineColor 和 shadowColor 的 alpha
        el.opacity = eased;
        
        // 调整 outline 的透明度
        if (originalOutlineColor && el.outlineColor) {
            el.outlineColor = new pc.Color(
                originalOutlineColor.r,
                originalOutlineColor.g,
                originalOutlineColor.b,
                originalOutlineColor.a * eased // 透明度随淡入变化
            );
        }
        
        // 调整 shadow 的透明度
        if (originalShadowColor && el.shadowColor) {
            el.shadowColor = new pc.Color(
                originalShadowColor.r,
                originalShadowColor.g,
                originalShadowColor.b,
                originalShadowColor.a * eased // 透明度随淡入变化
            );
        }
        
        var y = startY + (endY - startY) * eased;
        var p = entity.getLocalPosition();
        entity.setLocalPosition(p.x, y, 0);

        if (k >= 1) {
            self.app.off('update', h);
            if (callback) callback();
        }
    };
    this.app.on('update', h);
    this._tweens.push({ stop: function () { self.app.off('update', h); } });
};

/** 持续浮动动画（在 update 中） */
TitleTyper.prototype.update = function (dt) {
    if (this._floatItems.length === 0) return;
    
    var time = Date.now() * 0.001; // 秒
    
    for (var i = 0; i < this._floatItems.length; i++) {
        var item = this._floatItems[i];
        if (!item.entity || !item.entity.enabled) continue;
        
        // 正弦波浮动
        var offset = Math.sin(time * item.speed + item.phase) * item.amplitude;
        var pos = item.entity.getLocalPosition();
        item.entity.setLocalPosition(pos.x, item.baseY + offset, pos.z);
    }
};

/** 整体淡出（把每个字符同时做一个 opacity→0） */
TitleTyper.prototype._fadeOutAll = function (dur, i18nKey) {
    var t = 0, self = this;
    
    // 保存每个字符的原始 outlineColor 和 shadowColor
    var originalOutlineColors = [];
    var originalShadowColors = [];
    for (var i = 0; i < self._inUse.length; i++) {
        var el = self._inUse[i].element;
        if (el && el.outlineColor) {
            originalOutlineColors[i] = el.outlineColor.clone();
        } else {
            originalOutlineColors[i] = null;
        }
        if (el && el.shadowColor) {
            originalShadowColors[i] = el.shadowColor.clone();
        } else {
            originalShadowColors[i] = null;
        }
    }
    
    var update = function (dt) {
        t += dt;
        var k = Math.min(1, t / dur);
        var eased = k * k; // easeIn
        var alpha = 1 - eased;

        for (var i = 0; i < self._inUse.length; i++) {
            var el = self._inUse[i].element;
            if (el) {
                el.opacity = alpha;
                
                // 同时调整 outline 的透明度
                var originalOutlineColor = originalOutlineColors[i];
                if (originalOutlineColor && el.outlineColor) {
                    el.outlineColor = new pc.Color(
                        originalOutlineColor.r,
                        originalOutlineColor.g,
                        originalOutlineColor.b,
                        originalOutlineColor.a * alpha // 透明度随淡出变化
                    );
                }
                
                // 同时调整 shadow 的透明度
                var originalShadowColor = originalShadowColors[i];
                if (originalShadowColor && el.shadowColor) {
                    el.shadowColor = new pc.Color(
                        originalShadowColor.r,
                        originalShadowColor.g,
                        originalShadowColor.b,
                        originalShadowColor.a * alpha // 透明度随淡出变化
                    );
                }
            }
        }
        
        if (k >= 1) {
            self.app.off('update', update);
            self._recycleAll();
            
            // 触发 title 完成事件
            self.app.fire('title:complete', {
                i18nKey: i18nKey,
                hasSubtitle: false
            });
        }
    };
    this.app.on('update', update);
    this._tweens.push({ stop: function () { self.app.off('update', update); } });
};

/** 清理 */
TitleTyper.prototype.destroy = function () {
    this._recycleAll();
    
    if (this.app) {
        if (this._onTitleShow) {
            this.app.off('title:show', this._onTitleShow, this);
        }
        if (this._onSceneBeforeUnload) {
            this.app.off('scene:beforeunload', this._onSceneBeforeUnload, this);
        }
    }
    
    for (var i = 0; i < this._pool.length; i++) {
        if (this._pool[i] && this._pool[i].destroy) {
            this._pool[i].destroy();
        }
    }
    this._pool.length = 0;
};
