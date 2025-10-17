/* global pc, UIManager, GlobalGame, I18n */
/**
 * @file MenuSettingsUI.js
 * @desc 菜单设置UI全局模块（非 pc.createScript）
 * 
 * 功能：
 * 1. 监听三个菜单按钮事件（UiMenuSetting, UiMenuAppearance, UiMenuPrologue）
 * 2. 在 ScrollView Content 中生成设置选项
 * 3. 从侧边滑入动画（可配置左/右侧）
 * 4. 玩家输入后保存到 GameManager
 * 
 * 使用：
 *   MenuSettingsUI.init(app, { debug: true });
 *   MenuSettingsUI.show('setting');
 */

var MenuSettingsUI = (function () {
    'use strict';

    // ---------- 内部状态 ----------
    var _app = null;
    var _scrollView = null;
    var _scrollViewContent = null;
    var _debug = true;
    var _currentCategory = null;
    var _isVisible = false;
    var _isAnimating = false;
    var _slideDirection = 'left'; // 'left' 或 'right'

    // 配置项（使用 I18n 键）
    var _settingsConfig = {
        setting: {
            sections: [
                {
                    titleKey: 'menu.panels.settings.audio.title', // 音频标题
                    items: [
                        { key: 'masterVolume', type: 'slider', labelKey: 'menu.panels.subtitles.masterVolume', min: 0, max: 100, default: 80 },
                        { key: 'musicVolume', type: 'slider', labelKey: 'menu.panels.subtitles.musicVolume', min: 0, max: 100, default: 70 },
                        { key: 'sfxVolume', type: 'slider', labelKey: 'menu.panels.subtitles.sfxVolume', min: 0, max: 100, default: 80 },
                        { key: 'voiceVolume', type: 'slider', labelKey: 'menu.panels.subtitles.voiceVolume', min: 0, max: 100, default: 80 },
                        { key: 'language', type: 'dropdown', labelKey: 'menu.panels.subtitles.language', options: ['zh-CN', 'en-US'], default: 'zh-CN' }
                    ]
                },
                {
                    titleKey: 'menu.panels.settings.video.title', // 画面标题
                    items: [
                        { key: 'fullscreen', type: 'toggle', labelKey: 'menu.panels.subtitles.fullscreen', default: false },
                        { key: 'vSync', type: 'toggle', labelKey: 'menu.panels.subtitles.vSync', default: true },
                        { key: 'brightness', type: 'slider', labelKey: 'menu.panels.subtitles.brightness', min: 0, max: 100, default: 50 }
                    ]
                },
                {
                    titleKey: 'menu.panels.settings.controls.title', // 操作标题
                    items: [
                        { key: 'mouseSensitivity', type: 'slider', labelKey: 'menu.panels.subtitles.mouseSensitivity', min: 0.1, max: 2.0, default: 1.0 },
                        { key: 'invertY', type: 'toggle', labelKey: 'menu.panels.subtitles.invertY', default: false },
                        { key: 'clearProgress', type: 'toggle', labelKey: 'menu.panels.clearProgress.button', default: false, special: 'clearProgress' }
                    ]
                }
            ]
        },
        video: {
            titleKey: 'menu.panels.settings.video.title', // 画面标题
            items: [
                { key: 'fullscreen', type: 'toggle', labelKey: 'menu.panels.subtitles.fullscreen', default: false },
                { key: 'vSync', type: 'toggle', labelKey: 'menu.panels.subtitles.vSync', default: true },
                { key: 'brightness', type: 'slider', labelKey: 'menu.panels.subtitles.brightness', min: 0, max: 100, default: 50 }
            ]
        },
        controls: {
            titleKey: 'menu.panels.settings.controls.title', // 操作标题
            items: [
                { key: 'mouseSensitivity', type: 'slider', labelKey: 'menu.panels.subtitles.mouseSensitivity', min: 0.1, max: 2.0, default: 1.0 },
                { key: 'invertY', type: 'toggle', labelKey: 'menu.panels.subtitles.invertY', default: false },
                { key: 'clearProgress', type: 'toggle', labelKey: 'menu.panels.clearProgress.button', default: false, special: 'clearProgress' }
            ]
        },
        appearance: 'collectibles', // 特殊类型：显示收藏品
        prologue: 'story', // 特殊类型：显示故事进度
        help: 'help', // 特殊类型：帮助信息
        clearRecord: 'clear_record', // 特殊类型：通关记录
        achievements: 'achievements', // 特殊类型：成就
        worldCompletion: 'world_completion', // 特殊类型：世界完成度
        redemption: 'redemption', // 特殊类型：救赎（重生次数）
        heartKeyGallery: 'heart_key_gallery' // 特殊类型：心钥收藏馆
    };

    var _tempSettings = {};
    var _languageChangeHandler = null; // 保存语言变更监听器

    // 移除了 debug log 函数
    
    // ---------- I18n 翻译辅助函数 ----------
    function _translateText(key) {
        try {
            // 使用 I18n.t() 方法支持完整路径（如 'menu.panels.subtitles.masterVolume'）
            if (typeof I18n !== 'undefined' && I18n.t) {
                var translated = I18n.t(key, key);
                // 如果翻译成功，返回翻译结果
                if (translated && typeof translated === 'string') {
                    return translated;
                }
            }
        } catch (e) {
            // Translation failed
        }
        // 返回原文本作为后备
        return key;
    }

    // ---------- 初始化 ----------
    function init(app, options) {
        _app = app;
        options = options || {};
        _debug = !!options.debug;

        _bindUIFromManager();
        _bindMenuEvents();
        _loadSlideDirection();

        // Initialized
    }

    function _bindUIFromManager() {
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (!mgr) return;

            _scrollView = mgr.menuScrollView || null;
            _scrollViewContent = mgr.menuScrollViewContent || null;

            if (_scrollView) {
                // Bound to ScrollView
                
                // 立即设置为屏幕中央偏左
                if (_scrollView.element) {
                    _scrollView.element.anchor = new pc.Vec4(0.5, 0.5, 0.5, 0.5);
                    _scrollView.element.pivot = new pc.Vec2(0.5, 0.5);
                    
                    // 调整ScrollView尺寸：宽度×2，高度×1.5
                    // 原始尺寸假设为500×600，现调整为1000×900
                    _scrollView.element.width = 1000;  // 原500×2
                    _scrollView.element.height = 900;  // 原600×1.5
                    
                    // 向左偏移60px
                    _scrollView.setLocalPosition(-60, 0, 0);
                    
                    // ScrollView size adjusted
                }
                
                // 初始隐藏
                _scrollView.enabled = false;
            }
            if (_scrollViewContent) {
                // Bound to Content
                
                // 调整Content宽度以匹配ScrollView
                if (_scrollViewContent.element) {
                    _scrollViewContent.element.width = 980; // 比ScrollView略窄，留出滚动条空间
                    // Content width adjusted
                }
            }
        } catch (e) {
            // Failed to bind UI
        }
    }

    function _loadSlideDirection() {
        // 从 cameraPosition.json 读取滑入方向
        try {
            if (typeof I18n !== 'undefined' && I18n.t) {
                var direction = I18n.t('ui.menuSlideDirection', '');
                if (direction === 'left' || direction === 'right') {
                    _slideDirection = direction;
                }
            }
        } catch (e) {
            // Failed to load slide direction
        }
    }

    function _bindMenuEvents() {
        if (!_app) return;

        _app.on('menu:show_setting', function () {
            toggle('setting');
        });

        _app.on('menu:show_appearance', function () {
            toggle('appearance');
        });

        _app.on('menu:show_prologue', function () {
            toggle('prologue');
        });

        _app.on('menu:show_help', function () {
            toggle('help');
        });
        
        // 新增5个功能面板事件
        _app.on('menu:show_clear_record', function () {
            toggle('clearRecord');
        });
        
        _app.on('menu:show_achievements', function () {
            toggle('achievements');
        });
        
        _app.on('menu:show_world_completion', function () {
            toggle('worldCompletion');
        });
        
        _app.on('menu:show_redemption', function () {
            toggle('redemption');
        });
        
        _app.on('menu:show_heart_key_gallery', function () {
            toggle('heartKeyGallery');
        });
        
        // 监听语言变更事件
        _languageChangeHandler = function (key, value) {
            if (key === 'language' && _isVisible && _currentCategory) {
                // Language changed, refreshing UI
                // 延迟刷新，等待 I18n 加载完成
                setTimeout(function() {
                    _clearContent();
                    _loadCurrentSettings(_currentCategory);
                    _generateOptions(_currentCategory);
                }, 500);
            }
        };
        _app.on('setting:changed', _languageChangeHandler);
    }

    // ---------- 切换 ----------
    function toggle(category) {
        if (_isAnimating) return;
        
        if (_isVisible && _currentCategory === category) {
            hide();
        } else {
            show(category);
        }
    }

    // ---------- 显示 ----------
    function show(category) {
        if (!_scrollView || !_scrollViewContent || _isAnimating) return;

        _currentCategory = category;
        // Showing category

        _clearContent();
        _loadCurrentSettings(category);
        _generateOptions(category);
        _slideIn();
    }

    function _clearContent() {
        if (!_scrollViewContent) return;
        var children = _scrollViewContent.children.slice();
        for (var i = 0; i < children.length; i++) {
            try { children[i].destroy(); } catch (e) {}
        }
    }

    function _loadCurrentSettings(category) {
        var config = _settingsConfig[category];
        _tempSettings = {};
        
        // 特殊类型无需加载设置
        if (config === 'collectibles' || config === 'story' || config === 'help' ||
            config === 'clear_record' || config === 'achievements' || 
            config === 'world_completion' || config === 'redemption' || 
            config === 'heart_key_gallery') {
            return;
        }
        
        var allItems = [];
        
        // 多段配置结构
        if (config && config.sections && Array.isArray(config.sections)) {
            for (var s = 0; s < config.sections.length; s++) {
                var section = config.sections[s];
                if (section.items) {
                    allItems = allItems.concat(section.items);
                }
            }
        } else if (config && config.items) {
            // 单段配置结构
            allItems = config.items;
        } else if (Array.isArray(config)) {
            // 兼容旧的配置格式
            allItems = config;
        }
        
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            var value = _getSetting(item.key);
            _tempSettings[item.key] = (value !== null && value !== undefined) ? value : item.default;
        }
    }

    function _getSetting(key) {
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting) {
                return GlobalGame.getSetting(key);
            }
        } catch (e) {}
        return null;
    }

    function _generateOptions(category) {
        var config = _settingsConfig[category];
        // Generate options called
        // Config found
        
        // 特殊类型：收藏品
        if (config === 'collectibles') {
            _generateCollectiblesUI();
            return;
        }
        
        // 特殊类型：故事进度
        if (config === 'story') {
            _generateStoryUI();
            return;
        }
        
        // 特殊类型：帮助信息
        if (config === 'help') {
            _generateHelpUI();
            return;
        }
        
        // 特殊类型：通关记录
        if (config === 'clear_record') {
            _generateClearRecordUI();
            return;
        }
        
        // 特殊类型：成就
        if (config === 'achievements') {
            _generateAchievementsUI();
            return;
        }
        
        // 特殊类型：世界完成度
        if (config === 'world_completion') {
            _generateWorldCompletionUI();
            return;
        }
        
        // 特殊类型：救赎（重生次数）
        if (config === 'redemption') {
            _generateRedemptionUI();
            return;
        }
        
        // 特殊类型：心钥收藏馆
        if (config === 'heart_key_gallery') {
            _generateHeartKeyGalleryUI();
            return;
        }
        
        var yOffset = 0;
        var totalItems = 0;
        
        // 新的多段配置结构
        if (config && config.sections && Array.isArray(config.sections)) {
            for (var s = 0; s < config.sections.length; s++) {
                var section = config.sections[s];
                
                // 创建段标题
                if (section.titleKey) {
                    _createSectionTitle(section.titleKey, yOffset);
                    yOffset += 30; // 标题后间距，与选项间距相同
                }
                
                // 创建该段的配置项
                var items = section.items || [];
                for (var i = 0; i < items.length; i++) {
                    _createOptionUI(items[i], i, yOffset + i * 90);
                }
                yOffset += items.length * 90;
                totalItems += items.length;
                
                // 段间距
                if (s < config.sections.length - 1) {
                    yOffset += 70;
                }
            }
        } else if (config && config.titleKey && config.items) {
            // 单段配置结构（向后兼容）
            // Using single section config
            // Title key found
            // Items found
            _createSectionTitle(config.titleKey, yOffset);
            yOffset += 90; // 标题后间距，与选项间距相同
            var items = config.items;
            for (var i = 0; i < items.length; i++) {
                // Creating option UI
                _createOptionUI(items[i], i, yOffset + i * 90);
            }
            totalItems = items.length;
            yOffset += items.length * 90;
        } else if (Array.isArray(config)) {
            // 兼容旧的配置格式
            for (var i = 0; i < config.length; i++) {
                _createOptionUI(config[i], i, yOffset);
            }
            totalItems = config.length;
            yOffset += config.length * 90;
        }
        
        
        // 调整高度
        var totalHeight = yOffset + 80;
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(totalHeight, _scrollViewContent.element.height);
        }
    }

    // 创建区域标题
    function _createSectionTitle(titleKey, yOffset) {
        var titleContainer = new pc.Entity('SectionTitle');
        titleContainer.addComponent('element', {
            type: pc.ELEMENTTYPE_GROUP,
            anchor: [0, 1, 1, 1],
            pivot: [0, 1],
            width: 0,
            height: 50
        });
        titleContainer.setLocalPosition(0, -yOffset - 25, 0);

        var titleText = new pc.Entity('TitleText');
        titleText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: 400,
            height: 40,
            text: _translateText(titleKey),
            fontSize: 32,
            color: new pc.Color(0, 0, 0),
            fontWeight: 'bold'
        });
        titleText.setLocalPosition(50, 0, 0);
        
        // 设置字体
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                titleText.element.fontAsset = mgr.textElement.element.fontAsset;
            }
        } catch (e) {}
        
        titleContainer.addChild(titleText);
        _scrollViewContent.addChild(titleContainer);
    }

    // 创建清除进度按钮
    function _createClearProgressButton(yOffset) {
        // Create clear progress button
        // ScrollViewContent check
        
        var buttonContainer = new pc.Entity('ClearProgressContainer');
        buttonContainer.addComponent('element', {
            type: pc.ELEMENTTYPE_GROUP,
            anchor: [0, 1, 1, 1],
            pivot: [0, 1],
            width: 0,
            height: 60
        });
        buttonContainer.setLocalPosition(0, -yOffset - 30, 0);

        // 红色按钮背景
        var button = new pc.Entity('ClearProgressButton');
        button.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 300,
            height: 50,
            color: new pc.Color(0.8, 0.2, 0.2), // 红色
            useInput: true
        });

        // 按钮文字
        var buttonText = new pc.Entity('ButtonText');
        buttonText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 280,
            height: 40,
            text: _translateText('menu.panels.clearProgress.button') || '清除当前进度',
            fontSize: 20,
            color: new pc.Color(1, 1, 1), // 白色文字
            fontWeight: 'bold'
        });
        
        // 设置字体
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                buttonText.element.fontAsset = mgr.textElement.element.fontAsset;
            }
        } catch (e) {}

        button.addChild(buttonText);
        buttonContainer.addChild(button);

        // 点击事件
        button.element.on('click', function() {
            _showClearProgressConfirmation();
        });

        // 悬停效果
        button.element.on('mouseenter', function() {
            button.element.color = new pc.Color(0.9, 0.3, 0.3); // 稍微亮一点的红色
        });

        button.element.on('mouseleave', function() {
            button.element.color = new pc.Color(0.8, 0.2, 0.2); // 恢复原色
        });

        _scrollViewContent.addChild(buttonContainer);
    }

    // 显示清除进度确认对话框
    function _showClearProgressConfirmation() {
        if (!_app) return;
        
        // 创建确认对话框背景
        var overlay = new pc.Entity('ClearProgressOverlay');
        overlay.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0, 1, 1],
            pivot: [0.5, 0.5],
            width: 0,
            height: 0,
            color: new pc.Color(0, 0, 0, 0.7), // 半透明黑色
            useInput: true
        });

        // 对话框容器
        var dialog = new pc.Entity('ConfirmDialog');
        dialog.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 400,
            height: 200,
            color: new pc.Color(0.9, 0.9, 0.9), // 浅灰色背景
            useInput: true
        });

        // 标题文字
        var titleText = new pc.Entity('DialogTitle');
        titleText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.8, 0.5, 0.8],
            pivot: [0.5, 0.5],
            width: 350,
            height: 30,
            text: _translateText('menu.panels.clearProgress.title') || '确认清除进度',
            fontSize: 24,
            color: new pc.Color(0, 0, 0),
            fontWeight: 'bold'
        });

        // 内容文字
        var contentText = new pc.Entity('DialogContent');
        contentText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.6, 0.5, 0.6],
            pivot: [0.5, 0.5],
            width: 350,
            height: 60,
            text: _translateText('menu.panels.clearProgress.message') || '这将清除所有游戏进度和对话记录，\n此操作不可撤销。确定要继续吗？',
            fontSize: 16,
            color: new pc.Color(0.2, 0.2, 0.2),
            wrapLines: true
        });

        // 确认按钮
        var confirmBtn = new pc.Entity('ConfirmButton');
        confirmBtn.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0.3, 0.2, 0.3, 0.2],
            pivot: [0.5, 0.5],
            width: 100,
            height: 40,
            color: new pc.Color(0.8, 0.2, 0.2), // 红色
            useInput: true
        });

        var confirmText = new pc.Entity('ConfirmText');
        confirmText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 90,
            height: 30,
            text: _translateText('menu.panels.clearProgress.confirm') || '确认',
            fontSize: 16,
            color: new pc.Color(1, 1, 1)
        });

        // 取消按钮
        var cancelBtn = new pc.Entity('CancelButton');
        cancelBtn.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0.7, 0.2, 0.7, 0.2],
            pivot: [0.5, 0.5],
            width: 100,
            height: 40,
            color: new pc.Color(0.5, 0.5, 0.5), // 灰色
            useInput: true
        });

        var cancelText = new pc.Entity('CancelText');
        cancelText.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 90,
            height: 30,
            text: _translateText('menu.panels.clearProgress.cancel') || '取消',
            fontSize: 16,
            color: new pc.Color(1, 1, 1)
        });

        // 设置字体
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                titleText.element.fontAsset = mgr.textElement.element.fontAsset;
                contentText.element.fontAsset = mgr.textElement.element.fontAsset;
                confirmText.element.fontAsset = mgr.textElement.element.fontAsset;
                cancelText.element.fontAsset = mgr.textElement.element.fontAsset;
            }
        } catch (e) {}

        // 组装对话框
        confirmBtn.addChild(confirmText);
        cancelBtn.addChild(cancelText);
        dialog.addChild(titleText);
        dialog.addChild(contentText);
        dialog.addChild(confirmBtn);
        dialog.addChild(cancelBtn);
        overlay.addChild(dialog);

        // 添加到屏幕
        if (_scrollView && _scrollView.parent) {
            _scrollView.parent.addChild(overlay);
        }

        // 事件处理
        confirmBtn.element.on('click', function() {
            _executeClearProgress();
            overlay.destroy();
        });

        cancelBtn.element.on('click', function() {
            overlay.destroy();
        });

        // 点击背景关闭
        overlay.element.on('click', function(e) {
            if (e.element === overlay.element) {
                overlay.destroy();
            }
        });
    }

    // 执行清除进度
    function _executeClearProgress() {
        try {
            if (typeof GlobalGame !== 'undefined') {
                // 清除对话进度
                if (GlobalGame.clearDialogueProgress) {
                    GlobalGame.clearDialogueProgress();
                }
                
                // 清除游戏进度（如果有相关方法）
                if (GlobalGame.clearGameProgress) {
                    GlobalGame.clearGameProgress();
                }
                
                // ★★ 明确清除 prologue 访问记录 ★★
                if (GlobalGame.clearPrologueVisited) {
                    GlobalGame.clearPrologueVisited(); // 清除所有prologue标记
                    console.log('[MenuSettingsUI] Cleared all prologue visited marks');
                }
                
                // 重置localStorage中的其他进度数据（保留语言设置避免页面刷新）
                var keysToRemove = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    // 保留设置数据和语言相关数据，避免触发页面刷新
                    if (key && key.startsWith('echoSoul_') && 
                        key !== 'echoSoul_settings' && 
                        key !== 'echoSoul_locale' && 
                        !key.includes('_language') && 
                        !key.includes('_i18n')) {
                        keysToRemove.push(key);
                    }
                }
                
                for (var j = 0; j < keysToRemove.length; j++) {
                    localStorage.removeItem(keysToRemove[j]);
                    // Removed localStorage key
                }
                
                // Game progress cleared
                
                // 触发进度清除事件
                if (_app) {
                    _app.fire('game:progress:cleared');
                }
                
                // 显示成功提示并强制刷新页面
                console.log('[MenuSettingsUI] 游戏进度已清除，正在刷新页面...');
                console.log('[MenuSettingsUI] 清除的键包括: echoSoul_prologueVisited, 对话记录, 存档点等');
                
                // 延迟刷新，确保日志输出完成
                setTimeout(function() {
                    window.location.reload();
                }, 500);
                
            } else {
                console.warn('[MenuSettingsUI] GlobalGame not available for clearing progress');
            }
        } catch (e) {
            console.error('[MenuSettingsUI] Error clearing progress:', e);
        }
    }

    function _createOptionUI(item, index, yOffset) {
        yOffset = yOffset || 0;
        var container = new pc.Entity('Option_' + item.key);
        container.addComponent('element', {
            type: pc.ELEMENTTYPE_GROUP,
            anchor: [0, 1, 1, 1],
            pivot: [0, 1],
            width: 0,
            height: 160  // 增加容器高度以容纳按钮
        });
        container.setLocalPosition(0, -yOffset - 40, 0);

        // 标签（使用 I18n 键）
        var labelText = item.labelKey ? _translateText(item.labelKey) : (item.label || item.key);
        var label = new pc.Entity('Label');
        label.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: 200,
            height: 40,
            text: labelText,
            fontSize: 24,
            color: new pc.Color(0, 0, 0)
        });
        label.setLocalPosition(50, 0, 0);
        
        // 设置字体
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                label.element.fontAsset = mgr.textElement.element.fontAsset;
            }
        } catch (e) {}
        
        container.addChild(label);

        // 控件
        var control = null;
        if (item.type === 'slider') control = _createSlider(item);
        else if (item.type === 'toggle') control = _createToggle(item);
        else if (item.type === 'dropdown') control = _createDropdown(item);

        if (control) {
            // 语言选择块向右偏移更多
            var xPos = (item.type === 'dropdown') ? 380 : 300;
            control.setLocalPosition(xPos, 0, 0);
            container.addChild(control);
        }

        _scrollViewContent.addChild(container);
    }

    function _createLabel(text, x, y) {
        var label = new pc.Entity('Label');
        label.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: 200,
            height: 40,
            text: _translateText(text) || '',
            fontSize: 24,
            color: new pc.Color(0, 0, 0)
        });
        
        // 设置字体
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                label.element.fontAsset = mgr.textElement.element.fontAsset;
            }
        } catch (e) {}
        
        label.setLocalPosition(x, y, 0);
        return label;
    }

    function _createSlider(item) {
        var slider = new pc.Entity('Slider_' + item.key);
        slider.addComponent('element', {
            type: pc.ELEMENTTYPE_GROUP,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: 520,
            height: 60
        });

        // 背景条 - 颜色改为 #FCFBDB
        var bg = new pc.Entity('SliderBG');
        bg.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: 400,
            height: 20,
            color: new pc.Color(0.988, 0.984, 0.859), // #FCFBDB 转换为RGB
            useInput: true
        });
        slider.addChild(bg);

        // 小圆点手柄（IMAGE，避免字体缺字）
        var handle = new pc.Entity('Handle');
        handle.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0.5, 0.5],
            width: 24,
            height: 24,
            color: new pc.Color(1, 0.6, 0)
        });
        slider.addChild(handle);

        // 数值文本（百分比）
        var valueLabel = _createLabel('', 420, 0);
        valueLabel.element.fontSize = 20;
        slider.addChild(valueLabel);

        // 计算并设置初始值
        var currentValue = _tempSettings[item.key];
        if (currentValue === null || currentValue === undefined) {
            currentValue = item.default;
        }
        var ratio = (currentValue - item.min) / (item.max - item.min);
        ratio = Math.max(0, Math.min(1, ratio));

        // 根据 ratio 更新UI
        function applyRatio(r) {
            var x = r * bg.element.width; // 局部宽度
            handle.setLocalPosition(x, 0, 0);
            var val = item.min + r * (item.max - item.min);
            
            // 根据设置项类型决定精度和显示格式
            if (item.key === 'mouseSensitivity') {
                val = Math.round(val * 10) / 10; // 保留1位小数
                _tempSettings[item.key] = val;
                valueLabel.element.text = val.toFixed(1);
            } else {
                val = Math.round(val);
                _tempSettings[item.key] = val;
                valueLabel.element.text = val + '%';
            }
        }
        applyRatio(ratio);

        // 点击/拖动交互
        var dragging = false;

        function updateFromPointer(e) {
            // 简化：使用 element 的 canvasCorners 来计算相对位置
            if (!bg.element.canvasCorners) return;
            
            var corners = bg.element.canvasCorners;
            var left = corners[0].x;
            var right = corners[2].x;
            var bgWidth = right - left;
            
            // 计算鼠标在背景条中的相对位置
            var relativeX = e.x - left;
            var localX = Math.max(0, Math.min(bgWidth, relativeX));
            var r = localX / bgWidth;
            
            applyRatio(r);
        }

        bg.element.on('mousedown', function (e) { 
            dragging = true; 
            updateFromPointer(e); 
        });
        
        _app.mouse.on('mousemove', function (e) { 
            if (dragging) updateFromPointer(e); 
        });
        
        _app.mouse.on('mouseup', function () { 
            dragging = false; 
        });

        // 触屏支持
        if (_app.touch) {
            bg.element.on('touchstart', function (e) { 
                dragging = true; 
                if (e.touches && e.touches[0]) {
                    updateFromPointer(e.touches[0]); 
                }
            });
            
            _app.touch.on('touchmove', function (e) { 
                if (dragging && e.touches && e.touches[0]) {
                    updateFromPointer(e.touches[0]); 
                }
            });
            
            _app.touch.on('touchend', function () { 
                dragging = false; 
            });
        }

        return slider;
    }

    function _createToggle(item) {
        var toggle = new pc.Entity('Toggle_' + item.key);
        toggle.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0.5, 0.5],
            width: 60,
            height: 40,
            color: new pc.Color(0.5, 0.5, 0.5),
            useInput: true
        });

        var currentValue = _tempSettings[item.key] || item.default;
        
        // 特殊处理清除进度的颜色
        if (item.special === 'clearProgress') {
            toggle.element.color = new pc.Color(0.8, 0.2, 0.2); // 红色，表示危险操作
        } else {
            toggle.element.color = currentValue ? new pc.Color(0, 1, 0) : new pc.Color(0.5, 0.5, 0.5);
        }

        toggle.element.on('click', function () {
            // 特殊处理清除进度功能
            if (item.special === 'clearProgress') {
                _showClearProgressConfirmation();
                // 清除进度不保存状态，始终保持false
                return;
            }
            
            var newValue = !_tempSettings[item.key];
            _tempSettings[item.key] = newValue;
            toggle.element.color = newValue ? new pc.Color(0, 1, 0) : new pc.Color(0.5, 0.5, 0.5);
        });

        return toggle;
    }

    function _createDropdown(item) {
        var dropdown = new pc.Entity('Dropdown_' + item.key);
        dropdown.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0.5, 0.5],
            width: 150,
            height: 40,
            color: new pc.Color(0.988, 0.984, 0.859),
            useInput: true
        });

        var currentValue = _tempSettings[item.key] || item.default;
        
        // 获取显示文本的函数
        function getDisplayText(value) {
            if (item.key === 'language') {
                // 获取当前语言设置
                var currentLang = 'zh-CN';
                if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting) {
                    currentLang = GlobalGame.getSetting('language', 'zh-CN');
                } else if (typeof I18n !== 'undefined' && I18n.getCurrentLanguage) {
                    currentLang = I18n.getCurrentLanguage();
                }
                
                // 根据当前语言返回对应的翻译
                if (currentLang.indexOf('en') === 0) {
                    // 英语环境：显示英文
                    return value === 'zh-CN' ? 'Chinese' : 'English';
                } else {
                    // 中文环境：显示中文
                    return value === 'zh-CN' ? '简体中文' : 'English';
                }
            }
            return value; // 其他选项直接显示原值
        }
        
        var label = _createLabel(getDisplayText(currentValue), 0, 0);
        dropdown.addChild(label);

        dropdown.element.on('click', function () {
            var options = item.options || [];
            var idx = options.indexOf(_tempSettings[item.key]);
            var newValue = options[(idx + 1) % options.length];
            _tempSettings[item.key] = newValue;
            label.element.text = getDisplayText(newValue);
        });

        return dropdown;
    }

    // ---------- 创建关闭按钮 ----------
    function _createCloseButton() {
        if (!_scrollView) return;
        
        // 检查是否已存在关闭按钮
        var existing = _scrollView.findByName('CloseButton');
        if (existing) return;
        
        var closeBtn = new pc.Entity('CloseButton');
        closeBtn.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [1, 1, 1, 1], // 右上角
            pivot: [1, 1],
            width: 40,
            height: 40,
            color: new pc.Color(0.8, 0.2, 0.2), // 红色
            useInput: true
        });
        closeBtn.setLocalPosition(-10, -50, 0);
        
        // 添加 X 文本
        var xLabel = new pc.Entity('XLabel');
        xLabel.addComponent('element', {
            type: pc.ELEMENTTYPE_TEXT,
            anchor: [0.5, 0.5, 0.5, 0.5],
            pivot: [0.5, 0.5],
            width: 40,
            height: 40,
            text: '×',
            fontSize: 32,
            color: new pc.Color(1, 1, 1),
            alignment: new pc.Vec2(0.5, 0.5)
        });
        closeBtn.addChild(xLabel);
        
        // 点击关闭
        closeBtn.element.on('click', function() {
            hide();
        });
        
        _scrollView.addChild(closeBtn);
    }

    // ---------- 滑入动画 ----------
    function _slideIn() {
        if (!_scrollView) return;

        _scrollView.enabled = true;
        _isAnimating = true;
        _isVisible = false;

        // 获取屏幕宽度
        var screenWidth = _app.graphicsDevice.width;
        
        // 起始位置（屏幕外）
        var startX = _slideDirection === 'left' ? -screenWidth : screenWidth;
        var endX = 0; // 居中（相对于父容器）

        if (_scrollView.element) {
            _scrollView.element.opacity = 1;
        }
        _scrollView.setLocalPosition(startX, 0, 0);
        
        // 创建关闭按钮
        _createCloseButton();

        // 滑入动画（400ms）
        var startTime = Date.now();
        var duration = 400;

        var slideInterval = setInterval(function() {
            var elapsed = Date.now() - startTime;
            var progress = Math.min(elapsed / duration, 1);
            
            // 缓动函数（easeOutCubic）
            var eased = 1 - Math.pow(1 - progress, 3);
            var currentX = startX + (endX - startX) * eased;

            if (_scrollView) {
                _scrollView.setLocalPosition(currentX, 0, 0);
            }

            if (progress >= 1) {
                clearInterval(slideInterval);
                _isAnimating = false;
                _isVisible = true;
                // Slide in complete
            }
        }, 16);
    }

    // ---------- 滑出动画 ----------
    function _slideOut(callback) {
        if (!_scrollView) {
            if (callback) callback();
            return;
        }

        _isAnimating = true;

        var screenWidth = _app.graphicsDevice.width;
        var startX = 0;
        var endX = _slideDirection === 'left' ? -screenWidth : screenWidth;

        var startTime = Date.now();
        var duration = 400;

        var slideInterval = setInterval(function() {
            var elapsed = Date.now() - startTime;
            var progress = Math.min(elapsed / duration, 1);
            
            var eased = 1 - Math.pow(1 - progress, 3);
            var currentX = startX + (endX - startX) * eased;

            if (_scrollView) {
                _scrollView.setLocalPosition(currentX, 0, 0);
            }

            if (progress >= 1) {
                clearInterval(slideInterval);
                _scrollView.enabled = false;
                _isAnimating = false;
                _isVisible = false;
                // Slide out complete
                if (callback) callback();
            }
        }, 16);
    }

    // ---------- 生成收藏品UI ----------
    function _generateCollectiblesUI() {
        var pm = (typeof PlayerManager !== 'undefined') ? PlayerManager.get() : null;
        var collectibles = pm ? pm.getAllCollectibles() : {};
        var collectibleIds = Object.keys(collectibles);
        
        if (collectibleIds.length === 0) {
            // 无收藏品时显示提示
            var emptyHint = _createLabel('menu.collectibles.empty', 50, -40);
            emptyHint.element.color = new pc.Color(0.5, 0.5, 0.5);
            emptyHint.element.fontSize = 20;
            emptyHint.element.anchor = [0, 1, 0, 1];
            emptyHint.element.pivot = [0, 1];
            emptyHint.element.alignment = new pc.Vec2(0, 0.5);
            _scrollViewContent.addChild(emptyHint);
            
            if (_scrollViewContent.element) {
                _scrollViewContent.element.height = 200;
            }
            return;
        }
        
        // 显示收藏品列表
        var yOffset = -20;
        for (var i = 0; i < collectibleIds.length; i++) {
            var id = collectibleIds[i];
            var data = collectibles[id];
            
            var container = new pc.Entity('Collectible_' + id);
            container.addComponent('element', {
                type: pc.ELEMENTTYPE_GROUP,
                anchor: [0, 1, 1, 1],
                pivot: [0, 1],
                width: 0,
                height: 100
            });
            container.setLocalPosition(0, yOffset, 0);
            
            // 收藏品图标（占位）
            var icon = new pc.Entity('Icon');
            icon.addComponent('element', {
                type: pc.ELEMENTTYPE_IMAGE,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                width: 80,
                height: 80,
                color: new pc.Color(0.2, 0.6, 0.8)
            });
            icon.setLocalPosition(20, 0, 0);
            container.addChild(icon);
            
            // 收藏品名称（不需要翻译，直接创建）
            var nameLabel = new pc.Entity('Name');
            nameLabel.addComponent('element', {
                type: pc.ELEMENTTYPE_TEXT,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                width: 400,
                height: 40,
                text: data.displayName || id,
                fontSize: 20,
                color: new pc.Color(0, 0, 0),
                alignment: new pc.Vec2(0, 0.5)
            });
            nameLabel.setLocalPosition(120, 15, 0);
            // 设置字体
            try {
                var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
                if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                    nameLabel.element.fontAsset = mgr.textElement.element.fontAsset;
                }
            } catch (e) {}
            container.addChild(nameLabel);
            
            // 位置信息（需要翻译）
            var locationText = _translateText('menu.collectibles.location') + ': ' + (data.location || _translateText('menu.collectibles.unknown'));
            var locationLabel = new pc.Entity('Location');
            locationLabel.addComponent('element', {
                type: pc.ELEMENTTYPE_TEXT,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                width: 400,
                height: 40,
                text: locationText,
                fontSize: 16,
                color: new pc.Color(0.4, 0.4, 0.4),
                alignment: new pc.Vec2(0, 0.5)
            });
            locationLabel.setLocalPosition(120, -15, 0);
            try {
                var mgr2 = UIManager && UIManager.getInstance && UIManager.getInstance();
                if (mgr2 && mgr2.textElement && mgr2.textElement.element && mgr2.textElement.element.fontAsset) {
                    locationLabel.element.fontAsset = mgr2.textElement.element.fontAsset;
                }
            } catch (e) {}
            container.addChild(locationLabel);
            
            // 时间戳
            if (data.timestamp) {
                var date = new Date(data.timestamp);
                var timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                var timeText = _translateText('menu.collectibles.foundAt') + ': ' + timeStr;
                var timeLabel = _createLabel(timeText, 120, -35);
                timeLabel.element.fontSize = 14;
                timeLabel.element.color = new pc.Color(0.5, 0.5, 0.5);
                container.addChild(timeLabel);
            }
            
            _scrollViewContent.addChild(container);
            yOffset -= 110;
        }
        
        // 调整内容高度
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 400);
        }
        
        // Generated collectibles UI
    }
    
    // ---------- 生成故事进度UI ----------
    function _generateStoryUI() {
        var visited = {};
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame._prologueVisited) {
                visited = GlobalGame._prologueVisited;
            } else if (typeof localStorage !== 'undefined') {
                var saved = localStorage.getItem('echoSoul_prologueVisited');
                if (saved) visited = JSON.parse(saved);
            }
        } catch (e) {
            // Failed to load prologue visited
        }
        
        var prologueKeys = Object.keys(visited);
        
        if (prologueKeys.length === 0) {
            // 无故事记录时显示提示
            var emptyHint = _createLabel('menu.story.empty', 50, -40);
            emptyHint.element.color = new pc.Color(0.5, 0.5, 0.5);
            emptyHint.element.fontSize = 20;
            emptyHint.element.anchor = [0, 1, 0, 1];
            emptyHint.element.pivot = [0, 1];
            emptyHint.element.alignment = new pc.Vec2(0, 0.5);
            _scrollViewContent.addChild(emptyHint);
            
            if (_scrollViewContent.element) {
                _scrollViewContent.element.height = 200;
            }
            return;
        }
        
        // 尝试从 I18n 获取 prologue 数据（获取整个命名空间）
        var prologueData = {};
        try {
            if (typeof I18n !== 'undefined' && I18n.get) {
                // 注意：这里需要用 get 获取整个命名空间对象，不能用 t
                var allPrologueData = I18n.get('prologue');
                if (allPrologueData && typeof allPrologueData === 'object') {
                    prologueData = allPrologueData;
                }
            }
        } catch (e) {
            // Failed to load prologue data
        }
        
        // 显示故事列表
        var yOffset = -20;
        for (var i = 0; i < prologueKeys.length; i++) {
            var key = prologueKeys[i];
            var data = prologueData[key];
            
            var container = new pc.Entity('Story_' + key);
            container.addComponent('element', {
                type: pc.ELEMENTTYPE_GROUP,
                anchor: [0, 1, 1, 1],
                pivot: [0, 1],
                width: 980,  // 设置足够的宽度容纳按钮
                height: 160  // 增加高度以容纳更多内容
            });
            container.setLocalPosition(150, yOffset, 0);  // 向右偏移100px，确保内容完整显示
            
            // 强制设置容器宽度（防止被重新计算）
            if (container.element) {
                container.element.width = 980;
                // Container width force set
            }
            
            // 缩略图（尝试使用第一张图片）
            var thumbnail = new pc.Entity('Thumbnail');
            thumbnail.addComponent('element', {
                type: pc.ELEMENTTYPE_IMAGE,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                width: 220,  // 增大缩略图宽度
                height: 140, // 增大缩略图高度
                color: new pc.Color(0.15, 0.15, 0.2)
            });
            thumbnail.setLocalPosition(10, 0, 0);  // 缩略图从左边 10px 开始
            
            // 尝试加载缩略图纹理
            if (data && data.typeLines && data.typeLines[0] && data.typeLines[0].imageName) {
                var imageName = data.typeLines[0].imageName;
                var textureAsset = _app.assets.find(imageName, 'texture');
                if (textureAsset && textureAsset.resource) {
                    thumbnail.element.texture = textureAsset.resource;
                    thumbnail.element.color = new pc.Color(1, 1, 1);
                }
            }
            
            container.addChild(thumbnail);
            
            // 标题/名称
            var title = key;
            if (data && data.title) {
                title = data.title;
            } else {
                // 直接使用 menu.story.{key} 的 i18n 键
                title = _translateText('menu.story.' + key);
            }
            
            // 标题（不翻译，因为 title 已经是翻译好的文本）
            var titleLabel = new pc.Entity('Title');
            titleLabel.addComponent('element', {
                type: pc.ELEMENTTYPE_TEXT,
                anchor: [0, 0.5, 0, 0.5],
                pivot: [0, 0.5],
                width: 500,  // 增大文本宽度
                height: 40,
                text: title,
                fontSize: 24,  // 增大字体
                color: new pc.Color(0, 0, 0)  // 确保是黑色
            });
            titleLabel.setLocalPosition(250, 30, 0);  // 调整位置，向左移动一些
            titleLabel.element.fontAsset = _getFontAsset();
            container.addChild(titleLabel);
            
            // 状态标记（需要翻译）
            var statusLabel = _createLabel('menu.story.completed', 250, 0);  // 调整位置
            statusLabel.element.fontSize = 16;
            statusLabel.element.color = new pc.Color(0.2, 0.7, 0.3);
            container.addChild(statusLabel);
            
            // 播放按钮（参考语言下拉框样式）
            var playButton = new pc.Entity('PlayButton_' + key);
            playButton.addComponent('element', {
                type: pc.ELEMENTTYPE_IMAGE,
                anchor: [1, 0.5, 1, 0.5],  // 右侧居中
                pivot: [1, 0.5],
                width: 100,
                height: 40,
                color: new pc.Color(0.3, 0.6, 0.3),  // 绿色按钮
                useInput: true
            });
            playButton.setLocalPosition(-20, 0, 0);  // 距离右边 20px
            
            // 按钮文字
            var playLabel = new pc.Entity('PlayLabel');
            playLabel.addComponent('element', {
                type: pc.ELEMENTTYPE_TEXT,
                anchor: [0.5, 0.5, 0.5, 0.5],
                pivot: [0.5, 0.5],
                width: 100,
                height: 40,
                text: _translateText('menu.story.play') || '▶ 播放',
                fontSize: 20,
                color: new pc.Color(1, 1, 1),
                alignment: new pc.Vec2(0.5, 0.5)
            });
            // 设置字体
            try {
                var mgr2 = UIManager && UIManager.getInstance && UIManager.getInstance();
                if (mgr2 && mgr2.textElement && mgr2.textElement.element && mgr2.textElement.element.fontAsset) {
                    playLabel.element.fontAsset = mgr2.textElement.element.fontAsset;
                }
            } catch (e) {}
            playButton.addChild(playLabel);
            
            // 点击事件 - 播放对应的 prologue
            (function(prologueKey) {
                playButton.element.on('click', function() {
                    if (_debug) {
                        console.log('[MenuSettingsUI] 播放 prologue:', prologueKey);
                    }
                    
                    // 先通知 GameManager 播放 prologue
                    if (typeof GlobalGame === 'undefined') {
                        console.error('[MenuSettingsUI] GlobalGame 对象未定义');
                        return;
                    }
                    
                    if (_debug) {
                        console.log('[MenuSettingsUI] GlobalGame 可用:', !!GlobalGame);
                        console.log('[MenuSettingsUI] GlobalGame.playPrologue 存在:', typeof GlobalGame.playPrologue);
                        console.log('[MenuSettingsUI] GlobalGame 所有方法:', Object.keys(GlobalGame).filter(function(k) {
                            return typeof GlobalGame[k] === 'function';
                        }));
                    }
                    
                    if (typeof GlobalGame.playPrologue === 'function') {
                        try {
                            GlobalGame.playPrologue(prologueKey);
                            
                            if (_debug) {
                                console.log('[MenuSettingsUI] GlobalGame.playPrologue 调用成功');
                            }
                        } catch (e) {
                            console.error('[MenuSettingsUI] 播放 prologue 失败:', e);
                        }
                    } else {
                        console.error('[MenuSettingsUI] GlobalGame.playPrologue 方法不存在');
                        console.error('[MenuSettingsUI] GlobalGame.playPrologue 类型:', typeof GlobalGame.playPrologue);
                    }
                    
                    // 触发播放事件（供其他系统监听）
                    _app.fire('menu:play:prologue', { key: prologueKey });
                    
                    // 延迟关闭菜单，确保播放已启动
                    setTimeout(function() {
                        hide();
                    }, 100);
                });
            })(key);
            
            container.addChild(playButton);
            
            // 描述（不翻译，因为是来自 prologue 数据的文本）
            if (data && data.typeLines && data.typeLines[0]) {
                var descText = data.typeLines[0].text || '';
                if (descText.length > 60) descText = descText.substring(0, 60) + '...';  // 增加文本长度
                var descLabel = new pc.Entity('Description');
                descLabel.addComponent('element', {
                    type: pc.ELEMENTTYPE_TEXT,
                    anchor: [0, 0.5, 0, 0.5],
                    pivot: [0, 0.5],
                    width: 500,  // 增大文本宽度
                    height: 80,  // 增大文本高度
                    text: descText,
                    fontSize: 16,  // 增大字体
                    color: new pc.Color(0, 0, 0),  // 改为黑色
                    wrapLines: true
                });
                descLabel.setLocalPosition(250, -30, 0);  // 调整位置
                try {
                    var mgr3 = UIManager && UIManager.getInstance && UIManager.getInstance();
                    if (mgr3 && mgr3.textElement && mgr3.textElement.element && mgr3.textElement.element.fontAsset) {
                        descLabel.element.fontAsset = mgr3.textElement.element.fontAsset;
                    }
                } catch (e) {}
                container.addChild(descLabel);
            }
            
            // 最终强制设置容器宽度
            if (container.element) {
                container.element.width = 980;
                // Container width final force set
            }
            
            // 调试UI层级结构
            // UI Hierarchy check
            // ScrollViewContent exists check
            // ScrollViewContent element check
            // ScrollViewContent enabled check
            // ScrollViewContent parent check
            
            // 关键修复：确保 _scrollViewContent 启用
            if (_scrollViewContent && !_scrollViewContent.enabled) {
                _scrollViewContent.enabled = true;
                // FIXED: _scrollViewContent enabled
            }
            
            // 同时检查并启用父级容器
            if (_scrollViewContent && _scrollViewContent.parent && !_scrollViewContent.parent.enabled) {
                _scrollViewContent.parent.enabled = true;
                // FIXED: _scrollViewContent parent enabled
            }
            
            _scrollViewContent.addChild(container);
            // Container added to scrollViewContent
            yOffset -= 180;  // 增加项目间距
        }
        
        // 调整内容高度
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 400);
        }
        
        // Generated story UI
    }
    
    // ---------- 生成帮助信息UI ----------
    function _generateHelpUI() {
        var yOffset = -20; // 从顶部开始
        
        // 标题
        var title = _createLabel('menu.help.title', 50, yOffset);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(0, 0, 0);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        _scrollViewContent.addChild(title);
        yOffset -= 70;
        
        // 电脑端操作
        var pcTitle = _createLabel('menu.help.pc.title', 50, yOffset);
        pcTitle.element.fontSize = 32;
        pcTitle.element.color = new pc.Color(0, 0, 0);
        pcTitle.element.anchor = [0, 1, 0, 1];
        pcTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcTitle);
        yOffset -= 60;
        
        // 电脑端 - 移动控制
        var pcMovementTitle = _createLabel('menu.help.pc.movement.title', 70, yOffset);
        pcMovementTitle.element.fontSize = 24;
        pcMovementTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        pcMovementTitle.element.anchor = [0, 1, 0, 1];
        pcMovementTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcMovementTitle);
        yOffset -= 40;
        
        var pcWASD = _createLabel('menu.help.pc.movement.wasd', 90, yOffset);
        pcWASD.element.fontSize = 20;
        pcWASD.element.color = new pc.Color(0, 0, 0);
        pcWASD.element.anchor = [0, 1, 0, 1];
        pcWASD.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcWASD);
        yOffset -= 35;
        
        var pcShift = _createLabel('menu.help.pc.movement.shift', 90, yOffset);
        pcShift.element.fontSize = 20;
        pcShift.element.color = new pc.Color(0, 0, 0);
        pcShift.element.anchor = [0, 1, 0, 1];
        pcShift.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcShift);
        yOffset -= 35;
        
        var pcSpace = _createLabel('menu.help.pc.movement.space', 90, yOffset);
        pcSpace.element.fontSize = 20;
        pcSpace.element.color = new pc.Color(0, 0, 0);
        pcSpace.element.anchor = [0, 1, 0, 1];
        pcSpace.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcSpace);
        yOffset -= 40;
        
        var pcExit = _createLabel('menu.help.pc.movement.exit', 90, yOffset);
        pcExit.element.fontSize = 23;
        pcExit.element.color = new pc.Color(0, 0, 0);
        pcExit.element.anchor = [0, 1, 0, 1];
        pcExit.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcExit);
        yOffset -= 50;
        
        // 电脑端 - 交互操作
        var pcInteractionTitle = _createLabel('menu.help.pc.interaction.title', 70, yOffset);
        pcInteractionTitle.element.fontSize = 24;
        pcInteractionTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        pcInteractionTitle.element.anchor = [0, 1, 0, 1];
        pcInteractionTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcInteractionTitle);
        yOffset -= 40;
        
        var pcKey = _createLabel('menu.help.pc.interaction.key', 90, yOffset);
        pcKey.element.fontSize = 20;
        pcKey.element.color = new pc.Color(0, 0, 0);
        pcKey.element.anchor = [0, 1, 0, 1];
        pcKey.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcKey);
        yOffset -= 35;
        
        var pcDesc = _createLabel('menu.help.pc.interaction.description', 90, yOffset);
        pcDesc.element.fontSize = 18;
        pcDesc.element.color = new pc.Color(0.4, 0.4, 0.4);
        pcDesc.element.anchor = [0, 1, 0, 1];
        pcDesc.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcDesc);
        yOffset -= 50;
        
        // 电脑端 - 系统操作
        var pcSystemTitle = _createLabel('menu.help.pc.system.title', 70, yOffset);
        pcSystemTitle.element.fontSize = 24;
        pcSystemTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        pcSystemTitle.element.anchor = [0, 1, 0, 1];
        pcSystemTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcSystemTitle);
        yOffset -= 40;
        
        var pcRespawn = _createLabel('menu.help.pc.system.respawn', 90, yOffset);
        pcRespawn.element.fontSize = 20;
        pcRespawn.element.color = new pc.Color(0, 0, 0);
        pcRespawn.element.anchor = [0, 1, 0, 1];
        pcRespawn.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcRespawn);
        yOffset -= 35;
        
        var pcRespawnHint = _createLabel('menu.help.pc.system.respawnHint', 90, yOffset);
        pcRespawnHint.element.fontSize = 18;
        pcRespawnHint.element.color = new pc.Color(0.4, 0.4, 0.4);
        pcRespawnHint.element.anchor = [0, 1, 0, 1];
        pcRespawnHint.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcRespawnHint);
        yOffset -= 35;
        
        var pcEsc = _createLabel('menu.help.pc.system.esc', 90, yOffset);
        pcEsc.element.fontSize = 20;
        pcEsc.element.color = new pc.Color(0, 0, 0);
        pcEsc.element.anchor = [0, 1, 0, 1];
        pcEsc.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcEsc);
        yOffset -= 50;
        
        // 电脑端 - 叙事播放
        var pcNarrativeTitle = _createLabel('menu.help.pc.narrative.title', 70, yOffset);
        pcNarrativeTitle.element.fontSize = 24;
        pcNarrativeTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        pcNarrativeTitle.element.anchor = [0, 1, 0, 1];
        pcNarrativeTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcNarrativeTitle);
        yOffset -= 40;
        
        var pcNarrativeClick = _createLabel('menu.help.pc.narrative.click', 90, yOffset);
        pcNarrativeClick.element.fontSize = 20;
        pcNarrativeClick.element.color = new pc.Color(0, 0, 0);
        pcNarrativeClick.element.anchor = [0, 1, 0, 1];
        pcNarrativeClick.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcNarrativeClick);
        yOffset -= 35;
        
        var pcNarrativeDesc = _createLabel('menu.help.pc.narrative.description', 90, yOffset);
        pcNarrativeDesc.element.fontSize = 18;
        pcNarrativeDesc.element.color = new pc.Color(0.4, 0.4, 0.4);
        pcNarrativeDesc.element.anchor = [0, 1, 0, 1];
        pcNarrativeDesc.element.pivot = [0, 1];
        _scrollViewContent.addChild(pcNarrativeDesc);
        yOffset -= 80;
        
        // 移动端操作
        var mobileTitle = _createLabel('menu.help.mobile.title', 50, yOffset);
        mobileTitle.element.fontSize = 32;
        mobileTitle.element.color = new pc.Color(0, 0, 0);
        mobileTitle.element.anchor = [0, 1, 0, 1];
        mobileTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileTitle);
        yOffset -= 60;
        
        // 移动端 - 移动控制
        var mobileMovementTitle = _createLabel('menu.help.mobile.movement.title', 70, yOffset);
        mobileMovementTitle.element.fontSize = 24;
        mobileMovementTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        mobileMovementTitle.element.anchor = [0, 1, 0, 1];
        mobileMovementTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileMovementTitle);
        yOffset -= 40;
        
        var mobileJoystick = _createLabel('menu.help.mobile.movement.joystick', 90, yOffset);
        mobileJoystick.element.fontSize = 20;
        mobileJoystick.element.color = new pc.Color(0, 0, 0);
        mobileJoystick.element.anchor = [0, 1, 0, 1];
        mobileJoystick.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileJoystick);
        yOffset -= 35;
        
        var mobileRun = _createLabel('menu.help.mobile.movement.run', 90, yOffset);
        mobileRun.element.fontSize = 20;
        mobileRun.element.color = new pc.Color(0, 0, 0);
        mobileRun.element.anchor = [0, 1, 0, 1];
        mobileRun.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileRun);
        yOffset -= 35;
        
        var mobileJump = _createLabel('menu.help.mobile.movement.jump', 90, yOffset);
        mobileJump.element.fontSize = 20;
        mobileJump.element.color = new pc.Color(0, 0, 0);
        mobileJump.element.anchor = [0, 1, 0, 1];
        mobileJump.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileJump);
        yOffset -= 40;
        
        var mobileExit = _createLabel('menu.help.mobile.movement.exit', 90, yOffset);
        mobileExit.element.fontSize = 23;
        mobileExit.element.color = new pc.Color(0, 0, 0);
        mobileExit.element.anchor = [0, 1, 0, 1];
        mobileExit.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileExit);
        yOffset -= 50;
        
        // 移动端 - 交互操作
        var mobileInteractionTitle = _createLabel('menu.help.mobile.interaction.title', 70, yOffset);
        mobileInteractionTitle.element.fontSize = 24;
        mobileInteractionTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        mobileInteractionTitle.element.anchor = [0, 1, 0, 1];
        mobileInteractionTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileInteractionTitle);
        yOffset -= 40;
        
        var mobileButton = _createLabel('menu.help.mobile.interaction.button', 90, yOffset);
        mobileButton.element.fontSize = 20;
        mobileButton.element.color = new pc.Color(0, 0, 0);
        mobileButton.element.anchor = [0, 1, 0, 1];
        mobileButton.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileButton);
        yOffset -= 50;
        
        // 移动端 - 系统操作
        var mobileSystemTitle = _createLabel('menu.help.mobile.system.title', 70, yOffset);
        mobileSystemTitle.element.fontSize = 24;
        mobileSystemTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        mobileSystemTitle.element.anchor = [0, 1, 0, 1];
        mobileSystemTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileSystemTitle);
        yOffset -= 40;
        
        var mobileRespawn = _createLabel('menu.help.mobile.system.respawn', 90, yOffset);
        mobileRespawn.element.fontSize = 20;
        mobileRespawn.element.color = new pc.Color(0, 0, 0);
        mobileRespawn.element.anchor = [0, 1, 0, 1];
        mobileRespawn.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileRespawn);
        yOffset -= 35;
        
        var mobileRespawnHint = _createLabel('menu.help.mobile.system.respawnHint', 90, yOffset);
        mobileRespawnHint.element.fontSize = 18;
        mobileRespawnHint.element.color = new pc.Color(0.4, 0.4, 0.4);
        mobileRespawnHint.element.anchor = [0, 1, 0, 1];
        mobileRespawnHint.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileRespawnHint);
        yOffset -= 50;
        
        // 移动端 - 叙事播放
        var mobileNarrativeTitle = _createLabel('menu.help.mobile.narrative.title', 70, yOffset);
        mobileNarrativeTitle.element.fontSize = 24;
        mobileNarrativeTitle.element.color = new pc.Color(0.2, 0.2, 0.2);
        mobileNarrativeTitle.element.anchor = [0, 1, 0, 1];
        mobileNarrativeTitle.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileNarrativeTitle);
        yOffset -= 40;
        
        var mobileNarrativeHold = _createLabel('menu.help.mobile.narrative.hold', 90, yOffset);
        mobileNarrativeHold.element.fontSize = 20;
        mobileNarrativeHold.element.color = new pc.Color(0, 0, 0);
        mobileNarrativeHold.element.anchor = [0, 1, 0, 1];
        mobileNarrativeHold.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileNarrativeHold);
        yOffset -= 35;
        
        var mobileNarrativeDesc = _createLabel('menu.help.mobile.narrative.description', 90, yOffset);
        mobileNarrativeDesc.element.fontSize = 18;
        mobileNarrativeDesc.element.color = new pc.Color(0.4, 0.4, 0.4);
        mobileNarrativeDesc.element.anchor = [0, 1, 0, 1];
        mobileNarrativeDesc.element.pivot = [0, 1];
        _scrollViewContent.addChild(mobileNarrativeDesc);
        yOffset -= 50;
        
        // 调整滚动区域高度（确保足够容纳所有内容）
        if (_scrollViewContent && _scrollViewContent.element) {
            // 计算实际内容高度，添加足够的底部空间
            var contentHeight = Math.abs(yOffset) + 150;
            _scrollViewContent.element.height = Math.max(contentHeight, 900);
            
            if (_debug) {
                console.log('[MenuSettingsUI] Help panel content height set to:', _scrollViewContent.element.height);
            }
        }
    }
    
    // 移除了 Prologue 播放按钮相关函数
    
    /**
     * 查找第一个文本元素
     * @param {pc.Entity} entity - 父实体
     * @returns {pc.Entity|null} 文本元素
     */
    function _findFirstTextElement(entity) {
        if (!entity) return null;
        if (entity.element && entity.element.type === pc.ELEMENTTYPE_TEXT) return entity;
        
        var children = entity.children || [];
        for (var i = 0; i < children.length; i++) {
            var result = _findFirstTextElement(children[i]);
            if (result) return result;
        }
        return null;
    }
    
    function _getFontAsset() {
        try {
            var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
            if (mgr && mgr.textElement && mgr.textElement.element && mgr.textElement.element.fontAsset) {
                return mgr.textElement.element.fontAsset;
            }
        } catch (e) {}
        return null;
    }

    // ---------- 应用/隐藏 ----------
    function apply() {
        for (var key in _tempSettings) {
            if (_tempSettings.hasOwnProperty(key)) {
                try {
                    if (typeof GlobalGame !== 'undefined' && GlobalGame.setSetting) {
                        GlobalGame.setSetting(key, _tempSettings[key]);
                    }
                } catch (e) {}
            }
        }
        hide();
    }

    function hide() {
        if (_isAnimating) return;
        // 保存设置到GameManager
        _saveSettings();
        _slideOut(function() {
            _clearContent();
            _currentCategory = null;
        });
    }

    // 保存设置到GameManager
    function _saveSettings() {
        if (!_tempSettings) return;
        
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.setSetting) {
                for (var key in _tempSettings) {
                    if (_tempSettings.hasOwnProperty(key)) {
                        var oldValue = GlobalGame.getSetting(key);
                        var newValue = _tempSettings[key];
                        
                        if (oldValue !== newValue) {
                            GlobalGame.setSetting(key, newValue);
                            
                            // 应用设置的实际效果
                            _applySettingEffect(key, newValue, oldValue);
                            
                            // 触发设置变更事件
                            if (_app) {
                                _app.fire('setting:changed', { key: key, value: newValue, oldValue: oldValue });
                            }
                        }
                    }
                }
                
                // 保存到持久化存储
                if (GlobalGame.saveSettings) {
                    GlobalGame.saveSettings();
                }
            } else {
                console.warn('[MenuSettingsUI] GlobalGame not available for saving settings');
            }
        } catch (e) {
            console.error('[MenuSettingsUI] Error saving settings:', e);
        }
    }

    // 应用设置的实际效果
    function _applySettingEffect(key, newValue, oldValue) {
        try {
            switch (key) {
                case 'masterVolume':
                case 'musicVolume':
                case 'sfxVolume':
                case 'voiceVolume':
                    // 音频设置 - 通过事件通知音频系统
                    if (_app) {
                        _app.fire('audio:volume:changed', { 
                            type: key.replace('Volume', ''), 
                            volume: newValue / 100 // 转换为0-1范围
                        });
                    }
                    break;
                    
                case 'language':
                    // 语言设置 - 通知I18n系统切换语言
                    if (_app) {
                        _app.fire('i18n:change_language', { language: newValue });
                    }
                    break;
                    
                case 'fullscreen':
                    // 全屏设置 - 切换全屏模式
                    if (_app && _app.graphicsDevice) {
                        if (newValue) {
                            _app.graphicsDevice.canvas.requestFullscreen();
                        } else {
                            if (document.exitFullscreen) {
                                document.exitFullscreen();
                            }
                        }
                    }
                    break;
                    
                case 'brightness':
                    // 亮度设置 - 调整画面亮度
                    if (_app) {
                        _app.fire('graphics:brightness:changed', { brightness: newValue / 100 });
                    }
                    break;
                    
                case 'mouseSensitivity':
                    // 鼠标灵敏度 - 通知输入系统
                    if (_app) {
                        _app.fire('input:mouse_sensitivity:changed', { sensitivity: newValue });
                    }
                    break;
                    
                case 'invertY':
                    // 反转Y轴 - 通知输入系统
                    if (_app) {
                        _app.fire('input:invert_y:changed', { inverted: newValue });
                    }
                    break;
                    
                case 'vSync':
                    // 垂直同步 - 这个通常需要重启才能生效
                    break;
                    
                default:
                    break;
            }
        } catch (e) {
            console.error('[MenuSettingsUI] Error applying setting effect:', key, e);
        }
    }

    // 应用设置（立即生效，不等关闭界面）
    function applySettings() {
        _saveSettings();
    }

    // 重置设置为默认值
    function resetSettings() {
        if (!_currentCategory) return;
        
        var config = _settingsConfig[_currentCategory];
        if (!config) return;
        
        var allItems = [];
        
        // 收集所有设置项
        if (config.sections && Array.isArray(config.sections)) {
            for (var s = 0; s < config.sections.length; s++) {
                var section = config.sections[s];
                if (section.items) {
                    allItems = allItems.concat(section.items);
                }
            }
        } else if (config.items) {
            allItems = config.items;
        }
        
        // 重置为默认值
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            _tempSettings[item.key] = item.default;
        }
        
        // 重新生成UI以反映重置后的值
        _clearContent();
        _generateOptions(_currentCategory);
        
    }

    // ---------- 生成通关记录UI ----------
    function _generateClearRecordUI() {
        var title = _createLabel('menu.clearRecord.title', 50, -20);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(1, 0.8, 0.2);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        title.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(title);
        
        var clearData = {};
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSettings) {
                var settings = GlobalGame.getSettings();
                clearData = settings.clearRecord || {};
            }
        } catch (e) {
        }
        
        var yOffset = -80;
        var scenes = Object.keys(clearData);
        
        if (scenes.length === 0) {
            var emptyHint = _createLabel('menu.clearRecord.empty', 50, yOffset);
            emptyHint.element.color = new pc.Color(0.5, 0.5, 0.5);
            emptyHint.element.fontSize = 36;
            emptyHint.element.anchor = [0, 1, 0, 1];
            emptyHint.element.pivot = [0, 1];
            emptyHint.element.alignment = new pc.Vec2(0, 0.5);
            _scrollViewContent.addChild(emptyHint);
        } else {
            for (var i = 0; i < scenes.length; i++) {
                var sceneName = scenes[i];
                var data = clearData[sceneName];
                
                var sceneLabel = _createLabel('menu.clearRecord.scene', 20, yOffset);
                sceneLabel.element.text = _translateText('menu.clearRecord.scene') + ': ' + sceneName;
                sceneLabel.element.fontSize = 40;
                sceneLabel.element.anchor = [0, 1, 1, 1];
                sceneLabel.element.pivot = [0, 1];
                sceneLabel.element.alignment = new pc.Vec2(0, 0.5);
                _scrollViewContent.addChild(sceneLabel);
                yOffset -= 30;
                
                var timeLabel = _createLabel('menu.clearRecord.time', 40, yOffset);
                timeLabel.element.text = _translateText('menu.clearRecord.time') + ': ' + (data.time || '00:00:00');
                timeLabel.element.fontSize = 32;
                timeLabel.element.color = new pc.Color(0.7, 0.7, 0.7);
                timeLabel.element.anchor = [0, 1, 1, 1];
                timeLabel.element.pivot = [0, 1];
                timeLabel.element.alignment = new pc.Vec2(0, 0.5);
                _scrollViewContent.addChild(timeLabel);
                yOffset -= 30;
                
                var dateLabel = _createLabel('menu.clearRecord.date', 40, yOffset);
                if (data.timestamp) {
                    var date = new Date(data.timestamp);
                    dateLabel.element.text = _translateText('menu.clearRecord.date') + ': ' + date.toLocaleDateString();
                }
                dateLabel.element.fontSize = 28;
                dateLabel.element.color = new pc.Color(0.5, 0.5, 0.5);
                dateLabel.element.anchor = [0, 1, 1, 1];
                dateLabel.element.pivot = [0, 1];
                dateLabel.element.alignment = new pc.Vec2(0, 0.5);
                _scrollViewContent.addChild(dateLabel);
                yOffset -= 50;
            }
        }
        
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 400);
        }
        
    }
    
    // ---------- 生成成就UI ----------
    function _generateAchievementsUI() {
        var title = _createLabel('menu.achievements.title', 50, -20);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(1, 0.6, 0);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        title.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(title);
        
        // 定义成就列表
        var achievements = [
            { id: 'first_step', key: 'menu.achievements.first_step', icon: '🚶' },
            { id: 'explorer', key: 'menu.achievements.explorer', icon: '🗺️' },
            { id: 'collector', key: 'menu.achievements.collector', icon: '💎' },
            { id: 'speedrunner', key: 'menu.achievements.speedrunner', icon: '⚡' },
            { id: 'perfectionist', key: 'menu.achievements.perfectionist', icon: '⭐' }
        ];
        
        var unlockedAchievements = {};
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSettings) {
                var settings = GlobalGame.getSettings();
                unlockedAchievements = settings.achievements || {};
            }
        } catch (e) {}
        
        var yOffset = -80;
        var unlockedCount = 0;
        
        for (var i = 0; i < achievements.length; i++) {
            var ach = achievements[i];
            var unlocked = unlockedAchievements[ach.id] || false;
            if (unlocked) unlockedCount++;
            
            var container = new pc.Entity('Achievement_' + ach.id);
            container.addComponent('element', {
                type: pc.ELEMENTTYPE_GROUP,
                anchor: [0, 1, 1, 1],
                pivot: [0, 1],
                width: 0,
                height: 90  // 从60增加到90，适应新的间距
            });
            container.setLocalPosition(0, yOffset, 0);
            
            // 图标
            var icon = _createLabel(ach.icon, 30, -30);
            icon.element.fontSize = 64;
            icon.element.anchor = [0, 1, 0, 1];
            icon.element.pivot = [0, 1];
            container.addChild(icon);
            
            // 成就名称
            var nameLabel = _createLabel(ach.key, 80, -20);
            nameLabel.element.fontSize = 36;
            nameLabel.element.color = unlocked ? new pc.Color(1, 1, 1) : new pc.Color(0.3, 0.3, 0.3);
            nameLabel.element.anchor = [0, 1, 1, 1];
            nameLabel.element.pivot = [0, 1];
            nameLabel.element.alignment = new pc.Vec2(0, 0.5);
            container.addChild(nameLabel);
            
            // 状态（增加间距，从-40改为-65）
            var statusLabel = _createLabel(unlocked ? 'menu.achievements.unlocked' : 'menu.achievements.locked', 80, -65);
            statusLabel.element.fontSize = 28;
            statusLabel.element.color = unlocked ? new pc.Color(0, 1, 0) : new pc.Color(0.5, 0.5, 0.5);
            statusLabel.element.anchor = [0, 1, 1, 1];
            statusLabel.element.pivot = [0, 1];
            statusLabel.element.alignment = new pc.Vec2(0, 0.5);
            container.addChild(statusLabel);
            
            _scrollViewContent.addChild(container);
            yOffset -= 100;  // 从70增加到100，适应新的容器高度
        }
        
        // 进度统计
        var progressLabel = _createLabel('menu.achievements.progress', 50, -70);
        progressLabel.element.text = _translateText('menu.achievements.progress') + ': ' + unlockedCount + '/' + achievements.length;
        progressLabel.element.fontSize = 32;
        progressLabel.element.color = new pc.Color(0.8, 0.8, 0.8);
        progressLabel.element.anchor = [0, 1, 0, 1];
        progressLabel.element.pivot = [0, 1];
        progressLabel.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(progressLabel);
        
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 600);
        }
        
    }
    
    // ---------- 生成世界完成度UI ----------
    function _generateWorldCompletionUI() {
        var title = _createLabel('menu.worldCompletion.title', 50, -20);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(0.5, 0.8, 1);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        title.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(title);
        
        var completionData = {
            totalScenes: 0,
            completedScenes: 0,
            totalCollectibles: 0,
            foundCollectibles: 0,
            totalCheckpoints: 0,
            reachedCheckpoints: 0
        };
        
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSettings) {
                var settings = GlobalGame.getSettings();
                completionData = settings.worldCompletion || completionData;
            }
        } catch (e) {}
        
        var yOffset = -80;
        var centerX = 490; // Content宽度980px的一半
        var barWidth = 700; // 增加进度条宽度
        var leftMargin = 50; // 统一的左边距起点，从左边缘开始
        
        // 场景完成度
        var sceneLabel = _createLabel('menu.worldCompletion.scenes', leftMargin, yOffset);
        sceneLabel.element.text = _translateText('menu.worldCompletion.scenes') + ': ' + 
                                   completionData.completedScenes + '/' + completionData.totalScenes;
        sceneLabel.element.fontSize = 36;
        sceneLabel.element.anchor = [0, 1, 0, 1]; // 左对齐锚点
        sceneLabel.element.pivot = [0, 1]; // 左对齐轴点
        sceneLabel.element.width = barWidth; // 与进度条同宽
        sceneLabel.element.alignment = new pc.Vec2(0, 0.5); // 文字左对齐
        _scrollViewContent.addChild(sceneLabel);
        yOffset -= 40;
        
        var scenePercent = completionData.totalScenes > 0 ? 
            Math.round((completionData.completedScenes / completionData.totalScenes) * 100) : 0;
        _createProgressBar(leftMargin, yOffset, barWidth, scenePercent);
        yOffset -= 60;
        
        // 收藏品收集度
        var collectLabel = _createLabel('menu.worldCompletion.collectibles', leftMargin, yOffset);
        collectLabel.element.text = _translateText('menu.worldCompletion.collectibles') + ': ' + 
                                     completionData.foundCollectibles + '/' + completionData.totalCollectibles;
        collectLabel.element.fontSize = 36;
        collectLabel.element.anchor = [0, 1, 0, 1]; // 左对齐锚点
        collectLabel.element.pivot = [0, 1]; // 左对齐轴点
        collectLabel.element.width = barWidth; // 与进度条同宽
        collectLabel.element.alignment = new pc.Vec2(0, 0.5); // 文字左对齐
        _scrollViewContent.addChild(collectLabel);
        yOffset -= 40;
        
        var collectPercent = completionData.totalCollectibles > 0 ? 
            Math.round((completionData.foundCollectibles / completionData.totalCollectibles) * 100) : 0;
        _createProgressBar(leftMargin, yOffset, barWidth, collectPercent);
        yOffset -= 60;
        
        // 存档点到达率
        var checkpointLabel = _createLabel('menu.worldCompletion.checkpoints', leftMargin, yOffset);
        checkpointLabel.element.text = _translateText('menu.worldCompletion.checkpoints') + ': ' + 
                                        completionData.reachedCheckpoints + '/' + completionData.totalCheckpoints;
        checkpointLabel.element.fontSize = 36;
        checkpointLabel.element.anchor = [0, 1, 0, 1]; // 左对齐锚点
        checkpointLabel.element.pivot = [0, 1]; // 左对齐轴点
        checkpointLabel.element.width = barWidth; // 与进度条同宽
        checkpointLabel.element.alignment = new pc.Vec2(0, 0.5); // 文字左对齐
        _scrollViewContent.addChild(checkpointLabel);
        yOffset -= 40;
        
        var checkpointPercent = completionData.totalCheckpoints > 0 ? 
            Math.round((completionData.reachedCheckpoints / completionData.totalCheckpoints) * 100) : 0;
        _createProgressBar(leftMargin, yOffset, barWidth, checkpointPercent);
        yOffset -= 60;
        
        // 总完成度
        var totalPercent = Math.round((scenePercent + collectPercent + checkpointPercent) / 3);
        var totalLabel = _createLabel('menu.worldCompletion.total', leftMargin, yOffset);
        totalLabel.element.text = _translateText('menu.worldCompletion.total') + ': ' + totalPercent + '%';
        totalLabel.element.fontSize = 40;
        totalLabel.element.color = new pc.Color(1, 1, 0);
        totalLabel.element.anchor = [0, 1, 0, 1]; // 左对齐锚点
        totalLabel.element.pivot = [0, 1]; // 左对齐轴点
        totalLabel.element.width = barWidth; // 与进度条同宽
        totalLabel.element.alignment = new pc.Vec2(0, 0.5); // 文字左对齐
        _scrollViewContent.addChild(totalLabel);
        
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 500);
        }
        
    }
    
    // 辅助函数：创建进度条
    function _createProgressBar(x, y, width, percent) {
        var barBg = new pc.Entity('ProgressBarBG');
        barBg.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 1, 0, 1],
            pivot: [0, 1],
            width: width,
            height: 20,
            color: new pc.Color(0.2, 0.2, 0.2)
        });
        barBg.setLocalPosition(x, y, 0);
        
        var barFill = new pc.Entity('ProgressBarFill');
        barFill.addComponent('element', {
            type: pc.ELEMENTTYPE_IMAGE,
            anchor: [0, 0.5, 0, 0.5],
            pivot: [0, 0.5],
            width: Math.floor(width * percent / 100),
            height: 16,
            color: new pc.Color(0.3, 0.8, 0.3)
        });
        barFill.setLocalPosition(2, 0, 0);
        barBg.addChild(barFill);
        
        _scrollViewContent.addChild(barBg);
        return barBg;
    }
    
    // ---------- 生成救赎（重生次数）UI ----------
    function _generateRedemptionUI() {
        var title = _createLabel('menu.redemption.title', 50, -20);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(1, 0.5, 0.5);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        title.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(title);
        
        var respawnCount = 0;
        var respawnsByScene = {};
        
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting) {
                // 使用 getSetting 方法获取复活次数数据
                respawnCount = GlobalGame.getSetting('totalRespawns', 0);
                respawnsByScene = GlobalGame.getSetting('respawnsByScene', {});
                
                if (_debug) {
                    console.log('[MenuSettingsUI] Redemption data loaded:');
                    console.log('  Total respawns:', respawnCount);
                    console.log('  Respawns by scene:', respawnsByScene);
                }
            } else {
                if (_debug) {
                    console.warn('[MenuSettingsUI] GlobalGame or getSetting method not available');
                }
            }
        } catch (e) {
            if (_debug) {
                console.error('[MenuSettingsUI] Error loading redemption data:', e);
            }
        }
        
        var yOffset = -80;
        
        // 总重生次数
        var totalLabel = _createLabel('menu.redemption.totalRespawns', 50, yOffset);
        totalLabel.element.text = _translateText('menu.redemption.totalRespawns') + ': ' + respawnCount;
        totalLabel.element.fontSize = 44;
        totalLabel.element.color = new pc.Color(1, 1, 1);
        totalLabel.element.anchor = [0, 1, 0, 1];
        totalLabel.element.pivot = [0, 1];
        totalLabel.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(totalLabel);
        yOffset -= 60;
        
        // 救赎之心图标
        var heartIcon = _createLabel('💔', 50, yOffset);
        heartIcon.element.fontSize = 96;
        heartIcon.element.anchor = [0, 1, 0, 1];
        heartIcon.element.pivot = [0, 1];
        heartIcon.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(heartIcon);
        yOffset -= 80;
        
        // 提示文本
        var hintLabel = _createLabel('menu.redemption.hint', 50, yOffset);
        hintLabel.element.fontSize = 32;
        hintLabel.element.color = new pc.Color(0.7, 0.7, 0.7);
        hintLabel.element.anchor = [0, 1, 0, 1];
        hintLabel.element.pivot = [0, 1];
        hintLabel.element.alignment = new pc.Vec2(0, 0.5);
        hintLabel.element.wrapLines = true;
        hintLabel.element.width = 800;
        _scrollViewContent.addChild(hintLabel);
        yOffset -= 60;
        
        // 各场景重生次数
        var scenes = Object.keys(respawnsByScene);
        if (scenes.length > 0) {
            var detailTitle = _createLabel('menu.redemption.byScene', 50, yOffset);
            detailTitle.element.fontSize = 36;
            detailTitle.element.color = new pc.Color(0.9, 0.9, 0.9);
            detailTitle.element.anchor = [0, 1, 0, 1];
            detailTitle.element.pivot = [0, 1];
            detailTitle.element.alignment = new pc.Vec2(0, 0.5);
            _scrollViewContent.addChild(detailTitle);
            yOffset -= 40;
            
            for (var i = 0; i < scenes.length; i++) {
                var sceneName = scenes[i];
                var count = respawnsByScene[sceneName];
                
                var sceneLabel = _createLabel('scene', 40, yOffset);
                sceneLabel.element.text = sceneName + ': ' + count + ' ' + _translateText('menu.redemption.times');
                sceneLabel.element.fontSize = 32;
                sceneLabel.element.color = new pc.Color(0.6, 0.6, 0.6);
                sceneLabel.element.anchor = [0, 1, 1, 1];
                sceneLabel.element.pivot = [0, 1];
                sceneLabel.element.alignment = new pc.Vec2(0, 0.5);
                _scrollViewContent.addChild(sceneLabel);
                yOffset -= 30;
            }
        }
        
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 500);
        }
        
    }
    
    // ---------- 生成心钥收藏馆UI ----------
    function _generateHeartKeyGalleryUI() {
        var title = _createLabel('menu.heartKey.title', 50, -20);
        title.element.fontSize = 48;
        title.element.color = new pc.Color(1, 0.2, 0.8);
        title.element.anchor = [0, 1, 0, 1];
        title.element.pivot = [0, 1];
        title.element.alignment = new pc.Vec2(0, 0.5);
        _scrollViewContent.addChild(title);
        
        var heartKeys = [];
        try {
            if (typeof GlobalGame !== 'undefined' && GlobalGame.getSettings) {
                var settings = GlobalGame.getSettings();
                heartKeys = settings.heartKeys || [];
            }
        } catch (e) {}
        
        var yOffset = -80;
        
        if (heartKeys.length === 0) {
            // 无心钥时显示提示
            var noKeyIcon = _createLabel('🔐', 50, yOffset);
            noKeyIcon.element.fontSize = 128;
            noKeyIcon.element.anchor = [0, 1, 0, 1];
            noKeyIcon.element.pivot = [0, 1];
            noKeyIcon.element.alignment = new pc.Vec2(0, 0.5);
            _scrollViewContent.addChild(noKeyIcon);
            yOffset -= 100;
            
            var emptyHint = _createLabel('menu.heartKey.empty', 50, yOffset);
            emptyHint.element.color = new pc.Color(0.7, 0.7, 0.7);
            emptyHint.element.fontSize = 40;
            emptyHint.element.anchor = [0, 1, 0, 1];
            emptyHint.element.pivot = [0, 1];
            emptyHint.element.alignment = new pc.Vec2(0, 0.5);
            emptyHint.element.wrapLines = true;
            emptyHint.element.width = 800;
            _scrollViewContent.addChild(emptyHint);
            yOffset -= 80;
            
            var hintLabel = _createLabel('menu.heartKey.hint', 50, yOffset);
            hintLabel.element.fontSize = 32;
            hintLabel.element.color = new pc.Color(0.5, 0.5, 0.5);
            hintLabel.element.anchor = [0, 1, 0, 1];
            hintLabel.element.pivot = [0, 1];
            hintLabel.element.alignment = new pc.Vec2(0, 0.5);
            hintLabel.element.wrapLines = true;
            hintLabel.element.width = 800;
            _scrollViewContent.addChild(hintLabel);
        } else {
            // 显示心钥列表
            for (var i = 0; i < heartKeys.length; i++) {
                var key = heartKeys[i];
                
                var container = new pc.Entity('HeartKey_' + i);
                container.addComponent('element', {
                    type: pc.ELEMENTTYPE_GROUP,
                    anchor: [0, 1, 1, 1],
                    pivot: [0, 1],
                    width: 0,
                    height: 120
                });
                container.setLocalPosition(0, yOffset, 0);
                
                // 心钥图标
                var keyIcon = _createLabel('💖', 30, -60);
                keyIcon.element.fontSize = 96;
                keyIcon.element.anchor = [0, 1, 0, 1];
                keyIcon.element.pivot = [0, 1];
                container.addChild(keyIcon);
                
                // 心钥名称
                var keyName = _createLabel(key.name || 'menu.heartKey.unknown', 100, -30);
                keyName.element.fontSize = 40;
                keyName.element.color = new pc.Color(1, 0.6, 0.9);
                keyName.element.anchor = [0, 1, 1, 1];
                keyName.element.pivot = [0, 1];
                keyName.element.alignment = new pc.Vec2(0, 0.5);
                container.addChild(keyName);
                
                // 获得位置
                var keyLocation = _createLabel('location', 100, -60);
                keyLocation.element.text = _translateText('menu.heartKey.location') + ': ' + (key.location || '???');
                keyLocation.element.fontSize = 32;
                keyLocation.element.color = new pc.Color(0.7, 0.7, 0.7);
                keyLocation.element.anchor = [0, 1, 1, 1];
                keyLocation.element.pivot = [0, 1];
                keyLocation.element.alignment = new pc.Vec2(0, 0.5);
                container.addChild(keyLocation);
                
                // 获得时间
                if (key.timestamp) {
                    var date = new Date(key.timestamp);
                    var keyTime = _createLabel('time', 100, -85);
                    keyTime.element.text = _translateText('menu.heartKey.obtainedAt') + ': ' + date.toLocaleDateString();
                    keyTime.element.fontSize = 28;
                    keyTime.element.color = new pc.Color(0.5, 0.5, 0.5);
                    keyTime.element.anchor = [0, 1, 1, 1];
                    keyTime.element.pivot = [0, 1];
                    keyTime.element.alignment = new pc.Vec2(0, 0.5);
                    container.addChild(keyTime);
                }
                
                _scrollViewContent.addChild(container);
                yOffset -= 130;
            }
        }
        
        if (_scrollViewContent.element) {
            _scrollViewContent.element.height = Math.max(Math.abs(yOffset) + 100, 400);
        }
    }

    // ---------- 销毁 ----------
    function destroy() {
        // 解绑语言变更事件
        if (_app && _languageChangeHandler) {
            _app.off('setting:changed', _languageChangeHandler);
            _languageChangeHandler = null;
        }
    }

    // ---------- 导出 ----------
    return {
        init: init,
        show: show,
        hide: hide,
        toggle: toggle,
        applySettings: applySettings,
        resetSettings: resetSettings,
        destroy: destroy
    };
})();
