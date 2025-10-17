/* global pc, DialogueUI, DialogueManager, I18n, TypingTypes, UiTypingAnimation, RightHint, GlobalCameraManager */

/**
 * UIManager.js (delegates camera to GlobalCameraManager)
 * 负责：首进打字机、白幕、对话 UI、右侧提示等 2D/3D UI；相机/机位/视角状态改由 GlobalCameraManager 管理
 */
var UIManager = pc.createScript('uiManager');

// ===== UI 状态（保留） =====
UIManager.UI_STATES = {
    HIDDEN: 'hidden',
    FIRST_TIME_INTRO: 'first_time_intro',
    TYPEWRITER: 'typewriter',
    FADE_TRANSITION: 'fade_transition',
    NORMAL: 'normal',
    ESC_CONFIRM: 'esc_confirm'
};

// ===== 视角控制状态（和之前一致；内部委托到 GlobalCameraManager） =====
UIManager.CONTROL_STATES = {
    LOCKED_MULTI: 'locked_multi',
    FREE_FIXED:   'free_fixed',
    FREE_FOLLOW:  'free_follow',
    LOCKED_FIXED: 'locked_fixed',
    DIALOGUE:     'dialogue'
};

// ---------- 属性（基本保持不变） ----------
UIManager.attributes.add('camera', { type: 'entity', title: '摄像机实体（用于 Screen.camera；真实控制由 GlobalCameraManager）' });
UIManager.attributes.add('textElement', { type: 'entity', title: '文字元素实体' });
UIManager.attributes.add('overlayElement', { type: 'entity', title: '白色背景实体(白幕)' });
UIManager.attributes.add('blackOverlayElement', { type: 'entity', title: '黑色背景实体(淡入淡出，可选)' });

UIManager.attributes.add('welcomeText', { type: 'string', default: '欢迎来到回音之魂...\n\n这是一个充满神秘的世界\n\n准备好开始你的冒险了吗？' });

UIManager.attributes.add('typewriterSpeed', { type: 'number', default: 50 });
UIManager.attributes.add('fadeSpeed', { type: 'number', default: 2 });
UIManager.attributes.add('enableDebugLog', { type: 'boolean', default: true });

UIManager.attributes.add('bgHexColor',  { type: 'string', default: '#FCFBDB', title: '首屏纯色（十六进制）' });
UIManager.attributes.add('bgFadeOutMs', { type: 'number', default: 1500,      title: '首屏纯色淡出时长(ms)' });
UIManager.attributes.add('imageCarouselContainer', { type: 'entity', title: '图片轮播容器节点（挂载 prologue 图片）' });

// 右侧提示
UIManager.attributes.add('rightHintPanel',   { type: 'entity', title: '右侧提示面板(Image Element)' });
UIManager.attributes.add('rightHintText',    { type: 'entity', title: '右侧提示文本(Text Element)' });
UIManager.attributes.add('rightHintKeyText', { type: 'entity', title: '右侧提示键位(Text Element)' });
UIManager.attributes.add('rightHintShowMs',  { type: 'number', default: 160, title: '提示-显示时长(ms)' });
UIManager.attributes.add('rightHintHideMs',  { type: 'number', default: 140, title: '提示-隐藏时长(ms)' });

// 对话 UI
UIManager.attributes.add('dialogueRootEntity',       { type: 'entity', title: '对话UI根(容器)' });
UIManager.attributes.add('dialogueTextEntity',       { type: 'entity', title: '对话文本(Element Text)' });
UIManager.attributes.add('dialogueBackgroundEntity', { type: 'entity', title: '对话背景(可选)' });
UIManager.attributes.add('dialogueButtonsContainer', { type: 'entity', title: '选项按钮容器(可选)' });
UIManager.attributes.add('dialogueButtonGroup',     { type: 'entity', title: '按钮组容器(新)' });
UIManager.attributes.add('dialogueButtonTemplate',   { type: 'entity', title: '按钮模板(含button插件)' });
UIManager.attributes.add('dialogueButtonSpacing',    { type: 'number', default: 150,  title: '按钮间距(px)' });
UIManager.attributes.add('dialogueButtonsMargin',    { type: 'number', default: 24, title: '按钮与文本间距(px)' });
UIManager.attributes.add('dialogueButtonMaxTextWidth', { type: 'number', default: 300, title: '按钮文字最大宽度(px)' });
UIManager.attributes.add('dialogueAutoPlaceButtons', { type: 'boolean', default: false, title: '自动将按钮放在文本右侧(通常关闭)' });

// NPC名字显示
UIManager.attributes.add('dialogueNpcNameEntity', { type: 'entity', title: 'NPC名字显示文本(Element Text)' });
UIManager.attributes.add('dialogueUnknownNpcName', { type: 'string', default: '???', title: '未知NPC显示名字' });

// ESC确认界面（代码生成，无需配置属性）

// 菜单设置UI
UIManager.attributes.add('menuScrollView',           { type: 'entity', title: '菜单设置ScrollView主实体' });
UIManager.attributes.add('menuScrollViewContent',    { type: 'entity', title: '菜单设置ScrollView Content' });

// Prologue 播放按钮模板
UIManager.attributes.add('prologuePlayButtonTemplate', { type: 'entity', title: 'Prologue播放按钮模板' });

// 与相机相关的组名（仅用于调用 GlobalCameraManager；这里仍保留以兼容原配置）
UIManager.attributes.add('mainMenuGroupName', { type: 'string', default: 'mainMenu', title: '主菜单机位组名(转交给相机管理器)' });
UIManager.attributes.add('mainMenuMainPos',   { type: 'string', default: 'main',     title: '主菜单默认子机位名' });
UIManager.attributes.add('fixedGroupName',    { type: 'string', default: 'fixed',    title: '固定机位组名' });
UIManager.attributes.add('fixedSubPos',       { type: 'string', default: 'main',     title: '固定机位子名' });

UIManager.attributes.add('dialogueYawRange',   { type: 'number', default: 50, title: '对话-左右夹角(°)' });
UIManager.attributes.add('dialoguePitchRange', { type: 'number', default: 50, title: '对话-上下夹角(°)' });

// ESC确认界面字体
UIManager.attributes.add('escConfirmFont', { type: 'asset', assetType: 'font', title: 'ESC确认界面字体' });

// 单例
UIManager._instance = null;
UIManager.getInstance = function () { return UIManager._instance; };

// ---------- 初始化 ----------
UIManager.prototype.initialize = function () {
    if (UIManager._instance && UIManager._instance !== this) { 
        console.warn('[UIManager] Multiple instances detected.'); 
        return; 
    }
    UIManager._instance = this;

    this.currentState = UIManager.UI_STATES.HIDDEN;
    this.isTransitioning = false;

    this.animationState = { typewriterIndex: 0, typewriterTimer: 0, isAnimating: false, fadeAlpha: 0, fadeDirection: 1 };

    if (!this._validateAndInitUI()) {
        // UI 未完全就绪也先挂上对话适配器，避免 DialogueManager 报错
        try { if (typeof this._bindDialogueAdaptor === 'function') this._bindDialogueAdaptor(); } catch (e) {}
        return;
    }

    // 跳字相关输入
    this._bindInputs();

    // 初始化时隐藏对话根
    try { if (this.dialogueRootEntity) this.dialogueRootEntity.enabled = false; } catch (e) {}
    
    // 初始化ESC确认界面
    this._initEscConfirmUI();

    // —— 对话 UI 适配器（绑定 DialogueUI & DialogueManager.setUI）——
    this._bindDialogueAdaptor = function () {
        try {
            if (typeof DialogueUI !== 'undefined' && DialogueUI.init) {
                DialogueUI.init(this.app, { screen: this.entity, debug: !!this.enableDebugLog });
                if (typeof DialogueUI.configure === 'function') {
                    DialogueUI.configure({
                        root: this.dialogueRootEntity || null,
                        text: this.dialogueTextEntity || null,
                        bg: this.dialogueBackgroundEntity || null,
                        container: this.dialogueButtonsContainer || (this.dialogueRootEntity || null),
                        template: this.dialogueButtonTemplate || null,
                        spacing: (this.dialogueButtonSpacing|0) || 8
                    });
                }
            }
            if (typeof DialogueManager !== 'undefined' && DialogueManager.setUI) {
                var self = this;
                DialogueManager.setUI({
                    setManager: function(m) { /* optional */ },
                    showNode: function(node, answers) {
                        try {
                            if (typeof DialogueUI !== 'undefined' && DialogueUI.show) {
                                // 给 DialogueUI 传递 textInfo（兼容你的布局流程）
                                var textInfo = null;
                                if (self.dialogueTextEntity && self.dialogueTextEntity.element) {
                                    var textEl = self.dialogueTextEntity.element;
                                    var worldPos = self.dialogueTextEntity.getPosition();
                                    textInfo = {
                                        x: worldPos.x,
                                        y: worldPos.y,
                                        width:  textEl.calculatedWidth  || textEl.width  || 0,
                                        height: textEl.calculatedHeight || textEl.height || 0
                                    };
                                }
                                DialogueUI.show(node, answers, textInfo);
                            }
                        } catch (e) { if (self.enableDebugLog) console.warn('[UIManager] DialogueUI.show failed:', e); }
                    },
                    hide: function() { try { if (typeof DialogueUI !== 'undefined' && DialogueUI.hide) DialogueUI.hide(); } catch (e) {} }
                });
            }
            try { this.app.fire('ui:dialogue:ready'); } catch (e) {}
        } catch (e) { if (this.enableDebugLog) console.warn('[UIManager] bindDialogueAdaptor failed:', e); }
    };
    this._bindDialogueAdaptor();
    
    // —— 菜单设置 UI 适配器 ——
    this._bindMenuSettingsUI = function () {
        try {
            if (typeof MenuSettingsUI !== 'undefined' && MenuSettingsUI.init) {
                MenuSettingsUI.init(this.app, { debug: !!this.enableDebugLog });
                if (this.enableDebugLog) {
                    console.log('[UIManager] MenuSettingsUI initialized');
                }
            }
        } catch (e) {
            console.warn('[UIManager] MenuSettingsUI init failed:', e);
        }
    };
    this._bindMenuSettingsUI();

    // —— 对话模式事件：状态交给 GlobalCameraManager 处理 —— //
    var self = this;
    this._onDialogueBegin = function (info) {
        try { self.dialogueNpcName = (info && info.npc) ? String(info.npc) : ''; } catch (e) {}
        try { self._bindDialogueAdaptor(); } catch (e) {}
        try { if (info && info.buttonsPos && DialogueUI && DialogueUI.setButtonsPosition) DialogueUI.setButtonsPosition(info.buttonsPos); } catch (e) {}
        try {
            var gcam = GlobalCameraManager.getInstance();
            if (gcam) gcam.setState(GlobalCameraManager.CONTROL_STATES.DIALOGUE);
        } catch (e) {}
    };
    this.app.on('ui:dialogue:begin', this._onDialogueBegin, this);

    this._onDialogueEnd = function () {
        try {
            var gcam = GlobalCameraManager.getInstance();
            if (gcam) {
                // 清除夹角限制在相机管理器内部完成
                gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
            }
        } catch (e) {}
        try { if (DialogueUI && DialogueUI.hide) DialogueUI.hide(); } catch (e) {}
    };
    this.app.on('ui:dialogue:end', this._onDialogueEnd, this);

    // ★★★ 在任何其他逻辑之前，立即设置玩家坐姿和相机状态 ★★★
    // 这样可以在其他脚本（CameraTransition、PlayerController）初始化时就已经是正确状态
    var self = this;
    this._setInitialPlayerAndCameraState = function() {
        try {
            // 立即设置玩家坐姿
            self.app.fire('player:set_sitting', true);
            console.log('[UIManager] Initialize: Set player sitting state');
            
            // 立即设置相机为锁定多机位状态
            var gcam = (typeof GlobalCameraManager !== 'undefined') ? GlobalCameraManager.getInstance() : null;
            if (gcam) {
                gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
                gcam.snapToMainMenu();
                console.log('[UIManager] Initialize: Set camera to LOCKED_MULTI');
            }
        } catch (e) {
            console.warn('[UIManager] Failed to set initial player/camera state:', e);
        }
    };
    
    // 立即执行一次
    this._setInitialPlayerAndCameraState();
    
    // 延迟再次确认（防止被其他脚本的初始化覆盖）
    setTimeout(function() {
        self._setInitialPlayerAndCameraState();
        console.log('[UIManager] Re-confirmed player/camera state after 100ms');
    }, 100);
    
    setTimeout(function() {
        self._setInitialPlayerAndCameraState();
        console.log('[UIManager] Re-confirmed player/camera state after 300ms');
    }, 300);
    
    // 首进：等 i18n 就绪后开始
    this._introStarted = false;
    var hasPrologue = (typeof I18n !== 'undefined' && I18n.get && I18n.get('prologue'));
    if (hasPrologue) {
        this._startFirstTimeIntro();
    } else {
        this.app.once('i18n:ready', function () {
            if (!this._introStarted) this._startFirstTimeIntro();
        }, this);
    }
    
    // 监听关卡 prologue 播放事件
    this._onLevelProloguePlay = this._handleLevelProloguePlay.bind(this);
    this.app.on('level:prologue:play', this._onLevelProloguePlay, this);
    
    // 监听菜单触发的 prologue 播放事件
    this._onUIPlayPrologue = this._handleUIPlayPrologue.bind(this);
    this.app.on('ui:play:prologue', this._onUIPlayPrologue, this);

    // 右侧提示（保持不变）
    try { if (typeof RightHint !== 'undefined' && RightHint.init) RightHint.init(this.app, { panel: this.rightHintPanel, text: this.rightHintText, key: this.rightHintKeyText, debug: this.enableDebugLog }); } catch (e) {}
    this._onUiHintShow = function (data) { if (!data || data.side !== 'right') return; this.showRightHint(data.text || '', data); };
    this._onUiHintHide = function (data) { if (data && data.side && data.side !== 'right') return; this.hideRightHint(data); };
    this.app.on('ui:hint:show', this._onUiHintShow, this);
    this.app.on('ui:hint:hide', this._onUiHintHide, this);

    // 兼容旧接口：外部 still 可以发 ui:control:set；这里转发给 GlobalCameraManager
    var self = this;
    this._onUiControlSet = function (state) {
        console.log('[UIManager] ui:control:set event received:', state);
        var gcam = GlobalCameraManager.getInstance();
        if (!gcam) {
            console.warn('[UIManager] GlobalCameraManager not available');
            return;
        }
        var ST = GlobalCameraManager.CONTROL_STATES;
        var v = state;
        if (typeof v === 'string') v = ST[v] || v;
        if (!v) v = ST.LOCKED_MULTI;
        console.log('[UIManager] Setting camera state to:', v);
        gcam.setState(v);
    };
    this.app.on('ui:control:set', this._onUiControlSet, this);
    
    // ★★ 只在 Start 场景中延迟设置初始状态为 LOCKED_MULTI ★★
    var self = this;
    var sceneName = (this.app.scene && this.app.scene.name) || '';
    var isStartScene = (sceneName.toLowerCase() === 'start' || sceneName.toLowerCase() === 'main');
    
    if (isStartScene) {
        setTimeout(function() {
            try {
                // 设置玩家坐姿
                self.app.fire('player:set_sitting', true);
                if (self.enableDebugLog) console.log('[UIManager] Set initial player sitting state (delayed) - Start scene');
                
                // 设置相机为锁定多机位状态
                self.app.fire('ui:control:set', 'LOCKED_MULTI');
                if (self.enableDebugLog) console.log('[UIManager] Set initial camera state to LOCKED_MULTI (delayed) - Start scene');
                
                // 再次延迟确保状态不被 PlayerController 覆盖
                setTimeout(function() {
                    try {
                        self.app.fire('player:set_sitting', true);
                        self.app.fire('ui:control:set', 'LOCKED_MULTI');
                        if (self.enableDebugLog) console.log('[UIManager] Re-enforced LOCKED_MULTI state after PlayerController init - Start scene');
                    } catch (e) {
                        if (self.enableDebugLog) console.warn('[UIManager] Failed to re-enforce states:', e);
                    }
                }, 150); // 延迟 150ms，确保在 PlayerController 的 100ms 延迟之后执行
            } catch (e) {
                if (self.enableDebugLog) console.warn('[UIManager] Failed to set initial states (delayed):', e);
            }
        }, 50); // 延迟 50ms，确保 GlobalCameraManager 已初始化
    } else {
        if (self.enableDebugLog) console.log('[UIManager] Non-start scene detected, skipping LOCKED_MULTI initialization');
    }
};

UIManager.prototype.update = function (dt) {
    if (this.isTransitioning) return;
    switch (this.currentState) {
        case UIManager.UI_STATES.TYPEWRITER:       this._updateTypewriter(dt);       break;
        case UIManager.UI_STATES.FADE_TRANSITION:  this._updateFadeTransition(dt);  break;
    }
};

// ---------- UI 基础校验 ----------
UIManager.prototype._validateAndInitUI = function () {
    var ok = true;

    if (!this.entity.screen) { console.error('[UIManager] Screen component missing on this entity.'); ok = false; }
    if (!this.textElement || !this.textElement.element || this.textElement.element.type !== pc.ELEMENTTYPE_TEXT) { console.error('[UIManager] textElement must be a Text Element.'); ok = false; }
    if (!this.overlayElement || !this.overlayElement.element || this.overlayElement.element.type !== pc.ELEMENTTYPE_IMAGE) { console.error('[UIManager] overlayElement must be an Image Element (white screen).'); ok = false; }
    if (this.blackOverlayElement && (!this.blackOverlayElement.element || this.blackOverlayElement.element.type !== pc.ELEMENTTYPE_IMAGE)) { console.warn('[UIManager] blackOverlayElement invalid, fade transition will be skipped.'); this.blackOverlayElement = null; }
    if (!ok) return false;

    if (this.camera) this.entity.screen.camera = this.camera;

    var te = this.textElement.element;
    te.text = '';
    te.opacity = 1;
    this.textElement.setLocalPosition(0, 0, 0);
    try {
        te.anchor = new pc.Vec4(0.5, 0.5, 0.5, 0.5);
        te.pivot  = new pc.Vec2(0.5, 0.5);
        te.margin = new pc.Vec4(0, 0, 0, 0);
        te.wrapLines = false;
        te.autoWidth = false;
        te.width = 1200;
        te.alignment = new pc.Vec2(0.5, 0.5);
    } catch (e) {}
    te.drawOrder = 1000;

    if (this.blackOverlayElement) {
        var be = this.blackOverlayElement.element;
        be.color = new pc.Color(0, 0, 0, 1);
        be.opacity = 0;
        this.blackOverlayElement.enabled = false;
    }

    if (!te.fontAsset && this.app.assets && this.app.assets.list) {
        var list = this.app.assets.list();
        for (var i = 0; i < list.length; i++) { if (list[i].type === 'font') { te.fontAsset = list[i].id; break; } }
    }
    return true;
};

// ---------- 输入：加速打字（支持桌面和移动端） ----------
UIManager.prototype._bindInputs = function () {
    var self = this;
    this._isSpeedingUp = false;
    
    // 键盘事件（桌面）
    this.onKeyDown = function (e) {
        if (e.key === pc.KEY_SPACE && (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO)) {
            self._speedUpTypewriter(true);
        }
        // ESC键处理 - typewriter 或 first_time_intro 状态时忽略
        if (e.key === pc.KEY_ESCAPE) {
            if (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO) {
                console.log('[UIManager] ESC key ignored during animation state:', self.currentState);
                return;
            }
            self._handleEscKey();
        }
    };
    
    this.onKeyUp = function (e) {
        if (e.key === pc.KEY_SPACE && (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO)) {
            self._speedUpTypewriter(false);
        }
    };
    
    // 鼠标事件（桌面）
    this.onMouseDown = function () {
        if (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO) {
            self._speedUpTypewriter(true);
        }
    };
    
    this.onMouseUp = function () {
        if (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO) {
            self._speedUpTypewriter(false);
        }
    };
    
    // 触摸事件（移动端）
    this.onTouchStart = function () {
        if (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO) {
            self._speedUpTypewriter(true);
        }
    };
    
    this.onTouchEnd = function () {
        if (self.currentState === UIManager.UI_STATES.TYPEWRITER || self.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO) {
            self._speedUpTypewriter(false);
        }
    };
    
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this.onKeyDown, this);
    this.app.keyboard.on(pc.EVENT_KEYUP, this.onKeyUp, this);
    this.app.mouse.on(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    this.app.mouse.on(pc.EVENT_MOUSEUP, this.onMouseUp, this);
    
    // 绑定触摸事件
    if (this.app.touch) {
        this.app.touch.on(pc.EVENT_TOUCHSTART, this.onTouchStart, this);
        this.app.touch.on(pc.EVENT_TOUCHEND, this.onTouchEnd, this);
    }
};

// ---------- 首进流程 ----------
UIManager.prototype._startFirstTimeIntro = function () {
    console.log('[UIManager] _startFirstTimeIntro called');
    this._introStarted = true;
    
    // 检查当前场景，只在Start场景播放welcome prologue
    var currentScene = '';
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.getCurrentScene) {
            currentScene = GlobalGame.getCurrentScene() || '';
        } else if (this.app.scene && this.app.scene.name) {
            currentScene = this.app.scene.name || '';
        }
    } catch (e) {
        console.warn('[UIManager] Failed to get current scene:', e);
    }
    
    console.log('[UIManager] Current scene:', currentScene);
    
    // 只在Start场景播放welcome prologue
    // 如果场景名称为空，可能是首次加载，默认认为是Start场景
    if (currentScene && currentScene.toLowerCase() !== 'start' && currentScene.toLowerCase() !== 'main') {
        console.log('[UIManager] Not in Start scene (' + currentScene + '), skipping welcome prologue');
        this._finishFirstTimeIntro();
        return;
    }
    
    // 如果场景名称为空，记录日志但继续执行
    if (!currentScene) {
        console.log('[UIManager] Scene name is empty, assuming Start scene (first load)');
    }
    
    // 检查是否已经访问过 welcome prologue
    var hasVisited = false;
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.hasPrologueVisited) {
            hasVisited = GlobalGame.hasPrologueVisited('welcome');
            console.log('[UIManager] Welcome prologue visited before:', hasVisited);
            
            // 额外调试：检查localStorage
            if (typeof localStorage !== 'undefined') {
                var stored = localStorage.getItem('echoSoul_prologueVisited');
                console.log('[UIManager] localStorage echoSoul_prologueVisited:', stored);
            }
        } else {
            console.warn('[UIManager] GlobalGame.hasPrologueVisited not available');
        }
    } catch (e) {
        console.warn('[UIManager] Failed to check prologue visited:', e);
    }
    
    // 如果已访问过，直接跳过 prologue 进入主菜单
    if (hasVisited) {
        console.log('[UIManager] Skipping welcome prologue (already visited)');
        this._finishFirstTimeIntro();
        return;
    }
    
    console.log('[UIManager] ✓ All checks passed, starting welcome prologue');
    
    // ★★ 不在动画播放前设置坐姿，而是在动画完成后通过 _finishFirstTimeIntro 中的延迟设置 ★★
    // 切换 UIManager 状态开始动画
    this._changeState(UIManager.UI_STATES.FIRST_TIME_INTRO);

    if (this.enableDebugLog) {
        console.log('[UIManager] _startFirstTimeIntro - imageCarouselContainer:', this.imageCarouselContainer);
    }

    var data, opts;
    var i18nData = (typeof I18n !== 'undefined') ? I18n.getTypingData('prologue', 'welcome') : null;
    var i18nOpts = (typeof I18n !== 'undefined') ? I18n.getTypingOptions('prologue', 'welcomeOptions') : null;

    if (typeof TypingTypes !== 'undefined') {
        var lines = [];
        if (i18nData && i18nData.typeLines && i18nData.typeLines.length) {
            for (var i = 0; i < i18nData.typeLines.length; i++) {
                var l = i18nData.typeLines[i] || {};
                if (this.enableDebugLog && i === 0) {
                    console.log('[UIManager] First line from i18nData:', l);
                    console.log('[UIManager] imageName:', l.imageName, 'clearImage:', l.clearImage);
                }
                lines.push(TypingTypes.createLine(l.text || '', { 
                    durations: l.durations, 
                    bold: l.bold, 
                    color: l.color, 
                    size: l.size, 
                    clear: l.clear,
                    imageName: l.imageName,
                    clearImage: l.clearImage
                }));
            }
        } else {
            lines.push(TypingTypes.createLine(this.welcomeText || '', { color: '#000000' }));
        }
        data = TypingTypes.createData(lines);

        var baseOpts = {
            defaultCharMs: Math.max(0, this.typewriterSpeed|0) || undefined,
            lineGapMs: 300,
            enableDebugLog: !!this.enableDebugLog,
            overlayEntity: this.overlayElement,
            bgHexColor: this.bgHexColor,
            bgFadeOutMs: this.bgFadeOutMs,
            autoFadeOut: true,
            imageCarouselContainer: this.imageCarouselContainer
        };
        if (this.enableDebugLog) {
            console.log('[UIManager] baseOpts.imageCarouselContainer:', baseOpts.imageCarouselContainer);
        }
        if (i18nOpts) {
            if (typeof i18nOpts.defaultCharMs === 'number') baseOpts.defaultCharMs = i18nOpts.defaultCharMs;
            if (typeof i18nOpts.lineGapMs   === 'number') baseOpts.lineGapMs   = i18nOpts.lineGapMs;
            if (typeof i18nOpts.bgHexColor  === 'string') baseOpts.bgHexColor  = i18nOpts.bgHexColor;
            if (typeof i18nOpts.bgFadeOutMs === 'number') baseOpts.bgFadeOutMs = i18nOpts.bgFadeOutMs;
            if (typeof i18nOpts.enableDebugLog === 'boolean') baseOpts.enableDebugLog = i18nOpts.enableDebugLog;
            if (typeof i18nOpts.autoFadeOut === 'boolean') baseOpts.autoFadeOut = i18nOpts.autoFadeOut;
        }
        opts = TypingTypes.createOptions(baseOpts);
        if (this.enableDebugLog) {
            console.log('[UIManager] After TypingTypes.createOptions, opts:', opts);
        }
    } else {
        data = i18nData && i18nData.typeLines && i18nData.typeLines.length ? i18nData : { typeLines: [ { text: this.welcomeText || '', color: '#000000' } ] };
        opts = {
            defaultCharMs: (i18nOpts && typeof i18nOpts.defaultCharMs === 'number') ? i18nOpts.defaultCharMs : (Math.max(0, this.typewriterSpeed|0) || 50),
            lineGapMs:     (i18nOpts && typeof i18nOpts.lineGapMs   === 'number') ? i18nOpts.lineGapMs   : 300,
            enableDebugLog: (i18nOpts && typeof i18nOpts.enableDebugLog === 'boolean') ? i18nOpts.enableDebugLog : !!this.enableDebugLog,
            overlayEntity: this.overlayElement,
            bgHexColor:    (i18nOpts && typeof i18nOpts.bgHexColor  === 'string') ? i18nOpts.bgHexColor  : this.bgHexColor,
            bgFadeOutMs:   (i18nOpts && typeof i18nOpts.bgFadeOutMs === 'number') ? i18nOpts.bgFadeOutMs : this.bgFadeOutMs,
            autoFadeOut:   (i18nOpts && typeof i18nOpts.autoFadeOut === 'boolean') ? i18nOpts.autoFadeOut : true,
            imageCarouselContainer: this.imageCarouselContainer
        };
    }

    var self = this;
    
    this.playTypingData(data, opts, function () {
        // prologue 播放完成后调用 _finishFirstTimeIntro
        console.log('[UIManager] Welcome prologue completed, calling _finishFirstTimeIntro');
        self._finishFirstTimeIntro();
    });
};

// ---- UI 菜单触发的 Prologue 播放处理 ----
UIManager.prototype._handleUIPlayPrologue = function (eventData) {
    if (!eventData || !eventData.prologueKey) {
        if (this.enableDebugLog) console.warn('[UIManager] UI play prologue event missing prologueKey');
        return;
    }
    
    var prologueKey = eventData.prologueKey;
    var options = eventData.options || {};
    
    if (this.enableDebugLog) {
        console.log('[UIManager] Playing prologue from menu:', prologueKey);
    }
    
    // 调用通用 prologue 播放方法
    this.playPrologue(prologueKey, options, function () {
        if (this.enableDebugLog) {
            console.log('[UIManager] Prologue playback completed:', prologueKey);
        }
    }.bind(this));
};

// ---- 关卡 Prologue 播放处理 ----
UIManager.prototype._handleLevelProloguePlay = function (eventData) {
    if (!eventData || !eventData.data) {
        if (this.enableDebugLog) console.warn('[UIManager] Level prologue event missing data');
        return;
    }
    
    var levelKey = eventData.levelKey || 'level1';
    var levelData = eventData.data;
    
    if (this.enableDebugLog) {
        console.log('[UIManager] Playing level prologue for:', levelKey);
        console.log('[UIManager] Level data:', levelData);
    }
    
    // 简化：直接使用关卡数据
    var data = levelData;
    var opts = levelData.options || {};
    
    // 设置基本选项
    opts.overlayEntity = this.overlayElement;
    opts.imageCarouselContainer = this.imageCarouselContainer;
    opts.enableDebugLog = !!this.enableDebugLog;
    
    // 播放关卡 prologue
    this._changeState(UIManager.UI_STATES.TYPEWRITER);
    this.playTypingData(data, opts, function () {
        // 完成后触发事件
        this.app.fire('level:prologue:complete', { levelKey: levelKey });
    }.bind(this));
};

// ---- 打字机桥接（简化版） ----
UIManager.prototype.playTypingData = function (data, options, onComplete) {
    options = options || {};
    console.log('[UIManager] playTypingData called, onComplete:', !!onComplete);
    
    try {
        if (typeof UiTypingAnimation !== 'undefined' && UiTypingAnimation.createPlayer) {
            if (this._typingPlayer && this._typingPlayer.state !== 'done') this._typingPlayer.skip();
            this._typingPlayer = UiTypingAnimation.createPlayer(this.app, this.textElement, data, options);
            
            // 包装 onComplete 回调以添加调试信息
            var wrappedCallback = function() {
                console.log('[UIManager] Typewriter animation completed, calling onComplete');
                if (onComplete) {
                    try {
                        onComplete();
                    } catch (e) {
                        console.error('[UIManager] onComplete callback failed:', e);
                    }
                } else {
                    console.warn('[UIManager] No onComplete callback provided');
                }
            };
            
            // 直接调用 UiTypingAnimation，让它处理所有逻辑
            this._typingPlayer.play(wrappedCallback);
            
            if (this.textElement && this.textElement.element) this.textElement.element.opacity = 1;
            if (this.overlayElement && this.overlayElement.element) this.overlayElement.element.opacity = 1;
            
            // 只有在不是 typewriter 或 first_time_intro 状态时才切换状态
            if (this.currentState !== UIManager.UI_STATES.TYPEWRITER && this.currentState !== UIManager.UI_STATES.FIRST_TIME_INTRO) {
                this._changeState(UIManager.UI_STATES.TYPEWRITER);
            }
        } else {
            console.warn('[UIManager] UiTypingAnimation not available');
            if (onComplete) onComplete();
        }
    } catch (e) {
        console.warn('[UIManager] playTypingData failed:', e);
        if (onComplete) onComplete();
    }
};

UIManager.prototype._updateTypewriter = function () { /* 由通用打字机驱动，无需实现 */ };

UIManager.prototype._speedUpTypewriter = function (speedUp) {
    // 支持 TYPEWRITER 和 FIRST_TIME_INTRO 状态
    if (this.currentState !== UIManager.UI_STATES.TYPEWRITER && this.currentState !== UIManager.UI_STATES.FIRST_TIME_INTRO) return;
    if (this._typingPlayer && this._typingPlayer.state !== 'done') {
        this._typingPlayer.setSpeedMultiplier(speedUp ? 5 : 1); // 加速5倍
        this._isSpeedingUp = speedUp;
        if (this.enableDebugLog) console.log('[UIManager] Typewriter speed:', speedUp ? '5x' : '1x', 'state:', this.currentState);
    }
};

UIManager.prototype._skipTypewriter = function () {
    // 支持 TYPEWRITER 和 FIRST_TIME_INTRO 状态
    if (this.currentState !== UIManager.UI_STATES.TYPEWRITER && this.currentState !== UIManager.UI_STATES.FIRST_TIME_INTRO) return;
    if (this._typingPlayer && this._typingPlayer.state !== 'done') {
        this._typingPlayer.skip();
        if (this.enableDebugLog) console.log('[UIManager] Typewriter skipped, state:', this.currentState);
    }
};

UIManager.prototype._startFadeTransition = function () { this._finishFirstTimeIntro(); };

UIManager.prototype._finishFirstTimeIntro = function () {
    // 标记 welcome prologue 为已访问
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.markPrologueVisited) {
            GlobalGame.markPrologueVisited('welcome');
            if (this.enableDebugLog) console.log('[UIManager] Marked welcome prologue as visited');
        }
    } catch (e) {
        if (this.enableDebugLog) console.warn('[UIManager] Failed to mark prologue visited:', e);
    }
    
    this._changeState(UIManager.UI_STATES.NORMAL);

    // 多次延迟确保玩家和相机状态不被其他系统改变
    var self = this;
    
    // 第一次：100ms后设置
    setTimeout(function() {
        try {
            self.app.fire('player:set_sitting', true);
            console.log('[UIManager] Maintained player sitting state after prologue (100ms)');
            
            var gcam = (typeof GlobalCameraManager !== 'undefined') ? GlobalCameraManager.getInstance() : null;
            if (gcam) {
                gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
                gcam.snapToMainMenu();
                console.log('[UIManager] Camera state applied: LOCKED_MULTI (100ms)');
            }
        } catch (e) {
            console.warn('[UIManager] Failed to apply state (100ms):', e);
        }
    }, 100);
    
    // 第二次：200ms后再次确认（防止被GameManager的延迟调用覆盖）
    setTimeout(function() {
        try {
            self.app.fire('player:set_sitting', true);
            console.log('[UIManager] Re-confirmed player sitting state (200ms)');
            
            var gcam = (typeof GlobalCameraManager !== 'undefined') ? GlobalCameraManager.getInstance() : null;
            if (gcam) {
                gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
                gcam.snapToMainMenu();
                console.log('[UIManager] Re-confirmed camera LOCKED_MULTI (200ms)');
            }
        } catch (e) {
            console.warn('[UIManager] Failed to apply state (200ms):', e);
        }
    }, 200);
    
    // 第三次：600ms后最终确认（确保在所有延迟调用之后）
    setTimeout(function() {
        try {
            self.app.fire('player:set_sitting', true);
            console.log('[UIManager] Final confirmation - player sitting state (600ms)');
            
            var gcam = (typeof GlobalCameraManager !== 'undefined') ? GlobalCameraManager.getInstance() : null;
            if (gcam) {
                gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
                gcam.snapToMainMenu();
                console.log('[UIManager] Final confirmation - camera LOCKED_MULTI (600ms)');
            }
        } catch (e) {
            console.warn('[UIManager] Failed to apply state (600ms):', e);
        }
    }, 600);

    this._hideAllUI();
    this.app.fire('ui:first_time_intro_complete');
};

UIManager.prototype._hideAllUI = function () {
    if (this.overlayElement && this.overlayElement.element) this.overlayElement.element.opacity = 0;
    if (this.blackOverlayElement && this.blackOverlayElement.element) this.blackOverlayElement.element.opacity = 0;
    if (this.textElement && this.textElement.element) this.textElement.element.text = '';
};

UIManager.prototype.showRightHint = function (text, options) {
    try {
        if (typeof RightHint !== 'undefined' && RightHint.show) {
            if (RightHint.configure) RightHint.configure({ panel: this.rightHintPanel, text: this.rightHintText, key: this.rightHintKeyText, debug: this.enableDebugLog });
            var opts = options || {};
            if (typeof opts.slideMs === 'undefined') opts.slideMs = (this.rightHintShowMs|0) || 160;
            RightHint.show(text, opts);
            return;
        }
    } catch (e) { if (this.enableDebugLog) console.warn('[UIManager.showRightHint] RightHint error:', e); }
    if (this.enableDebugLog) console.warn('[UIManager.showRightHint] RightHint not available');
};

UIManager.prototype.hideRightHint = function (options) {
    try {
        if (typeof RightHint !== 'undefined' && RightHint.hide) {
            if (RightHint.configure) RightHint.configure({ panel: this.rightHintPanel, text: this.rightHintText, key: this.rightHintKeyText, debug: this.enableDebugLog });
            var opts = options || {};
            if (typeof opts.slideMs === 'undefined') opts.slideMs = (this.rightHintHideMs|0) || 140;
            RightHint.hide(opts);
            return;
        }
    } catch (e) { if (this.enableDebugLog) console.warn('[UIManager.hideRightHint] RightHint error:', e); }
};

UIManager.prototype._changeState = function (newState) {
    if (this.currentState === newState) return;
    var from = this.currentState;
    this.currentState = newState;
    console.log('[UIManager] State changed:', from, '->', newState);
    console.log('[UIManager] Firing ui:state_changed event with data:', { from: from, to: newState });
    this.app.fire('ui:state_changed', { from: from, to: newState });
};

// 通用 prologue 播放方法
UIManager.prototype.playPrologue = function (prologueKey, options, onComplete) {
    if (!prologueKey) {
        if (this.enableDebugLog) console.warn('[UIManager] playPrologue: prologueKey is required');
        if (onComplete) onComplete();
        return;
    }
    
    options = options || {};
    var self = this;
    
    if (this.enableDebugLog) {
        console.log('[UIManager] Playing prologue:', prologueKey);
    }
    
    // 从 I18n 获取 prologue 数据
    var i18nData = null;
    var i18nOpts = null;
    
    try {
        if (typeof I18n !== 'undefined') {
            i18nData = I18n.getTypingData('prologue', prologueKey);
            i18nOpts = I18n.getTypingOptions('prologue', prologueKey + 'Options');
        }
    } catch (e) {
        if (this.enableDebugLog) console.warn('[UIManager] Failed to get i18n data for:', prologueKey, e);
    }
    
    if (!i18nData || !i18nData.typeLines || !i18nData.typeLines.length) {
        if (this.enableDebugLog) console.warn('[UIManager] No prologue data found for:', prologueKey);
        if (onComplete) onComplete();
        return;
    }
    
    // 简化：直接使用 I18n 数据和选项
    var data = i18nData;
    var opts = i18nOpts || {};
    
    // 设置基本选项
    opts.overlayEntity = this.overlayElement;
    opts.imageCarouselContainer = this.imageCarouselContainer;
    opts.enableDebugLog = !!this.enableDebugLog;
    
    // 切换到打字机状态
    this._changeState(UIManager.UI_STATES.TYPEWRITER);
    
    // 直接调用 UiTypingAnimation
    this.playTypingData(data, opts, function () {
        // 标记为已访问
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.markPrologueVisited) {
                GlobalGame.markPrologueVisited(prologueKey);
                if (self.enableDebugLog) console.log('[UIManager] Marked prologue as visited:', prologueKey);
            }
        } catch (e) {
            if (self.enableDebugLog) console.warn('[UIManager] Failed to mark prologue visited:', e);
        }
        
        // 切换状态回 NORMAL
        console.log('[UIManager] Prologue completed, switching to NORMAL state');
        self._changeState(UIManager.UI_STATES.NORMAL);
        
        // 触发完成事件
        self.app.fire('prologue:complete', { prologueKey: prologueKey });
        
        if (onComplete) onComplete();
    });
};

// ===== 公共 API：播放指定的 prologue =====
UIManager.prototype.playLevelPrologue = function (prologueKey, onComplete) {
    if (!prologueKey || prologueKey.trim() === '') {
        if (this.enableDebugLog) console.warn('[UIManager] playLevelPrologue: prologueKey is empty');
        if (onComplete) onComplete();
        return;
    }
    
    if (this.enableDebugLog) {
        console.log('[UIManager] playLevelPrologue called with key:', prologueKey);
    }
    
    // 直接调用现有的 playPrologue 方法
    this.playPrologue(prologueKey, {}, onComplete);
};

// 兼容：提供 setControlState，内部委托到 GlobalCameraManager
UIManager.prototype.setControlState = function (state) {
    var gcam = GlobalCameraManager.getInstance();
    if (!gcam) { if (this.enableDebugLog) console.warn('[UIManager] setControlState ignored: no GlobalCameraManager'); return; }
    var ST = GlobalCameraManager.CONTROL_STATES;
    var v = state;
    if (typeof v === 'string') v = ST[v] || v;
    if (!v) v = ST.LOCKED_MULTI;
    gcam.setState(v);
};

// ===== ESC确认界面功能 =====

/**
 * 初始化ESC确认界面（动态创建UI）
 */
UIManager.prototype._initEscConfirmUI = function () {
    var self = this;
    
    if (this.enableDebugLog) {
        console.log('[UIManager] _initEscConfirmUI starting...');
    }
    
    // 如果已经初始化过且UI元素存在，直接返回
    if (this.escConfirmPanel && this.escConfirmText && this.escConfirmYesButton && this.escConfirmNoButton) {
        if (this.enableDebugLog) {
            console.log('[UIManager] ESC confirm UI already initialized, skipping...');
        }
        return;
    }
    
    try {
    
    // 创建ESC确认面板容器
    this.escConfirmPanel = new pc.Entity('EscConfirmPanel');
    this.escConfirmPanel.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        anchor: new pc.Vec4(0, 0, 1, 1), // 全屏
        pivot: new pc.Vec2(0.5, 0.5),
        margin: new pc.Vec4(0, 0, 0, 0),
        color: this._hexToColor('#FCFBDB'), // 使用指定的背景色
        opacity: 0.9, // 轻微透明
        drawOrder: 9000, // 确保在最上层
        useInput: true // 确保可以接收输入事件
    });
    this.entity.addChild(this.escConfirmPanel);
    
    // 创建对话框背景
    this.escConfirmDialog = new pc.Entity('EscConfirmDialog');
    this.escConfirmDialog.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5), // 居中
        pivot: new pc.Vec2(0.5, 0.5),
        width: 400,
        height: 200,
        color: new pc.Color(0.3, 0.3, 0.3, 0.95), // 深灰色对话框
        opacity: 1,
        drawOrder: 9001
    });
    this.escConfirmPanel.addChild(this.escConfirmDialog);
    
    // 创建确认文本
    this.escConfirmText = new pc.Entity('EscConfirmText');
    this.escConfirmText.addComponent('element', {
        type: pc.ELEMENTTYPE_TEXT,
        anchor: new pc.Vec4(0.5, 0.7, 0.5, 0.7), // 上部居中
        pivot: new pc.Vec2(0.5, 0.5),
        width: 350,
        height: 60,
        fontSize: 20,
        color: new pc.Color(1, 1, 1, 1), // 白色文字（在深色背景上）
        text: '是否回到心灵彼岸？',
        alignment: new pc.Vec2(0.5, 0.5), // 居中对齐
        wrapLines: true,
        drawOrder: 9002,
        autoWidth: false,
        autoHeight: false,
        fontAsset: null, // 使用默认字体
        useInput: false // 确保不是输入框
    });
    
    // 设置字体
    try {
        // 使用指定的字体或默认字体
        if (this.escConfirmFont) {
            this.escConfirmText.element.fontAsset = this.escConfirmFont;
            if (this.enableDebugLog) console.log('[UIManager] Using custom font for confirm text');
        } else {
            // 尝试使用第一个可用字体
            var fontAssets = this.app.assets.filter(function(asset) {
                return asset.type === 'font';
            });
            if (fontAssets.length > 0) {
                this.escConfirmText.element.fontAsset = fontAssets[0].id;
                if (this.enableDebugLog) console.log('[UIManager] Using first available font:', fontAssets[0].name);
            } else {
                this.escConfirmText.element.fontAsset = null;
                if (this.enableDebugLog) console.log('[UIManager] No fonts available, using default');
            }
        }
        
        // 刷新文本显示
        setTimeout(function() {
            if (self.escConfirmText && self.escConfirmText.element) {
                self.escConfirmText.element.text = '是否回到心灵彼岸？';
                if (self.enableDebugLog) console.log('[UIManager] Text refreshed:', self.escConfirmText.element.text);
            }
        }, 100);
        
    } catch (e) {
        if (this.enableDebugLog) console.warn('[UIManager] Failed to set font for ESC confirm text:', e);
    }
    this.escConfirmDialog.addChild(this.escConfirmText);
    
    // 创建"是"按钮
    this.escConfirmYesButton = new pc.Entity('EscConfirmYesButton');
    this.escConfirmYesButton.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        anchor: new pc.Vec4(0.3, 0.3, 0.3, 0.3), // 左下
        pivot: new pc.Vec2(0.5, 0.5),
        width: 120,
        height: 40,
        color: new pc.Color(0.2, 0.6, 0.2, 1), // 绿色按钮
        opacity: 1,
        drawOrder: 9003,
        useInput: true // 确保可以接收输入事件
    });
    this.escConfirmYesButton.addComponent('button', {
        imageEntity: this.escConfirmYesButton,
        hitPadding: new pc.Vec4(10, 10, 10, 10),
        transitionMode: pc.BUTTON_TRANSITION_MODE_TINT,
        hoverTint: new pc.Color(0.3, 0.7, 0.3, 1),
        pressedTint: new pc.Color(0.1, 0.5, 0.1, 1),
        inactiveTint: new pc.Color(0.2, 0.6, 0.2, 1),
        active: true
    });
    this.escConfirmDialog.addChild(this.escConfirmYesButton);
    
    // 创建"是"按钮文本
    this.escConfirmYesText = new pc.Entity('EscConfirmYesText');
    this.escConfirmYesText.addComponent('element', {
        type: pc.ELEMENTTYPE_TEXT,
        anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5), // 居中
        pivot: new pc.Vec2(0.5, 0.5),
        width: 100,
        height: 30,
        fontSize: 16,
        color: new pc.Color(1, 1, 1, 1), // 白色文字
        text: '是',
        alignment: new pc.Vec2(0.5, 0.5),
        drawOrder: 9004,
        fontAsset: null
    });
    
    // 设置字体
    try {
        if (this.escConfirmFont) {
            this.escConfirmYesText.element.fontAsset = this.escConfirmFont;
        } else {
            var fontAssets = this.app.assets.filter(function(asset) {
                return asset.type === 'font';
            });
            if (fontAssets.length > 0) {
                this.escConfirmYesText.element.fontAsset = fontAssets[0].id;
            }
        }
        setTimeout(function() {
            if (self.escConfirmYesText && self.escConfirmYesText.element) {
                self.escConfirmYesText.element.text = '是';
            }
        }, 100);
    } catch (e) {}
    this.escConfirmYesButton.addChild(this.escConfirmYesText);
    
    // 创建"否"按钮
    this.escConfirmNoButton = new pc.Entity('EscConfirmNoButton');
    this.escConfirmNoButton.addComponent('element', {
        type: pc.ELEMENTTYPE_IMAGE,
        anchor: new pc.Vec4(0.7, 0.3, 0.7, 0.3), // 右下
        pivot: new pc.Vec2(0.5, 0.5),
        width: 120,
        height: 40,
        color: new pc.Color(0.6, 0.2, 0.2, 1), // 红色按钮
        opacity: 1,
        drawOrder: 9003,
        useInput: true // 确保可以接收输入事件
    });
    this.escConfirmNoButton.addComponent('button', {
        imageEntity: this.escConfirmNoButton,
        hitPadding: new pc.Vec4(10, 10, 10, 10),
        transitionMode: pc.BUTTON_TRANSITION_MODE_TINT,
        hoverTint: new pc.Color(0.7, 0.3, 0.3, 1),
        pressedTint: new pc.Color(0.5, 0.1, 0.1, 1),
        inactiveTint: new pc.Color(0.6, 0.2, 0.2, 1),
        active: true
    });
    this.escConfirmDialog.addChild(this.escConfirmNoButton);
    
    // 创建"否"按钮文本
    this.escConfirmNoText = new pc.Entity('EscConfirmNoText');
    this.escConfirmNoText.addComponent('element', {
        type: pc.ELEMENTTYPE_TEXT,
        anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5), // 居中
        pivot: new pc.Vec2(0.5, 0.5),
        width: 100,
        height: 30,
        fontSize: 16,
        color: new pc.Color(1, 1, 1, 1), // 白色文字
        text: '否',
        alignment: new pc.Vec2(0.5, 0.5),
        drawOrder: 9004,
        fontAsset: null
    });
    
    // 设置字体
    try {
        if (this.escConfirmFont) {
            this.escConfirmNoText.element.fontAsset = this.escConfirmFont;
        } else {
            var fontAssets = this.app.assets.filter(function(asset) {
                return asset.type === 'font';
            });
            if (fontAssets.length > 0) {
                this.escConfirmNoText.element.fontAsset = fontAssets[0].id;
            }
        }
        setTimeout(function() {
            if (self.escConfirmNoText && self.escConfirmNoText.element) {
                self.escConfirmNoText.element.text = '否';
            }
        }, 100);
    } catch (e) {}
    this.escConfirmNoButton.addChild(this.escConfirmNoText);
    
    // 绑定按钮事件 - 使用element事件而不是button事件
    this.escConfirmYesButton.element.on('click', function() {
        if (self.enableDebugLog) console.log('[UIManager] Yes button clicked (element event)');
        self._onEscConfirmYes();
    });
    
    this.escConfirmYesButton.element.on('mouseenter', function() {
        if (self.enableDebugLog) console.log('[UIManager] Yes button mouse enter (element event)');
    });
    
    this.escConfirmYesButton.element.on('mousedown', function() {
        if (self.enableDebugLog) console.log('[UIManager] Yes button mouse down (element event)');
    });
    
    this.escConfirmYesButton.element.on('mouseup', function() {
        if (self.enableDebugLog) console.log('[UIManager] Yes button mouse up (element event)');
    });
    
    this.escConfirmNoButton.element.on('click', function() {
        if (self.enableDebugLog) console.log('[UIManager] No button clicked (element event)');
        self._onEscConfirmNo();
    });
    
    this.escConfirmNoButton.element.on('mouseenter', function() {
        if (self.enableDebugLog) console.log('[UIManager] No button mouse enter (element event)');
    });
    
    // 初始时隐藏面板
    this.escConfirmPanel.enabled = false;
    
    if (this.enableDebugLog) {
        console.log('[UIManager] ESC confirm UI created dynamically');
        console.log('[UIManager] Panel entity:', this.escConfirmPanel);
        console.log('[UIManager] Dialog entity:', this.escConfirmDialog);
        console.log('[UIManager] Text entity:', this.escConfirmText);
        console.log('[UIManager] Yes button entity:', this.escConfirmYesButton);
        console.log('[UIManager] No button entity:', this.escConfirmNoButton);
        console.log('[UIManager] Text element text:', this.escConfirmText.element.text);
        console.log('[UIManager] Yes button has button component:', !!this.escConfirmYesButton.button);
        console.log('[UIManager] No button has button component:', !!this.escConfirmNoButton.button);
        console.log('[UIManager] Root entity has screen component:', !!this.entity.screen);
        console.log('[UIManager] Panel parent entity:', this.escConfirmPanel.parent);
        console.log('[UIManager] Panel enabled:', this.escConfirmPanel.enabled);
        
        // 添加测试方法到全局，方便调试
        window.testEscUI = function() {
            console.log('[TEST] Showing ESC confirm dialog');
            self._showEscConfirm();
        };
        
        // 添加强制显示文本的测试方法
        window.forceShowText = function() {
            console.log('[TEST] Force showing text');
            self.escConfirmText.element.text = 'TEST TEXT';
            self.escConfirmText.element.fontSize = 30;
            self.escConfirmText.element.color = new pc.Color(1, 0, 0, 1); // 红色
            self.escConfirmPanel.enabled = true;
        };
        
        // 添加手动触发按钮点击的方法
        window.testButtonClick = function() {
            console.log('[TEST] Manual button click');
            self._onEscConfirmYes();
        };
        
        // 添加简化版ESC界面测试
        window.testSimpleEscUI = function() {
            console.log('[TEST] Creating simple ESC UI');
            try {
                // 创建最简单的确认界面
                var simplePanel = new pc.Entity('SimpleEscPanel');
                simplePanel.addComponent('element', {
                    type: pc.ELEMENTTYPE_IMAGE,
                    anchor: [0, 0, 1, 1],
                    pivot: [0.5, 0.5],
                    color: new pc.Color(0, 0, 0, 0.8),
                    useInput: true
                });
                
                var simpleText = new pc.Entity('SimpleEscText');
                simpleText.addComponent('element', {
                    type: pc.ELEMENTTYPE_TEXT,
                    anchor: [0.5, 0.5, 0.5, 0.5],
                    pivot: [0.5, 0.5],
                    text: 'ESC TEST - Press any key to close',
                    fontSize: 24,
                    color: new pc.Color(1, 1, 1, 1)
                });
                
                simplePanel.addChild(simpleText);
                self.entity.addChild(simplePanel);
                
                // 点击关闭
                simplePanel.element.on('click', function() {
                    simplePanel.destroy();
                });
                
                console.log('[TEST] Simple ESC UI created successfully');
            } catch (e) {
                console.error('[TEST] Failed to create simple ESC UI:', e);
            }
        };
        
        console.log('[UIManager] Added test methods: testEscUI(), forceShowText(), testButtonClick(), testSimpleEscUI()');
    }
    
    } catch (e) {
        console.error('[UIManager] Error in _initEscConfirmUI:', e);
        console.error('[UIManager] Stack trace:', e.stack);
        
        // 清理可能部分创建的元素
        if (this.escConfirmPanel) {
            try { this.escConfirmPanel.destroy(); } catch (e2) {}
        }
        this.escConfirmPanel = null;
        this.escConfirmDialog = null;
        this.escConfirmText = null;
        this.escConfirmYesButton = null;
        this.escConfirmYesText = null;
        this.escConfirmNoButton = null;
        this.escConfirmNoText = null;
    }
};

/**
 * 获取ESC确认文本
 */
UIManager.prototype._getEscConfirmText = function () {
    var confirmText = '是否回到心灵彼岸？';
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            var i18nText = I18n.get('ui', 'esc_confirm_text');
            if (i18nText) confirmText = i18nText;
        }
    } catch (e) {}
    return confirmText;
};

/**
 * 获取"是"按钮文本
 */
UIManager.prototype._getYesText = function () {
    var yesText = '是';
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            var i18nYes = I18n.get('ui', 'yes');
            if (i18nYes) yesText = i18nYes;
        }
    } catch (e) {}
    return yesText;
};

/**
 * 获取"否"按钮文本
 */
UIManager.prototype._getNoText = function () {
    var noText = '否';
    try {
        if (typeof I18n !== 'undefined' && I18n.get) {
            var i18nNo = I18n.get('ui', 'no');
            if (i18nNo) noText = i18nNo;
        }
    } catch (e) {}
    return noText;
};

/**
 * 将十六进制颜色转换为 PlayCanvas Color 对象
 */
UIManager.prototype._hexToColor = function (hex) {
    // 移除 # 符号
    hex = hex.replace('#', '');
    
    // 解析 RGB 值
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    
    return new pc.Color(r, g, b, 1);
};

/**
 * 处理ESC键按下
 */
UIManager.prototype._handleEscKey = function () {
    // 检查当前状态，只在特定状态下显示ESC确认界面
    if (this.currentState === UIManager.UI_STATES.ESC_CONFIRM) {
        // 如果已经在ESC确认界面，再按ESC则取消
        this._hideEscConfirm();
        return;
    }
    
    // 检查是否在Start场景，如果已经在Start场景则不显示ESC界面
    var currentScene = '';
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.getCurrentScene) {
            currentScene = GlobalGame.getCurrentScene() || '';
        } else if (this.app.scene && this.app.scene.name) {
            currentScene = this.app.scene.name;
        }
    } catch (e) {}
    
    if (currentScene.toLowerCase() === 'start' || currentScene.toLowerCase() === 'main') {
        return;
    }
    
    // 只在首次进入和淡入淡出时不显示ESC界面
    if (this.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO ||
        this.currentState === UIManager.UI_STATES.FADE_TRANSITION) {
        return;
    }
    this._showEscConfirm();
};

/**
 * 显示ESC确认界面
 */
UIManager.prototype._showEscConfirm = function () {
    if (this.enableDebugLog) {
        console.log('[UIManager] _showEscConfirm called');
        console.log('[UIManager] escConfirmPanel exists:', !!this.escConfirmPanel);
    }
    
    // 检查UI元素是否存在，如果不存在则重新初始化
    if (!this.escConfirmPanel || !this.escConfirmText || !this.escConfirmYesButton || !this.escConfirmNoButton) {
        if (this.enableDebugLog) {
            console.log('[UIManager] ESC confirm UI elements missing, reinitializing...');
            console.log('[UIManager] Missing elements:', {
                panel: !!this.escConfirmPanel,
                text: !!this.escConfirmText,
                yesButton: !!this.escConfirmYesButton,
                noButton: !!this.escConfirmNoButton
            });
        }
        
        try {
            this._initEscConfirmUI();
        } catch (e) {
            if (this.enableDebugLog) {
                console.error('[UIManager] Failed to reinitialize ESC confirm UI:', e);
            }
            return;
        }
    }
    
    // 再次检查初始化是否成功
    if (!this.escConfirmPanel || !this.escConfirmText || !this.escConfirmYesButton || !this.escConfirmNoButton) {
        if (this.enableDebugLog) {
            console.error('[UIManager] ESC confirm UI initialization failed! Elements still missing:', {
                panel: !!this.escConfirmPanel,
                text: !!this.escConfirmText,
                yesButton: !!this.escConfirmYesButton,
                noButton: !!this.escConfirmNoButton
            });
        }
        return;
    }
    
    // 保存之前的状态
    this._previousState = this.currentState;
    
    // 切换到ESC确认状态
    this._changeState(UIManager.UI_STATES.ESC_CONFIRM);
    
    // 显示确认面板
    this.escConfirmPanel.enabled = true;
    
    // 确保按钮处于激活状态
    if (this.escConfirmYesButton && this.escConfirmYesButton.button) {
        this.escConfirmYesButton.button.active = true;
        if (this.enableDebugLog) console.log('[UIManager] Yes button reactivated');
    }
    if (this.escConfirmNoButton && this.escConfirmNoButton.button) {
        this.escConfirmNoButton.button.active = true;
        if (this.enableDebugLog) console.log('[UIManager] No button reactivated');
    }
    
    // 锁定玩家
    try {
        this.app.fire('player:set_sitting', true);
        if (this.enableDebugLog) console.log('[UIManager] Player locked for ESC confirm');
    } catch (e) {}
    
    // 设置相机为锁定状态
    try {
        var gcam = GlobalCameraManager.getInstance();
        if (gcam) {
            gcam.setState(GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI);
        } else {
            this.app.fire('ui:control:set', 'LOCKED_MULTI');
        }
        if (this.enableDebugLog) console.log('[UIManager] Camera locked for ESC confirm');
    } catch (e) {}
    
    if (this.enableDebugLog) {
        console.log('[UIManager] ESC confirm dialog shown');
        
        // 安全地输出调试信息，避免访问undefined属性
        try {
            console.log('[UIManager] Panel enabled:', this.escConfirmPanel ? this.escConfirmPanel.enabled : 'undefined');
            console.log('[UIManager] Dialog enabled:', this.escConfirmDialog ? this.escConfirmDialog.enabled : 'undefined');
            console.log('[UIManager] Text enabled:', this.escConfirmText ? this.escConfirmText.enabled : 'undefined');
            
            if (this.escConfirmText && this.escConfirmText.element) {
                console.log('[UIManager] Text content:', this.escConfirmText.element.text);
                console.log('[UIManager] Text color:', this.escConfirmText.element.color);
                console.log('[UIManager] Text fontSize:', this.escConfirmText.element.fontSize);
                console.log('[UIManager] Text fontAsset:', this.escConfirmText.element.fontAsset);
                console.log('[UIManager] Text drawOrder:', this.escConfirmText.element.drawOrder);
                console.log('[UIManager] Text world position:', this.escConfirmText.getPosition());
            } else {
                console.log('[UIManager] Text element is undefined');
            }
            
            if (this.escConfirmYesButton) {
                console.log('[UIManager] Yes button enabled:', this.escConfirmYesButton.enabled);
                if (this.escConfirmYesButton.button) {
                    console.log('[UIManager] Yes button active:', this.escConfirmYesButton.button.active);
                }
                if (this.escConfirmYesButton.element) {
                    console.log('[UIManager] Yes button element anchor:', this.escConfirmYesButton.element.anchor);
                    console.log('[UIManager] Yes button element width/height:', this.escConfirmYesButton.element.width, this.escConfirmYesButton.element.height);
                }
                console.log('[UIManager] Yes button world position:', this.escConfirmYesButton.getPosition());
            }
            
            if (this.escConfirmNoButton) {
                console.log('[UIManager] No button enabled:', this.escConfirmNoButton.enabled);
                if (this.escConfirmNoButton.button) {
                    console.log('[UIManager] No button active:', this.escConfirmNoButton.button.active);
                }
                console.log('[UIManager] No button world position:', this.escConfirmNoButton.getPosition());
            }
            
            if (this.escConfirmPanel && this.escConfirmPanel.element) {
                console.log('[UIManager] Panel drawOrder:', this.escConfirmPanel.element.drawOrder);
                console.log('[UIManager] Panel world position:', this.escConfirmPanel.getPosition());
            }
            
            if (this.escConfirmDialog && this.escConfirmDialog.element) {
                console.log('[UIManager] Dialog drawOrder:', this.escConfirmDialog.element.drawOrder);
                console.log('[UIManager] Dialog world position:', this.escConfirmDialog.getPosition());
            }
            
            if (this.entity && this.entity.screen) {
                console.log('[UIManager] Screen camera:', this.entity.screen.camera);
                console.log('[UIManager] Screen resolution:', this.entity.screen.resolution);
                console.log('[UIManager] Screen scale mode:', this.entity.screen.scaleMode);
            }
        } catch (e) {
            console.error('[UIManager] Error in debug logging:', e);
        }
    }
};

/**
 * 隐藏ESC确认界面
 */
UIManager.prototype._hideEscConfirm = function () {
    if (!this.escConfirmPanel) return;
    
    // 隐藏确认面板
    this.escConfirmPanel.enabled = false;
    
    // 恢复之前的状态
    if (this._previousState) {
        this._changeState(this._previousState);
        this._previousState = null;
    } else {
        this._changeState(UIManager.UI_STATES.NORMAL);
    }
    
    // 解锁玩家
    try {
        this.app.fire('player:set_sitting', false);
        if (this.enableDebugLog) console.log('[UIManager] Player unlocked after ESC confirm');
    } catch (e) {}
    
    // 恢复相机状态
    try {
        var gcam = GlobalCameraManager.getInstance();
        if (gcam) {
            gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
        } else {
            this.app.fire('ui:control:set', 'FREE_FOLLOW');
        }
        if (this.enableDebugLog) console.log('[UIManager] Camera unlocked after ESC confirm');
    } catch (e) {}
    
    if (this.enableDebugLog) {
        console.log('[UIManager] ESC confirm dialog hidden');
    }
};

/**
 * ESC确认-是按钮点击处理
 */
UIManager.prototype._onEscConfirmYes = function () {
    if (this.enableDebugLog) {
        console.log('[UIManager] ESC confirm YES clicked - returning to Start scene');
    }
    
    // 隐藏确认界面
    this._hideEscConfirm();
    
    // 切换到Start场景
    try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.loadScene) {
            GlobalGame.loadScene('Start', function(err) {
                if (err) {
                    console.error('[UIManager] Failed to load Start scene:', err);
                } else {
                    console.log('[UIManager] Successfully returned to Start scene');
                }
            });
        } else {
            // 如果GlobalGame不可用，尝试直接使用PlayCanvas API
            this.app.scenes.changeScene('Start');
        }
    } catch (e) {
        console.error('[UIManager] Error loading Start scene:', e);
    }
};

/**
 * ESC确认-否按钮点击处理
 */
UIManager.prototype._onEscConfirmNo = function () {
    if (this.enableDebugLog) {
        console.log('[UIManager] ESC confirm NO clicked - staying in current scene');
    }
    
    // 隐藏确认界面
    this._hideEscConfirm();
};

// 清理
UIManager.prototype.destroy = function () {
    console.log('[UIManager] Destroying instance...');
    
    if (UIManager._instance === this) UIManager._instance = null;
    
    // 解绑所有事件监听器
    this.app.off('gamestate:changed');
    if (this._onDialogueBegin) this.app.off('ui:dialogue:begin', this._onDialogueBegin, this);
    if (this._onDialogueEnd) this.app.off('ui:dialogue:end', this._onDialogueEnd, this);
    if (this._onLevelProloguePlay) this.app.off('level:prologue:play', this._onLevelProloguePlay, this);
    if (this._onUIPlayPrologue) this.app.off('ui:play:prologue', this._onUIPlayPrologue, this);
    if (this._onUiControlSet) this.app.off('ui:control:set', this._onUiControlSet, this);
    if (this._onUiHintShow) this.app.off('ui:hint:show', this._onUiHintShow, this);
    if (this._onUiHintHide) this.app.off('ui:hint:hide', this._onUiHintHide, this);
    if (this.onKeyDown)   this.app.keyboard.off(pc.EVENT_KEYDOWN, this.onKeyDown, this);
    if (this.onKeyUp)     this.app.keyboard.off(pc.EVENT_KEYUP, this.onKeyUp, this);
    if (this.onMouseDown) this.app.mouse.off(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
    if (this.onMouseUp)   this.app.mouse.off(pc.EVENT_MOUSEUP, this.onMouseUp, this);
    if (this.app.touch) {
        if (this.onTouchStart) this.app.touch.off(pc.EVENT_TOUCHSTART, this.onTouchStart, this);
        if (this.onTouchEnd)   this.app.touch.off(pc.EVENT_TOUCHEND, this.onTouchEnd, this);
    }
    
    console.log('[UIManager] All event listeners unbound');
    
    // 清理ESC确认界面
    if (this.escConfirmYesButton && this.escConfirmYesButton.element) {
        this.escConfirmYesButton.element.off('click');
        this.escConfirmYesButton.element.off('mouseenter');
        this.escConfirmYesButton.element.off('mousedown');
        this.escConfirmYesButton.element.off('mouseup');
    }
    if (this.escConfirmNoButton && this.escConfirmNoButton.element) {
        this.escConfirmNoButton.element.off('click');
        this.escConfirmNoButton.element.off('mouseenter');
    }
    if (this.escConfirmPanel) {
        this.escConfirmPanel.destroy();
        this.escConfirmPanel = null;
    }
    
    // 清理所有ESC确认界面的引用
    this.escConfirmDialog = null;
    this.escConfirmText = null;
    this.escConfirmYesButton = null;
    this.escConfirmYesText = null;
    this.escConfirmNoButton = null;
    this.escConfirmNoText = null;
};
