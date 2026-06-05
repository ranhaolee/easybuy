/* =========================================================
 *  飞机大战 Plane War  —  纯 Canvas 实现，无外部依赖
 *  图形全部代码绘制，音效用 Web Audio 合成
 * ======================================================= */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 700

  // ---------- DOM ----------
  const $score = document.getElementById('score');
  const $best = document.getElementById('best');
  const $lives = document.getElementById('lives');
  const $startScreen = document.getElementById('start-screen');
  const $pauseScreen = document.getElementById('pause-screen');
  const $overScreen = document.getElementById('over-screen');
  const $finalScore = document.getElementById('final-score');
  const $finalBest = document.getElementById('final-best');
  const $btnStart = document.getElementById('btn-start');
  const $btnResume = document.getElementById('btn-resume');
  const $btnRestart = document.getElementById('btn-restart');
  const $btnPause = document.getElementById('btn-pause');
  const $btnSound = document.getElementById('btn-sound');

  // ---------- 游戏状态 ----------
  const STATE = { READY: 0, PLAYING: 1, PAUSED: 2, OVER: 3 };
  let state = STATE.READY;

  let player, bullets, enemies, enemyBullets, particles, powerups, stars;
  let score, lives, elapsed, bestScore;
  let spawnTimer, fireTimer, powerTimer, bombFlash;
  let soundOn = true;

  bestScore = Number(localStorage.getItem('planewar_best') || 0);
  $best.textContent = bestScore;

  // =========================================================
  //  音效 (Web Audio 合成，无需音频文件)
  // =========================================================
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
  }
  function beep(freq, dur, type = 'square', vol = 0.06) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
  const sfx = {
    shoot: () => beep(880, 0.05, 'square', 0.025),
    hit: () => beep(220, 0.06, 'sawtooth', 0.04),
    boom: () => { beep(120, 0.3, 'sawtooth', 0.08); beep(80, 0.4, 'triangle', 0.06); },
    power: () => { beep(660, 0.08, 'sine', 0.07); beep(990, 0.12, 'sine', 0.07); },
    bomb: () => { beep(90, 0.5, 'sawtooth', 0.12); beep(60, 0.6, 'square', 0.08); },
    over: () => { beep(300, 0.2, 'sawtooth', 0.1); beep(180, 0.4, 'sawtooth', 0.1); },
  };

  // =========================================================
  //  工具
  // =========================================================
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  function hit(a, b) {
    return a.x - a.w / 2 < b.x + b.w / 2 &&
           a.x + a.w / 2 > b.x - b.w / 2 &&
           a.y - a.h / 2 < b.y + b.h / 2 &&
           a.y + a.h / 2 > b.y - b.h / 2;
  }

  // =========================================================
  //  初始化 / 重置
  // =========================================================
  function reset() {
    player = {
      x: W / 2, y: H - 90, w: 40, h: 46,
      speed: 360, hp: 1, bulletLevel: 1,
      invincible: 1.2, // 复活短暂无敌
      flame: 0,
    };
    bullets = [];
    enemies = [];
    enemyBullets = [];
    particles = [];
    powerups = [];
    score = 0;
    lives = 3;
    elapsed = 0;
    spawnTimer = 0;
    fireTimer = 0;
    powerTimer = rand(8, 12);
    bombFlash = 0;
    initStars();
    updateHUD();
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.5, 1.8),
        spd: rand(20, 90),
      });
    }
  }

  function updateHUD() {
    $score.textContent = score;
    $lives.textContent = lives > 0 ? '♥'.repeat(lives) : '—';
  }

  // =========================================================
  //  生成敌机
  // =========================================================
  const ENEMY_TYPES = {
    small:  { w: 30, h: 30, hp: 1, speed: 170, score: 100, color: '#7fe08a', canShoot: false },
    medium: { w: 46, h: 46, hp: 3, speed: 110, score: 300, color: '#ffd76a', canShoot: true },
    large:  { w: 72, h: 78, hp: 10, speed: 60, score: 800, color: '#ff7a7a', canShoot: true },
  };

  function spawnEnemy() {
    // 随难度提升大型机概率
    const diff = Math.min(elapsed / 60, 1);
    const r = Math.random();
    let type;
    if (r < 0.62 - diff * 0.15) type = 'small';
    else if (r < 0.9 - diff * 0.05) type = 'medium';
    else type = 'large';

    const def = ENEMY_TYPES[type];
    const x = rand(def.w / 2 + 6, W - def.w / 2 - 6);
    enemies.push({
      type, x, y: -def.h,
      w: def.w, h: def.h,
      hp: def.hp, maxHp: def.hp,
      speed: def.speed * (1 + diff * 0.5),
      score: def.score, color: def.color,
      canShoot: def.canShoot,
      shootTimer: rand(1.2, 2.5),
      flash: 0,
      wob: Math.random() * Math.PI * 2,
    });
  }

  function spawnPowerup(x, y) {
    const type = Math.random() < 0.65 ? 'double' : 'bomb';
    powerups.push({ x, y, w: 26, h: 26, type, speed: 110, t: 0 });
  }

  // =========================================================
  //  开火
  // =========================================================
  function playerFire() {
    const lv = player.bulletLevel;
    const by = player.y - player.h / 2;
    const mk = (x, vx = 0) => bullets.push({ x, y: by, w: 6, h: 16, vx, vy: -560, dmg: 1 });
    if (lv <= 1) {
      mk(player.x);
    } else if (lv === 2) {
      mk(player.x - 9); mk(player.x + 9);
    } else {
      mk(player.x); mk(player.x - 13, -60); mk(player.x + 13, 60);
    }
    sfx.shoot();
  }

  function enemyFire(e) {
    enemyBullets.push({
      x: e.x, y: e.y + e.h / 2, w: 8, h: 8,
      vx: 0, vy: 230, dmg: 1,
    });
  }

  function useBomb() {
    if (state !== STATE.PLAYING) return;
    bombFlash = 0.45;
    sfx.bomb();
    // 清掉敌机子弹
    enemyBullets = [];
    // 摧毁所有屏内敌机
    enemies.forEach(e => {
      addExplosion(e.x, e.y, e.color, e.w);
      score += e.score;
    });
    enemies = [];
    updateHUD();
  }

  // =========================================================
  //  爆炸粒子
  // =========================================================
  function addExplosion(x, y, color, size) {
    const n = Math.min(8 + size, 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(40, 200);
      particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: rand(1.5, 4), life: rand(0.3, 0.7), t: 0,
        color: Math.random() < 0.5 ? color : '#fff2a8',
      });
    }
    sfx.boom();
  }

  // =========================================================
  //  输入
  // =========================================================
  const keys = {};
  let pointer = { active: false, x: W / 2, y: H - 90 };

  function canvasPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * W,
      y: (clientY - rect.top) / rect.height * H,
    };
  }

  canvas.addEventListener('mousemove', e => {
    const p = canvasPos(e.clientX, e.clientY);
    pointer.active = true; pointer.x = p.x; pointer.y = p.y;
  });
  canvas.addEventListener('mouseleave', () => { pointer.active = false; });
  canvas.addEventListener('mousedown', () => { ensureAudio(); useBomb(); });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault(); ensureAudio();
    const t = e.touches[0];
    const p = canvasPos(t.clientX, t.clientY);
    pointer.active = true; pointer.x = p.x; pointer.y = p.y;
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    const p = canvasPos(t.clientX, t.clientY);
    pointer.active = true; pointer.x = p.x; pointer.y = p.y;
  }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); pointer.active = false; }, { passive: false });

  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); ensureAudio(); useBomb(); }
    if (e.key.toLowerCase() === 'p') togglePause();
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // =========================================================
  //  更新
  // =========================================================
  function update(dt) {
    elapsed += dt;
    if (bombFlash > 0) bombFlash -= dt;

    // 星空背景滚动
    for (const s of stars) {
      s.y += s.spd * dt;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }

    if (state !== STATE.PLAYING) return;

    // ---- 玩家移动 ----
    const kb = { x: 0, y: 0 };
    if (keys['arrowleft'] || keys['a']) kb.x -= 1;
    if (keys['arrowright'] || keys['d']) kb.x += 1;
    if (keys['arrowup'] || keys['w']) kb.y -= 1;
    if (keys['arrowdown'] || keys['s']) kb.y += 1;

    if (kb.x || kb.y) {
      const len = Math.hypot(kb.x, kb.y) || 1;
      player.x += (kb.x / len) * player.speed * dt;
      player.y += (kb.y / len) * player.speed * dt;
    } else if (pointer.active) {
      // 平滑跟随指针
      player.x += (pointer.x - player.x) * Math.min(1, dt * 14);
      player.y += (pointer.y - player.y) * Math.min(1, dt * 14);
    }
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(player.h / 2, Math.min(H - player.h / 2, player.y));
    player.flame += dt * 30;
    if (player.invincible > 0) player.invincible -= dt;

    // ---- 自动开火 ----
    fireTimer -= dt;
    const fireInterval = player.bulletLevel >= 3 ? 0.14 : 0.2;
    if (fireTimer <= 0) { playerFire(); fireTimer = fireInterval; }

    // ---- 生成敌机 ----
    spawnTimer -= dt;
    const diff = Math.min(elapsed / 50, 1);
    const spawnInterval = Math.max(0.35, 1.1 - diff * 0.7);
    if (spawnTimer <= 0) { spawnEnemy(); spawnTimer = spawnInterval; }

    // ---- 道具掉落计时 ----
    powerTimer -= dt;
    if (powerTimer <= 0) {
      spawnPowerup(rand(40, W - 40), -20);
      powerTimer = rand(10, 16);
    }

    // ---- 玩家子弹 ----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > W + 20) bullets.splice(i, 1);
    }

    // ---- 敌机更新 ----
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.y += e.speed * dt;
      e.wob += dt * 2;
      if (e.type !== 'small') e.x += Math.sin(e.wob) * 22 * dt * 2;
      e.x = Math.max(e.w / 2, Math.min(W - e.w / 2, e.x));
      if (e.flash > 0) e.flash -= dt;

      if (e.canShoot) {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && e.y > 0 && e.y < H * 0.7) {
          enemyFire(e);
          e.shootTimer = rand(1.4, 2.8);
        }
      }

      // 出界
      if (e.y - e.h / 2 > H) { enemies.splice(i, 1); continue; }

      // 与玩家碰撞
      if (player.invincible <= 0 && hit(e, player)) {
        addExplosion(e.x, e.y, e.color, e.w);
        enemies.splice(i, 1);
        damagePlayer();
        continue;
      }
    }

    // ---- 玩家子弹 vs 敌机 ----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (hit(b, e)) {
          e.hp -= b.dmg;
          e.flash = 0.08;
          bullets.splice(i, 1);
          // 命中小火花
          particles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-60, -10),
            r: 2, life: 0.2, t: 0, color: '#fff2a8' });
          if (e.hp <= 0) {
            addExplosion(e.x, e.y, e.color, e.w);
            score += e.score;
            // 大型机一定掉道具
            if (e.type === 'large') spawnPowerup(e.x, e.y);
            enemies.splice(j, 1);
            updateHUD();
          } else {
            sfx.hit();
          }
          break;
        }
      }
    }

    // ---- 敌机子弹 ----
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > H + 20) { enemyBullets.splice(i, 1); continue; }
      if (player.invincible <= 0 && hit(b, player)) {
        enemyBullets.splice(i, 1);
        damagePlayer();
      }
    }

    // ---- 道具 ----
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.speed * dt; p.t += dt;
      if (p.y - p.h / 2 > H) { powerups.splice(i, 1); continue; }
      if (hit(p, player)) {
        if (p.type === 'double') {
          player.bulletLevel = Math.min(3, player.bulletLevel + 1);
        } else {
          useBomb();
        }
        sfx.power();
        powerups.splice(i, 1);
      }
    }

    // ---- 粒子 ----
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
    }
  }

  function damagePlayer() {
    lives--;
    addExplosion(player.x, player.y, '#5fd0ff', player.w);
    player.bulletLevel = Math.max(1, player.bulletLevel - 1);
    player.invincible = 1.5;
    player.x = W / 2; player.y = H - 90;
    pointer.active = false;
    updateHUD();
    if (lives <= 0) gameOver();
  }

  // =========================================================
  //  绘制
  // =========================================================
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // 背景星空
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = 0.3 + s.r / 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 道具
    for (const p of powerups) drawPowerup(p);
    // 敌机
    for (const e of enemies) drawEnemy(e);
    // 玩家子弹
    ctx.fillStyle = '#5fd0ff';
    for (const b of bullets) {
      ctx.shadowColor = '#5fd0ff'; ctx.shadowBlur = 8;
      ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    }
    ctx.shadowBlur = 0;
    // 敌机子弹
    for (const b of enemyBullets) {
      ctx.fillStyle = '#ff6a8a';
      ctx.shadowColor = '#ff6a8a'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.w / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // 玩家
    if (state === STATE.PLAYING || state === STATE.PAUSED) drawPlayer();

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 炸弹白光
    if (bombFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, bombFlash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPlayer() {
    const p = player;
    // 复活闪烁
    if (p.invincible > 0 && Math.floor(p.invincible * 12) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);

    // 尾焰
    const flick = 6 + Math.sin(p.flame) * 4;
    const grd = ctx.createLinearGradient(0, p.h / 2, 0, p.h / 2 + flick + 10);
    grd.addColorStop(0, '#ffd76a');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-6, p.h / 2 - 4);
    ctx.lineTo(0, p.h / 2 + flick + 10);
    ctx.lineTo(6, p.h / 2 - 4);
    ctx.closePath(); ctx.fill();

    // 机身
    ctx.fillStyle = '#cfe6ff';
    ctx.beginPath();
    ctx.moveTo(0, -p.h / 2);            // 机头
    ctx.lineTo(7, -2);
    ctx.lineTo(7, p.h / 2 - 6);
    ctx.lineTo(-7, p.h / 2 - 6);
    ctx.lineTo(-7, -2);
    ctx.closePath(); ctx.fill();

    // 机翼
    ctx.fillStyle = '#5f9fff';
    ctx.beginPath();
    ctx.moveTo(-7, 2);
    ctx.lineTo(-p.w / 2, p.h / 2 - 8);
    ctx.lineTo(-7, p.h / 2 - 12);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(7, 2);
    ctx.lineTo(p.w / 2, p.h / 2 - 8);
    ctx.lineTo(7, p.h / 2 - 12);
    ctx.closePath(); ctx.fill();

    // 尾翼
    ctx.fillStyle = '#3f7fe0';
    ctx.fillRect(-10, p.h / 2 - 10, 20, 5);

    // 座舱
    ctx.fillStyle = '#0a2a55';
    ctx.beginPath();
    ctx.ellipse(0, -4, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const c = e.flash > 0 ? '#ffffff' : e.color;

    if (e.type === 'small') {
      // 小型无人机：向下的三角
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(-e.w / 2, -e.h / 2);
      ctx.lineTo(e.w / 2, -e.h / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b3a22';
      ctx.beginPath(); ctx.arc(0, -4, 4, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'medium') {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(-e.w / 2, 0);
      ctx.lineTo(-e.w / 4, -e.h / 2);
      ctx.lineTo(e.w / 4, -e.h / 2);
      ctx.lineTo(e.w / 2, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a4410';
      ctx.fillRect(-5, -6, 10, 12);
    } else {
      // 大型机（类似 boss）
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, e.h / 2);
      ctx.lineTo(-e.w / 2, e.h / 6);
      ctx.lineTo(-e.w / 3, -e.h / 2);
      ctx.lineTo(e.w / 3, -e.h / 2);
      ctx.lineTo(e.w / 2, e.h / 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a1010';
      ctx.fillRect(-e.w / 4, -e.h / 3, e.w / 2, e.h / 2);
      ctx.fillStyle = '#ffcaca';
      ctx.beginPath(); ctx.arc(-10, -6, 4, 0, Math.PI * 2);
      ctx.arc(10, -6, 4, 0, Math.PI * 2); ctx.fill();
    }

    // 血条（中/大型机受伤后显示）
    if (e.maxHp > 1 && e.hp < e.maxHp) {
      const bw = e.w, bh = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-bw / 2, -e.h / 2 - 9, bw, bh);
      ctx.fillStyle = '#5fff8a';
      ctx.fillRect(-bw / 2, -e.h / 2 - 9, bw * (e.hp / e.maxHp), bh);
    }
    ctx.restore();
  }

  function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const pulse = 1 + Math.sin(p.t * 6) * 0.08;
    ctx.scale(pulse, pulse);
    if (p.type === 'double') {
      ctx.fillStyle = '#5fd0ff';
      ctx.shadowColor = '#5fd0ff'; ctx.shadowBlur = 12;
    } else {
      ctx.fillStyle = '#ff9a4a';
      ctx.shadowColor = '#ff9a4a'; ctx.shadowBlur = 12;
    }
    ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#08203a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.type === 'double' ? 'P' : 'B', 0, 1);
    ctx.restore();
  }

  // =========================================================
  //  主循环
  // =========================================================
  let lastTime = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // =========================================================
  //  流程控制
  // =========================================================
  function startGame() {
    ensureAudio();
    reset();
    state = STATE.PLAYING;
    $startScreen.classList.add('hidden');
    $overScreen.classList.add('hidden');
    $pauseScreen.classList.add('hidden');
  }

  function gameOver() {
    state = STATE.OVER;
    sfx.over();
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('planewar_best', String(bestScore));
      $best.textContent = bestScore;
    }
    $finalScore.textContent = score;
    $finalBest.textContent = bestScore;
    $overScreen.classList.remove('hidden');
  }

  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      $pauseScreen.classList.remove('hidden');
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      $pauseScreen.classList.add('hidden');
    }
  }

  // 按钮
  $btnStart.addEventListener('click', startGame);
  $btnRestart.addEventListener('click', startGame);
  $btnResume.addEventListener('click', togglePause);
  $btnPause.addEventListener('click', togglePause);
  $btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    $btnSound.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) ensureAudio();
  });

  // 启动
  reset();
  initStars();
  requestAnimationFrame(loop);
})();
