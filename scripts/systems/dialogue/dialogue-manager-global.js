/* global pc */
/**
 * dialogue-manager-global.js
 * —— 全局 DialogueManager（非 pc.createScript 实例）
 * 用法：
 *   DialogueManager.setApp(this.app);
 *   DialogueManager.setUI(myUiAdaptor); // 可选
 *   DialogueManager.loadGraphFromAsset(jsonAsset) 或 DialogueManager.loadGraph(jsonDataObject)
 *   DialogueManager.start();
 *   DialogueManager.choose(index);
 *
 * 事件（app.fire）：
 *   'dialogue:started'    { id }
 *   'dialogue:stopped'    {}
 *   'dialogue:node'       { node, answers:[{index,text}] }
 *
 * UI 适配器接口：
 *   ui.setManager(mgr)
 *   ui.showNode(node, answers)
 *   ui.hide()
 */
(function (global) {
  'use strict';

  // ---------- 与 PlayerManager 的桥接（优先使用 PlayerManager，否则使用轻量兜底） ----------
  var PlayerState = (function () {
    function getPlayerManager() {
      // 尝试多种方式获取PlayerManager
      if (typeof PlayerManager !== 'undefined') {
        if (PlayerManager.get) return PlayerManager.get();
        if (PlayerManager._instance) return PlayerManager._instance;
      }
      if (typeof window !== 'undefined' && window.PlayerManagerAPI) {
        return window.PlayerManagerAPI;
      }
      if (typeof global !== 'undefined' && global.PlayerManager) {
        return global.PlayerManager.get ? global.PlayerManager.get() : global.PlayerManager._instance;
      }
      return null;
    }
    
    var PM = getPlayerManager();
    if (PM && PM.getFlag && PM.setFlag && PM.addItem && PM.getItemCount && PM.setQuestStage && PM.getQuestStage) {
      return {
        getFlag: function (k) { var pm = getPlayerManager(); return pm ? !!pm.getFlag(k) : false; },
        setFlag: function (k, v) { var pm = getPlayerManager(); if (pm) pm.setFlag(k, !!v); },
        addItem: function (id, n) { var pm = getPlayerManager(); if (pm) pm.addItem(id, n|0); },
        getItemCount: function (id) { var pm = getPlayerManager(); return pm ? (pm.getItemCount(id)|0) : 0; },
        setQuestStage: function (id, s) { var pm = getPlayerManager(); if (pm) pm.setQuestStage(id, s|0); },
        getQuestStage: function (id) { var pm = getPlayerManager(); return pm ? (pm.getQuestStage(id)|0) : 0; }
      };
    }
    // 兜底实现（无持久化，仅内存）
    var _flags = Object.create(null);
    var _items = Object.create(null);
    var _quests = Object.create(null);
    return {
      getFlag: function (k) { return !!_flags[k]; },
      setFlag: function (k, v) { _flags[k] = !!v; },
      addItem: function (id, n) { _items[id] = (_items[id] | 0) + (n | 0); },
      getItemCount: function (id) { return _items[id] | 0; },
      setQuestStage: function (id, s) { _quests[id] = s | 0; },
      getQuestStage: function (id) { return _quests[id] | 0; }
    };
  })();

  // ---------- 条件注册表 ----------
  var DialogueConditions = (function () {
    var _map = Object.create(null);
    function register(name, fn) { _map[name] = fn; }
    function evalCond(name, args, mgr, bb) {
      var fn = _map[name];
      if (!fn) { console.warn('[DialogueConditions] not found:', name); return false; }
      try { return !!fn.apply(null, [mgr, bb].concat(args || [])); }
      catch (e) { console.warn('[DialogueConditions]', name, 'error:', e); return false; }
    }
    // 内置通用条件
    register('flag',               function (mgr, bb, key) { return !!PlayerState.getFlag(key); });
    register('notFlag',            function (mgr, bb, key) { return !PlayerState.getFlag(key); });
    register('hasItem',            function (mgr, bb, id, n) { return PlayerState.getItemCount(id) >= (n | 0); });
    register('questStageAtLeast',  function (mgr, bb, questId, stage) { return (PlayerState.getQuestStage(questId) | 0) >= (stage | 0); });
    return { register: register, eval: evalCond };
  })();

  // ---------- 动作注册表 ----------
  var DialogueActions = (function () {
    var _map = Object.create(null);
    function register(name, fn) { _map[name] = fn; }
    function run(name, args, mgr, bb) {
      var fn = _map[name];
      if (!fn) { console.warn('[DialogueActions] not found:', name); return; }
      try { fn.apply(null, [mgr, bb].concat(args || [])); }
      catch (e) { console.warn('[DialogueActions]', name, 'error:', e); }
    }
    // 内置通用动作
    register('setFlag',       function (mgr, bb, key, value) { PlayerState.setFlag(key, !!value); });
    register('giveItem',      function (mgr, bb, id, n) { PlayerState.addItem(id, n | 0); mgr._fire('ui:toast', { text: 'Get ' + id + ' x' + (n | 0) }); });
    register('setQuestStage', function (mgr, bb, id, stage) { PlayerState.setQuestStage(id, stage | 0); mgr._fire('quest:stage_changed', { id: id, stage: stage | 0 }); });
    register('playSfx',       function (mgr, bb, bus, cue) { mgr._fire('audio:sfx', { bus: bus || 'ui', cue: cue || 'click' }); });
    register('fadeInBgm',     function (mgr, bb, track, duration) { mgr._fire('audio:bgm:fadein', { track: track, duration: duration || 1.0 }); });
    register('fadeOutBgm',    function (mgr, bb, duration) { mgr._fire('audio:bgm:fadeout', { duration: duration || 1.0 }); });
    register('addMapMarker',  function (mgr, bb, markerId, x, y, label) { mgr._fire('map:add_marker', { id: markerId, x: x || 0, y: y || 0, label: label || '' }); });
    register('removeMapMarker', function (mgr, bb, markerId) { mgr._fire('map:remove_marker', { id: markerId }); });
    register('endDialogue',   function (mgr) { mgr.stop(); });
    register('learnNpcName',  function (mgr, bb, npcId, realName) { 
      // 学习NPC名字
      try {
        var pm = null;
        
        // 尝试多种方式获取PlayerManager实例
        if (typeof PlayerManager !== 'undefined') {
          if (PlayerManager.get) {
            pm = PlayerManager.get();
          } else if (PlayerManager._instance) {
            pm = PlayerManager._instance;
          }
        }
        
        // 尝试从全局window对象获取
        if (!pm && typeof window !== 'undefined' && window.PlayerManagerAPI) {
          pm = window.PlayerManagerAPI;
        }
        
        // 尝试从全局对象获取
        if (!pm && typeof global !== 'undefined' && global.PlayerManager) {
          pm = global.PlayerManager.get ? global.PlayerManager.get() : global.PlayerManager._instance;
        }
        
        if (pm && pm.learnNpcName) {
          pm.learnNpcName(npcId, realName);
          mgr._fire('player:npc:learned', { npcId: npcId, name: realName });
          console.log('[DialogueActions] Learned NPC name:', npcId, '->', realName);
        } else {
          // 兜底方案：通过事件系统通知PlayerManager学习NPC名字
          console.warn('[DialogueActions] PlayerManager not available directly, using event fallback');
          mgr._fire('player:learn_npc_name', { npcId: npcId, name: realName });
          console.log('[DialogueActions] Fired learn_npc_name event:', npcId, '->', realName);
        }
      } catch (e) {
        console.error('[DialogueActions] learnNpcName failed:', e);
      }
    });
    return { register: register, run: run };
  })();

  // ---------- 核心：全局 DialogueManager ----------
  var DialogueManager = (function () {
    var _app = null;            // PlayCanvas app
    var _graph = null;          // { nodes: {id:Node}, start:"id" }
    var _currentId = null;      // 当前节点 id
    var _ui = null;             // UI 适配器
    var _active = false;        // 是否对话中
    var _bb = {};               // 会话黑板
    var _debug = true;
    var _npcKey = null;         // 当前对话的 NPC/角色 key（如 'moai'）

    function _log() { if (_debug) console.log.apply(console, ['[DialogueManager]'].concat([].slice.call(arguments))); }
    function _err() { console.error.apply(console, ['[DialogueManager]'].concat([].slice.call(arguments))); }
    function _fire(ev, data) { if (_app) _app.fire(ev, data || {}); }

    function _detectLocale() {
      // 优先读取 GlobalGame 的语言设置
      try {
        if (typeof GlobalGame !== 'undefined' && GlobalGame.getLocale) {
          var g = GlobalGame.getLocale();
          if (g === 'zh-CN' || g === 'en-US') return g;
        }
      } catch (e) {}
      var nav = (typeof navigator !== 'undefined') ? navigator : null;
      var lang = (nav && (nav.language || (nav.languages && nav.languages[0]))) || 'en-US';
      if (/^zh(?:-Hans)?(?:-CN)?/i.test(lang)) return 'zh-CN';
      if (/^en/i.test(lang)) return 'en-US';
      return 'en-US';
    }

    function _findJsonAssetByName(name) {
      if (!_app || !_app.assets) return null;
      return _app.assets.find(name, 'json') || _app.assets.find(name) || null;
    }

    function _loadJsonAssetByName(name, cb) {
      var a = _findJsonAssetByName(name);
      if (!a) { if (cb) cb(null); return; }
      if (a.resource) { if (cb) cb(a); return; }
      a.once('load', function (asset) { if (cb) cb(asset); });
      try { _app.assets.load(a); } catch (e) { if (cb) cb(null); }
    }

    function _normalizeGraph(raw) {
      if (!raw) return null;
      var dict = {};
      var arr = raw.nodes || [];
      for (var i = 0; i < arr.length; i++) dict[arr[i].id] = arr[i];
      return { nodes: dict, start: raw.start || (arr[0] && arr[0].id) || null };
    }

    // 检查并更新NPC名字显示
    function _checkAndUpdateNpcName(node) {
      if (!node || !node.speaker || !_npcKey) return;
      
      try {
        // 尝试获取PlayerManager实例来检查已学习的NPC名字
        var pm = null;
        if (typeof PlayerManager !== 'undefined') {
          if (PlayerManager.get) {
            pm = PlayerManager.get();
          } else if (PlayerManager._instance) {
            pm = PlayerManager._instance;
          }
        }
        
        // 尝试从window.PlayerManagerAPI获取
        if (!pm && typeof window !== 'undefined' && window.PlayerManagerAPI) {
          pm = window.PlayerManagerAPI;
        }
        
        if (pm && pm.getLearnedNpcName) {
          var learnedName = pm.getLearnedNpcName(node.speaker);
          if (learnedName) {
            // 通知UI更新NPC名字显示
            _fire('dialogue:npc_name_update', {
              npcId: node.speaker,
              learnedName: learnedName,
              originalName: node.speaker
            });
            console.log('[DialogueManager] Updated NPC name display:', node.speaker, '->', learnedName);
          }
        }
      } catch (e) {
        console.error('[DialogueManager] Error checking NPC name:', e);
      }
    }

    function _goto(nodeId) {
      var node = nodeId && _graph && _graph.nodes[nodeId];
      if (!node) { _log('node not found', nodeId); stop(); return; }
      _currentId = nodeId;
      
      // 检查并更新NPC名字显示
      _checkAndUpdateNpcName(node);
      
      // 记录玩家对该 NPC 的当前节点进度
      try {
        if (_npcKey) {
          // 不保存 end 类型的节点，避免下次对话直接结束
          if (node.type === 'end') {
            console.log('[DialogueManager] Skipping save for end node:', _npcKey, '->', nodeId);
          } else {
            // 使用GameManager存储对话进度
            if (typeof GlobalGame !== 'undefined' && GlobalGame.setDialogueNode) {
              GlobalGame.setDialogueNode(_npcKey, nodeId);
              console.log('[DialogueManager] Saved dialogue progress:', _npcKey, '->', nodeId);
            } else {
              console.warn('[DialogueManager] GlobalGame not available for saving dialogue progress');
            }
          }
        }
      } catch (e) {
        console.error('[DialogueManager] Error saving dialogue progress:', e);
      }
      _run(node.onEnter);
      _present(node);
    }

    function _present(node) {
      var outs = _resolveOuts(node);

      if (node.type === 'auto') {
        var next = outs.length ? outs[0].to : null;
        if (next) _goto(next);
        else stop();
        return;
      }

      if (node.type === 'end') {
        _run(node.onExit);
        stop();
        return;
      }

      var answers = outs.map(function (o, i) { return { index: i, text: o.text || ('Answer ' + (i + 1)) }; });
      _fire('dialogue:node', { node: node, answers: answers });

      if (_ui && _ui.showNode) _ui.showNode(node, answers);
      else _log('UI missing ->', node.text, answers.map(function(a){return a.text;}));
    }

    function _resolveOuts(node) {
      var outs = node.outs || [];
      var ok = [];
      for (var i = 0; i < outs.length; i++) {
        var o = outs[i];
        if (_check(o.when)) ok.push(o);
      }
      return ok;
    }

    function _check(condSpec) {
      if (!condSpec || !condSpec.length) return true;
      var last = true, curOp = 'and';
      for (var i = 0; i < condSpec.length; i++) {
        var c = condSpec[i];
        var op = c.op || curOp;
        var res = DialogueConditions.eval(c.name, c.args || [], DialogueManager, _bb);
        if (op === 'and') last = last && res;
        else if (op === 'or') last = last || res;
        curOp = op;
      }
      return !!last;
    }

    function _run(actions) {
      if (!actions || !actions.length) return;
      for (var i = 0; i < actions.length; i++) {
        var a = actions[i];
        DialogueActions.run(a.name, a.args || [], DialogueManager, _bb);
      }
    }

    // ------- 对外 API -------
    function setApp(app) { _app = app; }
    function setDebug(flag) { _debug = !!flag; }
    function setUI(uiAdaptor) {
      _ui = uiAdaptor || null;
      if (_ui && _ui.setManager) { try { _ui.setManager(DialogueManager); } catch (e) {} }
    }

    function loadGraph(raw) {
      _graph = _normalizeGraph(raw);
      if (!_graph) _err('loadGraph failed: invalid data');
      else _log('graph loaded, nodes=', Object.keys(_graph.nodes).length, 'start=', _graph.start);
    }

    function loadGraphFromAsset(jsonAsset) {
      if (!jsonAsset) { _err('loadGraphFromAsset: asset is null'); return; }
      if (jsonAsset.resource) {
        loadGraph(jsonAsset.resource);
      } else if (jsonAsset.once) {
        jsonAsset.once('load', function (a) { loadGraph(a.resource); });
        if (_app && _app.assets) _app.assets.load(jsonAsset);
      } else {
        _err('loadGraphFromAsset: not a PlayCanvas json asset');
      }
    }

    function start(startId, opts) {
      if (!_app) { _err('setApp(app) first'); return; }
      if (!_graph) { _err('graph not loaded'); return; }
      _active = true;
      _bb = (opts && opts.bb) ? opts.bb : {};
      _goto(startId || _graph.start);
      _fire('dialogue:started', { id: _currentId });
    }

    // 多语言按角色启动：根据 locale 选择 data/dialogue/<npcKey>_<locale>.json，优先使用玩家进度节点
    function startFor(npcKey, opts) {
      if (!_app) { _err('setApp(app) first'); return; }
      var locale = (opts && opts.locale) || _detectLocale();
      var fallbacks = (opts && opts.fallbacks) || (locale === 'zh-CN' ? ['en-US'] : ['zh-CN']);
      var namePrimary = npcKey + '_' + locale + '.json';
      _npcKey = npcKey;

      var decideStartAndBegin = function () {
        // 读取玩家当前节点优先
        var startId = null;
        try {
          // 使用GameManager存储对话进度
          if (typeof GlobalGame !== 'undefined' && GlobalGame.getDialogueNode) {
            startId = GlobalGame.getDialogueNode(npcKey) || null;
            if (startId) {
              // 检查保存的节点是否有效（不是end节点）
              if (startId === 'end') {
                console.warn('[DialogueManager] Found invalid saved node (end), clearing progress for', npcKey);
                GlobalGame.clearDialogueProgressFor(npcKey);
                startId = null;
              } else {
                console.log('[DialogueManager] Found saved dialogue node for', npcKey, ':', startId);
              }
            } else {
              console.log('[DialogueManager] No saved dialogue node for', npcKey, ', starting from beginning');
            }
          } else {
            console.warn('[DialogueManager] GlobalGame not available for dialogue progress');
          }
        } catch (e) {
          console.error('[DialogueManager] Error reading dialogue progress:', e);
        }

        // 记录所用图键（可选，用于调试）
        if (typeof GlobalGame !== 'undefined' && GlobalGame.debug) {
          console.log('[DialogueManager] Using dialogue graph:', npcKey + '_' + locale);
        }

        start(startId, opts);
      };

      var tryFallbacks = function (idx) {
        if (idx >= fallbacks.length) { _err('startFor: no dialogue asset found for', npcKey); return; }
        var fb = npcKey + '_' + fallbacks[idx] + '.json';
        _loadJsonAssetByName(fb, function (asset) {
          if (asset && asset.resource) {
            loadGraph(asset.resource);
            decideStartAndBegin();
          } else {
            tryFallbacks(idx + 1);
          }
        });
      };

      _loadJsonAssetByName(namePrimary, function (asset) {
        if (asset && asset.resource) {
          loadGraph(asset.resource);
          decideStartAndBegin();
        } else {
          tryFallbacks(0);
        }
      });
    }

    function stop() {
      if (!_active) return;
      _active = false;
      _currentId = null;
      if (_ui && _ui.hide) { try { _ui.hide(); } catch (e) {} }
      _fire('dialogue:stopped');
    }

    function choose(answerIndex) {
      if (!_active || !_currentId) return;
      var node = _graph.nodes[_currentId];
      var outs = _resolveOuts(node);
      var chosen = outs[answerIndex | 0];
      if (!chosen) return;
      _run(node.onExit);
      _run(chosen.actions);
      var to = chosen.to;
      if (!to) { stop(); return; }
      _goto(to);
    }

    function getCurrentNode() { return _currentId ? (_graph && _graph.nodes[_currentId]) : null; }
    function isActive() { return _active; }

    return {
      // 基础
      setApp: setApp,
      setDebug: setDebug,
      setUI: setUI,
      loadGraph: loadGraph,
      loadGraphFromAsset: loadGraphFromAsset,
      start: start,
      startFor: startFor,
      stop: stop,
      choose: choose,
      getCurrentNode: getCurrentNode,
      isActive: isActive,
      // 预加载 API（不改变当前图）
      preloadFor: function (npcKey, opts) {
        if (!_app) { _err('setApp(app) first'); return; }
        var locale = (opts && opts.locale) || _detectLocale();
        var fallbacks = (opts && opts.fallbacks) || (locale === 'zh-CN' ? ['en-US'] : ['zh-CN']);
        var names = [ npcKey + '_' + locale + '.json' ].concat(fallbacks.map(function(l){ return npcKey + '_' + l + '.json'; }));
        names.forEach(function(name){ _loadJsonAssetByName(name, function(){ /* ensure cached */ }); });
      },
      preloadMany: function (npcKeys, opts) {
        if (!Array.isArray(npcKeys)) return;
        var self = this;
        for (var i = 0; i < npcKeys.length; i++) {
          self.preloadFor(npcKeys[i], opts);
        }
      },
      // 可扩展注册表
      Conditions: DialogueConditions,
      Actions: DialogueActions,
      State: PlayerState,
      // 供内置动作/外部模块统一触发 app 事件
      _fire: _fire
    };
  })();

  global.DialogueManager = DialogueManager;

})(typeof window !== 'undefined' ? window : this);
