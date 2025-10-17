/* global pc */
/**
 * @file TitleTyperTest.js
 * @desc TitleTyper 测试脚本 - 按 T 键测试标题显示
 */
var TitleTyperTest = pc.createScript('titleTyperTest');

TitleTyperTest.attributes.add('testKey', {
    type: 'string',
    default: 'level.mind_shore.entrance',
    title: '测试标题 Key'
});

TitleTyperTest.prototype.initialize = function () {
    var self = this;
    
    console.log('[TitleTyperTest] Initialized, press T to test title display');
    console.log('[TitleTyperTest] Test key:', this.testKey);
    
    // 按 T 键测试
    this._onKeyDown = function (e) {
        if (e.key === pc.KEY_T) {
            console.log('[TitleTyperTest] T key pressed, triggering title:show');
            console.log('[TitleTyperTest] Key:', self.testKey);
            
            try {
                self.app.fire('title:show', self.testKey);
                console.log('[TitleTyperTest] Event fired successfully');
            } catch (err) {
                console.error('[TitleTyperTest] Failed to fire event:', err);
            }
        }
    };
    
    this.app.keyboard.on(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    
    // 3秒后自动测试一次
    setTimeout(function() {
        console.log('[TitleTyperTest] Auto-testing after 3 seconds...');
        try {
            self.app.fire('title:show', self.testKey);
            console.log('[TitleTyperTest] Auto-test fired');
        } catch (err) {
            console.error('[TitleTyperTest] Auto-test failed:', err);
        }
    }, 3000);
};

TitleTyperTest.prototype.destroy = function () {
    if (this.app && this.app.keyboard && this._onKeyDown) {
        this.app.keyboard.off(pc.EVENT_KEYDOWN, this._onKeyDown, this);
    }
    console.log('[TitleTyperTest] Destroyed');
};
