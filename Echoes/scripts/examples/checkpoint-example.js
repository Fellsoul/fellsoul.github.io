/* global pc */

/**
 * @file checkpoint-example.js
 * @desc SmartTrigger 使用示例：检查点系统
 * @使用方法
 *   1. 创建检查点实体，添加 Collision 组件（Box，无 Rigidbody）
 *   2. 挂载 smart-trigger.js 脚本：
 *      - useCollision = true
 *      - once = true
 *      - targetTag = 'player'
 *      - enterEvent = 'checkpoint:reached'
 *   3. 在 GameManager 或其他脚本中挂载本示例脚本
 *   4. 玩家穿过检查点时自动存档并显示提示
 */

var CheckpointExample = pc.createScript('checkpointExample');

/* ---------- 属性 ---------- */
CheckpointExample.attributes.add('uiEntity', { 
    type: 'entity', 
    title: 'UI 提示实体',
    description: '显示"检查点已到达"的 UI 元素（可选）'
});

CheckpointExample.attributes.add('saveToLocalStorage', { 
    type: 'boolean', 
    default: true, 
    title: '保存到本地存储',
    description: '是否将检查点信息保存到 localStorage'
});

CheckpointExample.attributes.add('debugLog', { 
    type: 'boolean', 
    default: true, 
    title: '调试日志'
});

CheckpointExample.attributes.add('isLevelCheckpoint', {
    type: 'boolean',
    default: false,
    title: '关卡存档点',
    description: '勾选后，到达存档点时会自动加载并淡入显示下一部分内容'
});

CheckpointExample.attributes.add('nextSectionRoot', {
    type: 'entity',
    title: '下一部分根节点',
    description: '存档时要淡入显示的节点（会显示其所有子节点）'
});

CheckpointExample.attributes.add('fadeInDuration', {
    type: 'number',
    default: 1.5,
    title: '淡入时长（秒）',
    description: '下一部分内容的淡入动画时长'
});

CheckpointExample.attributes.add('fadeInDelay', {
    type: 'number',
    default: 0.5,
    title: '淡入延迟（秒）',
    description: '到达存档点后，延迟多久开始淡入'
});

/* ---------- 生命周期 ---------- */
CheckpointExample.prototype.initialize = function () {
    // 监听全局检查点事件
    this.app.on('checkpoint:reached', this.onCheckpointReached, this);

    // 加载已保存的检查点（如果有）
    this.loadLastCheckpoint();

    if (this.debugLog) {
        console.log('[CheckpointExample] 检查点系统已初始化');
    }
};

CheckpointExample.prototype.destroy = function () {
    // 解绑事件
    this.app.off('checkpoint:reached', this.onCheckpointReached, this);
};

/* ---------- 检查点逻辑 ---------- */
CheckpointExample.prototype.onCheckpointReached = function (triggerEntity, player) {
    if (this.debugLog) {
        console.log('[CheckpointExample] 到达检查点:', triggerEntity.name);
    }

    // 保存检查点数据
    var checkpointData = {
        name: triggerEntity.name,
        position: player.getPosition().clone(),
        rotation: player.getRotation().clone(),
        timestamp: Date.now()
    };

    // 保存到本地存储
    if (this.saveToLocalStorage) {
        this.saveCheckpoint(checkpointData);
    }

    // 显示 UI 提示
    this.showCheckpointUI(triggerEntity.name);

    // 如果是关卡存档点，加载并淡入下一部分
    if (this.isLevelCheckpoint && this.nextSectionRoot) {
        this.loadNextSection();
    }

    // 可选：播放音效
    // AudioManager.playSound('checkpoint_reached');
};

/* ---------- 存储与加载 ---------- */
CheckpointExample.prototype.saveCheckpoint = function (data) {
    try {
        var serialized = JSON.stringify({
            name: data.name,
            position: [data.position.x, data.position.y, data.position.z],
            rotation: [data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w],
            timestamp: data.timestamp
        });

        localStorage.setItem('echoSoul_lastCheckpoint', serialized);

        if (this.debugLog) {
            console.log('[CheckpointExample] 检查点已保存:', data.name);
        }
    } catch (e) {
        console.error('[CheckpointExample] 保存检查点失败:', e);
    }
};

CheckpointExample.prototype.loadLastCheckpoint = function () {
    try {
        var stored = localStorage.getItem('echoSoul_lastCheckpoint');
        if (!stored) {
            if (this.debugLog) {
                console.log('[CheckpointExample] 未找到保存的检查点');
            }
            return null;
        }

        var data = JSON.parse(stored);

        if (this.debugLog) {
            console.log('[CheckpointExample] 加载检查点:', data.name);
        }

        return {
            name: data.name,
            position: new pc.Vec3(data.position[0], data.position[1], data.position[2]),
            rotation: new pc.Quat(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]),
            timestamp: data.timestamp
        };
    } catch (e) {
        console.error('[CheckpointExample] 加载检查点失败:', e);
        return null;
    }
};

/**
 * 在玩家死亡或重新开始时，传送到最后的检查点
 */
CheckpointExample.prototype.respawnAtLastCheckpoint = function (player) {
    var checkpoint = this.loadLastCheckpoint();
    if (checkpoint && player && player.rigidbody) {
        player.rigidbody.teleport(checkpoint.position, checkpoint.rotation);

        if (this.debugLog) {
            console.log('[CheckpointExample] 已传送到检查点:', checkpoint.name);
        }

        return true;
    }

    if (this.debugLog) {
        console.warn('[CheckpointExample] 无法传送：检查点或玩家不存在');
    }
    return false;
};

/* ---------- UI 提示 ---------- */
CheckpointExample.prototype.showCheckpointUI = function (checkpointName) {
    if (!this.uiEntity) return;

    // 假设 UI 实体有 element 组件和文本子元素
    var textElement = this.uiEntity.findByName('CheckpointText');
    if (textElement && textElement.element) {
        textElement.element.text = '检查点已到达: ' + checkpointName;
    }

    // 显示 UI
    this.uiEntity.enabled = true;

    // 2 秒后隐藏
    setTimeout(function() {
        this.uiEntity.enabled = false;
    }.bind(this), 2000);
};

/* ---------- 公共 API ---------- */

/**
 * 清除所有检查点数据（如重新开始游戏）
 */
CheckpointExample.prototype.clearAllCheckpoints = function () {
    try {
        localStorage.removeItem('echoSoul_lastCheckpoint');
        if (this.debugLog) {
            console.log('[CheckpointExample] 检查点数据已清除');
        }
    } catch (e) {
        console.error('[CheckpointExample] 清除检查点失败:', e);
    }
};

/**
 * 获取所有检查点实体（用于调试或地图显示）
 */
CheckpointExample.prototype.getAllCheckpoints = function () {
    var checkpoints = [];
    var triggers = this.app.root.find(function(entity) {
        return entity.script && entity.script.smartTrigger;
    });

    triggers.forEach(function(trigger) {
        var script = trigger.script.smartTrigger;
        if (script.enterEvent === 'checkpoint:reached') {
            checkpoints.push({
                entity: trigger,
                name: trigger.name,
                position: trigger.getPosition().clone()
            });
        }
    });

    return checkpoints;
};

/* ---------- 关卡存档点：淡入下一部分 ---------- */

/**
 * 加载并淡入显示下一部分内容
 */
CheckpointExample.prototype.loadNextSection = function () {
    if (!this.nextSectionRoot) {
        console.warn('[CheckpointExample] nextSectionRoot 未配置');
        return;
    }

    if (this.debugLog) {
        console.log('[CheckpointExample] 开始加载下一部分:', this.nextSectionRoot.name);
    }

    // 启用根节点
    this.nextSectionRoot.enabled = true;

    // 收集所有需要淡入的子节点（包含 element、model 或 render 组件）
    var fadeItems = this._collectFadeItems(this.nextSectionRoot);

    if (fadeItems.length === 0) {
        if (this.debugLog) {
            console.warn('[CheckpointExample] 未找到可淡入的子节点');
        }
        return;
    }

    if (this.debugLog) {
        console.log('[CheckpointExample] 找到', fadeItems.length, '个可淡入的节点');
    }

    // 设置初始透明度为 0
    for (var i = 0; i < fadeItems.length; i++) {
        this._setOpacity(fadeItems[i], 0);
    }

    // 延迟后开始淡入
    var self = this;
    setTimeout(function () {
        self._fadeInItems(fadeItems);
    }, this.fadeInDelay * 1000);
};

/**
 * 收集所有可淡入的节点
 */
CheckpointExample.prototype._collectFadeItems = function (root) {
    var items = [];

    var collect = function (entity) {
        // 检查是否有可淡入的组件
        var item = null;

        if (entity.element) {
            item = { entity: entity, type: 'element', component: entity.element };
        } else if (entity.model) {
            item = { entity: entity, type: 'model', component: entity.model };
        } else if (entity.render) {
            item = { entity: entity, type: 'render', component: entity.render };
        }

        if (item) {
            items.push(item);
        }

        // 递归处理子节点
        var children = entity.children;
        for (var i = 0; i < children.length; i++) {
            collect(children[i]);
        }
    };

    collect(root);
    return items;
};

/**
 * 设置节点透明度
 */
CheckpointExample.prototype._setOpacity = function (item, opacity) {
    try {
        if (item.type === 'element') {
            item.component.opacity = opacity;
        } else if (item.type === 'model' || item.type === 'render') {
            // 设置材质透明度
            var meshInstances = item.component.meshInstances;
            if (meshInstances) {
                for (var i = 0; i < meshInstances.length; i++) {
                    var material = meshInstances[i].material;
                    if (material) {
                        // 保存原始颜色（第一次设置时）
                        if (!item.originalColors) {
                            item.originalColors = [];
                            item.originalOpacities = [];
                        }
                        if (!item.originalColors[i]) {
                            item.originalColors[i] = material.diffuse ? material.diffuse.clone() : new pc.Color(1, 1, 1);
                            item.originalOpacities[i] = material.opacity !== undefined ? material.opacity : 1;
                        }

                        // 启用透明
                        material.blendType = pc.BLEND_NORMAL;
                        material.opacity = opacity;
                        material.update();
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[CheckpointExample] 设置透明度失败:', e);
    }
};

/**
 * 淡入所有节点
 */
CheckpointExample.prototype._fadeInItems = function (items) {
    var startTime = Date.now();
    var duration = this.fadeInDuration * 1000; // 转换为毫秒
    var self = this;

    var animate = function () {
        var elapsed = Date.now() - startTime;
        var progress = Math.min(1, elapsed / duration);
        var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

        // 更新所有节点的透明度
        for (var i = 0; i < items.length; i++) {
            self._setOpacity(items[i], eased);
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // 动画完成，恢复完全不透明
            for (var i = 0; i < items.length; i++) {
                self._setOpacity(items[i], 1);
            }

            if (self.debugLog) {
                console.log('[CheckpointExample] 淡入动画完成');
            }

            // 触发事件通知其他系统
            self.app.fire('checkpoint:section_loaded', self.nextSectionRoot);
        }
    };

    requestAnimationFrame(animate);
};
