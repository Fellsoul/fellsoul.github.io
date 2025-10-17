/* global pc */

/**
 * @file npc-dialogue-example.js
 * @desc SmartTrigger 使用示例：NPC 对话交互
 * @使用方法
 *   1. NPC 实体挂载 smart-trigger.js 脚本：
 *      - useDistance = true
 *      - distance = 3
 *      - ignoreY = true
 *      - targetTag = 'player'
 *      - enterEvent = 'npc:nearby'
 *      - leaveEvent = 'npc:far'
 *   2. NPC 实体挂载本脚本
 *   3. 玩家靠近时显示"按 E 对话"提示，按 E 触发对话
 */

var NpcDialogueExample = pc.createScript('npcDialogueExample');

/* ---------- 属性 ---------- */
NpcDialogueExample.attributes.add('npcName', { 
    type: 'string', 
    default: '神秘旅者',
    title: 'NPC 名称'
});

NpcDialogueExample.attributes.add('dialogueLines', { 
    type: 'string', 
    array: true,
    default: [
        '你好，旅者。',
        '这片土地充满了回声...',
        '继续前进，你会找到答案的。'
    ],
    title: '对话内容',
    description: '依次显示的对话文本'
});

NpcDialogueExample.attributes.add('interactKey', { 
    type: 'string', 
    default: 'e',
    title: '交互按键',
    description: '触发对话的按键（小写）'
});

NpcDialogueExample.attributes.add('uiHintEntity', { 
    type: 'entity', 
    title: 'UI 提示实体',
    description: '显示"按 E 对话"的 UI 元素'
});

NpcDialogueExample.attributes.add('uiDialogueEntity', { 
    type: 'entity', 
    title: 'UI 对话框实体',
    description: '显示对话内容的 UI 元素'
});

NpcDialogueExample.attributes.add('debugLog', { 
    type: 'boolean', 
    default: true, 
    title: '调试日志'
});

/* ---------- 生命周期 ---------- */
NpcDialogueExample.prototype.initialize = function () {
    this._isPlayerNearby = false;
    this._isDialogueActive = false;
    this._currentLineIndex = 0;

    // 监听 NPC 触发事件（使用实体局部事件）
    this.entity.on('npc:nearby', this.onPlayerNearby, this);
    this.entity.on('npc:far', this.onPlayerFar, this);

    // 绑定键盘输入
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this.onKeyDown, this);

    // 隐藏 UI
    this.hideHint();
    this.hideDialogue();

    if (this.debugLog) {
        console.log('[NpcDialogueExample] 初始化 NPC:', this.npcName);
    }
};

NpcDialogueExample.prototype.destroy = function () {
    // 解绑事件
    this.entity.off('npc:nearby', this.onPlayerNearby, this);
    this.entity.off('npc:far', this.onPlayerFar, this);
    this.app.keyboard.off(pc.EVENT_KEYDOWN, this.onKeyDown, this);
};

/* ---------- 触发器事件 ---------- */
NpcDialogueExample.prototype.onPlayerNearby = function (player) {
    this._isPlayerNearby = true;

    if (!this._isDialogueActive) {
        this.showHint();
    }

    if (this.debugLog) {
        console.log('[NpcDialogueExample] 玩家靠近 NPC:', this.npcName);
    }
};

NpcDialogueExample.prototype.onPlayerFar = function (player) {
    this._isPlayerNearby = false;

    this.hideHint();

    // 如果对话进行中，也关闭对话
    if (this._isDialogueActive) {
        this.endDialogue();
    }

    if (this.debugLog) {
        console.log('[NpcDialogueExample] 玩家远离 NPC:', this.npcName);
    }
};

/* ---------- 输入处理 ---------- */
NpcDialogueExample.prototype.onKeyDown = function (event) {
    var key = String.fromCharCode(event.key).toLowerCase();

    // 按交互键
    if (key === this.interactKey) {
        if (this._isPlayerNearby && !this._isDialogueActive) {
            // 开始对话
            this.startDialogue();
        } else if (this._isDialogueActive) {
            // 推进对话
            this.nextDialogueLine();
        }
    }
};

/* ---------- 对话逻辑 ---------- */
NpcDialogueExample.prototype.startDialogue = function () {
    this._isDialogueActive = true;
    this._currentLineIndex = 0;

    this.hideHint();
    this.showDialogue(this.dialogueLines[0]);

    if (this.debugLog) {
        console.log('[NpcDialogueExample] 开始对话:', this.npcName);
    }

    // 可选：暂停玩家控制
    // PlayerController.pause();
};

NpcDialogueExample.prototype.nextDialogueLine = function () {
    this._currentLineIndex++;

    if (this._currentLineIndex < this.dialogueLines.length) {
        // 显示下一行
        this.showDialogue(this.dialogueLines[this._currentLineIndex]);
    } else {
        // 对话结束
        this.endDialogue();
    }
};

NpcDialogueExample.prototype.endDialogue = function () {
    this._isDialogueActive = false;
    this._currentLineIndex = 0;

    this.hideDialogue();

    // 如果玩家仍在附近，重新显示提示
    if (this._isPlayerNearby) {
        this.showHint();
    }

    if (this.debugLog) {
        console.log('[NpcDialogueExample] 对话结束:', this.npcName);
    }

    // 可选：恢复玩家控制
    // PlayerController.resume();
};

/* ---------- UI 控制 ---------- */
NpcDialogueExample.prototype.showHint = function () {
    if (!this.uiHintEntity) return;

    var textElement = this.uiHintEntity.findByName('HintText');
    if (textElement && textElement.element) {
        textElement.element.text = '按 ' + this.interactKey.toUpperCase() + ' 对话';
    }

    this.uiHintEntity.enabled = true;
};

NpcDialogueExample.prototype.hideHint = function () {
    if (this.uiHintEntity) {
        this.uiHintEntity.enabled = false;
    }
};

NpcDialogueExample.prototype.showDialogue = function (text) {
    if (!this.uiDialogueEntity) return;

    // 设置 NPC 名称
    var nameElement = this.uiDialogueEntity.findByName('NpcName');
    if (nameElement && nameElement.element) {
        nameElement.element.text = this.npcName;
    }

    // 设置对话文本
    var textElement = this.uiDialogueEntity.findByName('DialogueText');
    if (textElement && textElement.element) {
        textElement.element.text = text;
    }

    // 显示进度提示
    var hintElement = this.uiDialogueEntity.findByName('ContinueHint');
    if (hintElement && hintElement.element) {
        var isLastLine = this._currentLineIndex >= this.dialogueLines.length - 1;
        hintElement.element.text = isLastLine 
            ? '按 ' + this.interactKey.toUpperCase() + ' 结束' 
            : '按 ' + this.interactKey.toUpperCase() + ' 继续';
    }

    this.uiDialogueEntity.enabled = true;
};

NpcDialogueExample.prototype.hideDialogue = function () {
    if (this.uiDialogueEntity) {
        this.uiDialogueEntity.enabled = false;
    }
};

/* ---------- 公共 API ---------- */

/**
 * 动态更新对话内容
 */
NpcDialogueExample.prototype.setDialogue = function (lines) {
    this.dialogueLines = lines;
    if (this.debugLog) {
        console.log('[NpcDialogueExample] 更新对话内容:', lines);
    }
};

/**
 * 检查对话是否进行中
 */
NpcDialogueExample.prototype.isDialogueActive = function () {
    return this._isDialogueActive;
};
