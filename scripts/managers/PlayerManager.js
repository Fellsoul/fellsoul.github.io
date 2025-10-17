/* global pc */
/**
 * player-manager.js
 * —— 组件形式的 PlayerManager（单例）
 * 用途：集中管理玩家档案/会话数据、背包、任务、旗标、属性、统计、持久化等。
 * 说明：不再管理“位置/朝向”，这些由 PlayerController 负责。
 *
 * 用法：
 *  1) 将本脚本挂到场景 Root（或任意常驻实体）上。
 *  2) 通过全局/单例访问：
 *       const pm = PlayerManager.get();          // 单例实例
 *       // 或（可选）window.PlayerManagerAPI     // 便捷函数集合
 *  3) 事件（this.app.fire）：
 *       'player:changed' { path, value }
 *       'player:inventory' { id, count, delta }
 *       'player:stat' { key, value, delta }
 *       'player:flag' { key, value }
 *       'player:quest' { id, stage }
 *       'player:saved' { saveKey, bytes }
 *       'player:loaded' { saveKey, ok }
 *       'player:reset' {}
 */

var PlayerManager = pc.createScript('playerManager');

/* ---------- 属性（可在编辑器配置） ---------- */
PlayerManager.attributes.add('saveKey', { type: 'string', default: 'game.save', title: '本地存档键' });
PlayerManager.attributes.add('autosaveOnChange', { type: 'boolean', default: false, title: '每次变更自动存档（开发期）' });
PlayerManager.attributes.add('clampHP', { type: 'boolean', default: true, title: '限制HP在[0,hpMax]' });
PlayerManager.attributes.add('clampStamina', { type: 'boolean', default: true, title: '限制体力在[0,staminaMax]' });
PlayerManager.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

/* ---------- 静态变量 ---------- */
PlayerManager._instance = null;

/* ---------- 静态方法 ---------- */
PlayerManager.getInstance = function() {
  return PlayerManager._instance;
};

PlayerManager.get = function() {
  return PlayerManager._instance;
};

PlayerManager.prototype._now = function () {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
};
PlayerManager.prototype._fire = function (ev, data) { this.app && this.app.fire(ev, data || {}); };
PlayerManager.prototype._log = function () { if (this.enableDebugLog) console.log.apply(console, arguments); };
PlayerManager.prototype._clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };
PlayerManager.prototype._clone = function (obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (Array.isArray(obj)) return obj.map(function(item) { return this._clone(item); }, this);
  var cloned = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = this._clone(obj[key]);
    }
  }
  return cloned;
};

/* ---------- 初始化默认数据（无位置字段） ---------- */
PlayerManager.prototype._makeDefaultData = function () {
  return {
    meta: {
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalPlayTimeMs: 0,
      sessions: 0,
      device: this._detectDevice()
    },
    player: {
      name: 'Player',
      level: 1,
      xp: 0,
      hp: 100, hpMax: 100,
      stamina: 100, staminaMax: 100,
      coins: 0,
      stats: {}          // 任意键值，如 {attack:10, defense:5}
    },
    flags: {},           // 布尔/数值/字符串开关，如 {hasKey:true}
    inventory: {},       // 物品表：{ itemId: count }
    quests: {},          // 任务进度：{ questId: { stage: 'started', vars:{...} } }
    bookmarks: {},       // 自定义标记/收藏
    dialogue: {          // 对话数据（持久化）
      graphs: {},        // 每 NPC 的对话图键：{ npcId: graphKey }
      stages: {},        // 每 NPC 的对话阶段（数字或字符串）：{ npcId: any }
      nodes: {}          // 每 NPC 的当前节点：{ npcId: nodeId }
    },
    knownNpcs: {},       // 已知NPC名字：{ npcId: { name: 'realName', knownAt: timestamp } }
    collectibles: {},    // 收藏品：{ collectibleId: { found: true, timestamp: Date.now(), location: 'level1' } }
    _sys: { lastSaveHash: '' }
  };
};

PlayerManager.prototype._detectDevice = function () {
  var nav = (typeof navigator !== 'undefined') ? navigator : null;
  var touch = (typeof window !== 'undefined') && ('ontouchstart' in window || (nav && (nav.maxTouchPoints|0) > 0));
  return { type: touch ? 'mobile' : 'desktop', platform: (nav && nav.platform) || '', ua: (nav && nav.userAgent) || '' };
};

/* ---------- 生命周期 ---------- */
PlayerManager.prototype.initialize = function () {
  if (PlayerManager._instance) {
    if (this.debug) console.warn('[PlayerManager] Multiple instances detected. Using the first one.');
    this.entity.destroy(); // 直接销毁多余的实例
    return;
  }
  PlayerManager._instance = this;

  this._cfg = {
    saveKey: this.saveKey || 'game.save',
    autoload: !!this.autoload,
    autosaveOnChange: !!this.autosaveOnChange,
    clampHP: !!this.clampHP,
    clampStamina: !!this.clampStamina
  };

  this._data = this._makeDefaultData();
  this._rt = { sessionStartMs: this._now(), dirty: false };

  // 会话计数
  this._data.meta.sessions++;

  // 自动读档
  if (this._cfg.autoload) this.load();

  // 可选：暴露便捷 API 到全局（调试/UI方便调用）
  if (typeof window !== 'undefined') {
    window.PlayerManagerAPI = this._buildPublicAPI();
  }

  // 监听对话系统的NPC名字学习事件
  this.app.on('player:learn_npc_name', this._handleLearnNpcName, this);

  this._log('[PlayerManager] Ready. Device:', this._data.meta.device);
};

PlayerManager.prototype.destroy = function () {
  // 移除事件监听
  this.app.off('player:learn_npc_name', this._handleLearnNpcName, this);
  
  if (PlayerManager._instance === this) PlayerManager._instance = null;
  // 可选择不移除 window.PlayerManagerAPI 以便运行时调试
};

/* ---------- 事件处理 ---------- */
PlayerManager.prototype._handleLearnNpcName = function (data) {
  if (data && data.npcId && data.name) {
    this.learnNpcName(data.npcId, data.name);
    this._log('[PlayerManager] Learned NPC name via event:', data.npcId, '->', data.name);
  }
};

/* ---------- 通用触达：标记变更/触发事件/可选自动存档 ---------- */
PlayerManager.prototype._touch = function (path, value, evt, payload) {
  this._data.meta.updatedAt = Date.now();
  this._rt.dirty = true;
  if (this._cfg.autosaveOnChange) this.save();
  this._fire('player:changed', { path: path, value: this._clone(value) });
  if (evt) this._fire(evt, payload || {});
};

/* ---------- 存档/读档/重置（无位置字段） ---------- */
PlayerManager.prototype.save = function () {
  try {
    var serialized = JSON.stringify(this._data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this._cfg.saveKey, serialized);
    }
    this._rt.dirty = false;
    this._fire('player:saved', { saveKey: this._cfg.saveKey, bytes: serialized.length });
    this._log('[PlayerManager] Saved ->', this._cfg.saveKey);
    return true;
  } catch (e) {
    console.warn('[PlayerManager] save failed:', e);
    return false;
  }
};

PlayerManager.prototype.load = function () {
  try {
    if (typeof localStorage === 'undefined') {
      this._fire('player:loaded', { saveKey: this._cfg.saveKey, ok: false });
      return false;
    }
    var raw = localStorage.getItem(this._cfg.saveKey);
    if (!raw) {
      this._fire('player:loaded', { saveKey: this._cfg.saveKey, ok: true });
      return true;
    }
    var parsed = JSON.parse(raw);

    // 合并到当前默认结构，避免旧版本缺字段
    var d = this._data;
    d.flags = Object.assign({}, d.flags, parsed.flags || {});
    d.inventory = Object.assign({}, d.inventory, parsed.inventory || {});
    d.quests = Object.assign({}, d.quests, parsed.quests || {});
    d.player.stats = Object.assign({}, d.player.stats, (parsed.player && parsed.player.stats) || {});
    var p = parsed.player || {};
    ['name','level','xp','hp','hpMax','stamina','staminaMax','coins'].forEach(function(k){
      if (typeof p[k] !== 'undefined') d.player[k] = p[k];
    });
    if (parsed.bookmarks) d.bookmarks = parsed.bookmarks;
    // 合并收藏品
    if (parsed.collectibles) d.collectibles = Object.assign({}, d.collectibles, parsed.collectibles);
    // 合并对话域（若旧档没有，则保持默认空对象）
    if (!d.dialogue) d.dialogue = { graphs:{}, stages:{}, nodes:{} };
    if (parsed.dialogue) {
      d.dialogue.graphs = Object.assign({}, d.dialogue.graphs, parsed.dialogue.graphs || {});
      d.dialogue.stages = Object.assign({}, d.dialogue.stages, parsed.dialogue.stages || {});
      d.dialogue.nodes  = Object.assign({}, d.dialogue.nodes,  parsed.dialogue.nodes  || {});
    }

    this._touch('load', this._clone(d));
    this._fire('player:loaded', { saveKey: this._cfg.saveKey, ok: true });
    this._log('[PlayerManager] Loaded.');
    return true;
  } catch (e) {
    console.warn('[PlayerManager] load failed:', e);
    this._fire('player:loaded', { saveKey: this._cfg.saveKey, ok: false });
    return false;
  }
};

PlayerManager.prototype.resetAll = function () {
  this._data = this._makeDefaultData();
  this._rt.dirty = true;
  this._fire('player:reset', {});
  this._log('[PlayerManager] Reset to defaults.');
};

/* ---------- 基本属性/生命值/体力/金币 ---------- */
PlayerManager.prototype.setName = function (name) {
  this._data.player.name = String(name || 'Player');
  this._touch('player.name', this._data.player.name);
};

PlayerManager.prototype.addXP = function (delta) {
  var p = this._data.player;
  p.xp = Math.max(0, (p.xp|0) + (delta|0));
  this._touch('player.xp', p.xp, 'player:stat', { key: 'xp', value: p.xp, delta: delta|0 });
};

PlayerManager.prototype.setLevel = function (level) {
  var p = this._data.player;
  p.level = Math.max(1, level|0);
  this._touch('player.level', p.level, 'player:stat', { key: 'level', value: p.level });
};

PlayerManager.prototype.addCoins = function (delta) {
  var p = this._data.player;
  var before = p.coins|0;
  p.coins = Math.max(0, before + (delta|0));
  this._touch('player.coins', p.coins, 'player:stat', { key: 'coins', value: p.coins, delta: (p.coins - before) });
  return p.coins;
};
PlayerManager.prototype.spendCoins = function (amount) { return this.addCoins(-(amount|0)); };

PlayerManager.prototype.setHPMax = function (max) {
  var p = this._data.player; p.hpMax = Math.max(1, max|0);
  if (this._cfg.clampHP) p.hp = this._clamp(p.hp, 0, p.hpMax);
  this._touch('player.hpMax', p.hpMax, 'player:stat', { key: 'hpMax', value: p.hpMax });
};
PlayerManager.prototype.addHP = function (delta) {
  var p = this._data.player; var before = p.hp|0;
  p.hp = (before + (delta|0));
  if (this._cfg.clampHP) p.hp = this._clamp(p.hp, 0, p.hpMax);
  this._touch('player.hp', p.hp, 'player:stat', { key: 'hp', value: p.hp, delta: (p.hp - before) });
  return p.hp;
};
PlayerManager.prototype.setStaminaMax = function (max) {
  var p = this._data.player; p.staminaMax = Math.max(1, max|0);
  if (this._cfg.clampStamina) p.stamina = this._clamp(p.stamina, 0, p.staminaMax);
  this._touch('player.staminaMax', p.staminaMax, 'player:stat', { key: 'staminaMax', value: p.staminaMax });
};
PlayerManager.prototype.addStamina = function (delta) {
  var p = this._data.player; var before = p.stamina|0;
  p.stamina = (before + (delta|0));
  if (this._cfg.clampStamina) p.stamina = this._clamp(p.stamina, 0, p.staminaMax);
  this._touch('player.stamina', p.stamina, 'player:stat', { key: 'stamina', value: p.stamina, delta: (p.stamina - before) });
  return p.stamina;
};

/* ---------- 自定义数值属性（stats） ---------- */
PlayerManager.prototype.setStat = function (key, value) {
  var v = (typeof value === 'number') ? value : (value|0);
  this._data.player.stats[key] = v;
  this._touch('player.stats.' + key, v, 'player:stat', { key: key, value: v });
};
PlayerManager.prototype.addStat = function (key, delta) {
  var cur = this._data.player.stats[key] || 0;
  var v = (cur + (delta||0));
  this._data.player.stats[key] = v;
  this._touch('player.stats.' + key, v, 'player:stat', { key: key, value: v, delta: (delta||0) });
  return v;
};
PlayerManager.prototype.getStat = function (key, defVal) {
  var v = this._data.player.stats[key];
  return (typeof v === 'undefined') ? defVal : v;
};

/* ---------- 旗标（flags） ---------- */
PlayerManager.prototype.setFlag = function (key, value) {
  this._data.flags[key] = value;
  this._touch('flags.' + key, value, 'player:flag', { key: key, value: this._clone(value) });
};
PlayerManager.prototype.getFlag = function (key, defVal) {
  var v = this._data.flags[key];
  return (typeof v === 'undefined') ? defVal : v;
};
PlayerManager.prototype.toggleFlag = function (key) {
  var v = !!this._data.flags[key]; this.setFlag(key, !v); return !v;
};

/* ---------- 背包（inventory） ---------- */
PlayerManager.prototype.getItemCount = function (id) { return this._data.inventory[id] || 0; };
PlayerManager.prototype.addItem = function (id, count) {
  count = (count == null) ? 1 : (count|0);
  var before = this.getItemCount(id);
  var after = Math.max(0, before + count);
  this._data.inventory[id] = after;
  this._touch('inventory.' + id, after, 'player:inventory', { id: id, count: after, delta: (after - before) });
  return after;
};
PlayerManager.prototype.removeItem = function (id, count) { return this.addItem(id, -(count||1)); };
PlayerManager.prototype.hasItem = function (id, count) { return this.getItemCount(id) >= (count||1); };

/* ---------- 任务（quests） ---------- */
PlayerManager.prototype.setQuestStage = function (id, stage, vars) {
  var q = this._data.quests[id] || { stage: 'none', vars: {} };
  q.stage = stage || 'none';
  if (vars && typeof vars === 'object') q.vars = Object.assign({}, q.vars, vars);
  this._data.quests[id] = q;
  this._touch('quests.' + id, q, 'player:quest', { id: id, stage: q.stage, vars: this._clone(q.vars) });
  return q;
};
PlayerManager.prototype.getQuest = function (id) { return this._clone(this._data.quests[id] || null); };

/* ---------- 对话（dialogue）图键/阶段/节点 ---------- */
PlayerManager.prototype.setDialogueGraphKey = function (npcId, graphKey) {
  if (!npcId) return false;
  if (!this._data.dialogue) this._data.dialogue = { graphs:{}, stages:{}, nodes:{} };
  this._data.dialogue.graphs[npcId] = String(graphKey || '');
  this._touch('dialogue.graphs.' + npcId, this._data.dialogue.graphs[npcId], 'dialogue:graph_set', { npcId: npcId, graphKey: this._data.dialogue.graphs[npcId] });
  return true;
};
PlayerManager.prototype.getDialogueGraphKey = function (npcId, defVal) {
  var v = this._data.dialogue && this._data.dialogue.graphs[npcId];
  return (typeof v === 'undefined') ? (defVal || '') : String(v);
};

PlayerManager.prototype.setDialogueStage = function (npcId, stage) {
  if (!npcId) return false;
  if (!this._data.dialogue) this._data.dialogue = { graphs:{}, stages:{}, nodes:{} };
  this._data.dialogue.stages[npcId] = stage;
  this._touch('dialogue.stages.' + npcId, this._data.dialogue.stages[npcId], 'dialogue:stage_set', { npcId: npcId, stage: this._clone(stage) });
  return true;
};
PlayerManager.prototype.getDialogueStage = function (npcId, defVal) {
  var v = this._data.dialogue && this._data.dialogue.stages[npcId];
  return (typeof v === 'undefined') ? defVal : this._clone(v);
};

PlayerManager.prototype.setDialogueNode = function (npcId, nodeId) {
  if (!npcId) return false;
  if (!this._data.dialogue) this._data.dialogue = { graphs:{}, stages:{}, nodes:{} };
  this._data.dialogue.nodes[npcId] = String(nodeId || '');
  this._touch('dialogue.nodes.' + npcId, this._data.dialogue.nodes[npcId], 'dialogue:node_set', { npcId: npcId, nodeId: this._data.dialogue.nodes[npcId] });
  return true;
};
PlayerManager.prototype.getDialogueNode = function (npcId, defVal) {
  var v = this._data.dialogue && this._data.dialogue.nodes[npcId];
  return (typeof v === 'undefined') ? (defVal || '') : String(v);
};

/* ---------- 书签/收藏（任意键值） ---------- */
PlayerManager.prototype.setBookmark = function (key, payload) {
  this._data.bookmarks[key] = this._clone(payload);
  this._touch('bookmarks.' + key, this._data.bookmarks[key]);
};
PlayerManager.prototype.getBookmark = function (key, defVal) {
  var v = this._data.bookmarks[key];
  return (typeof v === 'undefined') ? defVal : this._clone(v);
};

/* ---------- 收藏品（Collectibles） ---------- */
PlayerManager.prototype.addCollectible = function (id, location, metadata) {
  if (!id) return false;
  if (!this._data.collectibles) this._data.collectibles = {};
  
  // 如果已经收集过，不重复添加
  if (this._data.collectibles[id]) {
    this._log('[PlayerManager] Collectible already found:', id);
    return false;
  }
  
  this._data.collectibles[id] = {
    found: true,
    timestamp: Date.now(),
    location: location || 'unknown',
    metadata: metadata || {}
  };
  
  this._touch('collectibles.' + id, this._data.collectibles[id], 'player:collectible', { 
    id: id, 
    location: location,
    total: this.getCollectiblesCount()
  });
  
  this._log('[PlayerManager] Collectible added:', id, 'in', location);
  return true;
};

PlayerManager.prototype.hasCollectible = function (id) {
  return !!(this._data.collectibles && this._data.collectibles[id]);
};

PlayerManager.prototype.getCollectible = function (id) {
  if (!this._data.collectibles) return null;
  return this._clone(this._data.collectibles[id] || null);
};

PlayerManager.prototype.getAllCollectibles = function () {
  if (!this._data.collectibles) return {};
  return this._clone(this._data.collectibles);
};

PlayerManager.prototype.getCollectiblesCount = function () {
  if (!this._data.collectibles) return 0;
  return Object.keys(this._data.collectibles).length;
};

PlayerManager.prototype.removeCollectible = function (id) {
  if (!this._data.collectibles || !this._data.collectibles[id]) return false;
  delete this._data.collectibles[id];
  this._touch('collectibles.' + id, null, 'player:collectible', { 
    id: id, 
    removed: true,
    total: this.getCollectiblesCount()
  });
  return true;
};

/* ---------- NPC名字管理 ---------- */
PlayerManager.prototype.learnNpcName = function (npcId, realName) {
  if (!npcId || !realName) return false;
  if (!this._data.knownNpcs) this._data.knownNpcs = {};
  
  var wasKnown = !!this._data.knownNpcs[npcId];
  this._data.knownNpcs[npcId] = {
    name: realName,
    knownAt: Date.now()
  };
  
  this._touch('knownNpcs.' + npcId, this._data.knownNpcs[npcId], 'player:npc:learned', {
    npcId: npcId,
    name: realName,
    wasKnown: wasKnown
  });
  
  this._log('[PlayerManager] Learned NPC name:', npcId, '->', realName);
  return true;
};

PlayerManager.prototype.isNpcKnown = function (npcId) {
  if (!npcId || !this._data.knownNpcs) return false;
  return !!this._data.knownNpcs[npcId];
};

PlayerManager.prototype.getNpcName = function (npcId, unknownName) {
  if (!npcId) return unknownName || '???';
  if (!this._data.knownNpcs || !this._data.knownNpcs[npcId]) {
    return unknownName || '???';
  }
  return this._data.knownNpcs[npcId].name || unknownName || '???';
};

PlayerManager.prototype.forgetNpcName = function (npcId) {
  if (!npcId || !this._data.knownNpcs || !this._data.knownNpcs[npcId]) return false;
  
  var oldName = this._data.knownNpcs[npcId].name;
  delete this._data.knownNpcs[npcId];
  
  this._touch('knownNpcs.' + npcId, null, 'player:npc:forgotten', {
    npcId: npcId,
    oldName: oldName
  });
  
  this._log('[PlayerManager] Forgot NPC name:', npcId);
  return true;
};

PlayerManager.prototype.getAllKnownNpcs = function () {
  return this._clone(this._data.knownNpcs || {});
};

/* ---------- 公有只读访问 ---------- */
PlayerManager.prototype.snapshot = function () { return this._clone(this._data); };
PlayerManager.prototype.isDirty = function () { return !!this._rt.dirty; };

/* ---------- 暴露简洁 API（可选） ---------- */
PlayerManager.prototype._buildPublicAPI = function () {
  var self = this;
  return {
    get: function () { return self.snapshot(); },
    save: self.save.bind(self),
    load: self.load.bind(self),
    reset: self.resetAll.bind(self),

    setName: self.setName.bind(self),
    addXP: self.addXP.bind(self),
    setLevel: self.setLevel.bind(self),
    addCoins: self.addCoins.bind(self),
    spendCoins: self.spendCoins.bind(self),
    setHPMax: self.setHPMax.bind(self),
    addHP: self.addHP.bind(self),
    setStaminaMax: self.setStaminaMax.bind(self),
    addStamina: self.addStamina.bind(self),

    setStat: self.setStat.bind(self),
    addStat: self.addStat.bind(self),
    getStat: self.getStat.bind(self),

    setFlag: self.setFlag.bind(self),
    getFlag: self.getFlag.bind(self),
    toggleFlag: self.toggleFlag.bind(self),

    addItem: self.addItem.bind(self),
    removeItem: self.removeItem.bind(self),
    hasItem: self.hasItem.bind(self),
    itemCount: self.getItemCount.bind(self),

    setQuestStage: self.setQuestStage.bind(self),
    getQuest: self.getQuest.bind(self),

    // 对话
    setDialogueGraphKey: self.setDialogueGraphKey.bind(self),
    getDialogueGraphKey: self.getDialogueGraphKey.bind(self),
    setDialogueStage: self.setDialogueStage.bind(self),
    getDialogueStage: self.getDialogueStage.bind(self),
    setDialogueNode: self.setDialogueNode.bind(self),
    getDialogueNode: self.getDialogueNode.bind(self),

    // NPC名字管理
    learnNpcName: self.learnNpcName.bind(self),
    isNpcKnown: self.isNpcKnown.bind(self),
    getNpcName: self.getNpcName.bind(self),
    forgetNpcName: self.forgetNpcName.bind(self),
    getAllKnownNpcs: self.getAllKnownNpcs.bind(self),

    setBookmark: self.setBookmark.bind(self),
    getBookmark: self.getBookmark.bind(self),

    // 收藏品
    addCollectible: self.addCollectible.bind(self),
    hasCollectible: self.hasCollectible.bind(self),
    getCollectible: self.getCollectible.bind(self),
    getAllCollectibles: self.getAllCollectibles.bind(self),
    getCollectiblesCount: self.getCollectiblesCount.bind(self),
    removeCollectible: self.removeCollectible.bind(self)
  };
};
