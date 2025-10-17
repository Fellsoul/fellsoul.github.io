/* global pc */

/**
 * @file i18n.js
 * @desc 轻量级多语言加载与查询（函数模块，不是组件）
 *       - I18n.init(app)
 *       - I18n.setLocale(locale)
 *       - I18n.loadBundles([{ url, namespace }], callback)
 *       - I18n.get(namespace, key)
 *       - I18n.getTypingData(namespace, key)
 *       - I18n.getTypingOptions(namespace, key)
 */
var I18n = (function () {
    var _app = null;
    var _locale = 'zh-CN';
    var _bundles = {}; // { namespace: jsonObject }

    function init(app) { _app = app; }

    function setLocale(loc) { 
        var oldLocale = _locale;
        _locale = loc || _locale; 
        
        // 触发语言变更事件（如果有 app 实例）
        if (_app && oldLocale !== _locale) {
            try {
                _app.fire('i18n:locale:changed', { 
                    locale: _locale, 
                    oldLocale: oldLocale 
                });
                console.log('[I18n] Locale changed from', oldLocale, 'to', _locale);
            } catch (e) {
                console.warn('[I18n] Failed to fire locale change event:', e);
            }
        }
    }
    function getLocale() { return _locale; }

    function _loadJson(url, done) {
        if (!_app || !_app.assets) {
            // 浏览器直载
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'json';
                xhr.onload = function () { done && done(null, xhr.response || JSON.parse(xhr.responseText)); };
                xhr.onerror = function () { done && done(new Error('XHR error')); };
                xhr.send();
            } catch (e) { done && done(e); }
            return;
        }
        _app.assets.loadFromUrl(url, 'json', function (err, asset) {
            if (err) { done && done(err); return; }
            done && done(null, asset.resource);
        });
    }

    function _loadByAssetRef(ref, done) {
        // 支持 { assetId } 或 { assetName }
        try {
            if (ref.assetId) {
                var assetById = _app.assets.get(ref.assetId);
                if (assetById) {
                    if (assetById.resource) return done && done(null, assetById.resource);
                    return _app.assets.load(assetById).once('load', function (a) { done && done(null, a.resource); });
                }
            }
            if (ref.assetName) {
                var assetByName = _app.assets.find(ref.assetName, 'json') || _app.assets.find(ref.assetName, 'text');
                if (assetByName) {
                    if (assetByName.resource) return done && done(null, assetByName.resource);
                    return _app.assets.load(assetByName).once('load', function (a) { done && done(null, a.resource); });
                }
            }
        } catch (e) { /* ignore */ }
        return done && done(new Error('Asset not found'));
    }

    function loadBundles(items, cb) {
        if (!items || !items.length) { if (cb) cb(); return; }
        var remain = items.length;
        items.forEach(function (it) {
            var after = function (err, json) {
                if (!err && json) _bundles[it.namespace] = json;
                if (--remain === 0 && cb) cb();
            };
            // 优先资产，其次 URL
            if (_app && _app.assets && (it.assetId || it.assetName)) {
                _loadByAssetRef(it, function (err, json) {
                    if (!err) return after(null, json);
                    if (it.url) return _loadJson(it.url, after);
                    return after(err);
                });
            } else if (it.url) {
                _loadJson(it.url, after);
            } else {
                after(new Error('No source provided'));
            }
        });
    }

    function get(namespace, key) {
        var ns = _bundles[namespace];
        if (!ns) return null;
        if (!key) return ns;
        return ns[key] != null ? ns[key] : null;
    }

    function _deepGet(obj, path) {
        if (!obj || !path) return null;
        var parts = path.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length; i++) {
            if (cur == null) return null;
            cur = cur[parts[i]];
        }
        return cur != null ? cur : null;
    }

    // t('menu.Text.ButtonMain1', 'fallback')
    function t(key, fallback) {
        if (!key || typeof key !== 'string') return fallback || '';
        var idx = key.indexOf('.');
        if (idx <= 0) {
            // 无命名空间或非法，直接返回fallback
            return fallback || '';
        }
        var ns = key.substring(0, idx);
        var rest = key.substring(idx + 1);
        var nsObj = _bundles[ns];
        // 若命名空间未加载，尝试从资产表按约定名称直接注册：`${ns}_${locale}.json`
        if (!nsObj && typeof pc !== 'undefined' && pc.app && pc.app.assets && typeof pc.app.assets.find === 'function') {
            try {
                var loc = getLocale();
                var assetName = ns + '_' + loc + '.json';
                var a = pc.app.assets.find(assetName, 'json');
                if (a && a.resource) {
                    _bundles[ns] = a.resource;
                    nsObj = _bundles[ns];
                }
            } catch (e) { /* ignore */ }
        }
        var val = _deepGet(nsObj, rest);
        return (val != null && val !== '') ? val : (fallback || '');
    }

    function _toTypingData(obj) {
        if (!obj || !obj.typeLines) return { typeLines: [] };
        var lines = [];
        for (var i = 0; i < obj.typeLines.length; i++) {
            var l = obj.typeLines[i] || {};
            var line = {
                text: l.text || '',
                durations: Array.isArray(l.durations) ? l.durations.slice(0) : null,
                bold: !!l.bold,
                clear: !!l.clear,
                color: typeof l.color === 'string' ? l.color : undefined,
                size: typeof l.size === 'number' ? l.size : undefined
            };
            // 添加图片相关属性
            if (typeof l.imageName === 'string' && l.imageName) {
                line.imageName = l.imageName;
                line.clearImage = !!l.clearImage;
            }
            lines.push(line);
        }
        return { typeLines: lines };
    }

    function _toTypingOptions(obj) {
        if (!obj) return {};
        return {
            defaultCharMs: typeof obj.defaultCharMs === 'number' ? obj.defaultCharMs : undefined,
            lineGapMs: typeof obj.lineGapMs === 'number' ? obj.lineGapMs : undefined,
            enableDebugLog: !!obj.enableDebugLog,
            bgHexColor: typeof obj.bgHexColor === 'string' ? obj.bgHexColor : undefined,
            bgFadeOutMs: typeof obj.bgFadeOutMs === 'number' ? obj.bgFadeOutMs : undefined,
            autoFadeOut: obj.autoFadeOut !== false
        };
    }

    function getTypingData(namespace, key) {
        return _toTypingData(get(namespace, key));
    }

    function getTypingOptions(namespace, key) {
        return _toTypingOptions(get(namespace, key));
    }

    // 清除所有已加载的资源包（用于语言切换时重新加载）
    function clearBundles() {
        _bundles = {};
        console.log('[I18n] All bundles cleared for reload');
    }
    
    // 清除特定命名空间的资源包
    function clearBundle(namespace) {
        if (_bundles[namespace]) {
            delete _bundles[namespace];
            console.log('[I18n] Bundle cleared:', namespace);
        }
    }
    
    // 获取当前已加载的资源包列表
    function getLoadedBundles() {
        return Object.keys(_bundles);
    }

    var api = {
        init: init,
        setLocale: setLocale,
        getLocale: getLocale,
        loadBundles: loadBundles,
        get: get,
        t: t,
        getTypingData: getTypingData,
        getTypingOptions: getTypingOptions,
        clearBundles: clearBundles,
        clearBundle: clearBundle,
        getLoadedBundles: getLoadedBundles
    };

    // 暴露到全局，供组件调用 window.I18n.t
    if (typeof window !== 'undefined') {
        window.I18n = window.I18n || {};
        for (var k in api) { window.I18n[k] = api[k]; }
    }

    return api;
})();
