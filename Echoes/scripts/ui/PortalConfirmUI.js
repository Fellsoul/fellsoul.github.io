/* global pc */
/**
 * @file PortalConfirmUI.js
 * @desc 场景传送门确认对话框 UI
 * @pc-attrs
 *   dialogPanel:entity=null, promptText:entity=null,
 *   yesButton:entity=null, noButton:entity=null,
 *   fadeInMs:number=200, fadeOutMs:number=150,
 *   enableDebugLog:boolean=false
 */
var PortalConfirmUI = pc.createScript('portalConfirmUI');

// UI 元素
PortalConfirmUI.attributes.add('dialogPanel', { 
    type: 'entity', 
    title: '对话框面板' 
});

PortalConfirmUI.attributes.add('promptText', { 
    type: 'entity', 
    title: '提示文本' 
});

PortalConfirmUI.attributes.add('yesButton', { 
    type: 'entity', 
    title: '"是"按钮' 
});

PortalConfirmUI.attributes.add('noButton', { 
    type: 'entity', 
    title: '"否"按钮' 
});

// 动画时间
PortalConfirmUI.attributes.add('fadeInMs', { 
    type: 'number', 
    default: 200, 
    title: '淡入时间（毫秒）' 
});

PortalConfirmUI.attributes.add('fadeOutMs', { 
    type: 'number', 
    default: 150, 
    title: '淡出时间（毫秒）' 
});

// 调试日志
PortalConfirmUI.attributes.add('enableDebugLog', { 
    type: 'boolean', 
    default: false, 
    title: '调试日志' 
});

// ===== 单例 =====
PortalConfirmUI._instance = null;
PortalConfirmUI.getInstance = function () { 
    return PortalConfirmUI._instance; 
};

// ===== 初始化 =====
PortalConfirmUI.prototype.initialize = function () {
    if (PortalConfirmUI._instance) {
        console.warn('[PortalConfirmUI] Multiple instances detected');
        return;
    }
    PortalConfirmUI._instance = this;
    
    this._isVisible = false;
    this._currentTargetScene = null;
    
    // 检测是否是 PC 端（非触摸设备）
    this._isPCPlatform = this._detectPCPlatform();
    
    console.log('[PortalConfirmUI] Initializing...');
    console.log('[PortalConfirmUI] Platform: PC =', this._isPCPlatform);
    console.log('[PortalConfirmUI] dialogPanel:', this.dialogPanel);
    console.log('[PortalConfirmUI] promptText:', this.promptText);
    console.log('[PortalConfirmUI] yesButton:', this.yesButton);
    console.log('[PortalConfirmUI] noButton:', this.noButton);
    
    // 验证必需元素
    if (!this._validateElements()) {
        console.error('[PortalConfirmUI] Required elements missing - UI will not work!');
        return;
    }
    
    // 初始隐藏（立即模式）
    this._setVisible(false, true);
    
    // 确保按钮也被隐藏
    if (this.yesButton) this.yesButton.enabled = false;
    if (this.noButton) this.noButton.enabled = false;
    
    console.log('[PortalConfirmUI] Initial hide complete, dialogPanel.enabled:', this.dialogPanel.enabled);
    
    // 绑定按钮事件
    this._bindButtons();
    
    // 绑定键盘快捷键（仅 PC 端）
    if (this._isPCPlatform) {
        this._bindKeyboardShortcuts();
    }
    
    // 监听显示/隐藏事件
    var self = this;
    this._onShow = function (data) {
        console.log('[PortalConfirmUI] ui:portal:show event received, data:', data);
        self._show(data);
    };
    this._onHide = function () {
        console.log('[PortalConfirmUI] ui:portal:hide event received');
        self._hide();
    };
    
    this.app.on('ui:portal:show', this._onShow, this);
    this.app.on('ui:portal:hide', this._onHide, this);
    
    console.log('[PortalConfirmUI] Initialized successfully, listening for ui:portal:show');
};

// ===== 验证元素 =====
PortalConfirmUI.prototype._validateElements = function () {
    if (!this.dialogPanel) {
        console.error('[PortalConfirmUI] dialogPanel is null');
        return false;
    }
    if (!this.promptText || !this.promptText.element) {
        console.error('[PortalConfirmUI] promptText is null or missing element');
        return false;
    }
    if (!this.yesButton || !this.yesButton.button) {
        console.error('[PortalConfirmUI] yesButton is null or missing button component');
        return false;
    }
    if (!this.noButton || !this.noButton.button) {
        console.error('[PortalConfirmUI] noButton is null or missing button component');
        return false;
    }
    return true;
};

// ===== 检测 PC 平台 =====
PortalConfirmUI.prototype._detectPCPlatform = function () {
    // 优先检查 PlayCanvas 应用的触摸支持
    if (this.app && this.app.touch) {
        if (this.app.touch.supported) {
            return false; // 触摸设备 = 移动端
        }
    }
    
    // 检查用户代理字符串
    var userAgent = navigator.userAgent || '';
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    // 检查触摸支持
    var hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // PC 平台 = 非移动设备 && 无触摸支持
    return !isMobile && !hasTouchSupport;
};

// ===== 绑定按钮 =====
PortalConfirmUI.prototype._bindButtons = function () {
    var self = this;
    
    this._onYesButtonClick = function () {
        console.log('[PortalConfirmUI] Yes button clicked, firing portal:yes');
        // 立即隐藏对话框（不使用动画，避免与后续事件冲突）
        if (self.dialogPanel) {
            self.dialogPanel.enabled = false;
            if (self.dialogPanel.element) {
                self.dialogPanel.element.opacity = 0;
            }
        }
        // 禁用按钮
        if (self.yesButton) self.yesButton.enabled = false;
        if (self.noButton) self.noButton.enabled = false;
        
        self._isVisible = false;
        self._currentTargetScene = null;
        self.app.fire('portal:yes');
    };
    
    this._onNoButtonClick = function () {
        console.log('[PortalConfirmUI] No button clicked');
        // 立即隐藏对话框（不使用动画，避免与后续事件冲突）
        if (self.dialogPanel) {
            self.dialogPanel.enabled = false;
            if (self.dialogPanel.element) {
                self.dialogPanel.element.opacity = 0;
            }
        }
        // 禁用按钮
        if (self.yesButton) self.yesButton.enabled = false;
        if (self.noButton) self.noButton.enabled = false;
        
        self._isVisible = false;
        self._currentTargetScene = null;
        self.app.fire('portal:no');
    };
    
    this.yesButton.button.on('click', this._onYesButtonClick, this);
    this.noButton.button.on('click', this._onNoButtonClick, this);
};

// ===== 绑定键盘快捷键（仅 PC 端）=====
PortalConfirmUI.prototype._bindKeyboardShortcuts = function () {
    var self = this;
    
    this._onKeyDown = function (event) {
        // 只在对话框可见时响应
        if (!self._isVisible) return;
        
        var key = event.key;
        
        if (key === pc.KEY_Q) {
            // Q 键 = No
            if (self.enableDebugLog) {
                console.log('[PortalConfirmUI] Q key pressed, triggering No button');
            }
            self._onNoButtonClick();
        } else if (key === pc.KEY_E) {
            // E 键 = Yes
            if (self.enableDebugLog) {
                console.log('[PortalConfirmUI] E key pressed, triggering Yes button');
            }
            self._onYesButtonClick();
        }
    };
    
    // 绑定键盘事件
    if (this.app.keyboard) {
        this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
        console.log('[PortalConfirmUI] Keyboard shortcuts bound: Q=No, E=Yes');
    }
};

// ===== 显示对话框 =====
PortalConfirmUI.prototype._show = function (data) {
    console.log('[PortalConfirmUI] _show called, data:', data);
    
    if (!data) {
        console.warn('[PortalConfirmUI] _show called with no data');
        return;
    }
    
    this._currentTargetScene = data.targetScene;
    
    // 更新文本
    if (this.promptText && this.promptText.element) {
        var promptText = data.prompt || '确认前往？';
        // 如果是 i18n key（包含点号），则翻译
        if (typeof I18n !== 'undefined' && typeof I18n.t === 'function' && promptText.indexOf('.') > 0) {
            promptText = I18n.t(promptText, promptText);
        }
        this.promptText.element.text = promptText;
        console.log('[PortalConfirmUI] Updated prompt text to:', promptText);
    } else {
        console.error('[PortalConfirmUI] Cannot update prompt text - element missing');
    }
    
    // 更新按钮文本（如果按钮有文本子元素）
    var yesText = this._translateButtonText(data.yesButton) || 'yes';
    var noText = this._translateButtonText(data.noButton) || 'no';
    
    // PC 端：添加键位提示
    if (this._isPCPlatform) {
        yesText = '[E] ' + yesText;  // E 键 = Yes
        noText = '[Q] ' + noText;    // Q 键 = No
        
        if (this.enableDebugLog) {
            console.log('[PortalConfirmUI] PC platform - added key hints');
        }
    }
    
    if (this.enableDebugLog) {
        console.log('[PortalConfirmUI] Button text translation - Yes:', data.yesButton, '->', yesText);
        console.log('[PortalConfirmUI] Button text translation - No:', data.noButton, '->', noText);
    }
    this._updateButtonText(this.yesButton, yesText);
    this._updateButtonText(this.noButton, noText);
    
    // 启用按钮
    if (this.yesButton) this.yesButton.enabled = true;
    if (this.noButton) this.noButton.enabled = true;
    
    // 显示面板
    console.log('[PortalConfirmUI] Calling _setVisible(true)');
    this._setVisible(true);
    
    console.log('[PortalConfirmUI] Dialog shown, target:', this._currentTargetScene);
};

// ===== 隐藏对话框 =====
PortalConfirmUI.prototype._hide = function () {
    this._setVisible(false);
    this._currentTargetScene = null;
    
    // 禁用按钮
    if (this.yesButton) this.yesButton.enabled = false;
    if (this.noButton) this.noButton.enabled = false;
    
    if (this.enableDebugLog) {
        console.log('[PortalConfirmUI] Hidden');
    }
};

// ===== 设置可见性 =====
PortalConfirmUI.prototype._setVisible = function (visible, immediate) {
    console.log('[PortalConfirmUI] _setVisible called, visible:', visible, 'immediate:', immediate, 'current _isVisible:', this._isVisible);
    
    if (this._isVisible === visible && !immediate) {
        console.log('[PortalConfirmUI] Already in desired state, skipping');
        return;
    }
    
    this._isVisible = visible;
    
    if (immediate) {
        // 立即设置
        this.dialogPanel.enabled = visible;
        if (this.dialogPanel.element) {
            this.dialogPanel.element.opacity = visible ? 1 : 0;
        }
        console.log('[PortalConfirmUI] Set immediately, enabled:', visible);
    } else {
        // 淡入/淡出动画
        var self = this;
        var duration = visible ? this.fadeInMs : this.fadeOutMs;
        var startOpacity = visible ? 0 : 1;
        var endOpacity = visible ? 1 : 0;
        
        if (visible) {
            this.dialogPanel.enabled = true;
        }
        
        if (this.dialogPanel.element) {
            this.dialogPanel.element.opacity = startOpacity;
            
            var startTime = Date.now();
            var animate = function () {
                var elapsed = Date.now() - startTime;
                var progress = Math.min(elapsed / duration, 1);
                
                if (self.dialogPanel && self.dialogPanel.element) {
                    self.dialogPanel.element.opacity = startOpacity + (endOpacity - startOpacity) * progress;
                }
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else if (!visible) {
                    if (self.dialogPanel) {
                        self.dialogPanel.enabled = false;
                    }
                }
            };
            
            requestAnimationFrame(animate);
        }
    }
};

// ===== 翻译按钮文本 =====
PortalConfirmUI.prototype._translateButtonText = function (text) {
    if (!text) return null;
    
    // 如果是 i18n key（包含点号），则翻译
    if (typeof I18n !== 'undefined' && typeof I18n.t === 'function' && text.indexOf('.') > 0) {
        return I18n.t(text, text);
    }
    
    // 如果是中文"是"/"否"，根据当前语言设置进行翻译
    if (text === '是' || text === '否') {
        // 检查当前语言设置
        var currentLang = 'zh-CN'; // 默认中文
        if (typeof I18n !== 'undefined' && I18n.getCurrentLanguage) {
            currentLang = I18n.getCurrentLanguage();
        } else if (typeof GlobalGame !== 'undefined' && GlobalGame.getSetting) {
            currentLang = GlobalGame.getSetting('language', 'zh-CN');
        }
        
        if (this.enableDebugLog) {
            console.log('[PortalConfirmUI] Language detection for button text:');
            console.log('  Input text:', text);
            console.log('  Current language:', currentLang);
            console.log('  I18n available:', typeof I18n !== 'undefined');
            console.log('  GlobalGame available:', typeof GlobalGame !== 'undefined');
        }
        
        // 根据语言返回对应文本
        if (currentLang.indexOf('en') === 0) {
            // 英语环境
            var result = text === '是' ? 'Yes' : 'No';
            if (this.enableDebugLog) {
                console.log('  English environment, translating to:', result);
            }
            return result;
        } else {
            // 中文环境，直接返回原文本
            if (this.enableDebugLog) {
                console.log('  Chinese environment, keeping original text:', text);
            }
            return text;
        }
    }
    
    // 其他情况直接返回原文本
    return text;
};

// ===== 更新按钮文本 =====
PortalConfirmUI.prototype._updateButtonText = function (button, text) {
    if (!button) return;
    
    // 查找按钮的文本子元素
    var textElement = null;
    
    // 方法1：查找名为 "Text" 的子元素
    textElement = button.findByName('Text');
    
    // 方法2：查找第一个有 element 组件的子元素
    if (!textElement) {
        var children = button.children || [];
        for (var i = 0; i < children.length; i++) {
            if (children[i].element && children[i].element.type === pc.ELEMENTTYPE_TEXT) {
                textElement = children[i];
                break;
            }
        }
    }
    
    if (textElement && textElement.element) {
        textElement.element.text = text;
    }
};

// ===== 清理 =====
PortalConfirmUI.prototype.destroy = function () {
    if (PortalConfirmUI._instance === this) {
        PortalConfirmUI._instance = null;
    }
    
    if (this.yesButton && this.yesButton.button && this._onYesButtonClick) {
        this.yesButton.button.off('click', this._onYesButtonClick, this);
    }
    
    if (this.noButton && this.noButton.button && this._onNoButtonClick) {
        this.noButton.button.off('click', this._onNoButtonClick, this);
    }
    
    // 解绑键盘事件（PC 端）
    if (this._isPCPlatform && this.app && this.app.keyboard && this._onKeyDown) {
        this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }
    
    if (this.app) {
        this.app.off('ui:portal:show', this._onShow, this);
        this.app.off('ui:portal:hide', this._onHide, this);
    }
};
