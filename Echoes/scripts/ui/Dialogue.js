/* global pc, UIManager, DialogueManager, I18n */
/**
 * DialogueUI.js  —  全局模块（非 pc.createScript）
 * 变更点：
 * 1) 不再做“容器对齐文本右上角”的自动摆放；完全尊重预设。
 * 2) 第一个按钮就生成在“模板按钮”的**预设位置**（相对于容器的本地坐标）；
 * 3) 其余按钮按模板高度 + UIManager.dialogueButtonSpacing 向下逐行排列；
 * 4) 支持两种 show 用法：
 *    - 新：show({ npcKey:'xxx', nodeId:'start' })  → 从 i18n 的 dialogue.<npcKey> 读取文本与选项，按钮执行 json 的 action/next
 *    - 旧：show(node, answers)                     → 直接用传入文本与选项（answers[i].text / .index）
 */
var DialogueUI = (function () {
    'use strict';
  
    // ---------- 内部状态 ----------
    var _app = null;         // PlayCanvas应用实例
    var _screen = null;
    // 绑定实体（默认从 UIManager 单例读取，可被 configure 覆盖）
    var _root = null;        // 对话UI根（容器）
    var _textEnt = null;     // 文本(Text Element)
    var _bgEnt = null;       // 背景(Image 可选)
    var _container = null;    // 按钮容器（可选）
    var _template = null;     // 按钮模板
  
    // 排列参数（默认从 UIManager 读取）
    var _spacing = 8;        // 按钮垂直间距(px)
    var _maxTextWidth = 300; // 按钮文字最大宽度(px)
    // 由模板推导出的“首个按钮基准”（相对 _container 的本地坐标）
    var _basePos = new pc.Vec3(-30, -300, 0);
    var _baseReady = false;
    var _btnHeight = 50;     // 单个按钮高度（优先模板 element.height）
  
    var _btns = [];
    var _debug = false;
    var _isCreatingButtons = false; // 全局按钮创建状态
    
    // 打字机动画相关
    var _typewriterActive = false;
    var _typewriterTimer = 0;
    var _typewriterIndex = 0;
    var _typewriterFullText = '';
    var _typewriterSpeed = 50; // 每个字符的显示间隔(ms)
    var _fadeSpeed = 300; // 淡入淡出速度(ms)
  
    function _log(){ if (_debug) console.log.apply(console, ['[DialogueUI]'].concat([].slice.call(arguments))); }
    function _num(v, d){ v = (v==null ? d : v); var n = Number(v); return isNaN(n) ? (d||0) : n; }
    
    // 打字机动画函数
    function _startTypewriter(text, onComplete) {
      if (!_textEnt || !_textEnt.element) {
        if (onComplete) onComplete();
        return;
      }
      
      _typewriterActive = true;
      _typewriterIndex = 0;
      _typewriterFullText = text || '';
      _typewriterTimer = 0;
      
      _log('Starting typewriter animation for text:', text);
      
      // 开始打字机动画
      var animate = function() {
        if (!_typewriterActive) return;
        
        _typewriterTimer += 16; // 假设 60fps
        
        if (_typewriterTimer >= _typewriterSpeed) {
          _typewriterTimer = 0;
          
          if (_typewriterIndex < _typewriterFullText.length) {
            var displayText = _typewriterFullText.substring(0, _typewriterIndex + 1);
            try {
              _textEnt.element.text = displayText;
            } catch (e) {
              _log('Typewriter text update failed:', e);
            }
            _typewriterIndex++;
            
            // 继续动画
            if (_app) {
              _app.once('update', animate);
            }
          } else {
            // 动画完成
            _typewriterActive = false;
            _log('Typewriter animation completed');
            if (onComplete) onComplete();
          }
        } else {
          // 继续等待
          if (_app) {
            _app.once('update', animate);
          }
        }
      };
      
      if (_app) {
        _app.once('update', animate);
      }
    }
    
    function _stopTypewriter() {
      _typewriterActive = false;
      _typewriterTimer = 0;
      _typewriterIndex = 0;
    }
    
    // 淡入淡出动画
    function _fadeTextOut(onComplete) {
      if (!_textEnt || !_textEnt.element) {
        if (onComplete) onComplete();
        return;
      }
      
      var startOpacity = _textEnt.element.opacity || 1;
      var startTime = Date.now();
      
      _log('Starting text fade out');
      
      var animate = function() {
        var elapsed = Date.now() - startTime;
        var progress = Math.min(elapsed / _fadeSpeed, 1);
        var opacity = startOpacity * (1 - progress);
        
        try {
          _textEnt.element.opacity = opacity;
        } catch (e) {
          _log('Fade out opacity update failed:', e);
        }
        
        if (progress < 1) {
          if (_app) {
            _app.once('update', animate);
          }
        } else {
          _log('Text fade out completed');
          if (onComplete) onComplete();
        }
      };
      
      if (_app) {
        _app.once('update', animate);
      }
    }
    
    function _fadeTextIn(onComplete) {
      if (!_textEnt || !_textEnt.element) {
        if (onComplete) onComplete();
        return;
      }
      
      var startTime = Date.now();
      
      _log('Starting text fade in');
      
      var animate = function() {
        var elapsed = Date.now() - startTime;
        var progress = Math.min(elapsed / _fadeSpeed, 1);
        var opacity = progress;
        
        try {
          _textEnt.element.opacity = opacity;
        } catch (e) {
          _log('Fade in opacity update failed:', e);
        }
        
        if (progress < 1) {
          if (_app) {
            _app.once('update', animate);
          }
        } else {
          _log('Text fade in completed');
          if (onComplete) onComplete();
        }
      };
      
      if (_app) {
        _app.once('update', animate);
      }
    }
    
    // 根据文字长度和最大宽度计算合适的字体大小
    function _calculateFontSize(text, maxWidth, initialFontSize) {
      if (!text || text.length === 0) return initialFontSize || 24;
      
      // 估算字符宽度（中文字符通常比英文字符宽）
      var avgCharWidth = 0;
      var chineseCount = 0;
      var englishCount = 0;
      
      for (var i = 0; i < text.length; i++) {
        var char = text.charAt(i);
        if (/[\u4e00-\u9fff]/.test(char)) {
          chineseCount++;
        } else {
          englishCount++;
        }
      }
      
      // 中文字符宽度约为字体大小的1倍，英文字符约为0.6倍
      var estimateWidth = function(fontSize) {
        return (chineseCount * fontSize * 1.0) + (englishCount * fontSize * 0.6);
      };
      
      var fontSize = initialFontSize || 24;
      var currentWidth = estimateWidth(fontSize);
      
      // 如果当前宽度超过最大宽度，按比例缩小
      if (currentWidth > maxWidth) {
        fontSize = Math.floor(fontSize * (maxWidth / currentWidth));
        // 设置最小字体大小
        fontSize = Math.max(fontSize, 12);
      }
      
      _log('Font size calculation - text:', text, 'length:', text.length, 'chinese:', chineseCount, 'english:', englishCount, 'initial fontSize:', initialFontSize, 'estimated width:', estimateWidth(fontSize), 'maxWidth:', maxWidth, 'final fontSize:', fontSize);
      
      return fontSize;
    }
  
    // ---------- 绑定 & 校验 ----------
    function _applyUIBindingsFromManager(){
      try {
        var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
        if (!mgr) return;
  
        // 元素
        _root      = _root      || mgr.dialogueRootEntity || _root;
        _textEnt   = _textEnt   || mgr.dialogueTextEntity || _textEnt;
        _bgEnt     = _bgEnt     || mgr.dialogueBackgroundEntity || _bgEnt;
        _container = _container || mgr.dialogueButtonsContainer || _container || _root;
        _template  = _template  || mgr.dialogueButtonTemplate || _template;
  
        // 参数
        _spacing   = (mgr.dialogueButtonSpacing|0) || _spacing;
        _maxTextWidth = (mgr.dialogueButtonMaxTextWidth|0) || _maxTextWidth;
        
        // 动画参数
        if (mgr.typewriterSpeed != null) _typewriterSpeed = Math.max(10, mgr.typewriterSpeed|0);
        if (mgr.fadeSpeed != null) _fadeSpeed = Math.max(100, mgr.fadeSpeed|0);
        
        _log('UIManager config loaded - spacing:', mgr.dialogueButtonSpacing, 'final _spacing:', _spacing, 'maxTextWidth:', _maxTextWidth, 'typewriterSpeed:', _typewriterSpeed, 'fadeSpeed:', _fadeSpeed);
  
        // 模板禁用作为 prefab
        try { if (_template) _template.enabled = false; } catch (e) {}
      } catch (e) {
        _log('bind from UIManager failed:', e);
      }
    }
  
    function _ensureBound(){
      if (!_root) { _log('UI root missing'); return false; }
      if (!_textEnt) { _log('Text entity missing'); /*仍可显示按钮*/ }
      if (!_container) _container = _root;
      if (!_template)  { _log('Button template missing'); }
      return true;
    }
  
    // ---------- 计算“模板在容器中的基准位置”和“按钮高度” ----------
    function _computeBaseFromTemplate(){
      if (!_template || !_container) { _baseReady = false; return; }
  
      try {
        // 1) 读取模板世界位置 → 转容器本地（把模板原点作为基准）
        var wp = _template.getPosition();          // 本地坐标（相对其父）
        var parent = _template.parent || _container;
  
        // 将模板本地坐标转为世界坐标
        var world = new pc.Vec3();
        parent.getWorldTransform().transformPoint(wp, world);
  
        // 世界 → 容器本地
        var inv = new pc.Mat4();
        inv.copy(_container.getWorldTransform()).invert();
        inv.transformPoint(world, _basePos);
  
        // 2) 读取按钮高度（优先模板 element.height）
        _btnHeight = 50;
        if (_template.element) {
          _btnHeight = _template.element.height || _template.element.calculatedHeight || _btnHeight;
        } else {
          // 尝试找模板内第一个 Text Element 的高度
          var t = _findFirstTextElement(_template);
          if (t && t.element) {
            _btnHeight = t.element.height || t.element.calculatedHeight || _btnHeight;
          }
        }
  
        _baseReady = true;
        _log('Base computed:', _basePos, 'btnHeight=', _btnHeight, 'spacing=', _spacing);
      } catch (e) {
        _baseReady = false;
        _log('compute base failed:', e);
      }
    }
  
    function _findFirstTextElement(entity){
      if (!entity) return null;
      if (entity.element && entity.element.type === pc.ELEMENTTYPE_TEXT) return entity;
      var q = [entity];
      while (q.length) {
        var n = q.shift();
        var ch = n.children || [];
        for (var i=0;i<ch.length;i++){
          var c = ch[i];
          if (c.element && c.element.type === pc.ELEMENTTYPE_TEXT) return c;
          q.push(c);
        }
      }
      return null;
    }
  
    // ---------- 按钮 CRUD ----------
    function _clearButtons(){
      for (var i = 0; i < _btns.length; i++) {
        var b = _btns[i];
        try { if (b && b.parent) b.parent.removeChild(b); } catch (e) {}
        try { b && b.destroy && b.destroy(); } catch (e) {}
      }
      _btns.length = 0;
    }
  
    function _bindClick(ent, meta){
      // meta = { action, next, index, npcKey }
      var isProcessing = false; // 防止重复点击
      
      var handler = function(event){
        try {
          // 防止重复点击和事件冒泡
          if (isProcessing || _isCreatingButtons) {
            _log('Button click ignored - processing:', isProcessing, 'creating:', _isCreatingButtons);
            return;
          }
          
          if (event && event.stopPropagation) {
            event.stopPropagation();
          }
          if (event && event.preventDefault) {
            event.preventDefault();
          }
          
          isProcessing = true;
          _log('Button clicked - meta:', meta);
          
          // 延迟执行，避免快速连击
          setTimeout(function() {
            try {
              // 先淡出当前文本和按钮
              _fadeTextOut(function() {
                // 隐藏按钮
                _clearButtons();
                
                // 执行对应的动作
                if (meta && meta.action != null) {
                  _log('Executing action:', meta.action, 'with meta:', meta);
                  if (DialogueManager && typeof DialogueManager.runAction === 'function') {
                    DialogueManager.runAction(meta.action, meta);
                  } else if (_app) {
                    _app.fire('dialogue:action', meta.action, meta);
                  }
                  return;
                }
                if (meta && meta.next != null) {
                  _log('Going to next node:', meta.next, 'npcKey:', meta.npcKey);
                  if (DialogueManager && typeof DialogueManager.go === 'function') {
                    DialogueManager.go(meta.npcKey, meta.next);
                  } else if (_app) {
                    _app.fire('dialogue:go', meta.npcKey, meta.next);
                  }
                  return;
                }
                _log('Choosing option index:', meta.index, 'meta:', meta);
                if (DialogueManager && typeof DialogueManager.choose === 'function') {
                  DialogueManager.choose(meta.index|0);
                } else if (_app) {
                  _app.fire('dialogue:choose', meta.index|0, meta);
                }
              });
            } finally {
              // 重置处理状态
              setTimeout(function() {
                isProcessing = false;
              }, 500); // 500ms 防抖
            }
          }, 50); // 50ms 延迟执行
          
        } catch (e) {
          console.warn('[DialogueUI] click handler failed:', e);
          isProcessing = false;
        }
      };
  
      if (ent.element && ent.element.on) ent.element.on('click', handler);
      if (ent.button  && ent.button.on)  ent.button.on('click', handler);
    }
  
    function _createButton(label, meta, index){
      if (!_template) return null;
      var btn = _template.clone();
      btn.enabled = true;
      btn.name = (_template.name || 'DialogueBtn') + '_' + (index|0);
  
      // 使用dialogueButtonGroup作为父节点
      var buttonGroup = null;
      try {
        var mgr = UIManager && UIManager.getInstance && UIManager.getInstance();
        buttonGroup = mgr && mgr.dialogueButtonGroup;
      } catch (e) {}
      
      var parentContainer = buttonGroup || _container || _root;
      try { 
        parentContainer.addChild(btn); 
        _log('Button', index, 'added to parent:', parentContainer.name);
        
        // 检查父子关系是否正确建立
        _log('Button parent check - btn.parent:', btn.parent && btn.parent.name);
        _log('Parent container info:', parentContainer.name, 'position:', parentContainer.getLocalPosition(), 'world:', parentContainer.getPosition());
        
      } catch (e) { 
        _log('addChild failed:', e); 
      }
      
      // 按钮排列逻辑：所有按钮从上到下垂直排列，向右偏移
      var buttonSpacing = Math.max(_spacing, 100); // 增加间距到150px
      var x = 120;  // 向右偏移200px
      var y = -index * buttonSpacing; // 所有按钮按索引顺序从上到下排列
      var z = 10; // 设置较高的 z 值确保按钮在对话背景之上
      
      _log('Button spacing calculation - _spacing:', _spacing, 'final buttonSpacing:', buttonSpacing, 'index:', index, 'calculated x:', x, 'calculated y:', y, 'z:', z);
      
      try { 
        btn.setLocalPosition(x, y, z); 
        _log('Button', index, 'positioned at LOCAL:', x, y, z, 'spacing:', buttonSpacing);
        
        // 设置按钮元素的层级属性
        if (btn.element) {
          // 确保按钮在最前面显示
          btn.element.drawOrder = 1000 + index; // 高 drawOrder 值确保在前面
          _log('Button', index, 'drawOrder set to:', btn.element.drawOrder);
        }
        
        // 强制刷新变换层级
        if (btn.syncHierarchy) {
          btn.syncHierarchy();
        }
        
        // 检查设置后的位置
        var btnLocal = btn.getLocalPosition();
        var btnWorld = btn.getPosition();
        _log('Button', index, 'after setLocalPosition - LOCAL:', btnLocal, 'WORLD:', btnWorld);
        
        // 如果位置没有正确设置，再次尝试
        if (Math.abs(btnLocal.y - y) > 1) {
          _log('Button', index, 'position mismatch, retrying...');
          btn.setLocalPosition(x, y, z);
          if (btn.syncHierarchy) btn.syncHierarchy();
          var retryLocal = btn.getLocalPosition();
          _log('Button', index, 'after retry - LOCAL:', retryLocal);
        }
        
      } catch (e) { 
        _log('setLocalPosition failed:', e); 
      }
  
      // 填入文字并根据长度调整字体大小
      var labelEnt = _findFirstTextElement(btn);
      try { 
        if (labelEnt && labelEnt.element) {
          var text = String(label || ('Option '+(index+1)));
          
          // 使用动态字体大小计算
          var initialFontSize = 28; // 初始字体大小
          var fontSize = _calculateFontSize(text, _maxTextWidth, initialFontSize);
          
          // 先设置字体大小，再设置文本
          _log('Button', index, 'Setting fontSize BEFORE text - fontSize:', fontSize);
          
          // 记录设置前的字体大小
          var oldFontSize = labelEnt.element.fontSize;
          _log('Button', index, 'BEFORE fontSize change - old:', oldFontSize, 'new:', fontSize);
          
          // 尝试多种方式设置字体大小
          // 方法1: 直接设置
          labelEnt.element.fontSize = fontSize;
          
          // 方法2: 使用 PlayCanvas 的属性设置方式
          if (labelEnt.element.font && labelEnt.element.font.resource) {
            labelEnt.element.fontAsset = labelEnt.element.fontAsset;
            labelEnt.element.fontSize = fontSize;
          }
          
          // 现在设置文本内容
          labelEnt.element.text = text;
          
          // 设置文本元素的层级
          if (labelEnt.element) {
            labelEnt.element.drawOrder = 1100 + index; // 比按钮更高的层级
            _log('Button', index, 'text drawOrder set to:', labelEnt.element.drawOrder);
          }
          
          // 立即验证设置是否生效
          var actualFontSize = labelEnt.element.fontSize;
          _log('Button', index, 'AFTER fontSize set - actual:', actualFontSize, 'expected:', fontSize);
          
          // 强制刷新文本元素 - 简化版本
          try {
            // 方法1: 强制触发元素更新
            if (labelEnt.element._dirtifyText) {
              labelEnt.element._dirtifyText();
            }
            
            // 方法2: 强制同步层级
            if (labelEnt.syncHierarchy) {
              labelEnt.syncHierarchy();
            }
            
            // 方法3: 强制标记为脏数据
            if (labelEnt.element._markDirty) {
              labelEnt.element._markDirty();
            }
            
            // 方法4: 重新设置文本内容（同步）
            var tempText = labelEnt.element.text;
            labelEnt.element.text = '';
            labelEnt.element.text = tempText;
            
          } catch (refreshError) {
            _log('Font refresh failed:', refreshError);
          }
          
          _log('Button', index, 'text:', text, 'fontSize set to:', fontSize, 'maxWidth:', _maxTextWidth);
        }
      } catch (e) {
        _log('Text setup failed:', e);
      }
  
      // 绑定点击
      var finalMeta = meta || { index: index|0 };
      _log('Creating button', index, 'with label:', label, 'and meta:', finalMeta);
      _bindClick(btn, finalMeta);
  
      return btn;
    }
  
    function _layoutButtonsFromBase(n){
      if (!_baseReady) _computeBaseFromTemplate();
      if (!_baseReady) return;
  
      var step = (_btnHeight|0) + (_spacing|0);
      for (var i = 0; i < n; i++) {
        var btn = _btns[i]; if (!btn) continue;
        var x = _basePos.x;
        var y = _basePos.y - i * step;  // 向下逐行
        try { btn.setLocalPosition(x, y, 0); } catch (e) {}
      }
    }
  
    // ---------- i18n ----------
    function _t(key, def){
      try {
        if (!I18n) return def;
        var v = I18n.get('dialogue', key);
        if (v != null) return v;
        v = I18n.get('dialogue.' + key);
        return (v == null) ? def : v;
      } catch (e) { return def; }
    }
  
    function _readGraph(npcKey){
      var g = _t(npcKey, null);
      if (g && typeof g === 'object') return g;
      try { var g2 = I18n.get('dialogue', npcKey); if (g2 && typeof g2 === 'object') return g2; } catch (e) {}
      return null;
    }
  
    function _resolveNodeTextFromGraph(graph, nodeId){
      if (!graph) return '';
      var nodes = graph.nodes || graph;
      var nodeKey = nodeId || graph.start || 'start';
      var node = nodes[nodeKey] || null;
      if (!node) return '';
      if (typeof node.text === 'string' && node.text.length) return node.text;
      if (typeof node.textKey === 'string' && node.textKey.length) return _t(node.textKey, '');
      if (typeof node === 'string') return node;
      return '';
    }
  
    function _resolveOptionsFromGraph(graph, npcKey, nodeId){
      var nodes = (graph && (graph.nodes || graph)) || {};
      var nodeKey = nodeId || graph.start || 'start';
      var node = nodes[nodeKey] || {};
      var opts = node.options || node.answers || [];
  
      var list = [];
      for (var i = 0; i < opts.length; i++) {
        var o = opts[i] || {};
        var label = (typeof o.text === 'string') ? o.text : ((typeof o.textKey === 'string') ? _t(o.textKey, '') : ('Option ' + (i+1)));
        
        // 使用原始选项中的 index，如果没有则使用循环索引
        var optionIndex = (o.index != null) ? o.index : i;
        
        var meta = {
          npcKey: npcKey,
          action: (o.action != null) ? o.action : null,
          next: (o.next != null) ? o.next : null,
          index: optionIndex
        };
        
        _log('Option', i, 'parsed - label:', label, 'original option:', o, 'final meta:', meta);
        
        list.push({
          label: label,
          meta: meta
        });
      }
      return list;
    }
  
    // ---------- 对外 API ----------
    function init(app, options){
      _app = app;
      options = options || {};
      _screen = options.screen || null;
      _debug = !!options.debug;
  
      _applyUIBindingsFromManager();
      _computeBaseFromTemplate();
      
      _log('init: appRef=', !!_app, 'screen=', !!_screen);
    }
  
    function configure(opts){
      opts = opts || {};
      _root      = opts.root      || _root;
      _textEnt   = opts.text      || _textEnt;
      _bgEnt     = opts.bg        || _bgEnt;
      _container = opts.container || _container || _root;
      _template  = opts.template  || _template;
      _spacing   = _num(opts.spacing, _spacing);
  
      try { if (_template) _template.enabled = false; } catch (e) {}
  
      _computeBaseFromTemplate();
      _log('configure: root=', _root && _root.name, 'text=', _textEnt && _textEnt.name, 'container=', _container && _container.name, 'template=', _template && _template.name, 'spacing=', _spacing, 'basePos=', _basePos);
    }
  
    function setDebug(flag){ _debug = !!flag; }
    function setButtonsPosition(x,y,z){ _basePos.set(x,y,z); _baseReady=true; }
  
    /**
     * 显示对话
     * 新式：show({ npcKey:'xxx', nodeId:'start' })
     * 旧式：show(node, answers)
     */
    function show(arg1, arg2){
      _applyUIBindingsFromManager();
      _computeBaseFromTemplate();
  
      _clearButtons();
      try { if (_root) _root.enabled = true; } catch (e) {}
  
      var finalText = '';
      var optionsList = []; // [{ label, meta }]
  
      if (arg1 && typeof arg1 === 'object' && (arg1.npcKey || arg1.nodeId)) {
        // i18n 图
        var npcKey = String(arg1.npcKey || '');
        var nodeId = String(arg1.nodeId || 'start');
        var graph = _readGraph(npcKey);
        finalText = _resolveNodeTextFromGraph(graph, nodeId);
        optionsList = _resolveOptionsFromGraph(graph, npcKey, nodeId);
        if (!finalText && typeof arg1.textKey === 'string') finalText = _t(arg1.textKey, '');
        if (!finalText && typeof arg1.text === 'string') finalText = arg1.text;
      } else {
        // 旧式
        var node = arg1 || {};
        var answers = Array.isArray(arg2) ? arg2 : [];
        
        for (var i=0; i<answers.length; i++){
          var a = answers[i] || {};
          optionsList.push({
            label: a.text || ('Option ' + (i+1)),
            meta: { index: (a.index != null) ? a.index : i }
          });
        }
      }
  
      // 使用淡入+打字机动画显示文本
      _fadeTextIn(function() {
        _showTextWithTypewriter(finalText, function() {
          // 文本动画完成后创建按钮
          _createButtonsWithAnimation(optionsList);
        });
      });
    }
    
    // 显示文本的打字机动画
    function _showTextWithTypewriter(text, onComplete) {
      // 停止之前的动画
      _stopTypewriter();
      
      // 确保文本元素透明度为1
      try {
        if (_textEnt && _textEnt.element) {
          _textEnt.element.opacity = 1;
          _textEnt.element.text = ''; // 清空文本
        }
      } catch (e) {}
      
      // 开始打字机动画
      _startTypewriter(text, onComplete);
    }
    
    // 创建按钮的动画版本
    function _createButtonsWithAnimation(optionsList) {
      // 生成按钮（第一个就在模板预设处）
      _isCreatingButtons = true;
      _clearButtons();
      
      try {
        for (var i=0;i<optionsList.length;i++){
          var item = optionsList[i];
          var btn = _createButton(item.label, item.meta, i);
          if (btn) _btns.push(btn);
        }
      } finally {
        // 延迟解除创建状态，确保所有按钮都完全创建完成
        setTimeout(function() {
          _isCreatingButtons = false;
          _log('Button creation completed, clicks now enabled');
        }, 100);
      }
  
    }
  
    function hide(){
      _clearButtons();
      try { if (_textEnt && _textEnt.element) _textEnt.element.text = ''; } catch (e) {}
      try { if (_bgEnt) _bgEnt.enabled = false; } catch (e) {}
      try { if (_root) _root.enabled = false; } catch (e) {}
    }
    
    // ---------- 导出 ----------
    return {
      init: init,
      configure: configure,
      setDebug: setDebug,
      setButtonsPosition: setButtonsPosition,
      show: show,
      hide: hide
    };
  })();