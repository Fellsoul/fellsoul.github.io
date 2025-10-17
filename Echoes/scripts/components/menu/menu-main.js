/**
 * @file menu-main.js
 * @desc 主菜单控制：绑定按钮点击、刷新多语言文本、触发动作或信息对话框
 * @pc-attrs
 *   buttonEntities:entity[]   - 需要绑定的按钮实体（含 Button 组件或 Element 组件）
 *   buttonTextKeys:string[]    - 每个按钮对应的多语言键（如 menu.buttons.start）
 *   buttonActionEvents:string[]- 每个按钮点击时触发的全局事件名（app.fire）
 *   buttonDialogKeys:string[]  - 每个按钮的对话框键（对应 menu.dialogs.*；若存在则优先弹对话框）
 *   panelTitleKey:string       - 面板标题的多语言键（可选）
 *   enableDebugLog:boolean     - 是否输出调试日志
 */

/* global pc */

var MenuMain = pc.createScript('MenuMain');

MenuMain.attributes.add('buttonEntities', {
    type: 'entity',
    array: true,
    title: '按钮实体数组',
    description: '需要绑定点击事件的按钮，支持Button或Element组件'
});

MenuMain.attributes.add('buttonTextKeys', {
    type: 'string',
    array: true,
    title: '按钮文本多语言键',
    description: '与按钮实体顺序一一对应，如 menu.buttons.start'
});

MenuMain.attributes.add('buttonActionEvents', {
    type: 'string',
    array: true,
    title: '按钮动作事件',
    description: '点击后触发的全局事件名（app.fire(eventName)）'
});

MenuMain.attributes.add('buttonDialogKeys', {
    type: 'string',
    array: true,
    title: '按钮对话框键',
    description: '可选：menu.dialogs.*，存在时优先弹出对话框'
});

MenuMain.attributes.add('panelTitleKey', {
    type: 'string',
    title: '面板标题键',
    description: '如 menu.panels.title.main',
    default: ''
});

MenuMain.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

MenuMain.prototype.initialize = function () {
    this._boundClicks = [];
    this._onLangChanged = this.refreshTexts.bind(this);

    // 绑定按钮点击
    this._bindButtons();

    // 首次刷新文本
    this.refreshTexts();

    // 监听语言切换事件（如项目I18n会派发）
    this.app.on('i18n:changed', this._onLangChanged, this);
};

MenuMain.prototype.destroy = function () {
    // 解绑点击
    for (var i = 0; i < this._boundClicks.length; i++) {
        var ref = this._boundClicks[i];
        if (!ref || !ref.entity || !ref.entity.enabled) continue;
        if (ref.button && ref.cb) ref.button.off('click', ref.cb, this);
        if (ref.element && ref.cbElement) ref.element.off('click', ref.cbElement, this);
    }
    this._boundClicks.length = 0;

    // 解绑语言事件
    this.app.off('i18n:changed', this._onLangChanged, this);
};

MenuMain.prototype._bindButtons = function () {
    var self = this;
    var len = this.buttonEntities ? this.buttonEntities.length : 0;
    for (var i = 0; i < len; i++) {
        var btnEnt = this.buttonEntities[i];
        if (!btnEnt) continue;

        (function (index, entity) {
            var clickHandler = function () { self._onButtonClick(index, entity); };
            // Button组件优先
            if (entity.button) {
                entity.button.on('click', clickHandler, self);
                self._boundClicks.push({ entity: entity, button: entity.button, cb: clickHandler });
            } else if (entity.element) {
                // 退化到Element点击（需要在编辑器里开启Use Input）
                entity.element.on('click', clickHandler, self);
                self._boundClicks.push({ entity: entity, element: entity.element, cbElement: clickHandler });
            } else if (self.enableDebugLog) {
                console.warn('[MenuMain] Button entity without Button/Element:', entity && entity.name);
            }
        })(i, btnEnt);
    }
};

MenuMain.prototype._onButtonClick = function (index, entity) {
    if (this.enableDebugLog) {
        console.log('[MenuMain] Click index=' + index + ' entity=' + (entity && entity.name));
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
        this.app.fire(actionEv, { source: 'MenuMain', index: index, entity: entity });
    }
};

MenuMain.prototype.refreshTexts = function () {
    // 面板标题
    if (this.panelTitleKey) {
        var titleEnt = this._findTitleEntity();
        if (titleEnt) this._setEntityText(titleEnt, this._t(this.panelTitleKey, ''));
    }

    // 按钮文本
    var len = this.buttonEntities ? this.buttonEntities.length : 0;
    for (var i = 0; i < len; i++) {
        var ent = this.buttonEntities[i];
        var key = (this.buttonTextKeys && this.buttonTextKeys[i]) || (ent && ent.name ? ('menu.Text.' + ent.name) : '');
        if (ent && key) this._setEntityText(ent, this._t(key, ent.name || ''));
    }
};

MenuMain.prototype._dialogConfigByKey = function (k) {
    // 期望键形如 menu.dialogs.quitConfirm
    var title = this._t(k + '.title', '');
    var message = this._t(k + '.message', '');
    var confirm = this._t(k + '.confirm', this._t('menu.labels.yes', 'Yes'));
    var cancel = this._t(k + '.cancel', this._t('menu.labels.no', 'No'));
    if (!title && !message) return null;
    return { title: title, message: message, confirm: confirm, cancel: cancel, key: k };
};

MenuMain.prototype._t = function (key, fallback) {
    // 集成到项目I18n：若无则返回fallback或key
    if (typeof window !== 'undefined' && window.I18n && typeof window.I18n.t === 'function') {
        return window.I18n.t(key, fallback);
    }
    return fallback || key;
};

MenuMain.prototype._findTitleEntity = function () {
    // 优先找名为Title的子节点，否则若自身是Text则返回自身
    var title = this.entity.findByName('Title');
    if (title && title.element) return title;
    if (this.entity.element && this.entity.element.type === pc.ELEMENTTYPE_TEXT) return this.entity;
    return null;
};

MenuMain.prototype._setEntityText = function (entity, text) {
    // 若entity是文本，则直接设置；若是按钮，则尝试找到其子文本
    if (!entity) return;
    if (entity.element && entity.element.type === pc.ELEMENTTYPE_TEXT) {
        entity.element.text = text;
        return;
    }
    // 寻找第一个含文本的子元素
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
