/* Echoes Loading Screen — scalloped petals (spaced), filled=brown, unfilled=yellow */
pc.script.createLoadingScreen(function (app) {
  // ---------- i18n & Tips ----------
  var currentLang = (navigator.language || 'en-US').toLowerCase();
  var isZhCN = currentLang.startsWith('zh');
  var tips = [];
  var currentTipIndex = 0;
  var tipRotateInterval = null;

  // 直接内嵌tips数据，避免网络请求问题
  function initTips() {
    if (isZhCN) {
      tips = [
        "聆听回声中…",
        "探索神秘领域中…",
        "唤醒古老记忆中…",
        "追寻虚空低语中…",
        "发现隐藏真相中…",
        "解开时间之线中…",
        "拥抱未知旅程中…",
        "寻找过往碎片中…",
        "与光影共舞中…",
        "开启新世界之门中…"
      ];
    } else {
      tips = [
        "Listening to echoes…",
        "Exploring mysterious realms…",
        "Awakening ancient memories…",
        "Following whispers in the void…",
        "Discovering hidden truths…",
        "Unraveling the threads of time…",
        "Embracing the unknown journey…",
        "Seeking fragments of the past…",
        "Dancing with shadows and light…",
        "Opening doors to new worlds…"
      ];
    }
  }

  // ---------- DOM ----------
  var root = document.createElement('div');
  root.id = 'echoes-loading';
  root.innerHTML = `
    <div class="frame">
      <div class="title">ECHOES</div>
      <div class="ring">
        <div class="circle"></div>
        <svg class="petals" viewBox="-120 -140 240 260" aria-hidden="true"></svg>
        <div class="pct">0%</div>
      </div>
      <div class="tip">Loading...</div>
    </div>
  `;
  document.body.appendChild(root);

  // ---------- CSS ----------
  var css = document.createElement('style');
  css.textContent = `
    #echoes-loading{position:fixed;inset:0;display:grid;place-items:center;background:#F7F4D6;z-index:9999;
      font-family:ui-sans-serif,system-ui,"Helvetica Neue",Arial;color:#3d2c1f;opacity:1;transition:opacity 3000ms ease}
    #echoes-loading.hidden{opacity:0}
    .frame{display:flex;flex-direction:column;align-items:center;gap:40px}
    .title{letter-spacing:.35em;font-weight:800;font-size:26px;text-shadow:0 1px 0 #fff8;margin-bottom:20px}
    .ring{position:relative;width:300px;height:300px;display:grid;place-items:center}
    /* 中心圆固定为米黄色，不参与进度填充 */
    .circle{width:160px;height:160px;border-radius:50%;
      background:#F6D867;box-shadow:inset 0 0 0 8px rgba(0,0,0,.08)}
    /* 花瓣：每片两层path，底层棕色、顶层黄色随进度渐显 */
    .petals{position:absolute;width:300px;height:300px;pointer-events:none;top:-6px;opacity:1}
    .petals.fadeout{opacity:0;transition:opacity 300ms ease}
    .petals g.petal{transition:transform 180ms ease; transform-box: fill-box; transform-origin: center}
    .petals path.base{fill:#4f3a2b;opacity:0;stroke:#F7F4D6;stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 1px 0 #fff8)}
    .petals path.fill{fill:#F6D867;opacity:0;transition:opacity 160ms linear;stroke:#F7F4D6;stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 1px 0 #fff8)}
    .pct{position:absolute;font-weight:800;font-size:18px;color:#6b4c37}
    .tip{font-size:12px;opacity:.6;letter-spacing:.08em;transition:opacity 300ms ease}
    @media (prefers-reduced-motion:no-preference){.circle{transition:background 120ms linear}}
  `;
  document.head.appendChild(css);

  // ---------- 生成"外扩且有缝"的水滴花瓣 ----------
  var svg = root.querySelector('.petals');
  var petalBasePaths = []; // 棕色底层
  var petalFillPaths = []; // 黄色顶层（通过 opacity 渐变）
  var petalGroups = [];    // g 容器，用于位移/缩放动画
  var fillClockwise = true; // 从顶部开始顺时针填充
  
  function buildPetals(opts){
    svg.innerHTML = '';
    petalBasePaths = [];
    petalFillPaths = [];
    petalGroups = [];
    var n   = opts.count || 12;               // 花瓣数
    var circleRadius = 80;                    // 中心圆的半径（160px直径 / 2）
    var borderWidth = 8;                      // 圆的边框宽度
    var actualRadius = circleRadius + 10;      // 稍微扩大基点半径，让花瓣更好地围绕圆形
    var petalLength = opts.length || 45;      // 花瓣长度
    var rw  = opts.width || 30;               // 花瓣宽
    
    for (let i=0;i<n;i++){
      var angle = (i * (360/n)) - 90; // 从12点开始，-90度让第一个花瓣朝上
      var a = angle * Math.PI/180;
      
      // 花瓣基点（从圆的外边缘开始）
      var baseX = Math.cos(a) * actualRadius;
      var baseY = Math.sin(a) * actualRadius - 5; // 向上移动5px
      
      // 花瓣尖端（向外延伸）
      var tipX = Math.cos(a) * (actualRadius + petalLength);
      var tipY = Math.sin(a) * (actualRadius + petalLength) - 5; // 向上移动5px
      
      // 计算垂直于半径方向的向量（用于花瓣宽度）
      var perpX = -Math.sin(a) * rw/2;
      var perpY = Math.cos(a) * rw/2;
      
      // 花瓣中点（用于创建更好的曲线）
      var midX = Math.cos(a) * (actualRadius + petalLength * 0.6);
      var midY = Math.sin(a) * (actualRadius + petalLength * 0.6) - 5; // 向上移动5px
      
      // 创建圆润的水滴形状：圆形基部 + 平滑尖端
      var d = `
        M ${baseX + perpX*0.4} ${baseY + perpY*0.4}
        C ${baseX + perpX*0.8} ${baseY + perpY*0.8}, ${midX + perpX*0.5} ${midY + perpY*0.5}, ${midX + perpX*0.2} ${midY + perpY*0.2}
        C ${midX + perpX*0.05} ${midY + perpY*0.05}, ${tipX} ${tipY}, ${tipX} ${tipY}
        C ${tipX} ${tipY}, ${midX - perpX*0.05} ${midY - perpY*0.05}, ${midX - perpX*0.2} ${midY - perpY*0.2}
        C ${midX - perpX*0.5} ${midY - perpY*0.5}, ${baseX - perpX*0.8} ${baseY - perpY*0.8}, ${baseX - perpX*0.4} ${baseY - perpY*0.4}
        C ${baseX - perpX*0.1} ${baseY - perpY*0.1}, ${baseX + perpX*0.1} ${baseY + perpY*0.1}, ${baseX + perpX*0.4} ${baseY + perpY*0.4}
        Z`;
      // 分组容器，便于整体变换
      var g = document.createElementNS('http://www.w3.org/2000/svg','g');
      g.setAttribute('class','petal');
      g.setAttribute('data-cos', Math.cos(a));
      g.setAttribute('data-sin', Math.sin(a));
      // 底层（棕色）
      var base = document.createElementNS('http://www.w3.org/2000/svg','path');
      base.setAttribute('d', d);
      base.setAttribute('class','base');
      g.appendChild(base);
      petalBasePaths.push(base);
      // 顶层（黄色，opacity受进度控制）
      var fill = document.createElementNS('http://www.w3.org/2000/svg','path');
      fill.setAttribute('d', d);
      fill.setAttribute('class','fill');
      g.appendChild(fill);
      petalFillPaths.push(fill);
      svg.appendChild(g);
      petalGroups.push(g);
    }
  }
  buildPetals({ count: 12, length: 45, width: 30 });

  // ---------- Tips轮播 ----------
  function startTipRotation() {
    if (tips.length <= 1) return;
    tipRotateInterval = setInterval(function() {
      currentTipIndex = (currentTipIndex + 1) % tips.length;
      updateTipText();
    }, 7000); // 每7秒切换一次
  }

  function updateTipText() {
    var tipEl = root.querySelector('.tip');
    if (tipEl && tips.length > 0) {
      tipEl.style.opacity = 0;
      setTimeout(function() {
        tipEl.textContent = tips[currentTipIndex];
        tipEl.style.opacity = 0.6;
      }, 150);
    }
  }

  function stopTipRotation() {
    if (tipRotateInterval) {
      clearInterval(tipRotateInterval);
      tipRotateInterval = null;
    }
  }

  // ---------- 进度 ----------
  var circle = root.querySelector('.circle');
  var pctEl  = root.querySelector('.pct');
  var tipEl  = root.querySelector('.tip');
  var lastProgress = 0;
  function setProgress(v){ // 0..1
    v = Math.max(0, Math.min(1, v||0));
    // 忽略偶发的回退抖动（例如事件竞态），但允许 1 最终值
    if (v < lastProgress && lastProgress < 1) v = lastProgress;
    lastProgress = v;
    pctEl.textContent = Math.round(v*100)+'%';
    // 按花瓣序号（从12点开始顺时针）映射进度到不透明度
    var total = petalFillPaths.length;
    for (var i=0;i<total;i++){
      var t = v*total - i; // 12 o'clock clockwise order
      var op = t <= 0 ? 0 : (t >= 1 ? 1 : t);
      petalFillPaths[i].style.opacity = op;
      // 大小与内收动画：随填充值从 0 → 1 线性
      var g = petalGroups[i];
      if (g){
        var c = parseFloat(g.getAttribute('data-cos')) || 0;
        var s = parseFloat(g.getAttribute('data-sin')) || 0;
        var inset = op * 13;            // 向中心收拢像素
        var scale = 1 + op * 0.3;     // 轻微放大
        var tx = (-c * inset).toFixed(3);
        var ty = (-s * inset).toFixed(3);
        g.setAttribute('transform', 'translate('+tx+','+ty+') scale('+scale.toFixed(3)+')');
      }
    }
    if (v >= 1 && !svg.classList.contains('fadeout')){
      svg.classList.add('fadeout');
      pctEl.style.transition = 'opacity 200ms linear';
      tipEl.style.transition = 'opacity 200ms linear';
      pctEl.style.opacity = 0;
      tipEl.style.opacity = 0;
    }
  }

  // ---------- Official hooks wiring ----------
  var onProgress = function(v){ setProgress(v); };
  
  // 初始化：设置tips并开始轮播
  initTips();
  updateTipText();
  startTipRotation();

  app.on('preload:progress', onProgress);
  app.once('preload:start', function(){
    lastProgress = 0; setProgress(0);
    svg.classList.remove('fadeout');
    for (var i=0;i<petalFillPaths.length;i++){ petalFillPaths[i].style.opacity = 0; }
    pctEl.style.opacity = 1; tipEl.style.opacity = 1; pctEl.textContent = '0%';
  });
  app.once('preload:end', function(){
    app.off('preload:progress', onProgress);
    setProgress(1);
    stopTipRotation(); // 停止轮播
    GlobalGame.init(app, { defaultState: GlobalGame.STATES.MAIN_MENU, debug: true });
    // 初始化全局对话管理器（若已加载脚本）
    try { if (typeof DialogueManager !== 'undefined' && DialogueManager.setApp) DialogueManager.setApp(app); } catch (e) {}
    // 预加载对话资源：扫描资产名称形如 npcKey_locale.json 并预加载（不改变当前图）
    try {
      if (typeof DialogueManager !== 'undefined' && DialogueManager.preloadMany && app && app.assets && app.assets.list) {
        var re = /^(.+?)_(zh-CN|en-US)\.json$/i;
        var npcSet = Object.create(null);
        var list = app.assets.list();
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (!a || a.type !== 'json' || !a.name) continue;
          var m = a.name.match(re);
          if (m && m[1]) npcSet[m[1]] = true;
        }
        var npcKeys = Object.keys(npcSet);
        if (npcKeys.length) {
          var loc = null; try { if (typeof GlobalGame !== 'undefined' && GlobalGame.getLocale) loc = GlobalGame.getLocale(); } catch (e) {}
          DialogueManager.preloadMany(npcKeys, { locale: loc });
        }
      }
    } catch (e) { /* ignore preload errors */ }
  });
  app.once('start', function(){
    stopTipRotation(); // 确保停止轮播
    // Page fade-out (3000ms) then cleanup
    if (!root.classList.contains('hidden')) root.classList.add('hidden');
    var cleanup = function(e){
      if (!e || e.propertyName === 'opacity'){
        root.removeEventListener('transitionend', cleanup);
        if (root && root.parentNode) root.parentNode.removeChild(root);
        if (css && css.parentNode) css.parentNode.removeChild(css);
      }
    };
    root.addEventListener('transitionend', cleanup);
    setTimeout(function(){ cleanup({propertyName:'opacity'}); }, 3500);
  });
});