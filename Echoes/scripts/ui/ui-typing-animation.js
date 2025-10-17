/* global pc */

/**
 * @file ui-typing-animation.js
 * @desc 通用打字机动画基类与播放器（可被 UIManager 等系统复用）
 * @pc-attrs
 *   fontAssetNormal:asset,font, fontAssetBold:asset,font,
 *   defaultCharMs:number=50, lineGapMs:number=300, enableDebugLog:boolean=false
 * @lineData-extension
 *   imageName:string - 图片资源名称（如 prologue_welcome_1.png）
 *   clearImage:boolean - 本行图片是否需要淡入动画（true=淡入，false=直接显示）
 * @options-extension
 *   maxImageHeight:number=400 - 图片固定高度（像素），宽度根据宽高比自动计算
 */
var UiTypingAnimation = pc.createScript('uiTypingAnimation');

// 属性（可选：如果将本脚本挂到某实体上，可在面板中配置默认字体）
UiTypingAnimation.attributes.add('fontAssetNormal', { type: 'asset', assetType: 'font', title: '普通字体' });
UiTypingAnimation.attributes.add('fontAssetBold', { type: 'asset', assetType: 'font', title: '粗体字体(可选)' });
UiTypingAnimation.attributes.add('defaultCharMs', { type: 'number', default: 50, title: '默认每字耗时(ms)' });
UiTypingAnimation.attributes.add('lineGapMs', { type: 'number', default: 300, title: '行间停顿(ms)' });
UiTypingAnimation.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

// 单例（便于无挂载直接通过静态方法使用）
UiTypingAnimation._instance = null;
UiTypingAnimation.getInstance = function () { return UiTypingAnimation._instance; };

UiTypingAnimation.prototype.initialize = function () {
    UiTypingAnimation._instance = this;
};

/**
 * Typing 数据结构
 * typeLines: Array<lineData>
 * lineData: {
 *   text: string,                       // 该行完整字符串
 *   durations?: number[],               // 每个字符的打印时长(ms)，长度与 text 一致；未给则采用默认
 *   bold?: boolean,                     // 是否使用粗体（需要提供 fontAssetBold）
 *   color?: string,                     // 十六进制颜色，如 #000000
 *   size?: number                       // 字号（px）
 * }
 */

/** 将十六进制转 pc.Color */
function _hexColor(hex) {
    if (!hex || typeof hex !== 'string') return new pc.Color(0, 0, 0, 1);
    var s = hex.trim();
    if (s[0] === '#') s = s.substring(1);
    if (s.length !== 6) return new pc.Color(0, 0, 0, 1);
    var r = parseInt(s.substring(0, 2), 16) / 255;
    var g = parseInt(s.substring(2, 4), 16) / 255;
    var b = parseInt(s.substring(4, 6), 16) / 255;
    return new pc.Color(r, g, b, 1);
}

/**
 * 播放器：基于 update 驱动，避免大量 setTimeout
 * 使用：
 *   var player = UiTypingAnimation.createPlayer(app, textElementEntity, data, options);
 *   player.play(onComplete);
 *   player.skip();
 */
function TypingPlayer(app, textEntity, data, options) {
    this.app = app;
    this.textEntity = textEntity; // 必须是 Text Element 的实体
    this.data = data || { typeLines: [] };
    this.opts = options || {};

    this.defaultCharMs = this.opts.defaultCharMs || 50;
    this.lineGapMs = this.opts.lineGapMs || 300;
    this.fontAssetNormal = this.opts.fontAssetNormal || null;
    this.fontAssetBold = this.opts.fontAssetBold || null;
    this.debug = !!this.opts.enableDebugLog;

    // 覆盖层选项（纯色背景）
    this.overlayEntity = this.opts.overlayEntity || null; // pc.Entity（Image Element）
    this.bgHexColor = this.opts.bgHexColor || '#FCFBDB';
    this.bgFadeOutMs = (this.opts.bgFadeOutMs|0) > 0 ? (this.opts.bgFadeOutMs|0) : 1500;
    
    // 图片轮播容器（直接使用容器的 Element 组件显示图片）
    this.imageCarouselContainer = this.opts.imageCarouselContainer || null; // pc.Entity (必须有 Image Element 组件)
    this.maxImageWidth = typeof this.opts.maxImageWidth === 'number' ? this.opts.maxImageWidth : 1200; // 最大宽度（已废弃，现在只用高度）
    this.maxImageHeight = typeof this.opts.maxImageHeight === 'number' ? this.opts.maxImageHeight : 400; // 固定高度
    if (this.debug) {
        console.log('[TypingPlayer] Constructor - imageCarouselContainer from opts:', this.imageCarouselContainer);
        console.log('[TypingPlayer] Constructor - maxImageWidth:', this.maxImageWidth, 'maxImageHeight:', this.maxImageHeight);
        console.log('[TypingPlayer] Constructor - debug enabled:', this.debug);
        if (!this.imageCarouselContainer) {
            console.warn('[TypingPlayer] ⚠️ imageCarouselContainer is NULL! Image carousel will not work.');
            console.warn('[TypingPlayer] 📋 To fix: In PlayCanvas Editor, set UIManager.imageCarouselContainer to an Entity with Image Element component');
        }
    }

    // 运行态
    this.lineIndex = 0;
    this.charIndex = 0;
    this.timerMs = 0;
    this.state = 'idle'; // idle|typing|lineGap|done
    this._onComplete = null;
    this._updateCb = this._onUpdate.bind(this);
    this._tweenCb = null;
    this.outputPrefix = '';
    this.speedMultiplier = 1; // 速度倍数（用于加速）
    this.pendingClear = false;
    this.nextOutputPrefix = '';
    // 位置/对齐控制
    this.baseLocalPos = textEntity ? textEntity.getLocalPosition().clone() : new pc.Vec3();
    this.currentFullWidth = 0; // 该行的完整宽度（用于最终居中）
    // 晃动参数（可从 opts 覆盖）
    this.swayAmpX = typeof this.opts.swayAmpX === 'number' ? this.opts.swayAmpX : 10;
    this.swayAmpY = typeof this.opts.swayAmpY === 'number' ? this.opts.swayAmpY : 5;
    this.swaySpeed = typeof this.opts.swaySpeed === 'number' ? this.opts.swaySpeed : 0.3; // Hz（更慢）
    this._elapsed = 0;
    // 文本宽度估算参数（ASCII/CJK 不同比例）
    this.widthFactorAscii = typeof this.opts.widthFactorAscii === 'number' ? this.opts.widthFactorAscii : 0.6;
    this.widthFactorCJK = typeof this.opts.widthFactorCJK === 'number' ? this.opts.widthFactorCJK : 1.0;
}

TypingPlayer.prototype._applyLineStyle = function (line) {
    if (!this.textEntity || !this.textEntity.element) return;
    var el = this.textEntity.element;
    if (line) {
        if (typeof line.size === 'number' && line.size > 0) el.fontSize = line.size;
        
        // 设置颜色：如果 line 有颜色使用 line.color，否则使用默认黑色
        var colorToUse = line.color || '#000000';
        var c = _hexColor(colorToUse);
        if (el.color && el.color.set) el.color.set(c.r, c.g, c.b, c.a); else el.color = c;
        
        if (line.bold && this.fontAssetBold) {
            el.fontAsset = this.fontAssetBold.id || this.fontAssetBold;
        } else if (this.fontAssetNormal) {
            el.fontAsset = this.fontAssetNormal.id || this.fontAssetNormal;
        }
    }
};

// ========== 图片管理 ==========
/**
 * 加载并显示图片
 * @param {string} imageName - 图片名称（如 prologue_welcome_1）
 * @param {boolean} useFadeIn - 是否使用淡入动画（true=淡入，false=直接显示）
 */
TypingPlayer.prototype._showImage = function (imageName, useFadeIn) {
    if (this.debug) console.log('[TypingPlayer] _showImage called, imageName=', imageName, 'useFadeIn=', useFadeIn, 'container=', this.imageCarouselContainer);
    
    if (!this.imageCarouselContainer) {
        if (this.debug) console.warn('[TypingPlayer] imageCarouselContainer is null, cannot show image');
        return;
    }
    
    if (!imageName) {
        if (this.debug) console.log('[TypingPlayer] imageName is empty, skipping image display');
        return;
    }
    
    var self = this;
    var assetName = imageName;
    
    if (this.debug) console.log('[TypingPlayer] Searching for asset:', assetName);
    
    // 查找资源
    var asset = this.app.assets.find(assetName, 'texture');
    if (!asset) {
        if (this.debug) console.warn('[TypingPlayer] Image asset not found:', assetName);
        // 尝试列出所有纹理资源以帮助调试
        if (this.debug) {
            var allTextures = this.app.assets.filter(function(a) { return a.type === 'texture'; });
            console.log('[TypingPlayer] Available texture assets:', allTextures.map(function(a) { return a.name; }));
        }
        return;
    }
    
    if (this.debug) console.log('[TypingPlayer] Asset found:', asset.name, 'loaded=', !!asset.resource);
    
    // 确保资源已加载
    if (!asset.resource) {
        if (this.debug) console.log('[TypingPlayer] Loading asset:', asset.name);
        asset.ready(function () {
            if (self.debug) console.log('[TypingPlayer] Asset loaded, creating entity');
            self._createImageEntity(asset, useFadeIn);
        });
        this.app.assets.load(asset);
    } else {
        this._createImageEntity(asset, useFadeIn);
    }
};

/**
 * 显示图片到容器（直接使用容器的 Element 组件）
 * @param {pc.Asset} asset - 纹理资源
 * @param {boolean} useFadeIn - 是否使用淡入动画
 */
TypingPlayer.prototype._createImageEntity = function (asset, useFadeIn) {
    if (this.debug) console.log('[TypingPlayer] _createImageEntity called, asset=', asset.name, 'useFadeIn=', useFadeIn);
    
    if (!this.imageCarouselContainer) {
        if (this.debug) console.warn('[TypingPlayer] imageCarouselContainer is null in _createImageEntity');
        return;
    }
    
    // 检查容器是否有 element 组件
    if (!this.imageCarouselContainer.element) {
        if (this.debug) console.warn('[TypingPlayer] imageCarouselContainer does not have an element component');
        return;
    }
    
    var el = this.imageCarouselContainer.element;
    
    // 确保是 Image 类型的 Element
    if (el.type !== pc.ELEMENTTYPE_IMAGE) {
        if (this.debug) console.warn('[TypingPlayer] imageCarouselContainer element is not an IMAGE type, type=', el.type);
        return;
    }
    
    if (this.debug) console.log('[TypingPlayer] Setting texture asset to container element');
    
    // 直接设置纹理资源到容器的 element
    el.textureAsset = asset;
    el.texture = asset.resource;
    
    // 动态调整图片尺寸
    this._resizeImageToFit(el, asset.resource);
    
    // 启用容器
    if (!this.imageCarouselContainer.enabled) {
        this.imageCarouselContainer.enabled = true;
    }
    
    // 根据 useFadeIn 决定是否使用淡入动画
    if (useFadeIn) {
        el.opacity = 0;
        this._fadeInImage(this.imageCarouselContainer);
        if (this.debug) console.log('[TypingPlayer] Image shown with fade in:', asset.name);
    } else {
        el.opacity = 1;
        if (this.debug) console.log('[TypingPlayer] Image shown directly (no fade):', asset.name);
    }
};

/**
 * 根据纹理尺寸动态调整 Element 大小，固定高度并保持宽高比
 * @param {pc.ElementComponent} element - Element 组件
 * @param {pc.Texture} texture - 纹理资源
 */
TypingPlayer.prototype._resizeImageToFit = function (element, texture) {
    if (!element || !texture) return;
    
    var texWidth = texture.width || 1;
    var texHeight = texture.height || 1;
    
    if (this.debug) {
        console.log('[TypingPlayer] Original texture size:', texWidth, 'x', texHeight);
    }
    
    // 固定高度为 maxImageHeight，根据宽高比计算宽度
    var targetHeight = this.maxImageHeight;
    var aspectRatio = texWidth / texHeight;
    var targetWidth = Math.floor(targetHeight * aspectRatio);
    
    element.width = targetWidth;
    element.height = targetHeight;
    
    if (this.debug) {
        console.log('[TypingPlayer] Resized to:', targetWidth, 'x', targetHeight, 'aspectRatio:', aspectRatio.toFixed(3));
    }
};

/**
 * 图片淡入
 * @param {pc.Entity} imgEntity - 图片实体
 */
TypingPlayer.prototype._fadeInImage = function (imgEntity) {
    if (!imgEntity || !imgEntity.element) return;
    
    var el = imgEntity.element;
    var duration = 500; // 500ms 淡入
    var elapsed = 0;
    var self = this;
    
    var fadeIn = function (dt) {
        elapsed += dt * 1000;
        var progress = Math.min(1, elapsed / duration);
        el.opacity = progress;
        
        if (progress >= 1) {
            self.app.off('update', fadeIn);
        }
    };
    
    this.app.on('update', fadeIn);
};

/**
 * 清除当前图片
 * @param {boolean} immediate - 是否立即清除（不淡出）
 */
TypingPlayer.prototype._clearImage = function (immediate) {
    if (!this.imageCarouselContainer || !this.imageCarouselContainer.element) return;
    
    var el = this.imageCarouselContainer.element;
    var self = this;
    
    if (immediate) {
        el.opacity = 0;
        el.textureAsset = null;
        el.texture = null;
        if (this.debug) console.log('[TypingPlayer] Image cleared immediately');
        return;
    }
    
    // 淡出动画
    var duration = 500; // 500ms 淡出
    var elapsed = 0;
    var startOpacity = el.opacity || 1;
    
    var fadeOut = function (dt) {
        elapsed += dt * 1000;
        var progress = Math.min(1, elapsed / duration);
        el.opacity = startOpacity * (1 - progress);
        
        if (progress >= 1) {
            self.app.off('update', fadeOut);
            el.textureAsset = null;
            el.texture = null;
            if (self.debug) console.log('[TypingPlayer] Image cleared with fade');
        }
    };
    
    this.app.on('update', fadeOut);
};

// ========== 覆盖层（纯色背景）管理 ==========
TypingPlayer.prototype._prepareOverlay = function () {
    var ent = this.overlayEntity;
    if (!ent || !ent.element || ent.element.type !== pc.ELEMENTTYPE_IMAGE) return;
    var el = ent.element;
    // 颜色
    var c = _hexColor(this.bgHexColor);
    if (el.color && el.color.set) el.color.set(c.r, c.g, c.b, c.a); else el.color = c;
    // 可见
    el.opacity = 1;
    // 尺寸/锚点（尽量通用）
    try {
        el.anchor = new pc.Vec4(0, 0, 1, 1);
        el.pivot = new pc.Vec2(0.5, 0.5);
        el.margin = new pc.Vec4(0, 0, 0, 0);
    } catch (e) {}
    // 提供 1x1 白纹理（避免无贴图不渲染）
    var white = this._ensureWhiteTextureAsset();
    if (white) { el.textureAsset = white; el.texture = white.resource; }
    // 层级（在文字之下）
    if (this.textEntity && this.textEntity.element && this.textEntity.element.layers) {
        try { el.layers = this.textEntity.element.layers.slice(0); } catch (e) {}
    }
    el.drawOrder = Math.max(0, (this.textEntity && this.textEntity.element ? this.textEntity.element.drawOrder - 100 : 900));
    // 启用
    if (!ent.enabled) ent.enabled = true;
    if (ent.element && ent.element.enabled === false) ent.element.enabled = true;
};

TypingPlayer.prototype._overlayFadeOut = function (durationMs, onComplete) {
    var ent = this.overlayEntity;
    if (!ent || !ent.element) { if (onComplete) onComplete(); return; }
    var el = ent.element;
    this._tweenOpacity(el, el.opacity != null ? el.opacity : 1, 0, Math.max(0, durationMs|0), onComplete);
};

// 简易 tween（本地实现）
TypingPlayer.prototype._tweenOpacity = function (element, from, to, durationMs, onComplete) {
    var self = this;
    var t = 0, dur = Math.max(0, durationMs|0);
    element.opacity = from;
    if (dur === 0) { element.opacity = to; if (onComplete) onComplete(); return; }
    var cb = function (dt) {
        t += dt * 1000;
        var k = Math.min(1, t / dur);
        element.opacity = from + (to - from) * k;
        if (k >= 1) {
            self.app.off('update', cb);
            if (onComplete) onComplete();
        }
    };
    this.app.on('update', cb);
    this._tweenCb = cb;
};

// 白纹理（与 UIManager 实现一致的思路）
TypingPlayer.prototype._ensureWhiteTexture = function () {
    if (UiTypingAnimation._whiteTexture) return UiTypingAnimation._whiteTexture;
    try {
        var gd = this.app && this.app.graphicsDevice;
        if (!gd) return null;
        var cvs = document && document.createElement ? document.createElement('canvas') : null;
        if (!cvs) return null;
        cvs.width = 1; cvs.height = 1;
        var ctx = cvs.getContext('2d');
        if (ctx) { ctx.clearRect(0,0,1,1); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,1,1); }
        var tex = new pc.Texture(gd, { width: 1, height: 1, format: pc.PIXELFORMAT_R8_G8_B8_A8 });
        tex.setSource(cvs);
        UiTypingAnimation._whiteTexture = tex;
        return tex;
    } catch (e) { return null; }
};

TypingPlayer.prototype._ensureWhiteTextureAsset = function () {
    if (UiTypingAnimation._whiteTextureAsset) return UiTypingAnimation._whiteTextureAsset;
    var tex = this._ensureWhiteTexture();
    if (!tex) return null;
    try {
        var asset = new pc.Asset('ui_white_1x1_global', 'texture', { url: '' }, {});
        asset.resource = tex;
        asset.loaded = true;
        this.app.assets.add(asset);
        UiTypingAnimation._whiteTextureAsset = asset;
        return asset;
    } catch (e) { return null; }
};

TypingPlayer.prototype.play = function (onComplete) {
    if (!this.textEntity || !this.textEntity.element) return;
    this._onComplete = onComplete || null;
    this.textEntity.element.text = '';
    this.lineIndex = 0;
    this.charIndex = 0;
    this.timerMs = 0;
    this.state = 'fade_in'; // 初始状态为淡入
    this._applyLineStyle(this.data.typeLines[0]);
    this._prepareOverlay();
    this.outputPrefix = '';
    this.pendingClear = false;
    this.nextOutputPrefix = '';
    this._elapsed = 0;
    
    // 设置文字居中对齐，保持静止
    try { 
        this.textEntity.element.alignment = new pc.Vec2(0.5, 0.5);
        // 确保文字位置固定在初始位置
        this.textEntity.setLocalPosition(this.baseLocalPos.x, this.baseLocalPos.y, this.baseLocalPos.z);
        // 初始设置文字为透明
        this.textEntity.element.opacity = 0;
    } catch (e) {}
    
    // 初始设置背景为透明
    if (this.overlayEntity && this.overlayEntity.element) {
        this.overlayEntity.element.opacity = 0;
    }
    
    // 预计算第一行的完整宽度
    this._updateLineFullWidth(this._currentLine());
    
    // 开始淡入动画
    var self = this;
    var fadeInTime = 800; // 淡入时间 800ms
    
    if (this.debug) {
        console.log('[TypingPlayer] Starting fade in animation');
    }
    
    // 淡入背景
    if (this.overlayEntity && this.overlayEntity.element) {
        this._tweenOpacity(this.overlayEntity.element, 0, 1, fadeInTime);
    }
    
    // 淡入文字（稍微延迟一点）
    setTimeout(function() {
        if (self.textEntity && self.textEntity.element) {
            self._tweenOpacity(self.textEntity.element, 0, 1, fadeInTime * 0.6, function() {
                // 淡入完成后开始打字
                self.state = 'typing';
                if (self.debug) console.log('[TypingPlayer] Fade in complete, starting typing');
            });
        }
    }, fadeInTime * 0.2); // 延迟 20% 的时间后开始淡入文字
    
    // 显示第一行的图片（如果有），在淡入完成后显示
    var firstLine = this._currentLine();
    if (firstLine && firstLine.imageName) {
        setTimeout(function() {
            if (self.debug) console.log('[TypingPlayer] Showing first image after fade in:', firstLine.imageName);
            self._showImage(firstLine.imageName, firstLine.clearImage);
        }, fadeInTime * 0.5); // 淡入到一半时显示图片
    }
    
    this.app.on('update', this._updateCb);
};

/**
 * 设置打字速度倍数
 * @param {number} multiplier - 速度倍数（1=正常，5=5倍速）
 */
TypingPlayer.prototype.setSpeedMultiplier = function (multiplier) {
    this.speedMultiplier = Math.max(1, multiplier || 1);
    if (this.debug) console.log('[TypingPlayer] Speed multiplier set to:', this.speedMultiplier);
};

TypingPlayer.prototype.skip = function () {
    if (!this.textEntity || !this.textEntity.element) return;
    var el = this.textEntity.element;
    // 直接输出全部文本（保持样式为最后一行样式）
    var fullText = '';
    for (var i = 0; i < this.data.typeLines.length; i++) {
        fullText += (i > 0 ? '\n' : '') + (this.data.typeLines[i].text || '');
    }
    // 应用最后一行样式
    this._applyLineStyle(this.data.typeLines[this.data.typeLines.length - 1]);
    el.text = fullText;
    // 跳过时显示最后一行的图片（如果有），直接显示不淡入
    var lastLine = this.data.typeLines[this.data.typeLines.length - 1];
    if (lastLine && lastLine.imageName) {
        this._showImage(lastLine.imageName, false); // 跳过时不使用淡入
    }
    this._finish();
};

TypingPlayer.prototype._finish = function () {
    this.app.off('update', this._updateCb);
    this.state = 'done';
    var self = this;
        
    // 文字播放完成后停留一段时间
    var textHoldTime = 1500;
    
    setTimeout(function() {
        // 1. 先淡出文字
        var textFadeTime = 800;
        if (self.textEntity && self.textEntity.element) {
            self._tweenOpacity(self.textEntity.element, 1, 0, textFadeTime);
        }
        
        // 2. 同时开始淡出图片（如果有）
        if (self.imageCarouselContainer && self.imageCarouselContainer.element) {
            self._clearImage(false); // 使用淡出动画
            if (self.debug) console.log('[TypingPlayer] Fading out image at finish');
        }
        
        // 3. 文字和图片淡出后，再淡出背景
        var imageFadeTime = (self.imageCarouselContainer && self.imageCarouselContainer.element) ? 500 : 0;
        var maxFadeTime = Math.max(textFadeTime, imageFadeTime);
        
        setTimeout(function() {
            if (self.overlayEntity && self.bgFadeOutMs > 0) {
                self._overlayFadeOut(self.bgFadeOutMs, function () {
                    if (self._onComplete) self._onComplete();
                });
            } else {
                if (self._onComplete) self._onComplete();
            }
        }, maxFadeTime);
        
    }, textHoldTime);
};

TypingPlayer.prototype._currentLine = function () { return this.data.typeLines[this.lineIndex]; };

TypingPlayer.prototype._nextCharDuration = function () {
    var line = this._currentLine();
    if (!line) return this.defaultCharMs;
    if (Array.isArray(line.durations) && line.durations.length > this.charIndex) return Math.max(0, line.durations[this.charIndex]|0);
    return this.defaultCharMs;
};

TypingPlayer.prototype._onUpdate = function (dt) {
    this._elapsed += dt;
    if (this.state === 'done') return;
    if (!this.textEntity || !this.textEntity.element) { this._finish(); return; }

    var el = this.textEntity.element;
    
    // 淡入状态时不进行任何打字操作，等待淡入完成
    if (this.state === 'fade_in') {
        return;
    }
    
    if (this.state === 'typing') {
        this.timerMs += dt * 1000 * this.speedMultiplier; // 应用速度倍数
        var needMs = this._nextCharDuration();
        if (this.timerMs >= needMs) {
            this.timerMs = 0;
            var line = this._currentLine();
            if (!line) { this._finish(); return; }
            // 输出下一个字符
            var currentPrefix = line.text ? line.text.substring(0, this.charIndex + 1) : '';
            el.text = this.outputPrefix + currentPrefix;
            if (this.debug) console.log('[TypingPlayer] typing line', this.lineIndex, 'char', this.charIndex, 'clear=', !!(line && line.clear), 'outPrefixLen=', this.outputPrefix.length);
            this.charIndex++;

            if (this.charIndex >= (line.text ? line.text.length : 0)) {
                // 当前行结束：记录下一行开始时的处理策略
                if (line && line.clear) {
                    this.pendingClear = true;
                    this.nextOutputPrefix = '';
                    if (this.debug) console.log('[TypingPlayer] line end -> schedule clear at next line start', this.lineIndex);
                } else {
                    this.pendingClear = false;
                    this.nextOutputPrefix = (el.text || '') + '\n';
                    if (this.debug) console.log('[TypingPlayer] line end -> schedule keep, next outPrefixLen=', this.nextOutputPrefix.length);
                }
                // clearImage 现在用于控制淡入动画，不再清除图片
                this.state = 'lineGap';
                this.timerMs = 0;
            }
        }
    } else if (this.state === 'lineGap') {
        this.timerMs += dt * 1000;
        if (this.timerMs >= (this.speedMultiplier == 5 ? 0.2 : this.lineGapMs)) {
            this.timerMs = 0;
            this.lineIndex++;
            this.charIndex = 0;
            if (this.lineIndex >= this.data.typeLines.length) {
                // 所有行完成
                this._finish();
                return;
            }
            // 应用下一行样式，并在进入 typing 前应用 pendingClear/nextOutputPrefix
            this._applyLineStyle(this._currentLine());
            // 在新行开始前，更新该行完整宽度，用于动态定位
            this._updateLineFullWidth(this._currentLine());
            if (this.pendingClear) {
                el.text = '';
                this.outputPrefix = '';
                if (this.debug) console.log('[TypingPlayer] next line start -> applied clear');
            } else {
                this.outputPrefix = this.nextOutputPrefix || this.outputPrefix;
                if (this.debug) console.log('[TypingPlayer] next line start -> applied keep, outPrefixLen=', this.outputPrefix.length);
            }
            // 显示新行的图片（如果有）
            var nextLine = this._currentLine();
            if (nextLine && nextLine.imageName) {
                this._showImage(nextLine.imageName, nextLine.clearImage);
                if (this.debug) console.log('[TypingPlayer] next line start -> showing image:', nextLine.imageName, 'useFadeIn:', nextLine.clearImage);
            }
            this.state = 'typing';
        }
    }
    // 每帧更新文本实体的局部位置：保持“最终居中”，动画中根据可见宽度让左缘不动
    // 保持文字位置固定，不移动
    if (this.textEntity) {
        this.textEntity.setLocalPosition(this.baseLocalPos.x, this.baseLocalPos.y, this.baseLocalPos.z);
    }
};

/**
 * 估算文本宽度（像素）。若无法获取精确度量，回退到 ASCII/CJK 的经验比例
 */
TypingPlayer.prototype._measureTextWidth = function (text, fontSize) {
    if (!text) return 0;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        // 粗略：CJK 全角字符范围
        var code = ch.charCodeAt(0);
        var isCJK = (code >= 0x2E80 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFF00 && code <= 0xFFEF);
        total += (isCJK ? this.widthFactorCJK : this.widthFactorAscii) * fontSize;
    }
    return total;
};

/**
 * 在一行开始前，计算该行完整宽度
 */
TypingPlayer.prototype._updateLineFullWidth = function (line) {
    var el = this.textEntity && this.textEntity.element;
    if (!el || !line) { this.currentFullWidth = 0; return; }
    var fsize = typeof line.size === 'number' && line.size > 0 ? line.size : el.fontSize || 32;
    var fullWidth = this._measureTextWidth(line.text || '', fsize);
    this.currentFullWidth = fullWidth;
    if (this.debug) console.log('[TypingPlayer] update full width:', this.currentFullWidth, 'fsize=', fsize);
};

/**
 * 对外 API：创建一个播放器
 * @param {pc.Application} app
 * @param {pc.Entity} textEntity - 必须挂有 Element(Text) 组件
 * @param {{ typeLines: Array<lineData> }} data
 * @param {{ defaultCharMs?:number, lineGapMs?:number, fontAssetNormal?:any, fontAssetBold?:any, enableDebugLog?:boolean }} options
 */
UiTypingAnimation.createPlayer = function (app, textEntity, data, options) {
    return new TypingPlayer(app, textEntity, data, options);
};
