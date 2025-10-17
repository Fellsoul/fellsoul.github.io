/**
 * @file water-wave-shader.js
 * @desc 使用自定义顶点着色器在 GPU 顶点阶段产生上下波浪，不依赖 CPU 改写顶点。
 * @pc-attrs
 *   amplitude:number=0.25, frequency:number=0.6, speed:number=1.0, phaseOffset:number=0.0,
 *   baseColor:rgb=#6fb7ff, opacity:number=0.85, useWorldXZ:boolean=true
 */
/* global pc */
var WaterWaveShader = pc.createScript('waterWave');

WaterWaveShader.attributes.add('amplitude', { type: 'number', default: 0.25, title: '振幅(米)' });
WaterWaveShader.attributes.add('frequency', { type: 'number', default: 0.6, title: '空间频率' });
WaterWaveShader.attributes.add('speed', { type: 'number', default: 1.0, title: '相位速度' });
WaterWaveShader.attributes.add('phaseOffset', { type: 'number', default: 0.0, title: '相位偏移' });
WaterWaveShader.attributes.add('useWorldXZ', { type: 'boolean', default: true, title: '使用世界XZ参与相位' });
WaterWaveShader.attributes.add('baseColor', { type: 'rgb', default: [0.44, 0.72, 1.0], title: '颜色' });
WaterWaveShader.attributes.add('opacity', { type: 'number', default: 0.85, title: '透明度(0~1)' });

WaterWaveShader.prototype.initialize = function () {
    this.render = this.entity.render || this.entity.model;
    if (!this.render || !this.render.meshInstances || this.render.meshInstances.length === 0) {
        console.warn('[WaterWaveShader] Missing render/model on entity:', this.entity.name);
        this.enabled = false;
        return;
    }

    // 生成自定义 Shader（简易非光照版，可作为占位；需要保留 PBR 可改用 material.chunks 方案）
    var device = this.app.graphicsDevice;

    var vs = [
        'attribute vec3 aPosition;',
        'attribute vec3 aNormal;',
        'attribute vec2 aUv0;',
        'uniform mat4 matrix_model;',
        'uniform mat4 matrix_viewProjection;',
        'uniform float uTime;',
        'uniform float uAmp;',
        'uniform float uFreq;',
        'uniform float uSpeed;',
        'uniform float uPhase;',
        'uniform float uUseWorldXZ;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'void main(void){',
        '  vec3 pos = aPosition;',
        '  float xz = (uUseWorldXZ > 0.5) ? ( (matrix_model * vec4(pos,1.0)).x + (matrix_model * vec4(pos,1.0)).z ) : (pos.x + pos.z);',
        '  float wave = sin(xz * uFreq + uTime * uSpeed + uPhase) * uAmp;',
        '  pos.y += wave;',
        '  vec4 wpos = matrix_model * vec4(pos, 1.0);',
        '  gl_Position = matrix_viewProjection * wpos;',
        '  vNormal = mat3(matrix_model) * aNormal;',
        '  vUv = aUv0;',
        '}'
    ].join('\n');

    var fs = [
        'precision mediump float;',
        'uniform vec4 uColor;',
        'varying vec3 vNormal;',
        'varying vec2 vUv;',
        'void main(void){',
        '  // 简单Lambert近似以免完全平涂',
        '  vec3 N = normalize(vNormal);',
        '  vec3 L = normalize(vec3(0.3, 1.0, 0.2));',
        '  float ndl = clamp(dot(N, L)*0.5+0.5, 0.0, 1.0);',
        '  vec3 col = uColor.rgb * (0.55 + 0.45 * ndl);',
        '  gl_FragColor = vec4(col, uColor.a);',
        '}'
    ].join('\n');

    this._shader = new pc.Shader(device, {
        attributes: {
            aPosition: pc.SEMANTIC_POSITION,
            aNormal: pc.SEMANTIC_NORMAL,
            aUv0: pc.SEMANTIC_TEXCOORD0
        },
        vshader: vs,
        fshader: fs
    });

    // 克隆材质并替换 shader（保持每个 MI 独立材质，避免影响其他实例）
    this._origMaterials = [];
    this._materials = [];
    this._t0 = 0;

    for (var i = 0; i < this.render.meshInstances.length; i++) {
        var mi = this.render.meshInstances[i];
        var origMat = mi.material;
        this._origMaterials.push(origMat);

        var mat = new pc.Material();
        mat.shader = this._shader;
        mat.setParameter('uColor', new pc.Vec4(this.baseColor[0], this.baseColor[1], this.baseColor[2], this.opacity));
        mat.setParameter('uAmp', this.amplitude);
        mat.setParameter('uFreq', this.frequency);
        mat.setParameter('uSpeed', this.speed);
        mat.setParameter('uPhase', this.phaseOffset);
        mat.setParameter('uUseWorldXZ', this.useWorldXZ ? 1.0 : 0.0);
        // 透明混合设置
        mat.blendType = pc.BLEND_NORMAL; // 透明混合
        mat.depthWrite = false;          // 透明一般不写深度，避免排序伪影（按需调整）
        mat.depthTest = true;
        mat.cull = pc.CULLFACE_NONE;
        mat.update();

        mi.material = mat;
        // 自定义 shader 不包含阴影pass：关闭该网格的投射阴影，避免“no shader for pass 4”
        mi.castShadow = false;
        // 接收阴影可按需保留（一般水面也可关闭以避免硬阴影）
        // mi.receiveShadow = false;
        this._materials.push(mat);
    }
};

WaterWaveShader.prototype.update = function (dt) {
    this._t0 += dt;
    if (!this._materials) return;
    for (var i = 0; i < this._materials.length; i++) {
        var mat = this._materials[i];
        if (mat) mat.setParameter('uTime', this._t0);
    }
};

WaterWaveShader.prototype.destroy = function () {
    // 恢复原材质
    if (this.render && this._origMaterials) {
        for (var i = 0; i < this.render.meshInstances.length; i++) {
            if (this.render.meshInstances[i] && this._origMaterials[i]) {
                this.render.meshInstances[i].material = this._origMaterials[i];
            }
        }
    }
    // 释放自定义材质
    if (this._materials) {
        for (var j = 0; j < this._materials.length; j++) {
            if (this._materials[j]) {
                this._materials[j].destroy();
            }
        }
    }
    this._materials = null;
    this._origMaterials = null;
};
