/* global pc, DialogueManager */
/**
 * @file talkable.js
 * @desc 可对话的交互组件：当接收到 `interactable:action` 且 action==='talk'、目标为自身时，
 *       自动按 npcKey 触发 DialogueManager.startFor，并通知 UI 进入对话控制状态。
 * @pc-attrs
 *   npcKey:string="moai"      // 对话目标角色键，匹配 data/dialogue/<npcKey>_<locale>.json
 *   autoExit:boolean=true      // 当对话结束时自动退出对话控制状态
 *   enableDebugLog:boolean=false
 */
var Talkable = pc.createScript('talkable');

Talkable.attributes.add('npcKey', { type: 'string', default: 'moai', title: '角色键(NPC Key)' });
Talkable.attributes.add('autoExit', { type: 'boolean', default: true, title: '对话结束自动退出控制态' });
Talkable.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });
// UI 按钮生成位置（UI本地坐标，像素为单位，Z通常为0）
Talkable.attributes.add('useCustomButtonPos', { type: 'boolean', default: false, title: '自定义按钮位置' });
Talkable.attributes.add('buttonPosX', { type: 'number', default: 0, title: '按钮X' });
Talkable.attributes.add('buttonPosY', { type: 'number', default: 0, title: '按钮Y' });
Talkable.attributes.add('buttonPosZ', { type: 'number', default: 0, title: '按钮Z' });

Talkable.prototype.initialize = function () {
  this._onInteract = this._handleInteract.bind(this);
  this.app.on('interactable:action', this._onInteract, this);
  this._onDialogueStopped = null;
  if (this.enableDebugLog) console.log('[Talkable] init on', this.entity && this.entity.name, 'npcKey=', this.npcKey);
};

Talkable.prototype.destroy = function () {
  if (this._onInteract) this.app.off('interactable:action', this._onInteract, this);
  if (this._onDialogueStopped) this.app.off('dialogue:stopped', this._onDialogueStopped, this);
  if (this.enableDebugLog) console.log('[Talkable] destroy on', this.entity && this.entity.name);
};

Talkable.prototype._handleInteract = function (payload) {
  if (this.enableDebugLog) console.log('[Talkable] event interactable:action received:', payload);
  if (!payload) return;
  var target = payload.entity || payload.target || null;
  if (target !== this.entity) {
    if (this.enableDebugLog) console.log('[Talkable] skip: target mismatch. expected=', this.entity && this.entity.name, 'got=', target && target.name);
    return;
  }
  var action = (payload.action || payload.name || '').toLowerCase();
  if (action !== 'talk') {
    if (this.enableDebugLog) console.log('[Talkable] skip: action is', action);
    return;
  }

  var npc = (this.npcKey || '').trim();
  if (!npc) { if (this.enableDebugLog) console.warn('[Talkable] npcKey empty, abort'); return; }

  // 通知 UI 进入对话模式（会锁定玩家并调整相机约束）
  var payload = { npc: npc, entity: this.entity };
  if (this.useCustomButtonPos) {
    payload.buttonsPos = { x: (this.buttonPosX||0), y: (this.buttonPosY||0), z: (this.buttonPosZ||0) };
  }
  try { if (this.enableDebugLog) console.log('[Talkable] firing ui:dialogue:begin'); this.app.fire('ui:dialogue:begin', payload); } catch (e) { if (this.enableDebugLog) console.warn('[Talkable] ui:dialogue:begin failed', e); }
  try { if (this.enableDebugLog) console.log('[Talkable] firing ui:control:set DIALOGUE'); this.app.fire('ui:control:set', 'DIALOGUE'); } catch (e) { if (this.enableDebugLog) console.warn('[Talkable] ui:control:set failed', e); }

  // 启动对话（多语言 + 玩家进度优先）
  try {
    var self = this;
    if (typeof DialogueManager === 'undefined') {
      if (this.enableDebugLog) console.warn('[Talkable] DialogueManager undefined');
    } else if (DialogueManager.startFor && DialogueManager.setApp) {
      if (this.enableDebugLog) console.log('[Talkable] starting DialogueManager for', npc);
      try { if (!DialogueManager._fire) DialogueManager.setApp(this.app); } catch (e) {}
      DialogueManager.startFor(npc);
    } else {
      if (this.enableDebugLog) console.warn('[Talkable] DialogueManager missing startFor/setApp');
    }
  } catch (e) { if (this.enableDebugLog) console.warn('[Talkable] startFor failed:', e); }

  // 对话结束自动退出
  if (this.autoExit) {
    var self = this;
    this._onDialogueStopped = function () {
      if (self.enableDebugLog) console.log('[Talkable] dialogue:stopped -> exit');
      try { self.app.fire('ui:dialogue:end', { npc: npc, entity: self.entity }); } catch (e) {}
      
      // 先解锁玩家行动，再设置相机状态
      try { 
        self.app.fire('player:unlock_action'); 
        if (self.enableDebugLog) console.log('[Talkable] player:unlock_action sent');
      } catch (e) {}
      
      try { self.app.fire('ui:control:set', 'FREE_FOLLOW'); } catch (e) {}
    };
    this.app.once('dialogue:stopped', this._onDialogueStopped, this);
    if (this.enableDebugLog) console.log('[Talkable] once(dialogue:stopped) registered');
  }
};
