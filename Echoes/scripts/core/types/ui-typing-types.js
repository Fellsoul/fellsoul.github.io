/* global pc */

/**
 * @file ui-typing-types.js
 * @desc 打字机动画数据类型与构造辅助（全局：TypingTypes）
 *
 * 本文件仅提供“数据结构”的构造与typedef，避免在业务代码里硬编码字面量。
 */

var TypingTypes = (function () {
    /**
     * @typedef {Object} TypeLineData
     * @property {string} text                 文本内容
     * @property {number[]=} durations         每个字符的打印时长(ms)
     * @property {boolean=} bold               是否粗体
     * @property {boolean=} clear              播放完本行后是否清除已显示文本
     * @property {string=} color               文本颜色 #RRGGBB
     * @property {number=} size                字号(px)
     * @property {string=} imageName           图片资源名称
     * @property {boolean=} clearImage         本行图片是否使用淡入动画（true=淡入，false=直接显示）
     */

    /**
     * @typedef {Object} TypingData
     * @property {TypeLineData[]} typeLines    多行数据
     */

    /**
     * @typedef {Object} TypingOptions
     * @property {number=} defaultCharMs       默认每字耗时(ms)
     * @property {number=} lineGapMs           行间停顿(ms)
     * @property {any=} fontAssetNormal        普通字体资产或其id
     * @property {any=} fontAssetBold          粗体字体资产或其id
     * @property {boolean=} enableDebugLog     调试日志
     * @property {pc.Entity=} overlayEntity    纯色覆盖层（Image Element）
     * @property {string=} bgHexColor          覆盖层颜色 #RRGGBB
     * @property {number=} bgFadeOutMs         覆盖层淡出时长(ms)
     * @property {boolean=} autoFadeOut        是否自动在结束后完成/过渡
     * @property {pc.Entity=} imageCarouselContainer  图片轮播容器（Image Element）
     * @property {number=} maxImageWidth       图片最大宽度(px)
     * @property {number=} maxImageHeight      图片最大高度(px)
     */

    function clampNum(n, def) {
        return typeof n === 'number' && isFinite(n) ? n : def;
    }

    /**
     * 创建一行
     * @param {string} text
     * @param {{durations?:number[], bold?:boolean, color?:string, size?:number, clear?:boolean, imageName?:string, clearImage?:boolean}=} opt
     * @returns {TypeLineData}
     */
    function createLine(text, opt) {
        opt = opt || {};
        var line = {
            text: typeof text === 'string' ? text : '',
            durations: Array.isArray(opt.durations) ? opt.durations.slice(0) : null,
            bold: !!opt.bold,
            clear: !!opt.clear,
            color: typeof opt.color === 'string' ? opt.color : undefined,
            size: typeof opt.size === 'number' ? opt.size : undefined
        };
        // 只有当 imageName 存在时才添加图片相关属性
        if (typeof opt.imageName === 'string' && opt.imageName) {
            line.imageName = opt.imageName;
            line.clearImage = !!opt.clearImage;
        }
        return line;
    }

    /**
     * 创建数据集
     * @param {TypeLineData[]} lines
     * @returns {TypingData}
     */
    function createData(lines) {
        return { typeLines: Array.isArray(lines) ? lines.slice(0) : [] };
    }

    /**
     * 创建播放选项
     * @param {TypingOptions=} opt
     * @returns {TypingOptions}
     */
    function createOptions(opt) {
        opt = opt || {};
        var out = {
            defaultCharMs: clampNum(opt.defaultCharMs, 50),
            lineGapMs: clampNum(opt.lineGapMs, 300),
            fontAssetNormal: opt.fontAssetNormal || null,
            fontAssetBold: opt.fontAssetBold || null,
            enableDebugLog: !!opt.enableDebugLog,
            overlayEntity: opt.overlayEntity || null,
            bgHexColor: typeof opt.bgHexColor === 'string' ? opt.bgHexColor : '#FCFBDB',
            bgFadeOutMs: clampNum(opt.bgFadeOutMs, 1500),
            autoFadeOut: opt.autoFadeOut !== false,
            imageCarouselContainer: opt.imageCarouselContainer || null,
            maxImageWidth: clampNum(opt.maxImageWidth, 1200), // 已废弃，保留用于兼容
            maxImageHeight: clampNum(opt.maxImageHeight, 400) // 固定高度
        };
        return out;
    }

    return {
        createLine: createLine,
        createData: createData,
        createOptions: createOptions
    };
})();
