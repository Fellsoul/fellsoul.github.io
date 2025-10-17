/* global pc */

/**
 * GlobalCameraManager.js
 * 全局相机/机位/视角状态管理（单例）
 * - 接管：机位稳切、A/D 左右切机位、S 键从主菜单进第三人称、对话夹角限制
 * - 兼容 UIManager 之前的事件：ui:control_state_changed, camera:transition:start, ui:camera:active
 * - 与 CameraTransition / FollowCamera 解耦，自动查找并带重试
 */
var GlobalCameraManager = pc.createScript('globalCameraManager');

// ---------- 属性 ----------
GlobalCameraManager.attributes.add('camera', { type: 'entity', title: '摄像机实体（含 CameraTransition/FollowCamera）' });
GlobalCameraManager.attributes.add('playerEntity', { type: 'entity', title: '玩家实体(锁定/解锁动作事件)' });

GlobalCameraManager.attributes.add('mainMenuGroupName', { type: 'string', default: 'mainMenu', title: '主菜单机位组名' });
GlobalCameraManager.attributes.add('mainMenuMainPos',   { type: 'string', default: 'main',     title: '主菜单默认子机位名' });

GlobalCameraManager.attributes.add('fixedGroupName', { type: 'string', default: 'fixed', title: '固定机位组名' });
GlobalCameraManager.attributes.add('fixedSubPos',    { type: 'string', default: 'main',  title: '固定机位子名' });

GlobalCameraManager.attributes.add('dialogueYawRange',   { type: 'number', default: 50, title: '对话-左右夹角(°)' });
GlobalCameraManager.attributes.add('dialoguePitchRange', { type: 'number', default: 50, title: '对话-上下夹角(°)' });

GlobalCameraManager.attributes.add('enableDebugLog', { type: 'boolean', default: true, title: '调试日志' });

// ---------- 常量（与 UIManager 兼容） ----------
GlobalCameraManager.CONTROL_STATES = {
    LOCKED_MULTI: 'locked_multi',   // 玩家锁定 + 多机位（如主菜单）
    FREE_FIXED:   'free_fixed',     // 玩家可移动 + 固定机位
    FREE_FOLLOW:  'free_follow',    // 玩家可移动 + 第三人称追踪
    LOCKED_FIXED: 'locked_fixed',   // 玩家锁定 + 固定机位
    DIALOGUE:     'dialogue'        // 玩家锁定 + 相机夹角限制（对话）
};

// ---------- 单例 ----------
GlobalCameraManager._instance = null;
GlobalCameraManager.getInstance = function () { return GlobalCameraManager._instance; };

// ---------- 生命周期 ----------
GlobalCameraManager.prototype.initialize = function () {
    if (GlobalCameraManager._instance) {
        console.warn('[GlobalCameraManager] Duplicate instance.');
        return;
    }
    GlobalCameraManager._instance = this;

    this._state = GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI;
    this._controlRetry = null;

    // S 键防误触：任意一次 camera:transition:start 后 1400ms 内屏蔽
    this._sKeyBlockedUntil = 0;
    this._onCamTransStart = function (positionName, config) {
        this._sKeyBlockedUntil = Date.now() + 1400;
        if (this.enableDebugLog) console.log('[GCam] S-key blocked 1400ms due to camera:transition:start ->', positionName, config);
    };
    this.app.on('camera:transition:start', this._onCamTransStart, this);

    // 绑定菜单热键（A/D/S）——仅在 LOCKED_MULTI 生效
    this._bindMenuHotkeys();

    // 监听外部请求：设置控制态
    this.app.on('ui:control:set', function (state) {
        var ST = GlobalCameraManager.CONTROL_STATES;
        var v = state;
        if (typeof v === 'string') v = ST[v] || v;
        if (!v) v = ST.LOCKED_MULTI;
        try { this.setState(v); } catch (e) { if (this.enableDebugLog) console.warn('[GCam] setState failed:', e); }
    }, this);

    // 默认切到多机位 & 稳进主菜单（通常由 UIManager 首进完成后调用；这里不强制）
    // this.setState(this._state);
};

// ---------- 公共 API ----------
GlobalCameraManager.prototype.getState = function () { return this._state; };

GlobalCameraManager.prototype.setState = function (state) {
    if (!state || this._state === state) return;
    var from = this._state;
    this._state = state;
    if (this.enableDebugLog) console.log('[GCam] setState:', from, '->', state);
    try { this._applyState(state); } catch (e) { if (this.enableDebugLog) console.warn('[GCam] apply state failed:', e); }
    this.app.fire('ui:control_state_changed', { from: from, to: state });
};

GlobalCameraManager.prototype.snapToMainMenu = function () {
    var self = this, group = this.mainMenuGroupName || 'mainMenu', sub = this.mainMenuMainPos || 'main';
    this._withCameraTransition(function (trans) {
        var ok = false;
        try { if (trans.snapToPosition) ok = trans.snapToPosition(group, sub); } catch (e) {}
        if (!ok) {
            try { if (trans.setCurrentPositionGroup) trans.setCurrentPositionGroup(group, sub); } catch (e) {}
            try { if (trans.transitionToPosition) ok = trans.transitionToPosition(group, sub); } catch (e) {}
        }
        // 主动广播，让 UI 按钮/提示立刻切换
        try { self.app.fire('camera:transition:start', group, { name: sub }); } catch (e) {}
        try { self.app.fire('ui:camera:active', { position: group, name: sub }); } catch (e) {}
        if (self.enableDebugLog) console.log('[GCam] snap main menu ->', group, '/', sub, 'ok=', !!ok);
    }, { retries: 30, delayMs: 150 });
};

// A/D 切换子机位（仅主菜单组）
GlobalCameraManager.prototype.stepMenuCamera = function (dir /* 'left'|'right' */) {
    var self = this, group = this.mainMenuGroupName || 'mainMenu';
    this._withCameraTransition(function (trans) {
        var grp = trans._cameraPositions && trans._cameraPositions[group];
        var list = grp && grp.positions || [];
        if (!list.length) { if (self.enableDebugLog) console.warn('[GCam] no positions in group', group); return; }

        var idx = (trans._currentPositionGroup === group) ? (trans._currentPositionIndex|0) : 0;
        var next = idx;
        if (dir === 'left')  next = (idx - 1 + list.length) % list.length;
        if (dir === 'right') next = (idx + 1) % list.length;
        var sub = list[next] && (list[next].name || null);
        if (!sub) return;

        var ok = false;
        try { if (trans.transitionToPosition) ok = trans.transitionToPosition(group, sub); } catch (e) {}
        if (!ok) try { if (trans.snapToPosition) ok = trans.snapToPosition(group, sub); } catch (e) {}

        try { if (trans.setCurrentPositionGroup) trans.setCurrentPositionGroup(group, sub); } catch (e) {}

        try { self.app.fire('camera:transition:start', group, { name: sub }); } catch (e) {}
        try { self.app.fire('ui:camera:active', { position: group, name: sub }); } catch (e) {}

        if (self.enableDebugLog) console.log('[GCam] step menu cam:', dir, '->', group, '/', sub, 'ok=', !!ok);
    });
};

GlobalCameraManager.prototype.isAtCamPosition = function (groupName, subPosName) {
    var trans = this._getCameraTransition(); if (!trans) return false;
    if (trans._currentPositionGroup !== groupName) return false;
    try {
        var grp = trans._cameraPositions && trans._cameraPositions[groupName];
        if (!grp || !grp.positions || !grp.positions.length) return false;
        var idx = trans._currentPositionIndex|0; idx = Math.max(0, Math.min(idx, grp.positions.length - 1));
        var cur = grp.positions[idx];
        return !!(cur && cur.name === subPosName);
    } catch (e) { return false; }
};

// ---------- 内部实现 ----------
GlobalCameraManager.prototype._applyState = function (state) {
    var player = this._getPlayer();
    var follow = this._getFollowCamera();
    var trans  = this._getCameraTransition();

    // CameraTransition 可能滞后：重试最多10次
    if (!trans) {
        if (!this._controlRetry) this._controlRetry = { tries: 0, state: state };
        if (this._controlRetry.tries < 10) {
            var self = this; var t = ++this._controlRetry.tries;
            if (this.enableDebugLog) console.warn('[GCam] cameraTransition not ready, retry', t);
            setTimeout(function () { self._applyState(self._state); }, 120);
            return;
        } else {
            if (this.enableDebugLog) console.warn('[GCam] cameraTransition not found after retries');
        }
    } else {
        this._controlRetry = null;
    }

    // 玩家锁/解锁
    var lockPlayer = function (flag, app) { try { app.fire('player:set_sitting', !!flag); } catch (e) {} };

    switch (state) {
        case GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI:
            lockPlayer(true, this.app);
            if (follow && follow.disable) follow.disable();
            if (trans) {
                // 等待 CameraTransition 就绪后再设置机位
                var self = this;
                var applyMainMenuPosition = function() {
                    try { trans.snapToPosition(self.mainMenuGroupName, self.mainMenuMainPos); } catch (e) {}
                    try { trans.setCurrentPositionGroup(self.mainMenuGroupName, self.mainMenuMainPos); } catch (e) {}
                    // 触发事件通知 UI 显示多机位按钮
                    try { self.app.fire('ui:camera:active', { position: self.mainMenuGroupName, name: self.mainMenuMainPos }); } catch (e) {}
                    try { self.app.fire('camera:transition:start', self.mainMenuGroupName, { name: self.mainMenuMainPos }); } catch (e) {}
                };
                
                // 如果 CameraTransition 已经就绪，立即执行
                if (trans._ready) {
                    applyMainMenuPosition();
                } else {
                    // 否则等待就绪事件
                    var onPositionsReady = function() {
                        applyMainMenuPosition();
                        self.app.off('camera:positions:ready', onPositionsReady);
                    };
                    self.app.once('camera:positions:ready', onPositionsReady);
                }
            } else {
                // 没有 CameraTransition 时的备用逻辑
                try { this.app.fire('ui:camera:active', { position: this.mainMenuGroupName, name: this.mainMenuMainPos }); } catch (e) {}
                try { this.app.fire('camera:transition:start', this.mainMenuGroupName, { name: this.mainMenuMainPos }); } catch (e) {}
            }
            break;

        case GlobalCameraManager.CONTROL_STATES.FREE_FIXED:
            lockPlayer(false, this.app);
            if (follow && follow.disable) follow.disable();
            if (trans) {
                try { trans.snapToPosition(this.fixedGroupName, this.fixedSubPos); } catch (e) {}
                try { trans.setCurrentPositionGroup(this.fixedGroupName, this.fixedSubPos); } catch (e) {}
            }
            break;

        case GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW:
            lockPlayer(false, this.app);
            if (follow) {
                try { if (!follow.targetEntity && player) follow.targetEntity = player; } catch (e) {}
                if (follow.enable) follow.enable();
            }
            if (trans) {
                try { if (typeof trans.setCurrentPositionGroup === 'function') trans.setCurrentPositionGroup(null, null); } catch (e) {}
                try { trans._currentPositionGroup = null; } catch (e) {}
                try { trans._currentPositionIndex = -1; } catch (e) {}
            }
            // 广播：无激活机位 & 强制让机位按钮隐藏
            try { this.app.fire('ui:camera:active', { position: null, name: null }); } catch (e) {}
            try { this.app.fire('camera:transition:start', 'freeFollow', { name: '' }); } catch (e) {}
            break;

        case GlobalCameraManager.CONTROL_STATES.LOCKED_FIXED:
            lockPlayer(true, this.app);
            if (follow && follow.disable) follow.disable();
            if (trans) {
                try { trans.snapToPosition(this.fixedGroupName, this.fixedSubPos); } catch (e) {}
                try { trans.setCurrentPositionGroup(this.fixedGroupName, this.fixedSubPos); } catch (e) {}
            }
            break;

        case GlobalCameraManager.CONTROL_STATES.DIALOGUE:
            try { this.app.fire('player:lock_action'); } catch (e) {}
            if (follow && follow.disable) follow.disable();
            if (trans) {
                try { if (typeof trans.setCurrentPositionGroup === 'function') trans.setCurrentPositionGroup(null, null); } catch (e) {}
                try { trans._currentPositionGroup = null; } catch (e) {}
                try { trans._currentPositionIndex = -1; } catch (e) {}
            }
            this._applyDialogueClamp(true);
            break;
    }
};

GlobalCameraManager.prototype._bindMenuHotkeys = function () {
    var self = this;
    if (this._menuHotkeysBound) return;
    this._menuHotkeysBound = true;

    this._onKeyDown = function (e) {
        if (self._state !== GlobalCameraManager.CONTROL_STATES.LOCKED_MULTI) return;

        // A/D/W 键由 CameraTransition 处理，Manager 只处理 S 键切换到第三人称
        // if (e.key === pc.KEY_A || e.key === pc.KEY_LEFT)  self.stepMenuCamera('left');
        // if (e.key === pc.KEY_D || e.key === pc.KEY_RIGHT) self.stepMenuCamera('right');

        // 在主菜单“main”机位按 S：切第三人称；尊重防抖窗口
        if (e.key === pc.KEY_S) {
            if (Date.now() < (self._sKeyBlockedUntil || 0)) {
                if (self.enableDebugLog) console.log('[GCam] KEY_S ignored (blocked window)');
                return;
            }
            // 检查是否在播放 prologue，如果是则禁用 S 键切换
            var isPlayingPrologue = false;
            try {
                if (typeof UIManager !== 'undefined') {
                    var uiManager = UIManager.getInstance();
                    if (uiManager && uiManager.currentState) {
                        isPlayingPrologue = (uiManager.currentState === UIManager.UI_STATES.FIRST_TIME_INTRO || 
                                           uiManager.currentState === UIManager.UI_STATES.TYPEWRITER);
                    }
                }
            } catch (e) {}
            
            if (isPlayingPrologue) {
                if (self.enableDebugLog) console.log('[GCam] KEY_S ignored (prologue playing)');
                return;
            }
            
            if (self.isAtCamPosition(self.mainMenuGroupName, self.mainMenuMainPos)) {
                self.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
                if (self.enableDebugLog) console.log('[GCam] FREE_FOLLOW by S at main menu');
            }
        }
    };
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
};

// ---- 对话夹角 ----
GlobalCameraManager.prototype._applyDialogueClamp = function (enable) {
    var follow = this._getFollowCamera();
    if (enable) {
        var ang = this._getPlayerYawPitch();
        var yawRange = Math.max(0, this.dialogueYawRange|0) || 50;
        var pitchRange = Math.max(0, this.dialoguePitchRange|0) || 50;

        try { this.app.fire('camera:clamp:set', { centerYaw: ang.yaw, centerPitch: ang.pitch, yawRange: yawRange, pitchRange: pitchRange }); } catch (e) {}
        try {
            if (follow) {
                if (typeof follow.setClamp === 'function') follow.setClamp(ang.yaw, yawRange, ang.pitch, pitchRange);
                if (typeof follow.setYawClamp === 'function') follow.setYawClamp(ang.yaw - yawRange, ang.yaw + yawRange);
                if (typeof follow.setPitchClamp === 'function') follow.setPitchClamp(ang.pitch - pitchRange, ang.pitch + pitchRange);
                if (typeof follow.enableClamp === 'function') follow.enableClamp(true);
                if (typeof follow.clampEnabled !== 'undefined') follow.clampEnabled = true;
                if (typeof follow.centerYaw !== 'undefined') follow.centerYaw = ang.yaw;
                if (typeof follow.centerPitch !== 'undefined') follow.centerPitch = ang.pitch;
                if (typeof follow.yawRange !== 'undefined') follow.yawRange = yawRange;
                if (typeof follow.pitchRange !== 'undefined') follow.pitchRange = pitchRange;
            }
        } catch (e) { if (this.enableDebugLog) console.warn('[GCam] apply dialogue clamp failed:', e); }
        if (this.enableDebugLog) console.log('[GCam] Dialogue clamp set:', ang, 'range=', yawRange, pitchRange);
    } else {
        try { this.app.fire('camera:clamp:clear'); } catch (e) {}
        try { if (follow && typeof follow.enableClamp === 'function') follow.enableClamp(false); if (follow && typeof follow.clampEnabled !== 'undefined') follow.clampEnabled = false; } catch (e) {}
        if (this.enableDebugLog) console.log('[GCam] Dialogue clamp cleared');
    }
};

// ---------- 工具：查找/重试 ----------
GlobalCameraManager.prototype._getPlayer = function () {
    if (this.playerEntity) return this.playerEntity;
    try { return this.app.root.findByName('Player'); } catch (e) { return null; }
};

GlobalCameraManager.prototype._getFollowCamera = function () {
    var camEnt = this.camera || null;
    return (camEnt && camEnt.script) ? camEnt.script.followCamera : null;
};

GlobalCameraManager.prototype._getCameraTransition = function () {
    var camEnt = this.camera || null;
    if (camEnt && camEnt.script && camEnt.script.cameraTransition) return camEnt.script.cameraTransition;
    var screenCam = (this.entity && this.entity.screen && this.entity.screen.camera) || null;
    if (screenCam && screenCam.script && screenCam.script.cameraTransition) return screenCam.script.cameraTransition;

    try {
        var byName = this.app.root.findByName && this.app.root.findByName('Camera');
        if (byName && byName.script && byName.script.cameraTransition) return byName.script.cameraTransition;
    } catch (e) {}

    try {
        var stack = [ this.app.root ];
        while (stack.length) {
            var node = stack.pop();
            if (node && node.script && node.script.cameraTransition) return node.script.cameraTransition;
            var ch = node && node.children || [];
            for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
        }
    } catch (e) {}
    return null;
};

GlobalCameraManager.prototype._withCameraTransition = function (fn, options) {
    options = options || {};
    var retries = (options.retries|0) || 20;
    var delayMs = (options.delayMs|0) || 150;
    var self = this;
    (function tryOnce(left){
        var trans = self._getCameraTransition();
        if (trans) { try { fn(trans); } catch(e) { if (self.enableDebugLog) console.warn('[GCam] withCameraTransition fn error:', e); } return; }
        if (left <= 0) { if (self.enableDebugLog) console.warn('[GCam] CameraTransition not found after retries'); return; }
        setTimeout(function(){ tryOnce(left - 1); }, delayMs);
    })(retries);
};

GlobalCameraManager.prototype._getPlayerYawPitch = function () {
    var player = this._getPlayer();
    var yaw = 0, pitch = 0;
    try {
        if (player && player.getEulerAngles) {
            var e = player.getEulerAngles();
            yaw = e.y || 0;
            pitch = e.x || 0;
        }
    } catch (e) {}
    return { yaw: yaw, pitch: pitch };
};

GlobalCameraManager.prototype.destroy = function () {
    if (GlobalCameraManager._instance === this) GlobalCameraManager._instance = null;
    if (this._onCamTransStart) this.app.off('camera:transition:start', this._onCamTransStart, this);
    if (this._onKeyDown) this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
};
