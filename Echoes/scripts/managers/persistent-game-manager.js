/* global pc */
/**
 * @file persistent-game-manager.js
 * @desc 让挂载了本脚本的实体在切换场景时“临时摘除→加载后挂回”，实现跨场景持久化。
 * 使用：
 *   - 在首个场景中创建一个实体，挂上 GameManager 与 PersistentGameManager 两个脚本。
 *   - 后续场景中若也存在该脚本实例，会在 initialize() 里检测到已有单例并自我销毁。
 *   - 通过 app.changeScene(url, cb) 进行切场景，该方法会派发自定义事件：
 *       scene:beforeLoad  → PersistentGameManager 在此从层级中移除自身实体
 *       scene:afterLoad   → PersistentGameManager 在此将自身实体重新挂回 app.root
 */
var PersistentGameManager = pc.createScript('persistentGameManager');

PersistentGameManager.attributes.add('enableDebugLog', { type: 'boolean', default: false, title: '调试日志' });

PersistentGameManager.prototype.initialize = function () {
  var app = this.app;

  // 单例保护：保留第一次创建的实例
  if (app._gameManager) {
    if (this.enableDebugLog) console.log('[PersistentGameManager] Duplicate detected, destroying self');
    this.entity.destroy();
    return;
  }

  app._gameManager = this;                 // 暴露脚本实例
  app._gameManagerEntity = this.entity;    // 持久化的实体引用

  // 绑定 before/after 事件（由 app.changeScene 驱动）
  var self = this;
  this._onBefore = function () {
    // 从层级中移除，避免被 loadSceneHierarchy 清空
    try {
      if (app._gameManagerEntity && app._gameManagerEntity.parent) {
        app._gameManagerEntity.removeFromHierarchy();
        if (self.enableDebugLog) console.log('[PersistentGameManager] Removed from hierarchy (beforeLoad)');
      }
    } catch (e) {}
  };
  this._onAfter = function () {
    // 加载完成后再挂回根节点
    try {
      if (app._gameManagerEntity && !app._gameManagerEntity.parent) {
        app.root.addChild(app._gameManagerEntity);
        if (self.enableDebugLog) console.log('[PersistentGameManager] Added back to root (afterLoad)');
      }
    } catch (e) {}
  };

  app.on('scene:beforeLoad', this._onBefore, this);
  app.on('scene:afterLoad', this._onAfter, this);

  // 提供统一的切场景方法（若尚未注入）
  if (!app.changeScene) {
    app.changeScene = function (sceneUrl, done) {
      // 触发 beforeLoad（让持久化实体先摘除）
      app.fire('scene:beforeLoad');

      app.loadSceneSettings(sceneUrl, function (err) {
        if (err) {
          console.error('[Scene] loadSceneSettings error:', err);
          if (done) done(err);
          return;
        }
        app.loadSceneHierarchy(sceneUrl, function (err2, root) {
          if (err2) {
            console.error('[Scene] loadSceneHierarchy error:', err2);
            if (done) done(err2);
            return;
          }
          // 场景已完成加载，将持久化实体挂回
          app.fire('scene:afterLoad');
          if (done) done(null, root);
        });
      });
    };
  }

  if (this.enableDebugLog) console.log('[PersistentGameManager] Singleton ready');
};

PersistentGameManager.prototype.destroy = function () {
  var app = this.app;
  // 仅当自己是全局实例时解绑监听
  if (app && app._gameManager === this) {
    try { app.off('scene:beforeLoad', this._onBefore, this); } catch (e) {}
    try { app.off('scene:afterLoad', this._onAfter, this); } catch (e) {}
    app._gameManager = null;
    app._gameManagerEntity = null;
  }
};
