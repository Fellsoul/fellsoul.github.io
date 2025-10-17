/* global pc, DialogueUI, PlayerManager, GlobalGame */

/**
 * @file npc-name-debug.js
 * @desc NPC名字调试工具脚本
 */

var NpcNameDebug = pc.createScript('npcNameDebug');

NpcNameDebug.attributes.add('enableDebug', {
  type: 'boolean',
  default: true,
  title: '启用调试'
});

NpcNameDebug.prototype.initialize = function() {
  if (!this.enableDebug) return;
  
  var self = this;
  
  // 添加全局调试方法
  if (typeof window !== 'undefined') {
    window.debugNpcNames = function() {
      console.log('=== NPC Name Debug Info ===');
      
      // 检查PlayerManager
      var pm = null;
      if (typeof PlayerManager !== 'undefined') {
        pm = PlayerManager.get ? PlayerManager.get() : PlayerManager._instance;
      }
      
      console.log('PlayerManager available:', !!pm);
      
      if (pm) {
        console.log('PlayerManager methods:', {
          learnNpcName: typeof pm.learnNpcName,
          getNpcName: typeof pm.getNpcName,
          isNpcKnown: typeof pm.isNpcKnown
        });
        
        // 检查已知NPC
        if (pm._data && pm._data.knownNpcs) {
          console.log('Known NPCs:', pm._data.knownNpcs);
        }
      }
      
      // 检查DialogueUI
      if (typeof DialogueUI !== 'undefined') {
        console.log('DialogueUI available:', true);
        if (DialogueUI.debugNpcNameStatus) {
          DialogueUI.debugNpcNameStatus();
        }
      } else {
        console.log('DialogueUI available:', false);
      }
      
      console.log('=== End Debug Info ===');
    };
    
    window.testLearnNpcName = function(npcId, name) {
      npcId = npcId || 'queen_elera';
      name = name || '艾拉女王';
      
      console.log('Testing learn NPC name:', npcId, '->', name);
      
      var pm = null;
      if (typeof PlayerManager !== 'undefined') {
        pm = PlayerManager.get ? PlayerManager.get() : PlayerManager._instance;
      }
      
      if (pm && pm.learnNpcName) {
        var result = pm.learnNpcName(npcId, name);
        console.log('Learn result:', result);
        
        // 检查是否成功学习
        setTimeout(function() {
          var isKnown = pm.isNpcKnown(npcId);
          var retrievedName = pm.getNpcName(npcId);
          console.log('After learning - isKnown:', isKnown, 'name:', retrievedName);
        }, 100);
      } else {
        console.warn('PlayerManager or learnNpcName method not available');
      }
    };
    
    console.log('[NpcNameDebug] Debug methods added:');
    console.log('- debugNpcNames(): 显示NPC名字系统状态');
    console.log('- testLearnNpcName(npcId, name): 测试学习NPC名字');
  }
  
  // 监听NPC名字学习事件
  this.app.on('player:npc:learned', function(data) {
    console.log('[NpcNameDebug] NPC name learned event:', data);
  });
  
  console.log('[NpcNameDebug] Initialized');
};

NpcNameDebug.prototype.destroy = function() {
  // 清理全局方法
  if (typeof window !== 'undefined') {
    delete window.debugNpcNames;
    delete window.testLearnNpcName;
  }
};
