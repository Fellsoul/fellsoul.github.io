/* global pc, I18n, GlobalAudioSceneConfig */

// ============================================================================
// GlobalGame.js
// A static, global Game Manager (no pc.Script instance required)
// Usage:
//   GlobalGame.init(app, { defaultState: 'main_menu', debug: true });
//   GlobalGame.changeState(GlobalGame.STATES.FREE_WORLD);
// ============================================================================

(function (global) {
  'use strict';

  // ---------- device helpers ----------
  function detectDevice() {
    var ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    var touch = (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
    var mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (touch && screen && Math.min(screen.width, screen.height) <= 820);
    return {
      isMobile: !!mobile,
      isDesktop: !mobile,
      userAgent: ua
    };
  }

  // ---------- tiny utils ----------
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- Global singleton (not a PlayCanvas component) ----------
  var GlobalGame = {
    // ---- public constants ----
    STATES: {
      LOADING: 'loading',
      MAIN_MENU: 'main_menu',
      LEVEL_SELECT: 'level_select',
      LEVEL: 'level',
      FREE_WORLD: 'free_world',
      PAUSED: 'paused',
      GAME_OVER: 'game_over',
      SETTINGS: 'settings',
      START: 'start',
      LEVEL1: 'level1',
      LEVEL2: 'level2',
      LEVEL3: 'level3',
      LEVEL4: 'level4',
      IN_ROOM_QUIET: 'inRoomQuiet',
      IN_ROOM_ECHOING: 'InRoomEchoing',
      VILLAGE: 'village',
      NYMPH_QUEEN: 'nymphQueen'
    },

    app: null,
    device: detectDevice(),
    debug: false,
    defaultState: 'main_menu',
    _currentLocale: null,

    _current: null,
    _previous: null,
    _stateStart: 0,
    _transitioning: false,
    
    // ---- 当前场景跟踪 ----
    _currentScene: null,  // 当前加载的场景名称

    _cb: { enter: {}, exit: {}, update: {} },
    _unsub: [],   // to cleanup listeners
    
    // ---- prologue 记录 ----
    _prologueVisited: {},  // { 'welcome': true, 'intro': true, ... }
    
    // ---- 玩家设置 ----
    _playerSettings: {},  // { 'masterVolume': 80, 'language': 'zh-CN', ... }
    
    // ---- 存档点 ----
    _checkpointPosition: null,  // 当前存档点位置 (pc.Vec3)
    _prologuePlayHistory: {},   // prologue 播放历史 { 'prologueKey': { timestamp: number, scene: string, checkpointId?: string } }
    _sceneCheckpoints: {},      // 场景专属存档点 { sceneName: pc.Vec3 }
    
    // ---- 当前场景变量 ----
    currentScene: null,

    // ---- init / destroy ----
    init(app, opts) {
      if (this.app) return; // already initialized
      this.app = app;
      opts = opts || {};
      this.debug = !!(opts.debug ?? true);
      this.defaultState = opts.defaultState || this.defaultState;

      if (this.debug) {
        console.log('[GlobalGame] init; device:',
          this.device.isMobile ? 'mobile' : 'desktop',
          this.device.userAgent);
      }

      // Lock player on boot (avoid movement during loading/state switches)
      try { 
        this.app.fire('player:set_sitting', true); 
        // 同时设置相机为锁定多机位状态
        this.app.fire('ui:control:set', 'LOCKED_MULTI');
        if (this.debug) console.log('[GlobalGame] Set player sitting and camera locked on boot');
      } catch (e) {}

      // default handlers
      this._registerDefaultHandlers();

      // 先加载玩家设置
      this._loadPlayerSettings();
      
      // 语言设置：每次启动都根据浏览器检测（不持久化）
      var browserLang = (typeof navigator !== 'undefined') ? (navigator.language || (navigator.languages && navigator.languages[0])) : null;
      var locale = this._detectLocale();
      this._currentLocale = locale;
      
      if (this.debug) {
        console.log('[GlobalGame] ===== Language Detection (Session Only) =====');
        console.log('[GlobalGame] Browser language:', browserLang);
        console.log('[GlobalGame] Detected locale:', locale);
        console.log('[GlobalGame] Note: Language is not persisted, resets on page refresh');
        console.log('[GlobalGame] ===================================================');
      }
      
      // 加载 prologue 访问记录
      this._loadPrologueVisited();
      
      // 加载 prologue 播放历史
      this._loadProloguePlayHistory();

      // I18n loading path
      if (typeof I18n !== 'undefined' && I18n.init) {
        I18n.init(this.app);
        var fallback = (locale === 'zh-CN') ? 'en-US' : 'zh-CN';
        this.changeState(this.STATES.LOADING);
        this._loadPrologueForLocale(locale, fallback);
      } else {
        this.changeState(this.defaultState);
      }

      this._setupGlobalEvents();
      
      // 设置场景加载监听
      this._setupSceneEvents();
      
      // 移动端：尝试进入全屏模式（隐藏地址栏）
      this._setupMobileFullscreen();
      
      // 初始化全局音频系统
      this._initializeAudioSystem();
    },
    
    // 初始化全局音频系统
    _initializeAudioSystem() {
      var self = this;
      
      // 检查GlobalAudioSceneConfig是否已加载
      if (typeof GlobalAudioSceneConfig === 'undefined') {
        console.error('[GlobalGame] GlobalAudioSceneConfig未定义');
        console.error('[GlobalGame] 请确保以下脚本已加载：');
        console.error('[GlobalGame]   - audio-settings-global.js');
        console.error('[GlobalGame]   - audio-bgm-global.js');
        console.error('[GlobalGame]   - audio-sfx-global.js');
        console.error('[GlobalGame]   - audio-scene-config-global.js');
        return;
      }
      
      // 获取audio-config.json资源
      var audioConfigAsset = this.app.assets.find('audio-config.json', 'json');
      
      if (!audioConfigAsset) {
        console.warn('[GlobalGame] 未找到audio-config.json，音频系统将使用空配置');
      }
      
      try {
        // 一次性初始化所有音频模块
        GlobalAudioSceneConfig.initialize(this.app, {
          configAsset: audioConfigAsset,
          poolSize2D: 8,
          poolSize3D: 16,
          storageKey: 'game.audio.v1',
          enableDebugLog: this.debug
        });
        
        if (this.debug) {
          console.log('[GlobalGame] ========================================');
          console.log('[GlobalGame] ✓ 全局音频系统初始化完成');
          console.log('[GlobalGame] ========================================');
        }
      } catch (e) {
        console.error('[GlobalGame] 音频系统初始化失败:', e);
      }
    },
    
    // 移动端全屏设置
    _setupMobileFullscreen() {
      if (!this.device.isMobile) return;
      
      var self = this;
      var canvas = this.app.graphicsDevice.canvas;
      
      // 强制横屏锁定（Landscape Orientation Lock）
      var lockLandscape = function() {
        try {
          // 使用 Screen Orientation API 锁定横屏
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').then(function() {
              if (self.debug) console.log('[GlobalGame] 屏幕已锁定为横屏模式');
            }).catch(function(e) {
              if (self.debug) console.warn('[GlobalGame] 横屏锁定失败:', e.message);
            });
          } 
          // 降级方案：使用旧版 API
          else if (screen.lockOrientation) {
            if (screen.lockOrientation('landscape') || screen.lockOrientation('landscape-primary')) {
              if (self.debug) console.log('[GlobalGame] 屏幕已锁定为横屏模式（旧版API）');
            }
          }
          // 兼容 webkit/moz 前缀
          else if (screen.webkitLockOrientation) {
            screen.webkitLockOrientation('landscape');
            if (self.debug) console.log('[GlobalGame] 屏幕已锁定为横屏模式（webkit）');
          } else if (screen.mozLockOrientation) {
            screen.mozLockOrientation('landscape');
            if (self.debug) console.log('[GlobalGame] 屏幕已锁定为横屏模式（moz）');
          } else {
            if (self.debug) console.log('[GlobalGame] 浏览器不支持屏幕方向锁定，使用 CSS 提示');
          }
        } catch (e) {
          if (self.debug) console.warn('[GlobalGame] 横屏锁定异常:', e);
        }
      };
      
      // 方法1: 监听首次用户交互，请求全屏
      var requestFullscreen = function() {
        try {
          if (canvas.requestFullscreen) {
            canvas.requestFullscreen();
          } else if (canvas.webkitRequestFullscreen) {
            canvas.webkitRequestFullscreen();
          } else if (canvas.mozRequestFullScreen) {
            canvas.mozRequestFullScreen();
          } else if (canvas.msRequestFullscreen) {
            canvas.msRequestFullscreen();
          }
          if (self.debug) console.log('[GlobalGame] Fullscreen requested');
          
          // 全屏成功后尝试锁定横屏
          setTimeout(lockLandscape, 200);
        } catch (e) {
          if (self.debug) console.warn('[GlobalGame] Fullscreen failed:', e);
        }
      };
      
      // 方法2: 设置 viewport meta 标签（如果不存在）
      if (!document.querySelector('meta[name="viewport"]')) {
        var meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        document.head.appendChild(meta);
      }
      
      // 方法3: 设置 body 样式，防止滚动
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      
      // 方法4: 监听首次触摸，请求全屏（延迟到 touchend 确保用户手势完成）
      var onFirstTouch = function(e) {
        // 延迟到下一帧，确保在用户手势上下文中
        setTimeout(function() {
          requestFullscreen();
        }, 100);
      };
      document.addEventListener('touchend', onFirstTouch, { once: true, passive: true });
      
      // 方法5: 尝试在页面加载时立即锁定横屏（某些浏览器允许非全屏状态下锁定）
      setTimeout(function() {
        lockLandscape();
      }, 500);
      
      // 方法6: 监听方向变化，提示用户旋转
      if (window.matchMedia) {
        var portraitMedia = window.matchMedia('(orientation: portrait)');
        var handleOrientationChange = function(e) {
          if (e.matches) {
            // 当前是竖屏，显示旋转提示
            if (self.debug) console.log('[GlobalGame] 检测到竖屏，建议旋转到横屏');
            self.app.fire('mobile:orientation:portrait');
          } else {
            // 当前是横屏
            if (self.debug) console.log('[GlobalGame] 检测到横屏');
            self.app.fire('mobile:orientation:landscape');
          }
        };
        portraitMedia.addListener(handleOrientationChange);
        // 初始检查
        handleOrientationChange(portraitMedia);
      }
      
      if (this.debug) console.log('[GlobalGame] Mobile fullscreen setup complete');
    },
    
    // 设置场景事件监听
    _setupSceneEvents() {
      var self = this;
      
      // 监听应用启动完成
      this.app.on('start', function() {
        console.log('[GlobalGame] ========== App started ==========');
        console.log('[GlobalGame] 开始检测当前场景...');
        
        var currentScene = self._detectCurrentScene();
        
        console.log('[GlobalGame] 场景检测结果:', currentScene);
        
        // 如果检测不到场景，使用默认的"start"场景
        if (!currentScene) {
          console.log('[GlobalGame] 未检测到场景，使用默认场景: start');
          currentScene = 'start';
        }
        
        console.log('[GlobalGame] 最终场景名:', currentScene);
        console.log('[GlobalGame] 准备调用 setCurrentScene...');
        
        // 延迟触发，确保所有脚本（包括AudioSceneConfig）都已初始化
        setTimeout(function() {
          console.log('[GlobalGame] 延迟触发场景音频播放');
          self.setCurrentScene(currentScene, true);
        }, 100);
        
        console.log('[GlobalGame] ==========================================');
      });
      
      if (this.debug) {
        console.log('[GlobalGame] Scene events setup complete');
      }
    },
    
    // 检测当前场景名称
    _detectCurrentScene() {
      try {
        // 方法1: 从URL检测
        if (typeof window !== 'undefined' && window.location) {
          var url = window.location.href;
          var sceneMatch = url.match(/scene[=\/]([^&\/\?]+)/i);
          if (sceneMatch) {
            return sceneMatch[1];
          }
        }
        
        // 方法2: 从PlayCanvas场景名检测
        if (this.app && this.app.scene && this.app.scene.name) {
          return this.app.scene.name;
        }
        
        // 方法3: 从根实体的特定子实体检测
        if (this.app && this.app.root) {
          // 查找特定的场景标识实体
          var sceneMarkers = ['Level1', 'Level2', 'Level3', 'Level4', 'Start', 'Main', 'Village'];
          for (var i = 0; i < sceneMarkers.length; i++) {
            if (this.app.root.findByName(sceneMarkers[i])) {
              return sceneMarkers[i].toLowerCase();
            }
          }
        }
        
        return null;
      } catch (e) {
        if (this.debug) {
          console.warn('[GlobalGame] Failed to detect current scene:', e);
        }
        return null;
      }
    },
    
    destroy() {
      if (!this.app) return;
      // remove listeners
      for (var i = 0; i < this._unsub.length; i++) {
        var u = this._unsub[i];
        try { u.target.off(u.event, u.fn, u.scope); } catch (e) {}
      }
      this._unsub.length = 0;

      this.app = null;
      if (this.debug) console.log('[GlobalGame] destroyed');
    },

    // ---- state API ----
    changeState(newState, data) {
      if (!this.app) return;
      if (this._transitioning) { if (this.debug) console.warn('[GlobalGame] transition in progress'); return; }
      if (!this._isValidState(newState)) { console.error('[GlobalGame] invalid state', newState); return; }
      if (this._current === newState) { if (this.debug) console.log('[GlobalGame] already in', newState); return; }

      this._transitioning = true;
      this._previous = this._current;

      this.app.fire('gamestate:before_change', { from: this._previous, to: newState, data: data });

      if (this._current) this._exit(this._current);
      this._current = newState;
      this._stateStart = nowMs();
      this._enter(newState, data);

      this._transitioning = false;
      this.app.fire('gamestate:changed', { from: this._previous, to: this._current, data: data });
      if (this.debug) console.log('[GlobalGame] state:', this._previous, '->', this._current);
    },

    getCurrentState() { return this._current; },
    getPreviousState() { return this._previous; },
    isInState(s) { return this._current === s; },
    
    // ---- 场景管理 ----
    getCurrentScene() { return this._currentScene; },
    setCurrentScene(sceneName, skipInitialization) {
      console.log('[GlobalGame] ========== setCurrentScene 被调用 ==========');
      console.log('[GlobalGame] 场景名称:', sceneName);
      console.log('[GlobalGame] 跳过初始化:', skipInitialization);
      
      var self = this;
      var oldScene = this._currentScene;
      
      // 如果是切换到不同的场景（不是首次设置），需要清理旧场景的音频
      if (oldScene && oldScene !== sceneName) {
        console.log('[GlobalGame] 检测到场景切换:', oldScene, '→', sceneName);
        console.log('[GlobalGame] 开始清理旧场景音频...');
        
        // 立即停止并销毁所有SFX（环境音、音效等）
        // 无论skipInitialization是什么，都要清理SFX
        this.app.fire('sfx:stopAll');
        console.log('[GlobalGame] 所有SFX已停止');
        
        // 如果不是skipInitialization，还需要淡出BGM
        if (!skipInitialization) {
          console.log('[GlobalGame] 开始淡出BGM...');
          
          // 停止BGM（带淡出效果）
          this.app.fire('bgm:stop', { fadeOut: 0.3 });
          
          // 停止场景音频（会再次调用sfx:stopAll，但没关系，是幂等的）
          this.app.fire('audio:scene:stop');
          
          // 延迟切换场景，等待音频淡出完成
          setTimeout(function() {
            console.log('[GlobalGame] 音频淡出完成，继续场景切换');
            self._continueSceneChange(sceneName, skipInitialization);
          }, 350); // 比淡出时间稍长一点，确保完全淡出
          
          return;
        }
        
        // skipInitialization=true时，立即继续场景切换（已经停止了SFX）
        console.log('[GlobalGame] skipInitialization=true，SFX已清理，立即继续');
      }
      
      // 如果是首次设置场景或skipInitialization，直接切换
      this._continueSceneChange(sceneName, skipInitialization);
    },
    
    // 继续场景切换（音频淡出后）
    _continueSceneChange(sceneName, skipInitialization) {
      console.log('[GlobalGame] ========== 继续场景切换 ==========');
      console.log('[GlobalGame] 场景名称:', sceneName);
      
      this._currentScene = sceneName;
      console.log('[GlobalGame] _currentScene 已设置为:', this._currentScene);
      
      // 播放场景音频（BGM + 环境音）
      console.log('[GlobalGame] 准备播放场景音频...');
      this._playSceneAudio(sceneName);
      
      // 如果skipInitialization为true，只设置场景名称，不执行初始化逻辑
      if (skipInitialization) {
        console.log('[GlobalGame] skipInitialization=true，只设置存档点');
        // 只自动设置存档点，不执行其他初始化
        this._autoSetLatestCheckpoint(sceneName);
        
        // Start场景特殊处理：不改变玩家和相机状态，由UIManager完全控制
        var isStartScene = !sceneName || sceneName.toLowerCase() === 'start' || sceneName.toLowerCase() === 'main';
        if (isStartScene) {
          console.log('[GlobalGame] Start场景 - 玩家和相机状态由UIManager控制，不在此改变');
        }
        
        console.log('[GlobalGame] ================================================');
        return;
      }
      
      console.log('[GlobalGame] 执行完整场景初始化...');
      
      // 场景切换时清理所有交互提示事件
      this._cleanupInteractableEvents();
      
      // 场景切换时重置玩家状态
      this._resetPlayerOnSceneChange();
      
      // 自动设置当前场景的最新存档点为当前存档点
      this._autoSetLatestCheckpoint(sceneName);
      
      // 优先检查是否在花园，如果是则传送到特殊位置
      if (!this._checkGardenTeleport()) {
        // 如果不在花园，则正常加载出生点
        this._loadAndApplySpawnPoint(sceneName);
      }
    },
    
    // 播放场景音频
    _playSceneAudio(sceneName) {
      console.log('[GlobalGame] ========== _playSceneAudio 被调用 ==========');
      console.log('[GlobalGame] 场景名称:', sceneName);
      
      if (!sceneName) {
        console.warn('[GlobalGame] 场景名称为空，取消音频播放');
        console.log('[GlobalGame] =============================================');
        return;
      }
      
      var eventData = { 
        sceneName: sceneName,
        forceReplay: false 
      };
      
      console.log('[GlobalGame] 准备触发 audio:scene:play 事件');
      console.log('[GlobalGame] 事件数据:', eventData);
      
      // 触发场景音频播放事件
      this.app.fire('audio:scene:play', eventData);
      
      console.log('[GlobalGame] audio:scene:play 事件已触发');
      console.log('[GlobalGame] 场景:', sceneName);
      console.log('[GlobalGame] =============================================');
    },
    
    /**
     * 自动设置当前场景的最新存档点为当前存档点
     * @param {string} sceneName - 场景名称
     */
    _autoSetLatestCheckpoint(sceneName) {
      if (!sceneName) return;
      
      var self = this;
      
      // 延迟执行，确保场景完全加载
      setTimeout(function() {
        try {
          // 简化：直接从localStorage获取当前场景的存档点位置
          var checkpointKey = 'echoSoul_currentCheckpoint_' + sceneName;
          var savedCheckpoint = null;
          
          try {
            var checkpointData = localStorage.getItem(checkpointKey);
            if (checkpointData) {
              savedCheckpoint = JSON.parse(checkpointData);
            }
          } catch (e) {
            if (self.debug) console.warn('[GlobalGame] Failed to load checkpoint from localStorage:', e);
          }
          
          if (savedCheckpoint && savedCheckpoint.position) {
            // 设置为当前存档点
            self.setCheckpoint(savedCheckpoint.position, savedCheckpoint.id, savedCheckpoint.additionalData);
            
            if (self.debug) {
              console.log('[GlobalGame] Auto-set checkpoint for scene', sceneName + ':', savedCheckpoint.id);
              console.log('[GlobalGame] Checkpoint position:', savedCheckpoint.position);
            }
          } else {
            if (self.debug) {
              console.log('[GlobalGame] No saved checkpoint found for scene:', sceneName);
            }
          }
        } catch (e) {
          if (self.debug) {
            console.error('[GlobalGame] Failed to auto-set checkpoint:', e);
          }
        }
      }, 500); // 延迟0.5秒执行
    },
    
    /**
     * 保存当前场景的存档点位置（当存档点被激活时调用）
     * @param {pc.Vec3} position - 存档点位置
     * @param {string} checkpointId - 存档点ID
     * @param {object} additionalData - 额外数据
     */
    saveCurrentSceneCheckpoint(position, checkpointId, additionalData) {
      var sceneName = this._currentScene;
      if (!sceneName || !position) return;
      
      try {
        var checkpointData = {
          id: checkpointId || 'checkpoint_' + Date.now(),
          position: {
            x: position.x,
            y: position.y,
            z: position.z
          },
          additionalData: additionalData || {},
          timestamp: Date.now(),
          sceneName: sceneName
        };
        
        var checkpointKey = 'echoSoul_currentCheckpoint_' + sceneName;
        localStorage.setItem(checkpointKey, JSON.stringify(checkpointData));
        
        // 同时设置为当前存档点
        this.setCheckpoint(position, checkpointId, additionalData);
        
        if (this.debug) {
          console.log('[GlobalGame] Saved checkpoint for scene', sceneName + ':', checkpointId);
          console.log('[GlobalGame] Position:', position);
        }
        
        // 触发存档点保存事件
        this.app.fire('checkpoint:saved', {
          sceneName: sceneName,
          checkpointId: checkpointId,
          position: position
        });
        
      } catch (e) {
        if (this.debug) {
          console.error('[GlobalGame] Failed to save checkpoint:', e);
        }
      }
    },
    
    // ---- 出生点管理 ----
    _spawnPointsData: null, // 存储加载的出生点数据
    
    // 加载并应用出生点
    _loadAndApplySpawnPoint(sceneName) {
      if (!sceneName) return;
      
      var self = this;
      
      // 如果出生点数据未加载，先加载
      if (!this._spawnPointsData) {
        this._loadSpawnPointsData(function(success) {
          if (success) {
            self._applySpawnPoint(sceneName);
          }
        });
      } else {
        // 数据已加载，直接应用
        this._applySpawnPoint(sceneName);
      }
    },
    
    // 加载出生点数据
    _loadSpawnPointsData(callback) {
      var self = this;
      
      // 直接使用默认配置，不加载外部文件
      if (this.debug) {
        console.log('[GlobalGame] 使用默认出生点配置，跳过外部文件加载');
      }
      
      this._spawnPointsData = this._getDefaultSpawnPoints();
      if (callback) callback(true);
    },
    
    // 获取默认出生点配置
    _getDefaultSpawnPoints() {
      return {
        "start": { "x": 0, "y": 0, "z": 0 },
        "main": { "x": 0, "y": 0, "z": 0 },
        "level1": { "x": -2, "y": 0, "z": 5 },
        "level2": { "x": 3, "y": 0, "z": -2 },
        "level3": { "x": 0, "y": 0, "z": 8 },
        "level4": { "x": -5, "y": 0, "z": 0 },
        "inRoomQuiet": { "x": 0, "y": 0, "z": 3 },
        "InRoomEchoing": { "x": 2, "y": 0, "z": 0 },
        "village": { "x": -3, "y": 0, "z": 4 },
        "nymphQueen": { "x": 0, "y": 0, "z": -3 }
      };
    },
    
    // 应用出生点
    _applySpawnPoint(sceneName) {
      if (!this._spawnPointsData || !sceneName) return;
      
      var spawnPoint = this._spawnPointsData[sceneName.toLowerCase()];
      if (!spawnPoint) {
        console.warn('[GlobalGame] No spawn point found for scene:', sceneName);
        return;
      }
      
      console.log('[GlobalGame] Applying spawn point for scene', sceneName, ':', spawnPoint);
      
      // 延迟执行确保场景加载完成
      var self = this;
      setTimeout(function() {
        self._teleportPlayer(spawnPoint);
      }, 200);
    },
    
    // 传送玩家到指定位置
    _teleportPlayer(position) {
      if (!position || !this.app) return;
      
      try {
        // 查找玩家实体
        var player = this._findPlayerEntity();
        
        if (!player) {
          console.warn('[GlobalGame] Player entity not found for teleport');
          return;
        }
        
        // 重置玩家状态确保可见性
        this._resetPlayerState(player);
        
        // 创建位置向量
        var newPos = new pc.Vec3(position.x, position.y, position.z);
        
        // 传送玩家
        if (player.rigidbody) {
          player.rigidbody.teleport(newPos, player.getRotation());
        } else {
          player.setPosition(newPos);
        }
        
        console.log('[GlobalGame] Player teleported to:', newPos);
        
        // 触发传送事件
        this.app.fire('player:teleported', {
          position: newPos,
          scene: this._currentScene
        });
        
      } catch (e) {
        console.error('[GlobalGame] Failed to teleport player:', e);
      }
    },
    
    // 查找玩家实体
    _findPlayerEntity() {
      var player = this.app.root.findByName('Player');
      if (!player) {
        // 尝试其他可能的玩家实体名称
        var possibleNames = ['player', 'PlayerController', 'Character', 'MainCharacter'];
        for (var i = 0; i < possibleNames.length; i++) {
          player = this.app.root.findByName(possibleNames[i]);
          if (player) break;
        }
      }
      return player;
    },
    
    // 重置玩家状态
    _resetPlayerState(player) {
      if (!player) return;
      
      try {
        // 确保玩家实体可见
        player.enabled = true;
        
        // 重置缩放（防止被缩放为0）
        if (player.getLocalScale().length() < 0.1) {
          player.setLocalScale(1, 1, 1);
        }
        
        // 重置透明度（如果有render组件）
        if (player.render) {
          player.render.enabled = true;
        }
        
        // 重置所有子实体状态
        this._resetChildrenState(player);
        
        // 重置物理状态
        if (player.rigidbody) {
          player.rigidbody.enabled = true;
          // 清除可能的异常速度
          player.rigidbody.linearVelocity = pc.Vec3.ZERO;
          player.rigidbody.angularVelocity = pc.Vec3.ZERO;
        }
        
        // 重置碰撞体
        if (player.collision) {
          player.collision.enabled = true;
        }
        
        if (this.debug) {
          console.log('[GlobalGame] Player state reset completed');
        }
        
      } catch (e) {
        console.error('[GlobalGame] Failed to reset player state:', e);
      }
    },
    
    // 递归重置子实体状态
    _resetChildrenState(entity) {
      if (!entity || !entity.children) return;
      
      for (var i = 0; i < entity.children.length; i++) {
        var child = entity.children[i];
        if (child) {
          // 重置子实体可见性
          child.enabled = true;
          
          // 重置子实体缩放
          if (child.getLocalScale().length() < 0.1) {
            child.setLocalScale(1, 1, 1);
          }
          
          // 重置渲染组件
          if (child.render) {
            child.render.enabled = true;
          }
          
          // 递归处理子实体的子实体
          this._resetChildrenState(child);
        }
      }
    },
    
    // 场景切换时重置玩家状态
    _resetPlayerOnSceneChange() {
      try {
        var player = this._findPlayerEntity();
        if (player) {
          if (this.debug) {
            console.log('[GlobalGame] Resetting player state on scene change');
          }
          
          // 延迟重置，确保场景切换完成
          var self = this;
          setTimeout(function() {
            self._resetPlayerState(player);
            
            // 额外的场景切换重置
            self._performSceneChangeReset(player);
          }, 100);
        } else {
          if (this.debug) {
            console.warn('[GlobalGame] Player not found during scene change reset');
          }
        }
      } catch (e) {
        console.error('[GlobalGame] Error during scene change player reset:', e);
      }
    },
    
    // 执行场景切换特定的重置操作
    _performSceneChangeReset(player) {
      if (!player) return;
      
      try {
        // 重置玩家控制器状态（如果有相关脚本）
        var scripts = player.script;
        if (scripts) {
          // 重置PlayerController相关状态
          if (scripts.playerController) {
            var pc = scripts.playerController;
            if (pc.enabled !== undefined) pc.enabled = true;
            // 重置可能的隐藏状态
            if (pc.isHidden !== undefined) pc.isHidden = false;
            if (pc.isVisible !== undefined) pc.isVisible = true;
          }
          
          // 重置其他可能的玩家脚本
          var playerScripts = ['player', 'character', 'movement', 'controller'];
          for (var i = 0; i < playerScripts.length; i++) {
            var scriptName = playerScripts[i];
            if (scripts[scriptName] && scripts[scriptName].enabled !== undefined) {
              scripts[scriptName].enabled = true;
            }
          }
        }
        
        // 强制刷新玩家可见性
        this._forcePlayerVisibility(player);
        
        // 触发玩家重置事件
        if (this.app) {
          this.app.fire('player:scene:reset', {
            player: player,
            scene: this._currentScene
          });
        }
        
        if (this.debug) {
          console.log('[GlobalGame] Scene change reset completed for player');
        }
        
      } catch (e) {
        console.error('[GlobalGame] Error in scene change reset:', e);
      }
    },
    
    // 强制玩家可见性
    _forcePlayerVisibility(player) {
      if (!player) return;
      
      try {
        // 多重确保可见性
        player.enabled = true;
        
        // 确保不是透明状态
        if (player.render && player.render.material) {
          var material = player.render.material;
          if (material.opacity !== undefined) {
            material.opacity = 1.0;
          }
          if (material.blendType !== undefined) {
            material.blendType = pc.BLEND_NONE;
          }
        }
        
        // 确保所有渲染组件都启用
        var renders = player.findComponents('render');
        for (var i = 0; i < renders.length; i++) {
          renders[i].enabled = true;
        }
        
        // 确保模型组件启用
        if (player.model) {
          player.model.enabled = true;
        }
        
        // 递归确保所有子实体可见
        this._forceChildrenVisibility(player);
        
      } catch (e) {
        console.error('[GlobalGame] Error forcing player visibility:', e);
      }
    },
    
    // 递归强制子实体可见性
    _forceChildrenVisibility(entity) {
      if (!entity || !entity.children) return;
      
      for (var i = 0; i < entity.children.length; i++) {
        var child = entity.children[i];
        if (child) {
          child.enabled = true;
          
          if (child.render) {
            child.render.enabled = true;
          }
          
          if (child.model) {
            child.model.enabled = true;
          }
          
          this._forceChildrenVisibility(child);
        }
      }
    },
    
    // 手动切换场景并传送玩家（供外部调用）
    switchToScene(sceneName) {
      if (!sceneName) return;
      console.log('[GlobalGame] Manual scene switch to:', sceneName);
      this.setCurrentScene(sceneName);
    },
    
    // 检测玩家是否在花园场景
    _isPlayerInGarden() {
      var currentScene = this._detectCurrentScene();
      if (!currentScene) return false;
      
      // 检测花园相关的场景名称
      var gardenScenes = ['Queen', 'flower', 'bloom', 'nature', 'park'];
      var sceneLower = currentScene.toLowerCase();
      
      for (var i = 0; i < gardenScenes.length; i++) {
        if (sceneLower.indexOf(gardenScenes[i]) !== -1) {
          return true;
        }
      }
      
      // 也可以通过实体名称检测（如果场景中有特定的花园标识实体）
      try {
        if (this.app && this.app.root) {
          var gardenMarkers = ['Garden', 'FlowerGarden', 'Flowers', 'BloomArea'];
          for (var j = 0; j < gardenMarkers.length; j++) {
            if (this.app.root.findByName(gardenMarkers[j])) {
              return true;
            }
          }
        }
      } catch (e) {
        if (this.debug) {
          console.warn('[GlobalGame] Error checking garden entities:', e);
        }
      }
      
      return false;
    },
    
    // 检查并处理花园传送
    _checkGardenTeleport() {
      if (this._isPlayerInGarden()) {
        if (this.debug) {
          console.log('[GlobalGame] Player detected in garden, teleporting to special location');
        }
        
        // 传送到花园特殊位置 (14, 14, 26)
        var gardenPosition = { x: 14, y: 14, z: 26 };
        
        // 延迟传送，确保场景加载完成
        var self = this;
        setTimeout(function() {
          self._teleportPlayer(gardenPosition);
          
          // 触发花园传送事件
          if (self.app) {
            self.app.fire('player:garden:teleported', {
              position: gardenPosition,
              scene: self._currentScene
            });
          }
        }, 300);
        
        return true;
      }
      return false;
    },
    
    // 清理交互提示相关事件
    _cleanupInteractableEvents() {
      if (!this.app) return;
      
      try {
        // 清理所有InteractableHint相关的事件
        var interactableEvents = [
          'interactable:action',
          'interactable:one_time_completed',
          'interactable:hint:show',
          'interactable:hint:hide',
          'ui:hint:show',
          'ui:hint:hide',
          'mobile:interact'
        ];
        
        for (var i = 0; i < interactableEvents.length; i++) {
          this.app.off(interactableEvents[i]);
        }
        
        // 清理动态生成的InteractableHint事件（格式：interactableHint:键名）
        var commonKeys = ['E', 'F', 'Space', 'Enter', '69', '70', '32', '13'];
        for (var j = 0; j < commonKeys.length; j++) {
          var eventName = 'interactableHint:' + commonKeys[j];
          this.app.off(eventName);
        }
        
        if (this.debug) {
          console.log('[GlobalGame] Cleaned up interactable events on scene change');
        }
        
      } catch (e) {
        console.error('[GlobalGame] Error cleaning up interactable events:', e);
      }
    },
    
    // 手动触发花园检测（供外部调用和测试）
    checkGardenTeleport() {
      return this._checkGardenTeleport();
    },
    
    // 手动检测是否在花园（供外部调用和测试）
    isPlayerInGarden() {
      return this._isPlayerInGarden();
    },
    
    // 手动重置玩家状态（供外部调用）
    resetPlayerState() {
      var player = this._findPlayerEntity();
      if (player) {
        this._resetPlayerState(player);
        this._performSceneChangeReset(player);
        if (this.debug) {
          console.log('[GlobalGame] Manual player state reset completed');
        }
        return true;
      } else {
        console.warn('[GlobalGame] Player not found for manual reset');
        return false;
      }
    },
    
    // ---- Part状态管理 ----
    _partStates: null, // 存储Part激活状态 { sceneName: { partIndex: activatedIndex } }
    
    // 加载Part状态
    _loadPartStates() {
      try {
        var stored = localStorage.getItem('echoSoul_partStates');
        this._partStates = stored ? JSON.parse(stored) : {};
        if (this.debug) {
          console.log('[GlobalGame] Loaded part states:', this._partStates);
        }
      } catch (e) {
        console.warn('[GlobalGame] Failed to load part states:', e);
        this._partStates = {};
      }
    },
    
    // 保存Part状态
    _savePartStates() {
      try {
        localStorage.setItem('echoSoul_partStates', JSON.stringify(this._partStates));
        if (this.debug) {
          console.log('[GlobalGame] Saved part states:', this._partStates);
        }
      } catch (e) {
        console.warn('[GlobalGame] Failed to save part states:', e);
      }
    },
    
    // 设置场景Part激活状态
    setScenePartState(sceneName, partIndex) {
      if (!sceneName || partIndex < 0) return;
      
      if (!this._partStates) {
        this._loadPartStates();
      }
      
      if (!this._partStates[sceneName]) {
        this._partStates[sceneName] = {};
      }
      
      // 记录当前激活的Part索引
      this._partStates[sceneName].activatedPartIndex = partIndex;
      this._partStates[sceneName].timestamp = Date.now();
      
      this._savePartStates();
      
      if (this.debug) {
        console.log('[GlobalGame] Set part state for scene', sceneName, 'part index:', partIndex);
      }
    },
    
    // 获取场景Part激活状态
    getScenePartState(sceneName) {
      if (!sceneName) return null;
      
      if (!this._partStates) {
        this._loadPartStates();
      }
      
      var sceneState = this._partStates[sceneName];
      return sceneState ? sceneState.activatedPartIndex : 0; // 默认返回Part-0
    },
    
    // 清除场景Part状态
    clearScenePartState(sceneName) {
      if (!sceneName || !this._partStates) return;
      
      delete this._partStates[sceneName];
      this._savePartStates();
      
      if (this.debug) {
        console.log('[GlobalGame] Cleared part state for scene:', sceneName);
      }
    },
    
    // 获取所有Part状态
    getAllPartStates() {
      if (!this._partStates) {
        this._loadPartStates();
      }
      return this._partStates;
    },
    
    // ---- 存档点管理 ----
    setCheckpoint(position, checkpointId, additionalData) {
      if (position && position.clone) {
        this._checkpointPosition = position.clone();
        
        if (this.debug) console.log('[GlobalGame] Checkpoint set at:', position);
      }
    },
    
    getCheckpoint() {
      return this._checkpointPosition ? this._checkpointPosition.clone() : null;
    },
    
    // ---- 场景专属存档点管理 ----
    setSceneCheckpoint(sceneName, position) {
      if (!sceneName || !position) {
        console.warn('[GlobalGame] setSceneCheckpoint: 场景名或位置无效');
        return;
      }
      
      // 保存到内存
      if (!this._sceneCheckpoints) this._sceneCheckpoints = {};
      this._sceneCheckpoints[sceneName] = position.clone();
      
      // 保存到localStorage
      try {
        var checkpointKey = 'echoSoul_sceneCheckpoint_' + sceneName;
        var checkpointData = {
          position: { x: position.x, y: position.y, z: position.z },
          timestamp: Date.now()
        };
        localStorage.setItem(checkpointKey, JSON.stringify(checkpointData));
        
        if (this.debug) {
          console.log('[GlobalGame] 场景存档点已保存到localStorage，场景:', sceneName, '位置:', position);
        }
      } catch (e) {
        console.error('[GlobalGame] 保存场景存档点到localStorage失败:', e);
      }
    },
    
    getSceneCheckpoint(sceneName) {
      if (!sceneName) {
        console.warn('[GlobalGame] getSceneCheckpoint: 场景名无效');
        return null;
      }
      
      // 先从内存中获取
      if (this._sceneCheckpoints && this._sceneCheckpoints[sceneName]) {
        if (this.debug) {
          console.log('[GlobalGame] 从内存获取场景存档点，场景:', sceneName);
        }
        return this._sceneCheckpoints[sceneName].clone();
      }
      
      // 如果内存中没有，尝试从localStorage加载
      try {
        var checkpointKey = 'echoSoul_sceneCheckpoint_' + sceneName;
        var savedData = localStorage.getItem(checkpointKey);
        
        if (savedData) {
          var checkpoint = JSON.parse(savedData);
          if (checkpoint && checkpoint.position) {
            var position = new pc.Vec3(
              checkpoint.position.x,
              checkpoint.position.y,
              checkpoint.position.z
            );
            
            // 缓存到内存
            if (!this._sceneCheckpoints) {
              this._sceneCheckpoints = {};
            }
            this._sceneCheckpoints[sceneName] = position;
            
            if (this.debug) {
              console.log('[GlobalGame] 从localStorage加载场景存档点，场景:', sceneName, '位置:', position);
            }
            
            return position.clone();
          }
        }
      } catch (e) {
        console.error('[GlobalGame] 从localStorage加载场景存档点失败:', e);
      }
      
      if (this.debug) {
        console.log('[GlobalGame] 场景存档点不存在，场景:', sceneName);
      }
      
      return null;
    },
    
    clearCheckpoint() {
      this._checkpointPosition = null;
      try {
        localStorage.removeItem('echoSoul_checkpoint');
      } catch (e) {}
      if (this.debug) console.log('[GlobalGame] Checkpoint cleared');
    },
    
    // ---- 存档点激活记录管理 ----
    
    
    
    /**
     * 传送玩家到当前存档点
     * @returns {boolean} 是否成功传送
     */
    teleportToCheckpoint() {
      // 直接使用当前设置的存档点
      var currentCheckpoint = this.getCheckpoint();
      
      if (!currentCheckpoint) {
        if (this.debug) console.warn('[GlobalGame] No current checkpoint found for teleport');
        return false;
      }
      
      try {
        // 查找玩家实体
        var player = this.app.root.findByName('Player');
        if (!player) {
          // 尝试其他可能的玩家实体名称
          player = this.app.root.findByName('player') || 
                   this.app.root.findByName('PlayerController') ||
                   this.app.root.findByTag('player')[0];
        }
        
        if (!player) {
          if (this.debug) console.error('[GlobalGame] Player entity not found for teleport');
          return false;
        }
        
        // 传送玩家
        var pos = currentCheckpoint;
        
        if (this.debug) {
          console.log('[GlobalGame] Teleport debug info:');
          console.log('  - Current checkpoint position:', pos);
          console.log('  - Position type:', typeof pos);
          console.log('  - Player entity:', player.name);
          console.log('  - Player has rigidbody:', !!player.rigidbody);
        }
        
        // 处理不同的位置数据格式
        var x, y, z;
        if (pos && typeof pos === 'object') {
          if (pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
            x = pos.x;
            y = pos.y;
            z = pos.z;
          } else if (pos.clone && typeof pos.clone === 'function') {
            // PlayCanvas Vec3 对象
            var clonedPos = pos.clone();
            x = clonedPos.x;
            y = clonedPos.y;
            z = clonedPos.z;
          } else {
            if (this.debug) console.error('[GlobalGame] Invalid position format:', pos);
            return false;
          }
        } else {
          if (this.debug) console.error('[GlobalGame] Position is not an object:', pos);
          return false;
        }
        
        if (this.debug) {
          console.log('[GlobalGame] Parsed position:', x, y, z);
        }
        
        if (player.rigidbody) {
          // 如果有刚体，使用teleport方法
          player.rigidbody.teleport(x, y, z);
          if (this.debug) console.log('[GlobalGame] Used rigidbody.teleport()');
        } else {
          // 否则直接设置位置
          player.setPosition(x, y, z);
          if (this.debug) console.log('[GlobalGame] Used setPosition()');
        }
        
        if (this.debug) {
          console.log('[GlobalGame] Player teleported to checkpoint at:', x, y, z);
        }
        
        // 触发传送事件
        this.app.fire('player:teleported', {
          position: { x: x, y: y, z: z },
          timestamp: nowMs()
        });
        
        return true;
        
      } catch (e) {
        if (this.debug) console.error('[GlobalGame] Teleport failed:', e);
        return false;
      }
    },
    
    /**
     * 调试方法：手动触发传送到存档点
     * 可以在浏览器控制台中调用 GlobalGame.debugTeleport()
     */
    debugTeleport() {
      console.log('[GlobalGame] === Debug Teleport ===');
      console.log('Current scene:', this._currentScene);
      console.log('Current state:', this._current);
      
      var current = this.getCheckpoint();
      console.log('Current checkpoint:', current);
      
      // 检查localStorage中的存档点
      if (this._currentScene) {
        var checkpointKey = 'echoSoul_currentCheckpoint_' + this._currentScene;
        try {
          var savedData = localStorage.getItem(checkpointKey);
          console.log('Saved checkpoint data:', savedData ? JSON.parse(savedData) : null);
        } catch (e) {
          console.log('Failed to load saved checkpoint:', e);
        }
      }
      
      console.log('Attempting teleport...');
      var result = this.teleportToCheckpoint();
      console.log('Teleport result:', result);
    },
    
    // 加载场景（使用 PlayCanvas API + Loading 动画）
    loadScene(sceneName, callback) {
      var self = this;
      if (this.debug) console.log('[GlobalGame] Loading scene:', sceneName);
      
      // 检查是否已经在目标场景
      if (this._currentScene && this._currentScene.toLowerCase() === sceneName.toLowerCase()) {
        console.warn('[GlobalGame] Already in scene:', sceneName);
        if (callback) callback(null);
        return;
      }
      
      // 停止当前场景音频
      this._stopSceneAudio();
      
      // 显示 loading 动画
      try {
        this.app.fire('loading:show', { text: 'Loading...' });
        if (this.debug) console.log('[GlobalGame] Loading screen shown');
      } catch (e) {
        console.warn('[GlobalGame] Failed to show loading screen:', e);
      }
      
      // 在场景切换前清除所有单例，防止重复实例
      try {
        if (typeof UIManager !== 'undefined') {
          if (self.debug) console.log('[GlobalGame] Clearing UIManager singleton before scene change');
          UIManager._instance = null;
        }
        if (typeof GlobalCameraManager !== 'undefined') {
          if (self.debug) console.log('[GlobalGame] Clearing CameraManager singleton before scene change');
          GlobalCameraManager._instance = null;
        }
        if (typeof UIMobile !== 'undefined') {
          if (self.debug) console.log('[GlobalGame] Clearing UIMobile singleton before scene change');
          UIMobile._instance = null;
        }
        if (typeof PortalConfirmUI !== 'undefined') {
          console.log('[GlobalGame] Clearing PortalConfirmUI singleton before scene change');
          // 先销毁旧实例（解绑事件）
          if (PortalConfirmUI._instance && typeof PortalConfirmUI._instance.destroy === 'function') {
            try {
              PortalConfirmUI._instance.destroy();
            } catch (e) {
              console.warn('[GlobalGame] Failed to destroy PortalConfirmUI:', e);
            }
          }
          PortalConfirmUI._instance = null;
        }
        if (typeof CameraUIController !== 'undefined') {
          if (self.debug) console.log('[GlobalGame] Clearing CameraUIController instances before scene change');
          CameraUIController._instances = {};
        }
        
        // 清理 DeathController（通过场景卸载事件触发）
        // 注意：DeathController 自己监听 scene:beforeunload 并自动销毁
        // 这里只是触发事件，实际清理由脚本自己处理
        if (self.debug) console.log('[GlobalGame] Triggering scene:beforeunload for cleanup');
        self.app.fire('scene:beforeunload', { sceneName: sceneName });
      } catch (e) {
        console.warn('[GlobalGame] Failed to clear singletons:', e);
      }
      
      try {
        this.app.scenes.changeScene(sceneName, function(err, loadedSceneRootEntity) {
          if (err) {
            console.error('[GlobalGame] Failed to load scene:', err);
            
            // 隐藏 loading
            try {
              self.app.fire('loading:hide');
            } catch (e) {}
            
            if (callback) callback(err);
          } else {
            // 使用setCurrentScene方法，只设置存档点，不执行其他初始化（避免与场景加载流程冲突）
            self.setCurrentScene(sceneName, true);
            if (self.debug) console.log('[GlobalGame] Scene loaded successfully:', sceneName);
            
            // 播放场景音频（BGM + 环境音）
            self._playSceneAudio(sceneName);
            
            // 延迟确保场景完全初始化并清理旧场景残留
            setTimeout(function() {
              try {
                // ⭐ 在触发事件前清理旧场景残留的监听器
                if (self.debug) console.log('[GlobalGame] Cleaning up old scene remnants...');
                self._cleanupOldSceneRemnants();
                
                // 触发场景初始化事件
                self.app.fire('scene:loaded', { sceneName: sceneName });
                
                // 应用当前语言的字体到新场景中的所有文本元素
                try {
                  var currentLocale = self.getLocale();
                  self._applyLocaleFonts(currentLocale);
                  if (self.debug) console.log('[GlobalGame] Applied fonts for locale:', currentLocale, 'to new scene:', sceneName);
                } catch (e) {
                  console.warn('[GlobalGame] Failed to apply fonts to new scene:', e);
                }
                
                // 检查是否为 level 场景，自动初始化 LevelManager
                var isLevelScene = sceneName.toLowerCase().indexOf('level') === 0;
                if (isLevelScene) {
                  self._initializeLevelManager(loadedSceneRootEntity);
                }
                
                // 根据场景类型设置玩家和相机状态
                // 注意：空字符串或Start/Main场景都视为Start场景，不强制改变玩家状态
                var isStartScene = !sceneName || sceneName.toLowerCase() === 'start' || sceneName.toLowerCase() === 'main';
                if (!isStartScene) {
                  if (self.debug) console.log('[GlobalGame] Non-start scene, forcing player to standing state');
                  
                  // ⭐ 再次检查监听器数量（调试用）
                  if (self.debug) {
                    self._logEventListenerCounts();
                  }
                  
                  // 设置玩家为站立状态
                  self.app.fire('player:set_sitting', false);
                  // 设置相机为自由跟随
                  if (typeof GlobalCameraManager !== 'undefined') {
                    var gcam = GlobalCameraManager.getInstance();
                    if (gcam) {
                      gcam.setState(GlobalCameraManager.CONTROL_STATES.FREE_FOLLOW);
                      if (self.debug) console.log('[GlobalGame] Camera set to FREE_FOLLOW');
                    }
                  }
                } else {
                  // Start 场景（或空字符串）：由 UIManager 控制玩家和相机状态，这里不强制改变
                  if (self.debug) console.log('[GlobalGame] Start scene (or empty name), keeping player state unchanged - controlled by UIManager');
                }
                
                self.app.fire('loading:hide');
                if (self.debug) console.log('[GlobalGame] Loading screen hidden');
                
                // 显示场景标题（延迟确保 loading 完全隐藏）
                setTimeout(function() {
                  self._showSceneTitle(sceneName);
                }, 300);
              } catch (e) {
                console.warn('[GlobalGame] Failed to hide loading screen:', e);
              }
              
              if (callback) callback(null, loadedSceneRootEntity);
            }, 800); // ⭐ 从500ms延长到800ms，确保旧场景完全销毁
          }
        });
      } catch (e) {
        console.error('[GlobalGame] Exception loading scene:', e);
        
        // 隐藏 loading
        try {
          this.app.fire('loading:hide');
        } catch (e2) {}
        
        if (callback) callback(e);
      }
    },
    
    // 显示场景标题
    _showSceneTitle(sceneName) {
      if (!sceneName) return;
      
      // 场景名称到 i18n key 的映射
      var titleMap = {
        // 关卡场景
        'Start': 'level.mind_shore.entrance',
        'level1': 'level.ethans_wind.outer',
        'ethans_wind_outer': 'level.ethans_wind.outer',
        'mind_shore': 'level.mind_shore.entrance',
        'Queen': 'Queen.entrance',
        'village': 'village.entrance',
        
        // 章节场景
        'Chapter1': 'story.chapter1.title'
      };
      
      var titleKey = titleMap[sceneName];
      
      if (titleKey) {
        try {
          this.app.fire('title:show', titleKey);
        } catch (e) {}
      }
    },
    
    // 播放场景音频（BGM + 环境音）
    _playSceneAudio(sceneName) {
      if (!sceneName) return;
      
      // 检查GlobalAudioSceneConfig是否已初始化
      if (typeof GlobalAudioSceneConfig === 'undefined' || !GlobalAudioSceneConfig._initialized) {
        if (this.debug) {
          console.warn('[GlobalGame] GlobalAudioSceneConfig未初始化，跳过场景音频播放');
        }
        return;
      }
      
      try {
        // 直接使用全局音频配置播放场景音频
        GlobalAudioSceneConfig.playScene(sceneName);
        
        if (this.debug) {
          console.log('[GlobalGame] ✓ 场景音频播放:', sceneName);
        }
      } catch (e) {
        console.error('[GlobalGame] 场景音频播放失败:', e);
      }
    },
    
    // 停止场景音频
    _stopSceneAudio() {
      // 检查GlobalAudioSceneConfig是否已初始化
      if (typeof GlobalAudioSceneConfig === 'undefined' || !GlobalAudioSceneConfig._initialized) {
        return;
      }
      
      try {
        GlobalAudioSceneConfig.stopScene();
        
        if (this.debug) {
          console.log('[GlobalGame] ✓ 场景音频已停止');
        }
      } catch (e) {
        console.error('[GlobalGame] 停止场景音频失败:', e);
      }
    },
    
    // 清理旧场景残留的监听器和实例
    _cleanupOldSceneRemnants() {
      var cleanedCount = 0;
      
      try {
        // 1. 清理重复的CameraTransition实例
        var allCameras = this.app.root.find(function(node) {
          return node.script && node.script.cameraTransition;
        });
        
        if (allCameras.length > 1) {
          console.warn('[GlobalGame] Found', allCameras.length, 'CameraTransition instances, keeping only the first one');
          
          // 销毁除第一个之外的所有实例
          for (var i = 1; i < allCameras.length; i++) {
            try {
              if (this.debug) {
                console.log('[GlobalGame] Destroying duplicate CameraTransition:', allCameras[i].name, allCameras[i].getGuid());
              }
              allCameras[i].destroy();
              cleanedCount++;
            } catch (e) {
              console.warn('[GlobalGame] Failed to destroy CameraTransition:', e);
            }
          }
        }
        
        // 2. 清理重复的PlayerController实例
        var allPlayers = this.app.root.findByTag('player');
        if (allPlayers.length > 1) {
          console.warn('[GlobalGame] Found', allPlayers.length, 'Player instances, keeping only the first one');
          
          for (var j = 1; j < allPlayers.length; j++) {
            try {
              if (this.debug) {
                console.log('[GlobalGame] Destroying duplicate Player:', allPlayers[j].name, allPlayers[j].getGuid());
              }
              allPlayers[j].destroy();
              cleanedCount++;
            } catch (e) {
              console.warn('[GlobalGame] Failed to destroy Player:', e);
            }
          }
        }
        
        if (cleanedCount > 0) {
          console.log('[GlobalGame] Cleaned up', cleanedCount, 'duplicate instances');
        } else if (this.debug) {
          console.log('[GlobalGame] No duplicate instances found');
        }
      } catch (e) {
        console.error('[GlobalGame] Error cleaning up old scene remnants:', e);
      }
    },
    
    // 日志事件监听器数量（调试用）
    _logEventListenerCounts() {
      try {
        var events = [
          'ui:control_state_changed',
          'player:set_sitting',
          'player:respawn',
          'ui:dialogue:begin',
          'ui:dialogue:end'
        ];
        
        console.log('[GlobalGame] Event listener counts:');
        for (var i = 0; i < events.length; i++) {
          var eventName = events[i];
          if (this.app._callbacks && this.app._callbacks.has(eventName)) {
            var listeners = this.app._callbacks.get(eventName);
            var count = listeners ? listeners.length : 0;
            console.log('[GlobalGame]  -', eventName + ':', count);
            
            if (count > 1) {
              console.warn('[GlobalGame]  ⚠️ Multiple listeners detected for:', eventName);
            }
          }
        }
      } catch (e) {
        console.warn('[GlobalGame] Failed to log event listener counts:', e);
      }
    },
    
    // 初始化 LevelManager（在 level 场景中自动调用）
    _initializeLevelManager(sceneRoot) {
      if (!sceneRoot) {
        if (this.debug) console.warn('[GlobalGame] sceneRoot is null, cannot initialize LevelManager');
        return;
      }
      
      // 查找根节点下的 LevelManager 脚本
      var levelManager = null;
      
      // 方法1: 尝试从根节点获取
      if (sceneRoot.script && sceneRoot.script.levelManager) {
        levelManager = sceneRoot.script.levelManager;
      }
      
      // 方法2: 尝试从子节点查找名为 "LevelManager" 的实体
      if (!levelManager) {
        var managerEntity = sceneRoot.findByName('LevelManager');
        if (managerEntity && managerEntity.script && managerEntity.script.levelManager) {
          levelManager = managerEntity.script.levelManager;
        }
      }
      
      // 方法3: 使用单例获取
      if (!levelManager && typeof LevelManager !== 'undefined' && LevelManager.getInstance) {
        levelManager = LevelManager.getInstance();
      }
      
      if (levelManager) {
        if (this.debug) console.log('[GlobalGame] Found LevelManager, initializing parts');
        
        // LevelManager 会在 initialize 中自动处理，这里只是确认找到了
        if (typeof levelManager._initializeParts === 'function') {
          levelManager._initializeParts();
        }
      } else {
        if (this.debug) console.warn('[GlobalGame] LevelManager not found in scene root');
      }
    },
    
    // Locale getters/setters (currently zh-CN/en-US only)
    getLocale() { return this._currentLocale || this._detectLocale(); },
    setLocale(loc) {
      var l = (loc === 'zh-CN' || loc === 'en-US') ? loc : this._detectLocale();
      if (l === this._currentLocale) {
        if (this.debug) console.log('[GlobalGame] setLocale: already', l, ', skipping');
        return;
      }
      
      var oldLocale = this._currentLocale;
      this._currentLocale = l;
      
      // 不再保存到 localStorage（语言设置是临时的）
      if (this.debug) console.log('[GlobalGame] setLocale: switching to', l, '(session only)');
      
      // If I18n is present, reload all bundles for new locale
      if (typeof I18n !== 'undefined' && I18n.setLocale) {
        try { 
          I18n.setLocale(l); 
          if (this.debug) console.log('[GlobalGame] I18n.setLocale called with:', l);
        } catch (e) {
          console.error('[GlobalGame] I18n.setLocale failed:', e);
        }
        
        var self = this;
        var fb = (l === 'zh-CN') ? 'en-US' : 'zh-CN';
        
        // 重新加载所有 i18n 资源
        this._reloadAllI18nBundles(l, fb, function() {
          // 确保 I18n 系统内部状态同步
          try {
            if (I18n.getLocale() !== l) {
              I18n.setLocale(l);
              if (self.debug) console.log('[GlobalGame] 强制同步 I18n locale 到:', l);
            }
          } catch (e) {
            console.warn('[GlobalGame] Failed to sync I18n locale:', e);
          }
          
          // 应用字体
          try {
            self._applyLocaleFonts(l);
          } catch (e) {
            console.warn('[GlobalGame] Failed to apply locale fonts:', e);
          }
          
          // 触发事件
          self.app.fire('i18n:ready');
          self.app.fire('locale:changed', { 
            locale: l, 
            oldLocale: oldLocale,
            timestamp: Date.now()
          });
          
          // 触发兼容事件（供菜单组件使用）
          self.app.fire('i18n:changed', { 
            locale: l, 
            oldLocale: oldLocale 
          });
          
          if (self.debug) {
            console.log('[GlobalGame] 语言切换完成，所有 i18n 资源已重新加载');
            console.log('[GlobalGame] locale changed ->', l);
            console.log('[GlobalGame] I18n.getLocale() returns:', I18n.getLocale());
          }
        });
      } else {
        this.app.fire('locale:changed', { 
          locale: l, 
          oldLocale: oldLocale,
          timestamp: Date.now()
        });
        this.app.fire('i18n:changed', { 
          locale: l, 
          oldLocale: oldLocale 
        });
        if (this.debug) console.log('[GlobalGame] I18n not available, fired locale:changed and i18n:changed events');
      }
    },
    
    // 重新加载所有 i18n 资源包
    _reloadAllI18nBundles(locale, fallbackLocale, done) {
      if (typeof I18n === 'undefined' || !I18n.loadBundles) { 
        if (done) done(); 
        return; 
      }
      
      var self = this;
      if (this.debug) {
        console.log('[GlobalGame] 开始重新加载所有 i18n 资源，目标语言:', locale);
        console.log('[GlobalGame] 当前已加载的资源包:', I18n.getLoadedBundles ? I18n.getLoadedBundles() : 'unknown');
      }
      
      // 清除所有已加载的资源包缓存
      try {
        if (I18n.clearBundles) {
          I18n.clearBundles();
          if (this.debug) console.log('[GlobalGame] 已清除所有 i18n 缓存');
        }
      } catch (e) {
        console.warn('[GlobalGame] Failed to clear i18n bundles:', e);
      }
      
      // 定义需要加载的资源包
      var bundlesToLoad = [
        { assetName: 'prologue_' + locale + '.json', namespace: 'prologue' },
        { assetName: 'ui_' + locale + '.json', namespace: 'ui' },
        { assetName: 'title_' + locale + '.json', namespace: 'title' }
      ];
      
      if (this.debug) console.log('[GlobalGame] 准备加载资源包:', bundlesToLoad.map(function(b) { return b.assetName; }));
      
      // 加载主要语言资源
      I18n.loadBundles(bundlesToLoad, function () {
        var prologueOk = !!(I18n.get && I18n.get('prologue'));
        var uiOk = !!(I18n.get && I18n.get('ui'));
        var titleOk = !!(I18n.get && I18n.get('title'));
        
        if (self.debug) {
          console.log('[GlobalGame] 重新加载结果 - Prologue:', prologueOk, 'UI:', uiOk, 'Title:', titleOk);
          console.log('[GlobalGame] 新加载的资源包:', I18n.getLoadedBundles ? I18n.getLoadedBundles() : 'unknown');
        }
        
        // 如果主要语言加载失败，尝试 fallback
        if ((!prologueOk || !uiOk || !titleOk) && fallbackLocale && fallbackLocale !== locale) {
          if (self.debug) console.log('[GlobalGame] 主要语言资源加载不完整，尝试 fallback:', fallbackLocale);
          
          var fallbackBundles = [
            { assetName: 'prologue_' + fallbackLocale + '.json', namespace: 'prologue' },
            { assetName: 'ui_' + fallbackLocale + '.json', namespace: 'ui' },
            { assetName: 'title_' + fallbackLocale + '.json', namespace: 'title' }
          ];
          
          I18n.loadBundles(fallbackBundles, function () {
            if (self.debug) console.log('[GlobalGame] Fallback 资源加载完成');
            if (done) done();
          });
        } else {
          if (self.debug) console.log('[GlobalGame] 所有 i18n 资源重新加载完成');
          if (done) done();
        }
      });
    },
    canTransitionTo(target) {
      var T = this.STATES;
      var map = {};
      map[T.LOADING]      = [T.MAIN_MENU];
      map[T.MAIN_MENU]    = [T.LEVEL_SELECT, T.FREE_WORLD, T.SETTINGS];
      map[T.LEVEL_SELECT] = [T.MAIN_MENU, T.LEVEL];
      map[T.LEVEL]        = [T.PAUSED, T.GAME_OVER, T.MAIN_MENU];
      map[T.FREE_WORLD]   = [T.PAUSED, T.MAIN_MENU];
      map[T.PAUSED]       = [T.LEVEL, T.FREE_WORLD, T.MAIN_MENU];
      map[T.GAME_OVER]    = [T.MAIN_MENU, T.LEVEL];
      map[T.SETTINGS]     = [T.MAIN_MENU];
      return (map[this._current] || []).indexOf(target) !== -1;
    },

    on(type, state, fn) { this._cb[type][state] = fn; },

    // convenience
    startGame() { this.changeState(this.STATES.LEVEL_SELECT); },
    enterFreeWorld() { this.changeState(this.STATES.FREE_WORLD); },
    pause() {
      if (this.isInState(this.STATES.LEVEL) || this.isInState(this.STATES.FREE_WORLD)) this.changeState(this.STATES.PAUSED);
    },
    resume() {
      if (this.isInState(this.STATES.PAUSED)) this.changeState(this._previous);
    },
    toMainMenu() { this.changeState(this.STATES.MAIN_MENU); },
    
    /**
     * 播放指定的 prologue
     * @param {string} prologueKey - prologue 键名
     * @param {object} options - 可选参数
     */
    playPrologue(prologueKey, options) {
      if (!prologueKey) {
        if (this.debug) console.warn('[GlobalGame] playPrologue: prologueKey is required');
        return;
      }
      
      if (this.debug) {
        console.log('[GlobalGame] playPrologue called with key:', prologueKey);
      }
      
      // 触发事件让 UIManager 播放 prologue
      this.app.fire('ui:play:prologue', {
        prologueKey: prologueKey,
        options: options || {}
      });
    },

    // ---- dialogue progress storage ----
    _dialogueData: null,
    
    _initDialogueStorage() {
      if (this._dialogueData) return;
      try {
        var saved = localStorage.getItem('echoSoul_dialogue_progress');
        this._dialogueData = saved ? JSON.parse(saved) : {};
      } catch (e) {
        console.warn('[GlobalGame] Failed to load dialogue progress:', e);
        this._dialogueData = {};
      }
    },
    
    _saveDialogueStorage() {
      if (!this._dialogueData) return;
      try {
        localStorage.setItem('echoSoul_dialogue_progress', JSON.stringify(this._dialogueData));
      } catch (e) {
        console.warn('[GlobalGame] Failed to save dialogue progress:', e);
      }
    },
    
    setDialogueNode(npcKey, nodeId) {
      this._initDialogueStorage();
      if (!npcKey) return false;
      this._dialogueData[npcKey] = String(nodeId || '');
      this._saveDialogueStorage();
      if (this.debug) console.log('[GlobalGame] Saved dialogue node:', npcKey, '->', nodeId);
      return true;
    },
    
    getDialogueNode(npcKey, defaultValue) {
      this._initDialogueStorage();
      var value = this._dialogueData[npcKey];
      return (typeof value === 'undefined') ? (defaultValue || '') : String(value);
    },
    
    clearDialogueProgress() {
      this._dialogueData = {};
      this._saveDialogueStorage();
      if (this.debug) console.log('[GlobalGame] Cleared all dialogue progress');
    },
    
    // 清除特定NPC的对话进度
    clearDialogueProgressFor(npcKey) {
      this._initDialogueStorage();
      if (this._dialogueData[npcKey]) {
        delete this._dialogueData[npcKey];
        this._saveDialogueStorage();
        if (this.debug) console.log('[GlobalGame] Cleared dialogue progress for:', npcKey);
        return true;
      }
      return false;
    },
    
    // 调试：显示当前所有对话进度
    showDialogueProgress() {
      this._initDialogueStorage();
      console.log('[GlobalGame] Current dialogue progress:', this._dialogueData);
      return this._dialogueData;
    },

    // ---- settings management ----
    _settingsData: null,
    
    _initSettingsStorage() {
      if (this._settingsData) return;
      try {
        var saved = localStorage.getItem('echoSoul_settings');
        this._settingsData = saved ? JSON.parse(saved) : {};
        
        // 设置默认值
        var defaults = {
          masterVolume: 80,
          musicVolume: 70,
          sfxVolume: 80,
          voiceVolume: 80,
          language: 'zh-CN',
          fullscreen: false,
          vSync: true,
          brightness: 50,
          mouseSensitivity: 1.0,
          invertY: false
        };
        
        for (var key in defaults) {
          if (!(key in this._settingsData)) {
            this._settingsData[key] = defaults[key];
          }
        }
        
      } catch (e) {
        console.warn('[GlobalGame] Failed to load settings:', e);
        this._settingsData = {};
      }
    },
    
    _saveSettingsStorage() {
      if (!this._settingsData) return;
      try {
        localStorage.setItem('echoSoul_settings', JSON.stringify(this._settingsData));
      } catch (e) {
        console.warn('[GlobalGame] Failed to save settings:', e);
      }
    },
    
    setSetting(key, value) {
      this._initSettingsStorage();
      if (!key) return false;
      this._settingsData[key] = value;
      this._saveSettingsStorage();
      if (this.debug) console.log('[GlobalGame] Setting saved:', key, '=', value);
      return true;
    },
    
    getSetting(key, defaultValue) {
      this._initSettingsStorage();
      var value = this._settingsData[key];
      return (typeof value === 'undefined') ? defaultValue : value;
    },
    
    saveSettings() {
      this._saveSettingsStorage();
      if (this.debug) console.log('[GlobalGame] All settings saved to localStorage');
    },
    
    resetSettings() {
      this._settingsData = null;
      this._initSettingsStorage(); // 这会重新应用默认值
      this._saveSettingsStorage();
      if (this.debug) console.log('[GlobalGame] Settings reset to defaults');
    },

    // 清除游戏进度
    clearGameProgress() {
      try {
        // 清除对话进度
        this.clearDialogueProgress();
        
        // 清除 prologue 访问记录
        this.clearPrologueVisited();
        
        
        // 清除 prologue 播放历史
        this.clearProloguePlayHistory();
        
        // 清除存档点位置
        this.clearCheckpoint();
        
        // 清除其他游戏数据（保留语言设置避免页面刷新）
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          // 保留设置数据和语言相关数据，避免触发页面刷新
          if (key && key.startsWith('echoSoul_') && 
              key !== 'echoSoul_settings' && 
              key !== 'echoSoul_locale' && 
              !key.includes('_language') && 
              !key.includes('_i18n')) {
            keysToRemove.push(key);
          }
        }
        
        for (var j = 0; j < keysToRemove.length; j++) {
          localStorage.removeItem(keysToRemove[j]);
          if (this.debug) console.log('[GlobalGame] Removed:', keysToRemove[j]);
        }
        
        // 重置内部状态
        this._dialogueData = null;
        this._checkpointActivations = {};
        this._prologuePlayHistory = {};
        this._checkpointPosition = null;
        
        if (this.debug) console.log('[GlobalGame] All game progress cleared');
        return true;
      } catch (e) {
        console.error('[GlobalGame] Error clearing game progress:', e);
        return false;
      }
    },

    // ---- internal: state hooks ----
    _enter(s, data) {
      var fn = this._cb.enter[s]; if (fn) fn.call(this, data);
      this.app.fire('gamestate:enter', { state: s, data: data });

      // hook update for this state (simple lightweight driver)
      var self = this;
      var upd = function (dt) {
        var f = self._cb.update[self._current];
        if (f) f.call(self, dt);
        self.app.fire('gamestate:update', {
          state: self._current,
          deltaTime: dt,
          stateTime: (nowMs() - self._stateStart) / 1000
        });
      };
      this._bind(this.app, 'update', upd, this);
    },

    _exit(s) {
      var fn = this._cb.exit[s]; if (fn) fn.call(this);
      this.app.fire('gamestate:exit', { state: s });
      // remove all update listeners we added (will be re-added on next enter)
      this._unsub = this._unsub.filter(function (u) {
        if (u.target === GlobalGame.app && u.event === 'update') {
          try { u.target.off(u.event, u.fn, u.scope); } catch (e) {}
          return false;
        }
        return true;
      });
    },

    _isValidState(s) { return Object.values(this.STATES).indexOf(s) !== -1; },

    // ---- default handlers ----
    _registerDefaultHandlers() {
      var T = this.STATES;
      var self = this;

      // MAIN_MENU
      this.on('enter', T.MAIN_MENU, function () {
        self.app.fire('ui:show_main_menu');
        self.app.fire('ui:hide_hud');
        self.app.fire('player:set_sitting', true);
        // 通知 UIManager 进入多机位锁定模式
        try { self.app.fire('ui:control:set', 'LOCKED_MULTI'); } catch (e) {}
        self._initMainMenuCamera();
      });

      // LEVEL
      this.on('enter', T.LEVEL, function (data) {
        self.app.fire('ui:show_hud');
        self.app.fire('ui:hide_main_menu');
        self.app.fire('player:set_sitting', false);
        if (data && data.levelId) self.app.fire('level:load', data.levelId);
      });

      // FREE_WORLD
      this.on('enter', T.FREE_WORLD, function () {
        self.app.fire('ui:show_hud');
        self.app.fire('ui:hide_main_menu');
        self.app.fire('world:enter_free_mode');
        self.app.fire('player:set_sitting', false);
      });

      // PAUSED
      this.on('enter', T.PAUSED, function () {
        self.app.fire('game:pause');
        self.app.fire('ui:show_pause_menu');
      });
      this.on('exit', T.PAUSED, function () {
        self.app.fire('game:resume');
        self.app.fire('ui:hide_pause_menu');
      });
    },

    // ---- events wiring ----
    _setupGlobalEvents() {
      var self = this;

      // ESC toggle pause
      var onKey = function (e) {
        if (e.key === pc.KEY_ESCAPE) {
          if (self.isInState(self.STATES.LEVEL) || self.isInState(self.STATES.FREE_WORLD)) self.pause();
          else if (self.isInState(self.STATES.PAUSED)) self.resume();
        }
        // G键传送到存档点
        else if (e.key === pc.KEY_G) {
          if (self.isInState(self.STATES.LEVEL) || self.isInState(self.STATES.FREE_WORLD)) {
            self.teleportToCheckpoint();
          }
        }
      };
      this._bind(this.app.keyboard, pc.EVENT_KEYDOWN, onKey, this);

      this._bind(this.app, 'game:start_level', function (id) { self.changeState(self.STATES.LEVEL, { levelId: id }); }, this);
      this._bind(this.app, 'game:enter_free_world', function () { self.enterFreeWorld(); }, this);
      this._bind(this.app, 'game:main_menu', function () { self.toMainMenu(); }, this);
      
      // 注意：Respawn功能由DeathController处理，监听 player:respawn 事件
      // GameManager不再直接处理respawn，避免状态检查限制
      
      // 监听存档点激活事件
      this._bind(this.app, 'checkpoint:activated', function (data) {
        if (data && data.position) {
          self.saveCurrentSceneCheckpoint(data.position, data.checkpointId, data.additionalData);
        }
      }, this);
    },

    _bind(target, event, fn, scope) {
      if (!target || !target.on) return;
      target.on(event, fn, scope);
      this._unsub.push({ target: target, event: event, fn: fn, scope: scope });
    },

    // ---- Camera helpers ----
    _initMainMenuCamera() {
      var cam = this.app.root.findByName('Camera');
      if (!cam || !cam.script || !cam.script.cameraTransition) {
        if (this.debug) console.warn('[GlobalGame] camera or cameraTransition not found');
        return;
      }
      var transition = cam.script.cameraTransition;
      var retries = 0, self = this;
      (function tryGo() {
        var ok = false;
        try { ok = transition.transitionToPosition('mainMenu', null, function(){ if (self.debug) console.log('[GlobalGame] camera at main menu'); }); } catch (e) {}
        if (!ok && retries++ < 5) setTimeout(tryGo, 100 * retries);
        else if (!ok && self.debug) console.warn('[GlobalGame] camera transition failed after retries');
      })();
    },

    switchMainMenuCamera(subPos) {
      if (!this.isInState(this.STATES.MAIN_MENU)) return false;
      var cam = this.app.root.findByName('Camera');
      var t = cam && cam.script && cam.script.cameraTransition;
      if (!t) return false;
      try { return !!t.transitionToPosition('mainMenu', subPos); } catch (e) { return false; }
    },

    // ---- I18n loading ----
    _detectLocale() {
      var nav = (typeof navigator !== 'undefined') ? navigator : null;
      var lang = (nav && (nav.language || (nav.languages && nav.languages[0]))) || 'en-US';
      if (/^zh(?:-Hans)?(?:-CN)?/i.test(lang)) return 'zh-CN';
      if (/^en/i.test(lang)) return 'en-US';
      return 'en-US';
    },

    _loadPrologueForLocale(locale, fallback) {
      var self = this;
      try { I18n.setLocale(locale); } catch (e) {}
      this._currentLocale = locale;
      var primary = 'prologue_' + locale + '.json';

      I18n.loadBundles([{ assetName: primary, namespace: 'prologue' }], function () {
        var ok = !!(I18n.get && I18n.get('prologue'));
        if (!ok && fallback && fallback !== locale) {
          try { I18n.setLocale(fallback); } catch (e) {}
          self._currentLocale = fallback;
          var fb = 'prologue_' + fallback + '.json';
          I18n.loadBundles([{ assetName: fb, namespace: 'prologue' }], function () {
            self._loadUiForLocale(self._currentLocale, (locale === fallback ? null : locale), function () { self._afterI18nLoaded(); });
          });
        } else {
          self._loadUiForLocale(self._currentLocale, fallback, function () { self._afterI18nLoaded(); });
        }
      });
    },

    _loadUiForLocale(locale, fallbackLocale, done) {
      if (typeof I18n === 'undefined' || !I18n.loadBundles) { if (done) done(); return; }
      var self = this;
      var uiAsset = 'ui_' + (locale || 'en-US') + '.json';
      var titleAsset = 'title_' + (locale || 'en-US') + '.json';
      
      // 同时加载 ui 和 title
      I18n.loadBundles([
        { assetName: uiAsset, namespace: 'ui' },
        { assetName: titleAsset, namespace: 'title' }
      ], function () {
        var uiOk = !!(I18n.get && I18n.get('ui'));
        var titleOk = !!(I18n.get && I18n.get('title'));
        
        if (self.debug) console.log('[GlobalGame] Loaded UI:', uiOk, 'Title:', titleOk);
        
        // 如果失败，尝试 fallback
        if ((!uiOk || !titleOk) && fallbackLocale && fallbackLocale !== locale) {
          var fbUi = 'ui_' + fallbackLocale + '.json';
          var fbTitle = 'title_' + fallbackLocale + '.json';
          I18n.loadBundles([
            { assetName: fbUi, namespace: 'ui' },
            { assetName: fbTitle, namespace: 'title' }
          ], function () { 
            if (done) done(); 
          });
        } else { 
          if (done) done(); 
        }
      });
    },

    _afterI18nLoaded() {
      this.changeState(this.defaultState);
      var ok = !!(I18n.get && I18n.get('prologue'));
      if (ok) {
        try { this._applyLocaleFonts(this._currentLocale || 'en-US'); } catch (e) {}
        this.app.fire('i18n:ready');
        if (this.debug) console.log('[GlobalGame] i18n ready');
        
        // 检测关卡 prologue
        this._checkLevelPrologue();
        
        // 显示初始场景标题（延迟确保 UI 完全初始化）
        var self = this;
        setTimeout(function() {
          if (self._currentScene) {
            self._showSceneTitle(self._currentScene);
          }
        }, 1000);
      } else {
        console.warn('[GlobalGame] prologue bundle missing');
      }
    },
    
    // ---- 关卡 Prologue 检测 ----
    _checkLevelPrologue() {
      // 【临时禁用】跳过关卡 prologue
      if (this.debug) console.log('[GlobalGame] Level prologue disabled - skipping');
      return;
      
      /* 原逻辑（已禁用）
      try {
        // 获取当前场景名称
        var sceneName = this.app.scene && this.app.scene.name;
        if (!sceneName) {
          if (this.debug) console.log('[GlobalGame] No scene name, skip level prologue check');
          return;
        }
        
        // 判断是否为关卡场景（例如：level1, level2 等）
        var levelMatch = sceneName.match(/^level(\d+)$/i);
        if (!levelMatch) {
          if (this.debug) console.log('[GlobalGame] Not a level scene:', sceneName);
          return;
        }
        
        var levelNum = levelMatch[1];
        var levelKey = 'level' + levelNum;
        
        // 检查是否已访问过该关卡
        if (this._prologueVisited && this._prologueVisited[levelKey]) {
          if (this.debug) console.log('[GlobalGame] Level', levelKey, 'already visited, skip prologue');
          return;
        }
        
        // 检查 i18n 中是否有该关卡的 prologue
        var levelPrologueData = (typeof I18n !== 'undefined' && I18n.get) ? I18n.get('prologue', levelKey) : null;
        if (!levelPrologueData) {
          if (this.debug) console.log('[GlobalGame] No prologue data for', levelKey);
          return;
        }
        
        // 标记为已访问
        this._prologueVisited[levelKey] = true;
        this._savePrologueVisited();
        
        // 触发关卡 prologue 播放事件
        this.app.fire('level:prologue:play', {
          levelKey: levelKey,
          levelNum: levelNum,
          data: levelPrologueData
        });
        
        if (this.debug) console.log('[GlobalGame] Trigger level prologue for', levelKey);
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Level prologue check failed:', e);
      }
      */
    },

    _applyLocaleFonts(locale) {
      var isZh = (locale === 'zh-CN');
      var fontName = isZh ? 'ZCOOLKuaiLe-Regular.ttf' : 'plotFont.ttf';
      var a = this._findFontAssetByName(fontName);
      if (!a) { console.warn('[GlobalGame] font not found:', fontName); return; }
      var stack = [ this.app.root ];
      while (stack.length) {
        var n = stack.pop();
        if (n.element && n.element.type === pc.ELEMENTTYPE_TEXT) {
          try { n.element.fontAsset = a.id || a; } catch (e) {}
        }
        var ch = n.children || [];
        for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
      }
      if (this.debug) console.log('[GlobalGame] applied font for', locale, '->', fontName);
    },

    _findFontAssetByName(name) {
      if (!this.app || !this.app.assets) return null;
      return this.app.assets.find(name, 'font') || this.app.assets.find(name) || null;
    },
    
    // ---- Prologue 访问记录管理 ----
    _loadPrologueVisited() {
      // 从 localStorage 加载已访问的 prologue
      try {
        if (typeof localStorage === 'undefined') {
          this._prologueVisited = {};
          return;
        }
        var saved = localStorage.getItem('echoSoul_prologueVisited');
        if (saved) {
          this._prologueVisited = JSON.parse(saved);
          if (this.debug) console.log('[GlobalGame] Loaded prologue visited:', this._prologueVisited);
        } else {
          this._prologueVisited = {};
        }
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to load prologue visited:', e);
        this._prologueVisited = {};
      }
    },
    
    _savePrologueVisited() {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem('echoSoul_prologueVisited', JSON.stringify(this._prologueVisited));
        if (this.debug) console.log('[GlobalGame] Saved prologue visited:', this._prologueVisited);
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to save prologue visited:', e);
      }
    },
    
    /**
     * 标记某个 prologue 已访问
     * @param {string} prologueKey - prologue 键名（如 'welcome', 'intro'）
     */
    markPrologueVisited(prologueKey) {
      if (!prologueKey) return;
      this._prologueVisited[prologueKey] = true;
      this._savePrologueVisited();
      if (this.debug) console.log('[GlobalGame] Marked prologue visited:', prologueKey);
    },
    
    /**
     * 检查某个 prologue 是否已访问
     * @param {string} prologueKey - prologue 键名（如 'welcome', 'intro'）
     * @returns {boolean}
     */
    hasPrologueVisited(prologueKey) {
      return !!this._prologueVisited[prologueKey];
    },
    
    /**
     * 清除某个 prologue 的访问记录（用于测试或重置）
     * @param {string} prologueKey - prologue 键名，不传则清除所有
     */
    clearPrologueVisited(prologueKey) {
      if (prologueKey) {
        delete this._prologueVisited[prologueKey];
        if (this.debug) console.log('[GlobalGame] Cleared prologue visited:', prologueKey);
      } else {
        this._prologueVisited = {};
        if (this.debug) console.log('[GlobalGame] Cleared all prologue visited');
      }
      this._savePrologueVisited();
    },
    
    // ---- 玩家设置管理 ----
    _loadPlayerSettings() {
      try {
        if (typeof localStorage === 'undefined') return;
        var saved = localStorage.getItem('echoSoul_playerSettings');
        if (saved) {
          this._playerSettings = JSON.parse(saved);
          if (this.debug) console.log('[GlobalGame] Loaded player settings:', this._playerSettings);
        }
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to load player settings:', e);
        this._playerSettings = {};
      }
    },
    
    _savePlayerSettings() {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem('echoSoul_playerSettings', JSON.stringify(this._playerSettings));
        if (this.debug) console.log('[GlobalGame] Saved player settings:', this._playerSettings);
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to save player settings:', e);
      }
    },
    
    /**
     * 设置玩家首选项
     * @param {string} key - 设置键名（如 'masterVolume', 'language'）
     * @param {any} value - 设置值
     */
    setSetting(key, value) {
      if (!key) return;
      
      // 特殊处理：语言变更（不持久化，仅会话期间有效）
      if (key === 'language' && value && (value === 'zh-CN' || value === 'en-US')) {
        if (this.debug) {
          console.log('[GlobalGame] ===== Language Change (Session Only) =====');
          console.log('[GlobalGame] New language:', value);
          console.log('[GlobalGame] Current locale:', this._currentLocale);
          console.log('[GlobalGame] Note: Change is temporary, will reset on page refresh');
        }
        
        // 不保存到 playerSettings 和 localStorage
        // 仅更新当前会话的语言
        this.setLocale(value);
        
        if (this.debug) console.log('[GlobalGame] =============================================');
        
        // 触发事件通知其他系统
        if (this.app) this.app.fire('setting:changed', key, value);
        return; // 不保存到 playerSettings
      }
      
      // 其他设置正常保存
      this._playerSettings[key] = value;
      this._savePlayerSettings();
      if (this.debug) console.log('[GlobalGame] Set setting:', key, '=', value);
      
      // 触发事件通知其他系统
      if (this.app) this.app.fire('setting:changed', key, value);
    },
    
    /**
     * 获取玩家首选项
     * @param {string} key - 设置键名
     * @param {any} defaultValue - 默认值
     * @returns {any}
     */
    getSetting(key, defaultValue) {
      if (!key) return defaultValue;
      
      // 特殊处理：语言返回当前会话的值
      if (key === 'language') {
        return this._currentLocale || this._detectLocale();
      }
      
      var value = this._playerSettings[key];
      return (value !== null && value !== undefined) ? value : defaultValue;
    },
    
    /**
     * 获取所有设置
     * @returns {object}
     */
    getAllSettings() {
      return Object.assign({}, this._playerSettings);
    },
    
    /**
     * 清除所有设置（恢复默认）
     */
    clearAllSettings() {
      this._playerSettings = {};
      this._savePlayerSettings();
      if (this.debug) console.log('[GlobalGame] Cleared all settings');
    },
    
    // ---- Prologue 播放历史管理 ----
    
    /**
     * 加载 prologue 播放历史
     */
    _loadProloguePlayHistory() {
      try {
        if (typeof localStorage === 'undefined') {
          this._prologuePlayHistory = {};
          return;
        }
        var saved = localStorage.getItem('echoSoul_prologuePlayHistory');
        if (saved) {
          this._prologuePlayHistory = JSON.parse(saved);
          if (this.debug) console.log('[GlobalGame] Loaded prologue play history:', Object.keys(this._prologuePlayHistory));
        } else {
          this._prologuePlayHistory = {};
        }
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to load prologue play history:', e);
        this._prologuePlayHistory = {};
      }
    },
    
    /**
     * 保存 prologue 播放历史
     */
    _saveProloguePlayHistory() {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem('echoSoul_prologuePlayHistory', JSON.stringify(this._prologuePlayHistory));
        if (this.debug) console.log('[GlobalGame] Saved prologue play history:', Object.keys(this._prologuePlayHistory));
      } catch (e) {
        if (this.debug) console.warn('[GlobalGame] Failed to save prologue play history:', e);
      }
    },
    
    /**
     * 记录 prologue 播放
     * @param {string} prologueKey - prologue 键名
     * @param {string} checkpointId - 触发的存档点ID（可选）
     * @param {object} additionalData - 额外数据（可选）
     */
    recordProloguePlay(prologueKey, checkpointId, additionalData) {
      if (!prologueKey) return;
      
      var playData = {
        timestamp: Date.now(),
        scene: this._currentScene || 'unknown'
      };
      
      if (checkpointId) {
        playData.checkpointId = checkpointId;
      }
      
      if (additionalData) {
        Object.assign(playData, additionalData);
      }
      
      this._prologuePlayHistory[prologueKey] = playData;
      
      if (this.debug) console.log('[GlobalGame] Recorded prologue play:', prologueKey, 'data:', playData);
      
      this._saveProloguePlayHistory();
    },
    
    /**
     * 获取 prologue 播放记录
     * @param {string} prologueKey - prologue 键名，不传则返回所有
     * @returns {object|object[]}
     */
    getProloguePlayRecord(prologueKey) {
      if (prologueKey) {
        return this._prologuePlayHistory[prologueKey] || null;
      }
      return Object.assign({}, this._prologuePlayHistory);
    },
    
    /**
     * 检查 prologue 是否已播放
     * @param {string} prologueKey - prologue 键名
     * @returns {boolean}
     */
    hasProloguePlayed(prologueKey) {
      return !!this._prologuePlayHistory[prologueKey];
    },
    
    /**
     * 获取场景中的所有 prologue 播放记录
     * @param {string} sceneName - 场景名称，不传则使用当前场景
     * @returns {object[]}
     */
    getScenePrologues(sceneName) {
      var scene = sceneName || this._currentScene;
      var result = [];
      
      for (var key in this._prologuePlayHistory) {
        var record = this._prologuePlayHistory[key];
        if (record.scene === scene) {
          result.push({
            key: key,
            data: record
          });
        }
      }
      
      // 按时间戳排序
      result.sort(function(a, b) {
        return a.data.timestamp - b.data.timestamp;
      });
      
      return result;
    },
    
    /**
     * 清除 prologue 播放历史
     * @param {string} prologueKey - prologue 键名，不传则清除所有
     */
    clearProloguePlayHistory(prologueKey) {
      if (prologueKey) {
        delete this._prologuePlayHistory[prologueKey];
        if (this.debug) console.log('[GlobalGame] Cleared prologue play record:', prologueKey);
      } else {
        this._prologuePlayHistory = {};
        if (this.debug) console.log('[GlobalGame] Cleared all prologue play history');
      }
      this._saveProloguePlayHistory();
    }
  };

  // expose globally
  global.GlobalGame = GlobalGame;

})(typeof window !== 'undefined' ? window : this);

// ---------------------------------------------------------------------------
// Example bootstrap (optional):
// In a PlayCanvas script that runs early (e.g., on a dummy entity), call:
// GlobalGame.init(this.app, { defaultState: GlobalGame.STATES.MAIN_MENU, debug: true });
// ---------------------------------------------------------------------------
