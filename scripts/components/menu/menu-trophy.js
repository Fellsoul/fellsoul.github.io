/**
 * @file menu-trophy.js
 * @desc Trophy 菜单控制：绑定按钮点击、刷新多语言文本、触发动作或信息对话框
 * @pc-attrs
 *   buttonEntities:entity[]   - 需要绑定的按钮实体（含 Button 组件或 Element 组件）
 *   buttonTextKeys:string[]    - 每个按钮对应的多语言键（如 menu.buttons.start）
 *   buttonActionEvents:string[]- 每个按钮点击时触发的全局事件名（app.fire）
 *   buttonDialogKeys:string[]  - 每个按钮的对话框键（对应 menu.dialogs.*；若存在则优先弹对话框）
 *   panelTitleKey:string       - 面板标题的多语言键（可选）
 *   enableDebugLog:boolean     - 是否输出调试日志
 */

/* global pc */

var MenuTrophy = pc.createScript('MenuTrophy');

MenuTrophy.attributes.add('buttonEntities', {
    type: 'entity',
    array: true,
    title: '按钮实体数组',
    description: '需要绑定点击事件的按钮，支持Button或Element组件'
});

MenuTrophy.attributes.add('buttonTextKeys', {
    type: 'string',
    array: true,
    title: '按钮文本多语言键',
    description: '与按钮实体顺序一一对应，如 menu.buttons.start'
});

MenuTrophy.attributes.add('buttonActionEvents', {
    type: 'string',
    array: true,
    title: '按钮动作事件',
    description: '点击后触发的全局事件名（app.fire(eventName)）'
});

MenuTrophy.attributes.add('buttonDialogKeys', {
    type: 'string',
    array: true,
    title: '按钮对话框键',
    description: '可选：menu.dialogs.*，存在时优先弹出对话框'
});

MenuTrophy.attributes.add('panelTitleKey', {
    type: 'string',
    title: '面板标题键',
    description: '如 menu.panels.title.trophy',
    default: ''
});

MenuTrophy.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

MenuTrophy.prototype.initialize = function () {
    this._boundClicks = [];
    this._onLangChanged = this.refreshTexts.bind(this);

    this._bindButtons();
    this.refreshTexts();

    this.app.on('i18n:changed', this._onLangChanged, this);
};

MenuTrophy.prototype.destroy = function () {
    for (var i = 0; i < this._boundClicks.length; i++) {
        var ref = this._boundClicks[i];
        if (!ref || !ref.entity || !ref.entity.enabled) continue;
        if (ref.button && ref.cb) ref.button.off('click', ref.cb, this);
        if (ref.element && ref.cbElement) ref.element.off('click', ref.cbElement, this);
    }
    this._boundClicks.length = 0;

    this.app.off('i18n:changed', this._onLangChanged, this);
};

MenuTrophy.prototype._bindButtons = function () {
    var self = this;
    var len = this.buttonEntities ? this.buttonEntities.length : 0;
    for (var i = 0; i < len; i++) {
        var btnEnt = this.buttonEntities[i];
        if (!btnEnt) continue;

        (function (index, entity) {
            var clickHandler = function () { self._onButtonClick(index, entity); };
            if (entity.button) {
                entity.button.on('click', clickHandler, self);
                self._boundClicks.push({ entity: entity, button: entity.button, cb: clickHandler });
            } else if (entity.element) {
                entity.element.on('click', clickHandler, self);
                self._boundClicks.push({ entity: entity, element: entity.element, cbElement: clickHandler });
            } else if (self.enableDebugLog) {
                console.warn('[MenuTrophy] Button entity without Button/Element:', entity && entity.name);
            }
        })(i, btnEnt);
    }
};

MenuTrophy.prototype._onButtonClick = function (index, entity) {
    if (this.enableDebugLog) {
        console.log('[MenuTrophy] Click index=' + index + ' entity=' + (entity && entity.name));
    }
    var dialogKey = (this.buttonDialogKeys && this.buttonDialogKeys[index]) || '';
    var actionEv = (this.buttonActionEvents && this.buttonActionEvents[index]) || '';

    if (dialogKey) {
        var cfg = this._dialogConfigByKey(dialogKey);
        if (cfg) {
            this.app.fire('ui:dialog:open', cfg);
            return;
        }
    }

    if (actionEv) {
        this.app.fire(actionEv, { source: 'MenuTrophy', index: index, entity: entity });
    }
};

MenuTrophy.prototype.refreshTexts = function () {
    if (this.panelTitleKey) {
        var titleEnt = this._findTitleEntity();
        if (titleEnt) this._setEntityText(titleEnt, this._t(this.panelTitleKey, ''));
    }

    var len = this.buttonEntities ? this.buttonEntities.length : 0;
    for (var i = 0; i < len; i++) {
        var ent = this.buttonEntities[i];
        var key = (this.buttonTextKeys && this.buttonTextKeys[i]) || (ent && ent.name ? ('menu.Text.' + ent.name) : '');
        if (ent && key) this._setEntityText(ent, this._t(key, ent.name || ''));
    }
};

MenuTrophy.prototype._dialogConfigByKey = function (k) {
    var title = this._t(k + '.title', '');
    var message = this._t(k + '.message', '');
    var confirm = this._t(k + '.confirm', this._t('menu.labels.yes', 'Yes'));
    var cancel = this._t(k + '.cancel', this._t('menu.labels.no', 'No'));
    if (!title && !message) return null;
    return { title: title, message: message, confirm: confirm, cancel: cancel, key: k };
};

MenuTrophy.prototype._t = function (key, fallback) {
    if (typeof window !== 'undefined' && window.I18n && typeof window.I18n.t === 'function') {
        return window.I18n.t(key, fallback);
    }
    return fallback || key;
};

MenuTrophy.prototype._findTitleEntity = function () {
    var title = this.entity.findByName('Title');
    if (title && title.element) return title;
    if (this.entity.element && this.entity.element.type === pc.ELEMENTTYPE_TEXT) return this.entity;
    return null;
};

MenuTrophy.prototype._setEntityText = function (entity, text) {
    if (!entity) return;
    if (entity.element && entity.element.type === pc.ELEMENTTYPE_TEXT) {
        entity.element.text = text;
        return;
    }
    var q = this._tempStack || [];
    q.length = 0;
    q.push(entity);
    while (q.length) {
        var e = q.shift();
        var comps = e && e.element ? 1 : 0;
        if (comps && e.element.type === pc.ELEMENTTYPE_TEXT) {
            e.element.text = text;
            return;
        }
        var children = e && e.children ? e.children : [];
        for (var i = 0; i < children.length; i++) q.push(children[i]);
    }
};
