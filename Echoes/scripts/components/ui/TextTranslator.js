/**
 * @file TextTranslator.js
 * @desc i18n 文本翻译器组件，自动根据键名翻译 TextElement 的文本内容
 *       支持延迟初始化、平台检测、多事件监听和自动语言切换
 * @pc-attrs
 *   i18nKey:string='', autoTranslate:boolean=true, namespace:string='ui',
 *   enableDebugLog:boolean=false, delayedInit:boolean=true,
 *   maxRetries:number=10, retryInterval:number=500,
 *   mobileKey:string='', desktopKey:string='', enablePlatformDetection:boolean=true
 * @events
 *   监听: i18n:changed, locale:changed, i18n:language:changed, i18n:ready
 *   触发: text:translated
 */

/* global pc */
var TextTranslator = pc.createScript('textTranslator');

// ===== 属性定义 =====
TextTranslator.attributes.add('i18nKey', {
    type: 'string',
    default: '',
    title: 'i18n 键名',
    description: '翻译键名，支持嵌套路径（如 menu.start_game）'
});

TextTranslator.attributes.add('autoTranslate', {
    type: 'boolean',
    default: true,
    title: '自动翻译',
    description: '组件初始化时是否自动翻译'
});

TextTranslator.attributes.add('namespace', {
    type: 'string',
    default: 'ui',
    title: '命名空间',
    description: 'i18n 命名空间（ui, dialogue, title 等）'
});

TextTranslator.attributes.add('enableDebugLog', {
    type: 'boolean',
    default: false,
    title: '调试日志'
});

TextTranslator.attributes.add('delayedInit', {
    type: 'boolean',
    default: true,
    title: '延迟初始化',
    description: '启用延迟初始化以等待 I18n 系统加载'
});

TextTranslator.attributes.add('maxRetries', {
    type: 'number',
    default: 10,
    title: '最大重试次数',
    description: '延迟初始化的最大重试次数'
});

TextTranslator.attributes.add('retryInterval', {
    type: 'number',
    default: 500,
    title: '重试间隔',
    description: '延迟初始化的重试间隔（毫秒）'
});

TextTranslator.attributes.add('mobileKey', {
    type: 'string',
    default: '',
    title: '移动端键名',
    description: '移动端专用的 i18n 键名，为空时使用通用键名'
});

TextTranslator.attributes.add('desktopKey', {
    type: 'string',
    default: '',
    title: '桌面端键名',
    description: '桌面端专用的 i18n 键名，为空时使用通用键名'
});

TextTranslator.attributes.add('enablePlatformDetection', {
    type: 'boolean',
    default: true,
    title: '启用平台检测',
    description: '是否根据平台自动选择不同的键名'
});

// ===== 初始化 =====
TextTranslator.prototype.initialize = function () {
    // 验证组件
    if (!this.entity.element || this.entity.element.type !== pc.ELEMENTTYPE_TEXT) {
        console.error('[TextTranslator] 组件必须绑定到 TextElement 上');
        return;
    }
    
    // 缓存原始文本（作为回退）
    this._originalText = this.entity.element.text || '';
    
    // 延迟初始化相关变量
    this._isI18nReady = false;
    this._retryCount = 0;
    this._maxRetries = this.maxRetries || 10;
    this._retryInterval = this.retryInterval || 500;
    
    // 平台检测
    this._currentPlatform = this._detectPlatform();
    this._effectiveKey = this._getEffectiveKey();
    
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 初始化完成');
        console.log('[TextTranslator] 实体:', this.entity.name);
        console.log('[TextTranslator] i18n键名:', this.i18nKey);
        console.log('[TextTranslator] 移动端键名:', this.mobileKey);
        console.log('[TextTranslator] 桌面端键名:', this.desktopKey);
        console.log('[TextTranslator] 当前平台:', this._currentPlatform);
        console.log('[TextTranslator] 有效键名:', this._effectiveKey);
        console.log('[TextTranslator] 命名空间:', this.namespace);
        console.log('[TextTranslator] 原始文本:', this._originalText);
    }
    
    // 监听语言变化事件（支持多种事件名）
    this._onLanguageChanged = this._handleLanguageChanged.bind(this);
    this.app.on('i18n:language:changed', this._onLanguageChanged, this);
    this.app.on('i18n:changed', this._onLanguageChanged, this); // GameManager 使用的事件
    this.app.on('locale:changed', this._onLanguageChanged, this); // 兼容事件
    
    // 监听 I18n 系统就绪事件
    this._onI18nReady = this._handleI18nReady.bind(this);
    this.app.on('i18n:ready', this._onI18nReady, this);
    
    // 尝试初始化翻译
    this._tryInitializeTranslation();
};

// ===== 平台检测 =====
TextTranslator.prototype._detectPlatform = function () {
    // 优先检查 PlayCanvas 应用的平台信息
    if (this.app && this.app.touch) {
        if (this.app.touch.supported) {
            return 'mobile';
        }
    }
    
    // 检查用户代理字符串
    var userAgent = navigator.userAgent || '';
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    // 检查屏幕尺寸
    var isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 768;
    
    // 检查触摸支持
    var hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 平台检测信息:');
        console.log('  User Agent Mobile:', isMobile);
        console.log('  Small Screen:', isSmallScreen);
        console.log('  Touch Support:', hasTouchSupport);
        console.log('  PlayCanvas Touch:', this.app && this.app.touch && this.app.touch.supported);
    }
    
    // 综合判断
    if (isMobile || (isSmallScreen && hasTouchSupport)) {
        return 'mobile';
    } else {
        return 'desktop';
    }
};

// ===== 获取有效的键名 =====
TextTranslator.prototype._getEffectiveKey = function () {
    if (!this.enablePlatformDetection) {
        return this.i18nKey;
    }
    
    var platformKey = '';
    
    if (this._currentPlatform === 'mobile' && this.mobileKey) {
        platformKey = this.mobileKey;
    } else if (this._currentPlatform === 'desktop' && this.desktopKey) {
        platformKey = this.desktopKey;
    }
    
    // 如果没有平台专用键名，使用通用键名
    var effectiveKey = platformKey || this.i18nKey;
    
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 键名选择:');
        console.log('  当前平台:', this._currentPlatform);
        console.log('  通用键名:', this.i18nKey);
        console.log('  移动端键名:', this.mobileKey);
        console.log('  桌面端键名:', this.desktopKey);
        console.log('  最终键名:', effectiveKey);
    }
    
    return effectiveKey;
};

// ===== 尝试初始化翻译 =====
TextTranslator.prototype._tryInitializeTranslation = function () {
    // 检查 I18n 系统是否可用
    if (this._checkI18nAvailable()) {
        this._isI18nReady = true;
        if (this.enableDebugLog) {
            console.log('[TextTranslator] I18n 系统已就绪，执行翻译');
        }
        
        // 自动翻译
        if (this.autoTranslate && this._effectiveKey) {
            this.translate();
        }
        return;
    }
    
    // 如果禁用延迟初始化，直接使用原始文本
    if (!this.delayedInit) {
        if (this.enableDebugLog) {
            console.warn('[TextTranslator] 延迟初始化已禁用，I18n 系统不可用，使用原始文本');
        }
        this._setText(this._originalText);
        return;
    }
    
    // I18n 系统不可用，尝试延迟初始化
    if (this._retryCount < this._maxRetries) {
        this._retryCount++;
        if (this.enableDebugLog) {
            console.log('[TextTranslator] I18n 系统不可用，延迟初始化 (尝试 ' + this._retryCount + '/' + this._maxRetries + ')');
        }
        
        // 延迟重试
        setTimeout(this._tryInitializeTranslation.bind(this), this._retryInterval);
    } else {
        if (this.enableDebugLog) {
            console.warn('[TextTranslator] I18n 系统初始化超时，使用原始文本');
        }
        // 使用原始文本
        this._setText(this._originalText);
    }
};

// ===== 检查 I18n 系统可用性 =====
TextTranslator.prototype._checkI18nAvailable = function () {
    // 检查 I18n 对象是否存在
    if (typeof I18n === 'undefined') {
        return false;
    }
    
    // 检查必要的方法是否存在
    if (!I18n.getText && !I18n.t) {
        return false;
    }
    
    // 检查是否已初始化（尝试获取一个测试翻译）
    try {
        if (I18n.getText) {
            var testResult = I18n.getText('ui', 'test');
            return true; // 如果没有抛出错误，说明系统可用
        } else if (I18n.t) {
            var testResult = I18n.t('ui.test', 'test');
            return true;
        }
    } catch (e) {
        return false;
    }
    
    return false;
};

// ===== I18n 系统就绪处理 =====
TextTranslator.prototype._handleI18nReady = function () {
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 收到 I18n 就绪事件');
    }
    
    if (!this._isI18nReady) {
        this._isI18nReady = true;
        
        // 执行翻译
        if (this.autoTranslate && this._effectiveKey) {
            this.translate();
        }
    }
};

// ===== 翻译方法 =====
TextTranslator.prototype.translate = function (key, namespace) {
    // 参数处理 - 优先使用传入的键名，否则使用有效键名
    var translationKey = key || this._effectiveKey || this.i18nKey;
    var translationNamespace = namespace || this.namespace;
    
    if (!translationKey) {
        if (this.enableDebugLog) {
            console.warn('[TextTranslator] 翻译键名为空，使用原始文本');
        }
        this._setText(this._originalText);
        return;
    }
    
    // 获取翻译文本
    var translatedText = this._getTranslation(translationKey, translationNamespace);
    
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 翻译结果');
        console.log('  键名:', translationKey);
        console.log('  命名空间:', translationNamespace);
        console.log('  原始文本:', this._originalText);
        console.log('  翻译文本:', translatedText);
    }
    
    // 设置文本
    this._setText(translatedText);
    
    // 触发翻译完成事件
    this.app.fire('text:translated', {
        entity: this.entity,
        key: translationKey,
        namespace: translationNamespace,
        text: translatedText
    });
};

// ===== 获取翻译文本 =====
TextTranslator.prototype._getTranslation = function (key, namespace) {
    // 检查 I18n 系统是否可用
    if (!this._checkI18nAvailable()) {
        if (this.enableDebugLog) {
            console.warn('[TextTranslator] I18n 系统不可用，使用原始文本');
        }
        return this._originalText;
    }
    
    try {
        var translatedText = null;
        
        // 尝试使用 I18n.getText 方法
        if (I18n.getText) {
            translatedText = I18n.getText(namespace, key);
        } 
        // 尝试使用 I18n.t 方法（支持嵌套路径）
        else if (I18n.t) {
            var fullKey = namespace + '.' + key;
            translatedText = I18n.t(fullKey, key); // 使用 key 作为默认值
        }
        
        // 检查翻译是否成功
        if (translatedText && 
            translatedText !== key && 
            translatedText.indexOf(key) === -1 &&
            translatedText !== namespace + '.' + key) {
            return translatedText;
        } else {
            if (this.enableDebugLog) {
                console.warn('[TextTranslator] 翻译失败或未找到，键名:', namespace + '.' + key, '返回值:', translatedText);
            }
            return this._originalText || key;
        }
    } catch (e) {
        console.error('[TextTranslator] 翻译过程出错:', e);
        return this._originalText || key;
    }
};

// ===== 设置文本 =====
TextTranslator.prototype._setText = function (text) {
    if (this.entity.element) {
        this.entity.element.text = text || '';
    }
};

// ===== 语言变化处理 =====
TextTranslator.prototype._handleLanguageChanged = function (eventData) {
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 语言已变化，重新翻译');
        if (eventData) {
            console.log('[TextTranslator] 事件数据:', eventData);
            console.log('  新语言:', eventData.locale);
            console.log('  旧语言:', eventData.oldLocale);
        }
    }
    
    // 重新检测平台和计算有效键名（因为语言变化可能影响平台检测）
    this._currentPlatform = this._detectPlatform();
    this._effectiveKey = this._getEffectiveKey();
    
    if (this._effectiveKey) {
        this.translate();
    } else {
        this._setText(this._originalText);
    }
};

/**
 * 设置新的翻译键名并翻译
 * @param {string} key - i18n 键名
 * @param {string} [namespace] - 命名空间（可选）
 */
TextTranslator.prototype.setKey = function (key, namespace) {
    this.i18nKey = key || '';
    if (namespace) {
        this.namespace = namespace;
    }
    
    // 重新计算有效键名
    this._effectiveKey = this._getEffectiveKey();
    
    if (this._effectiveKey) {
        this.translate();
    } else {
        this._setText(this._originalText);
    }
};

/**
 * 设置命名空间
 * @param {string} namespace - 命名空间
 */
TextTranslator.prototype.setNamespace = function (namespace) {
    this.namespace = namespace || 'ui';
    if (this._effectiveKey) {
        this.translate();
    }
};

/**
 * 设置平台专用键名
 * @param {string} mobileKey - 移动端键名
 * @param {string} desktopKey - 桌面端键名
 */
TextTranslator.prototype.setPlatformKeys = function (mobileKey, desktopKey) {
    this.mobileKey = mobileKey || '';
    this.desktopKey = desktopKey || '';
    
    // 重新计算有效键名
    this._effectiveKey = this._getEffectiveKey();
    
    if (this._effectiveKey) {
        this.translate();
    } else {
        this._setText(this._originalText);
    }
};

/**
 * 获取当前平台信息
 * @returns {Object} 平台信息对象
 */
TextTranslator.prototype.getPlatformInfo = function () {
    return {
        platform: this._currentPlatform,
        effectiveKey: this._effectiveKey,
        i18nKey: this.i18nKey,
        mobileKey: this.mobileKey,
        desktopKey: this.desktopKey,
        enablePlatformDetection: this.enablePlatformDetection
    };
};

/**
 * 强制重新翻译
 */
TextTranslator.prototype.refresh = function () {
    // 重新检测平台和计算有效键名
    this._currentPlatform = this._detectPlatform();
    this._effectiveKey = this._getEffectiveKey();
    
    if (this._effectiveKey) {
        this.translate();
    }
};

/**
 * 重置为原始文本
 */
TextTranslator.prototype.reset = function () {
    this._setText(this._originalText);
};

// ===== 清理 =====
TextTranslator.prototype.destroy = function () {
    // 解绑所有语言变化事件
    if (this._onLanguageChanged) {
        this.app.off('i18n:language:changed', this._onLanguageChanged, this);
        this.app.off('i18n:changed', this._onLanguageChanged, this);
        this.app.off('locale:changed', this._onLanguageChanged, this);
    }
    
    // 解绑 I18n 就绪事件
    if (this._onI18nReady) {
        this.app.off('i18n:ready', this._onI18nReady, this);
    }
    
    // 清理延迟初始化相关变量
    this._isI18nReady = false;
    this._retryCount = 0;
    
    if (this.enableDebugLog) {
        console.log('[TextTranslator] 组件已销毁:', this.entity.name);
    }
};
