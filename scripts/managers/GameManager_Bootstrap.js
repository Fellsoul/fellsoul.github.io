/* global pc */
/**
 * @file GameManager_Bootstrap.js
 * @desc 确保 GameManager 在其他脚本之前加载和初始化
 * @priority 1 (最高优先级，在 PlayCanvas 设置中设为 1)
 */
var GameManagerBootstrap = pc.createScript('gameManagerBootstrap');

GameManagerBootstrap.attributes.add('debug', {
    type: 'boolean',
    default: true,
    title: 'Debug Mode'
});

GameManagerBootstrap.attributes.add('defaultState', {
    type: 'string',
    default: 'main_menu',
    title: 'Default State'
});

GameManagerBootstrap.prototype.initialize = function () {
    console.log('[GameManagerBootstrap] Initializing...');
    
    // 检查 GlobalGame 是否已经存在
    if (typeof GlobalGame === 'undefined') {
        console.error('[GameManagerBootstrap] GlobalGame is not defined!');
        console.error('[GameManagerBootstrap] Make sure GameManager.js is loaded before other scripts.');
        console.error('[GameManagerBootstrap] Set GameManager.js loading priority to 1 in PlayCanvas Editor.');
        return;
    }
    
    // 初始化 GlobalGame
    if (!GlobalGame.app) {
        console.log('[GameManagerBootstrap] Initializing GlobalGame...');
        try {
            GlobalGame.init(this.app, {
                defaultState: this.defaultState,
                debug: this.debug
            });
            console.log('[GameManagerBootstrap] GlobalGame initialized successfully');
        } catch (e) {
            console.error('[GameManagerBootstrap] Failed to initialize GlobalGame:', e);
        }
    } else {
        console.log('[GameManagerBootstrap] GlobalGame already initialized');
    }
};

// 确保这个脚本在最早期执行
GameManagerBootstrap.prototype.preload = function () {
    console.log('[GameManagerBootstrap] Preload phase');
};
