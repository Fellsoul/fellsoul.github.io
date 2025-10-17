/* global pc, I18n, GlobalGame */

var WorldTips = pc.createScript('worldTips');

/**
 * 需要在编辑器里给 font 赋一个位图字体！
 */
WorldTips.attributes.add('tipKey', { type: 'string', default: '', title: '提示键名' });
WorldTips.attributes.add('triggerTag', { type: 'string', default: 'world-tip', title: 'Smart Trigger标签' });

WorldTips.attributes.add('characterSpacing', { type: 'number', default: 30, title: '字符间距(px)' });
WorldTips.attributes.add('popDelay', { type: 'number', default: 0.1, title: '弹出延迟(秒)' });
WorldTips.attributes.add('popDuration', { type: 'number', default: 0.5, title: '弹出动画时长(秒)' });
WorldTips.attributes.add('hideDelay', { type: 'number', default: 0.05, title: '隐藏延迟(秒)' });
WorldTips.attributes.add('hideDuration', { type: 'number', default: 0.3, title: '隐藏动画时长(秒)' });

WorldTips.attributes.add('offsetY', { type: 'number', default: 50, title: 'Y轴偏移' });
WorldTips.attributes.add('fontSize', { type: 'number', default: 24, title: '字体大小' });
WorldTips.attributes.add('fontColor', { type: 'string', default: '#FFFFFF', title: '字体颜色' });
WorldTips.attributes.add('outlineColor', { type: 'string', default: '#000000', title: '描边颜色' });
WorldTips.attributes.add('outlineThickness', { type: 'number', default: 0.5, title: '描边厚度' });

WorldTips.attributes.add('font', { type: 'asset', assetType: 'font', title: 'Font（必须）' });
WorldTips.attributes.add('layerName', { type: 'string', default: 'UI', title: '渲染层名称（默认UI）' });

WorldTips.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '启用调试日志' });

WorldTips.prototype.initialize = function () {
    this.isShowing = false;
    this.isHiding = false;
    this.characterEntities = [];
    this.animationTimeouts = [];
    this._tempVec3 = new pc.Vec3();

    // 提示：在世界空间用 Element 没问题；保留一个非屏幕空间的 Screen 作为尺度参考
    if (!this.entity.screen) {
        this.entity.addComponent('screen', {
            screenSpace: false,
            resolution: new pc.Vec2(1920, 1080),
            referenceResolution: new pc.Vec2(1920, 1080),
            scaleMode: pc.SCALEMODE_BLEND
        });
    }

    // 解析 layer
    this._targetLayerId = this._getLayerIdByName(this.layerName) ?? pc.LAYERID_UI;

    // 绑定全局 trigger 事件
    this._bindEvents();

    if (this.enableDebugLog) {
        console.log('[WorldTips] init',
            { tipKey: this.tipKey, layerName: this.layerName, layerId: this._targetLayerId,
              hasFont: !!this.font, entity: this.entity.name });
    }

    if (!this.font) {
        console.warn('[WorldTips] 未设置 font 资产，文本将不可见！请在属性中拖入一个位图字体（Font Asset）。');
    }
};

WorldTips.prototype.destroy = function () {
    this._unbindEvents();
    this._clearAllTimeouts();
    this._clearCharacterEntities();
};

/* ---------------- Events ---------------- */
WorldTips.prototype._bindEvents = function () {
    this._onTriggerEnter = (triggerEntity, playerEntity) => {
        if (this._isValidTrigger(triggerEntity)) this._showTips();
    };
    this._onTriggerLeave = (triggerEntity, playerEntity) => {
        if (this._isValidTrigger(triggerEntity)) this._hideTips();
    };
    this.app.on('trigger:enter', this._onTriggerEnter, this);
    this.app.on('trigger:leave', this._onTriggerLeave, this);
};

WorldTips.prototype._unbindEvents = function () {
    if (this._onTriggerEnter) this.app.off('trigger:enter', this._onTriggerEnter, this);
    if (this._onTriggerLeave) this.app.off('trigger:leave', this._onTriggerLeave, this);
};

WorldTips.prototype._isValidTrigger = function (triggerEntity) {
    if (!triggerEntity) return false;
    if (triggerEntity === this.entity) return true;
    if (this._isChildOf(triggerEntity, this.entity)) return true;
    if (this.triggerTag && triggerEntity.tags && triggerEntity.tags.has(this.triggerTag)) return true;
    if (this.triggerTag && triggerEntity.name === this.triggerTag) return true;
    return false;
};

WorldTips.prototype._isChildOf = function (child, parent) {
    var p = child && child.parent;
    while (p) { if (p === parent) return true; p = p.parent; }
    return false;
};

/* ---------------- Core ---------------- */
WorldTips.prototype._showTips = function () {
    if (this.isShowing) return;
    const text = this._getTipText(this.tipKey);
    if (!text) {
        if (this.enableDebugLog) console.warn('[WorldTips] 没有文本可显示：', this.tipKey);
        return;
    }
    if (!this.font) {
        console.warn('[WorldTips] 未设置 font 资产，无法显示文本：', text);
        return;
    }

    this.isShowing = true;
    this.isHiding = false;
    this._clearCharacterEntities();
    this._clearAllTimeouts();

    this._createCharacterEntities(text);
    this._animateCharactersIn();
};

WorldTips.prototype._hideTips = function () {
    if (this.isHiding || this.characterEntities.length === 0) return;
    this.isHiding = true;
    this.isShowing = false;
    this._clearAllTimeouts();
    this._animateCharactersOut();
};

WorldTips.prototype._getTipText = function (key) {
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            const t = I18n.get(key);
            if (t && t !== key) return t;
        }
        if (typeof GlobalGame !== 'undefined') {
            const locale = GlobalGame.getCurrentLocale ? GlobalGame.getCurrentLocale() : 'zh-CN';
            if (GlobalGame._worldTipsData && GlobalGame._worldTipsData[locale]) {
                const t2 = this._getNestedValue(GlobalGame._worldTipsData[locale], key);
                if (t2) return t2;
            }
        }
        // fallback
        const parts = (key || '').split('.');
        const last = parts[parts.length - 1] || key || '';
        return last.replace(/_/g, ' ');
    } catch (e) {
        return key || '';
    }
};

WorldTips.prototype._getNestedValue = function (obj, path) {
    const keys = (path || '').split('.');
    let cur = obj;
    for (let i = 0; i < keys.length; i++) {
        if (!cur || typeof cur !== 'object') return null;
        cur = cur[keys[i]];
    }
    return (typeof cur === 'string') ? cur : null;
};

WorldTips.prototype._createCharacterEntities = function (text) {
    const chars = text.split('');
    const filtered = chars.map(c => c === '\n' ? ' ' : c); // 简单处理换行成空格
    const visibleCount = filtered.filter(c => c !== ' ').length;
    const totalWidth = (visibleCount - 1) * this.characterSpacing;
    let startX = -totalWidth / 2;

    let indexVisible = 0;
    for (let i = 0; i < filtered.length; i++) {
        const ch = filtered[i];
        if (ch === ' ') { // 空格：推进起点但不创建实体
            startX += this.characterSpacing;
            continue;
        }
        const e = this._createCharacterEntity(ch, i);
        if (!e) continue;

        const x = startX + indexVisible * this.characterSpacing;
        e.setLocalPosition(x, this.offsetY, 0);
        e.setLocalScale(0, 0, 0);
        this.characterEntities.push(e);
        indexVisible++;
    }
};

WorldTips.prototype._createCharacterEntity = function (character, index) {
    try {
        const e = new pc.Entity('WorldTip_Char_' + index);
        e.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            text: character,
            fontAsset: this.font ? this.font.id : null, // 关键：必须设置字体
            fontSize: this.fontSize,
            color: this._parseColor(this.fontColor),
            outlineColor: this._parseColor(this.outlineColor),
            outlineThickness: this.outlineThickness,
            alignment: [0.5, 0.5],
            pivot: [0.5, 0.5],
            autoWidth: false,
            autoHeight: false,
            width: this.fontSize * 2,
            height: this.fontSize * 2,
            useInput: false
        });

        // 指定到目标层（通常是 UI 层，防止被场景遮挡）
        e.element.layers = [this._targetLayerId];

        this.entity.addChild(e);
        this._billboardToCamera(e);
        return e;
    } catch (err) {
        if (this.enableDebugLog) console.error('[WorldTips] 创建字符失败', err);
        return null;
    }
};

WorldTips.prototype._billboardToCamera = function (entity) {
    const cam = this._getMainCamera();
    if (!cam) return;
    entity.lookAt(cam.getPosition());
    entity.rotateLocal(0, 180, 0);
};

WorldTips.prototype._getMainCamera = function () {
    return this.app.root.findByName('Camera') || (this.app.root.findByTag('camera')[0] || null);
};

WorldTips.prototype._parseColor = function (str) {
    if (!str || str[0] !== '#' || (str.length !== 7 && str.length !== 4)) return new pc.Color(1, 1, 1);
    if (str.length === 7) {
        const r = parseInt(str.slice(1, 3), 16) / 255;
        const g = parseInt(str.slice(3, 5), 16) / 255;
        const b = parseInt(str.slice(5, 7), 16) / 255;
        return new pc.Color(r, g, b);
    } else {
        // #rgb
        const r = parseInt(str[1] + str[1], 16) / 255;
        const g = parseInt(str[2] + str[2], 16) / 255;
        const b = parseInt(str[3] + str[3], 16) / 255;
        return new pc.Color(r, g, b);
    }
};

/* ---------------- Animations ---------------- */
WorldTips.prototype._animateCharactersIn = function () {
    for (let i = 0; i < this.characterEntities.length; i++) {
        const ent = this.characterEntities[i];
        const delay = i * this.popDelay * 1000;
        const id = setTimeout(() => {
            if (!this.isShowing || !ent || !ent.element) return;
            this._animateCharacterScale(ent, 0, 1, this.popDuration);
        }, delay);
        this.animationTimeouts.push(id);
    }
};

WorldTips.prototype._animateCharactersOut = function () {
    for (let i = 0; i < this.characterEntities.length; i++) {
        const ent = this.characterEntities[i];
        const delay = i * this.hideDelay * 1000;
        const last = (i === this.characterEntities.length - 1);
        const id = setTimeout(() => {
            if (!ent || !ent.element) return;
            this._animateCharacterScale(ent, 1, 0, this.hideDuration, () => {
                if (last) {
                    setTimeout(() => {
                        this._clearCharacterEntities();
                        this.isHiding = false;
                    }, 60);
                }
            });
        }, delay);
        this.animationTimeouts.push(id);
    }
};

WorldTips.prototype._animateCharacterScale = function (entity, from, to, duration, cb) {
    const start = Date.now();
    const total = Math.max(0.001, duration) * 1000;
    const tick = () => {
        if (!entity || !entity.element) { if (cb) cb(); return; }
        const t = Math.min(1, (Date.now() - start) / total);
        const eased = this._easeOutBack(t);
        const s = from + (to - from) * eased;
        entity.setLocalScale(s, s, s);
        if (t < 1) requestAnimationFrame(tick);
        else if (cb) cb();
    };
    requestAnimationFrame(tick);
};

WorldTips.prototype._easeOutBack = function (t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/* ---------------- Cleanup & Update ---------------- */
WorldTips.prototype._clearAllTimeouts = function () {
    for (let i = 0; i < this.animationTimeouts.length; i++) clearTimeout(this.animationTimeouts[i]);
    this.animationTimeouts = [];
};

WorldTips.prototype._clearCharacterEntities = function () {
    for (let i = 0; i < this.characterEntities.length; i++) {
        const e = this.characterEntities[i];
        if (e && e.destroy) e.destroy();
    }
    this.characterEntities = [];
};

WorldTips.prototype._getLayerIdByName = function (name) {
    if (!name) return null;
    const layers = this.app.scene.layers;
    const id = layers.getLayerByName(name) ? layers.getLayerByName(name).id : null;
    return id;
};

WorldTips.prototype.update = function (dt) {
    if (this.characterEntities.length === 0) return;
    const cam = this._getMainCamera();
    if (!cam) return;
    const camPos = cam.getPosition();
    for (let i = 0; i < this.characterEntities.length; i++) {
        const e = this.characterEntities[i];
        if (e && e.enabled) {
            e.lookAt(camPos);
            e.rotateLocal(0, 180, 0);
        }
    }
};

/* --- Debug helpers --- */
WorldTips.prototype.debugShow = function () { this._showTips(); };
WorldTips.prototype.debugHide = function () { this._hideTips(); };
