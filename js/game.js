/* プレイヤー画面の進行制御: レイアウト、レバー、抽選確定、ステージ演出、スタッフ認証。 */
const Game = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const CX = 770, CY = 420;          // リール窓の中心（#content 座標）
  /* ステージごとのテーマカラー（粒子・稲妻・衝撃波の色）: 1=ゴールド / 2=サファイア / 3=ルビー */
  const STAGE_COL = { 1: ['gold', 'gold', 'white'], 2: ['blue', 'cyan', 'white', 'violet'], 3: ['red', 'gold', 'white', 'red'] };
  const STAGE_ACC = { 1: 'gold', 2: 'cyan', 3: 'red' };
  let sureShown = false; // 確定演出が発生中か
  const RAINBOW = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet'];
  const MSG_EMPTY = '抽選可能回数がありません。設定を確認してください。';
  let scale = 1, busy = false, curStage = 1, showingResult = false;
  let stageEl, cabinet, win, plate, lockbar, banner;

  /* ---------- レイアウト（16:9 基準・上下は背景で埋める） ---------- */
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const H = Math.min(1200, Math.max(900, Math.round(1600 * h / w)));
    scale = Math.min(w / 1600, h / H);
    stageEl.style.height = H + 'px';
    stageEl.style.transform = 'translate(' + (w - 1600 * scale) / 2 + 'px,' + (h - H * scale) / 2 + 'px) scale(' + scale + ')';
    $('content').style.top = (H - 900) / 2 + 'px';
  }

  function quake() { restart($('viewport'), 'quake'); } // 画面全体を揺らす
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function flash(soft) { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = soft ? 'go-soft' : 'go'; }

  function buildBulbs() {
    const box = $('bulbs'), pts = [];
    const L = 31, T = 31, R = 809, B = 529;
    for (let x = 78; x <= 762; x += 57) pts.push([x, T]);
    for (let y = 84; y <= 476; y += 56) pts.push([R, y]);
    for (let x = 762; x >= 78; x -= 57) pts.push([x, B]);
    for (let y = 476; y >= 84; y -= 56) pts.push([L, y]);
    pts.forEach((p, i) => {
      const b = document.createElement('i');
      b.style.left = p[0] + 'px'; b.style.top = p[1] + 'px';
      b.style.animationDelay = 'calc(var(--bulb) * ' + (-(i / pts.length) * 4).toFixed(3) + ')';
      box.appendChild(b);
    });
  }

  function setStage(n, show) {
    curStage = n;
    stageEl.dataset.stage = n;
    document.querySelectorAll('#ladder .rung').forEach((r) => {
      const s = +r.dataset.s;
      r.classList.toggle('on', s === n);
      r.classList.toggle('done', s < n);
    });
    if (sureShown) FX.setAmbient(40, RAINBOW); else FX.setAmbient([0, 0, 14, 30][n], STAGE_COL[n]);
    Reel.setStage(n, show);
    Sfx.setStage(n);
  }

  function setPlate(mode, main, sub) {
    plate.className = 'plate ' + mode;
    $('plateMain').textContent = main || '';
    $('plateSub').textContent = sub || '';
    $('plateSub').style.display = sub ? '' : 'none';
  }

  /* ---------- レバー ---------- */
  const Lever = (function () {
    const TRAVEL = 400, NOTCH = 40;
    let y = 0, v = 0, enabled = false, dragging = false, startY = 0, startPos = 0, raf = 0, notch = 0, homeSound = false;
    let el, knob, glow, led, onPull = null;

    function set(ny) {
      y = ny;
      knob.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      glow.style.height = (y + 56).toFixed(1) + 'px';
    }
    // 減衰バネで目標位置へ。上端に当たると小さく跳ね返る（重量感）
    function spring(to, k, c) {
      cancelAnimationFrame(raf);
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.034, (now - last) / 1000);
        last = now;
        for (let i = 0; i < 4; i++) {
          const h = dt / 4;
          v += (-k * (y - to) - c * v) * h;
          y += v * h;
          if (y < 0) { y = 0; if (homeSound && v < -120) { Sfx.play('leverHome'); homeSound = false; } v = -v * 0.32; }
          if (y > TRAVEL) { y = TRAVEL; v = -v * 0.2; }
        }
        set(y);
        if (Math.abs(y - to) < 0.4 && Math.abs(v) < 6) { set(to); v = 0; raf = 0; return; }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    function deny() {
      restart(el, 'deny');
      Sfx.play('leverDeny');
      if (plate.classList.contains('error')) restart(plate, 'bump');
    }
    function down(e) {
      e.preventDefault();
      Sfx.unlock();
      if (!enabled) return deny();
      dragging = true;
      try { knob.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      cancelAnimationFrame(raf);
      v = 0; startY = e.clientY; startPos = y; notch = Math.floor(y / NOTCH);
      el.classList.add('grab');
      Sfx.play('leverTouch');
    }
    function move(e) {
      if (!dragging) return;
      const ny = Math.max(0, Math.min(TRAVEL, startPos + (e.clientY - startY) / scale));
      const n = Math.floor(ny / NOTCH);
      if (n !== notch) { notch = n; Sfx.play('ratchet', ny / TRAVEL); }
      set(ny);
      if (ny >= TRAVEL * 0.97) commit();
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('grab');
      homeSound = y > 60;
      if (homeSound) Sfx.play('leverReturn');
      spring(0, 170, 14); // 引き切らずに離した: 自然に元の位置へ戻る
    }
    function commit() {
      dragging = false;
      el.classList.remove('grab');
      setEnabled(false);
      set(TRAVEL); v = 0;
      Sfx.play('leverCommit');
      restart(cabinet, 'thud');
      if (onPull) onPull();
      setTimeout(() => { homeSound = true; Sfx.play('leverReturn'); spring(0, 150, 12); }, 280);
    }
    function setEnabled(on) {
      enabled = on;
      el.classList.toggle('ready', on);
      led.textContent = on ? 'READY' : 'LOCKED';
      if (!on && dragging) { dragging = false; el.classList.remove('grab'); spring(0, 170, 14); }
    }
    function init(cb) {
      el = $('lever'); knob = $('leverKnob'); glow = $('leverGlow'); led = $('leverLed');
      onPull = cb;
      knob.addEventListener('pointerdown', down);
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
      knob.addEventListener('pointercancel', up);
      knob.addEventListener('lostpointercapture', up);
      set(0);
      setEnabled(false);
    }
    return { init, setEnabled };
  })();

  /* ---------- 状態 → 画面 ---------- */
  function canPlay() {
    const s = Store.state;
    return !!(s.pins && s.session && !s.locked && !s.play && Engine.sumCounts(s.session.remaining) > 0);
  }
  function refresh() {
    if (busy) return;
    const s = Store.state;
    if (s.play && s.play.phase === 'shown') return showLocked(s.play, false);
    lockbar.classList.remove('show');
    if (s.play) return awaitLever(s.play.cur || 1, false);
    clearSure();
    win.classList.remove('win', 'lose');
    cabinet.classList.remove('party');
    if (showingResult || curStage !== 1) { showingResult = false; setStage(1); }
    const ok = canPlay();
    Lever.setEnabled(ok);
    if (ok) setPlate('idle', 'PULL THE LEVER', 'レバーを下まで引いてください');
    else setPlate('error', MSG_EMPTY);
  }

  /* 確定済みプレイの途中: このステージのレバーを客自身が引くのを待つ（再起動時の復元にも使用） */
  function awaitLever(st, fresh) {
    win.classList.remove('win', 'lose');
    cabinet.classList.remove('party');
    if (showingResult || curStage !== st) { showingResult = false; setStage(st); }
    Lever.setEnabled(true);
    if (st === 1) setPlate('idle', 'PULL THE LEVER', 'レバーを下まで引いてください');
    else setPlate('idle', 'PULL THE LEVER', 'STAGE ' + st + ' ― もう一度レバーを引いてください');
    if (fresh) Sfx.play('stageReady');
  }

  /* 結果表示＋レバー完全ロック（再起動時の復元にも使用） */
  function showLocked(play, animate) {
    showingResult = true;
    Lever.setEnabled(false);
    if (!animate) {
      setStage(play.stage, play.value);
      win.classList.toggle('win', play.value > 0);
      win.classList.toggle('lose', play.value === 0);
    }
    plate.classList.add('hidden');
    renderLockbar(false);
    lockbar.classList.add('show');
  }
  function renderLockbar(authed) {
    const p = Store.state.play;
    lockbar.innerHTML =
      '<div class="res"><small>RESULT</small><b class="' + (p.value === 0 ? 'zero' : '') + '">' + fmtN(p.value) + '</b></div>' +
      '<div class="side">' + (authed
        ? '<span class="note">認証済み</span><button class="btn" data-act="next">次のプレイへ</button>'
        : '<span class="note">次のプレイにはスタッフ認証が必要です</span><button class="btn ghost" data-act="auth">スタッフ認証</button>') + '</div>';
  }
  async function onLockbar(e) {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    Sfx.play('button');
    if (b.dataset.act === 'auth') {
      const role = await UI.auth('スタッフ認証', ['staff', 'admin'], '次プレイ認証', '営業設定PINを入力');
      if (role && Store.state.play) { lockbar.dataset.role = role; renderLockbar(true); }
      return;
    }
    if (b.dataset.act === 'next') {
      const role = lockbar.dataset.role || 'staff';
      try {
        Store.transact((s) => {
          Store.log('NEXT_PLAY', { playNo: s.play ? s.play.playNo : null }, role);
          s.play = null; s.locked = false;
        });
      } catch (err) { return UI.toast('保存に失敗しました: ' + err.message, 'err'); }
      busy = true;
      lockbar.classList.remove('show');
      await transition(1);
      win.classList.remove('win', 'lose');
      showingResult = false;
      busy = false;
      refresh();
    }
  }

  /* ---------- 抽選確定 ----------
     レバーを引き切った瞬間に「抽選・在庫消費・ロック・履歴」を1回の書き込みで確定する。
     以降の演出は確定済みの結果をなぞるだけなので、途中で落ちても再抽選は起きない。 */
  function onPull() {
    const s0 = Store.state;
    if (busy || !s0.session) return refresh();
    // 2ステージ目以降: 結果は確定済み。レバーはそのステージの演出を始めるだけ（再抽選しない）
    if (s0.play && s0.play.phase === 'drawn') return runStage(s0.play, s0.play.cur || 1);
    if (s0.locked || s0.play) return refresh();
    let res;
    try {
      Store.transact((s) => {
        const ses = s.session;
        const before = Engine.sumCounts(ses.remaining);
        res = Engine.draw(ses);
        Engine.applyDraw(ses, res);
        s.play = { playNo: ses.playNo, stage: res.stage, value: res.value, overflow: res.overflow, phase: 'drawn', cur: 1, ts: Date.now() };
        s.locked = true;
        Store.log(res.overflow ? 'OVERFLOW_PLAY' : 'PLAY', {
          playNo: ses.playNo, stage: res.stage, value: res.value, key: res.key, path: Engine.pathFor(res.stage),
          remainBefore: before, remainAfter: Engine.sumCounts(ses.remaining), label: res.overflow ? '超過プレイ / 0' : undefined,
        });
      });
    } catch (err) {
      UI.toast('抽選を開始できませんでした（保存エラー）。', 'err');
      return refresh();
    }
    runStage(Store.state.play, 1);
  }

  /* ---------- 停止パターンの抽選（結果は確定済み。見せ方だけを変える） ----------
     ハズレ(0)で止まるとき …「当たりと思いきやハズレ」: 当たり絵柄で止まりかけて滑る／行きかけて戻される
     当たり・NEXT で止まるとき …「ハズレと思いきや当たり」: 0 で止まりかけて滑る／0 に行きかけて戻る／0 で一度止まって再始動
     DRAMA はその演出が出る割合（ステージ別）。 */
  const DRAMA = { lose: [0, 0.55, 0.7, 0.9], win: [0, 0.5, 0.65, 0.85] };
  function pickPattern(st, sym) {
    if (window.__fxTest && window.__fxTest.pat) return window.__fxTest.pat; // 演出確認用（結果には影響しない）
    const good = st === 3 ? [100000, 50000] : ['NEXT', st === 1 ? 1000 : 5000];
    const k = Math.random();
    if (sym === 0) {
      if (Math.random() > DRAMA.lose[st]) return { type: 'plain' };
      if (k < 0.4) return { type: 'slip', bait: [good[0]] };
      if (k < 0.75) return { type: 'back', bait: [good[0]] };
      return { type: 'slip2', bait: [good[1], good[0]] };
    }
    if (Math.random() > DRAMA.win[st]) return { type: Math.random() < 0.5 ? 'plain' : 'slip' };
    if (k < 0.3) return { type: 'slip', bait: [0] };
    if (k < 0.55) return { type: 'back', bait: [0] };
    if (k < 0.75) return { type: 'slip2', bait: [null, 0] };
    return { type: 'respin' };
  }

  /* ---------- 確定演出 ----------
     最終結果が 0 以外のプレイでだけ、低確率で発生する（ハズレのプレイでは絶対に出ない）。
       freeze : レバー直後に暗転・無音 → 閃光
       aura   : 回転中に筐体が白金に光り出す
       late   : 停止の直前に告知音と閃光（最終ステージのみ）
     SURE_RATE は1回のレバーあたりの発生率。1プレイで1回まで。発生後は結果が出るまで全体が虹色になる。 */
  const SURE_RATE = { freeze: 0.02, aura: 0.03, late: 0.03 }; // 本当にたまに出る程度
  function pickSure(play, st) {
    if (sureShown || !(play.value > 0) || play.overflow) return null;
    if (window.__fxTest && window.__fxTest.sure !== undefined) return window.__fxTest.sure;
    const r = Math.random();
    if (r < SURE_RATE.freeze) return 'freeze';
    if (r < SURE_RATE.freeze + SURE_RATE.aura) return 'aura';
    if (st === play.stage && r < SURE_RATE.freeze + SURE_RATE.aura + SURE_RATE.late) return 'late';
    return null;
  }
  function announceSure() {
    sureShown = true;
    stageEl.classList.add('sure');
    Sfx.play('kyuin');
    flash(false);
    restart(cabinet, 'shake');
    FX.ring(CX, CY, 'white', 1200, 0.9);
    RAINBOW.forEach((c, i) => setTimeout(() => FX.ring(CX, CY, c, 900 + i * 90, 0.8), 60 + i * 70)); // 虹の輪が次々に広がる
    FX.burst(CX, CY, 360, { max: 1600, life: 2, size: 26, colors: RAINBOW });
    FX.rain(240, 1.6, RAINBOW);
    FX.flakes(160, 1.6, RAINBOW);
    FX.streaks(CX, CY, 160, 1.0, { colors: RAINBOW });
    FX.setAmbient(40, RAINBOW);
    setPlate('spin sure', 'WIN CONFIRMED', '当選確定！');
  }
  function clearSure() {
    if (!sureShown) return;
    sureShown = false;
    stageEl.classList.remove('sure');
    FX.setAmbient([0, 0, 14, 30][curStage], STAGE_COL[curStage]);
  }

  /* 1ステージ分の演出。NEXT STAGE なら次のステージへ移り、再びレバー待ちに戻る。 */
  async function runStage(play, st) {
    busy = true;
    const sym = st < play.stage ? 'NEXT' : play.value;
    const pat = pickPattern(st, sym);
    const sure = pickSure(play, st);
    setPlate(sureShown ? 'spin sure' : 'spin', sureShown ? 'WIN CONFIRMED' : 'GOOD LUCK', sureShown ? '当選確定！' : 'STAGE ' + st);

    if (sure === 'freeze') { // 暗転フリーズ → 閃光
      $('blackout').classList.add('on');
      Sfx.play('freeze');
      await wait(1500);
      $('blackout').classList.remove('on');
      announceSure();
      await wait(1100);
    }
    const extra = {};
    if (sure === 'aura') extra.onStart = () => setTimeout(() => { if (busy) announceSure(); }, 900);
    if (sure === 'late') extra.onNear = announceSure;

    if (pat.type === 'respin') {
      // ハズレと思いきや当たり: いったん 0 で完全に止まり、沈黙のあと再始動する
      await spinReel(st, 0, { type: 'plain' }, extra);
      win.classList.add('lose');
      Sfx.play('zero');
      if (!sureShown) setPlate('result zero', '0', '');
      await wait(1500);
      win.classList.remove('lose');
      Sfx.play('revive');
      flash(false);
      restart(cabinet, 'shake');
      FX.ring(CX, CY, 'gold', 1100, 0.8);
      FX.burst(CX, CY, 200, { max: 1300, life: 1.6 });
      setPlate('spin sure', 'ONE MORE CHANCE', 'まだ終わらない！');
      await wait(900);
      await spinReel(st, sym, { type: Math.random() < 0.5 ? 'slip' : 'plain', quick: true }, {});
    } else {
      await spinReel(st, sym, pat, extra);
    }

    if (sym === 'NEXT') {
      // どこまで進んだかを保存（ここで落ちても次のステージのレバー待ちから再開）
      try { Store.transact((s) => { if (s.play) s.play.cur = st + 1; }); } catch (err) { /* 進行位置のみ */ }
      await nextStageFx(st);
      busy = false;
      if (Store.state.play) awaitLever(st + 1, true); else refresh();
      return;
    }
    await resultFx(play);
    clearSure();
    try { Store.transact((s) => { if (s.play) s.play.phase = 'shown'; }); } catch (err) { /* 表示済みフラグのみ。失敗しても整合性に影響なし */ }
    busy = false;
    if (Store.state.play) showLocked(Store.state.play, true); else refresh();
  }

  function spinReel(st, sym, pat, extra) {
    const beats = [];
    extra = extra || {};
    return Reel.spin(st, sym, {
      onStart: () => { Sfx.play('reelStart'); extra.onStart && extra.onStart(); },
      onTick: (n) => Sfx.tick(n),
      onSpeed: (n) => Sfx.spin(n),
      onNear: () => { extra.onNear && extra.onNear(); },
      onTease: (dur) => {
        Sfx.play('tease', dur);
        stageEl.classList.add('reach'); // 集中線で緊張感を出す
        $('content').querySelector('.spot').style.opacity = 1;
        if (st >= 2) for (let t = 0; t < dur - 0.2; t += st === 3 ? 0.5 : 0.62) beats.push(setTimeout(() => Sfx.play('heartbeat'), t * 1000));
        if (st === 3) $('dim').classList.add('on');
      },
      onStop: () => {
        beats.forEach(clearTimeout);
        stageEl.classList.remove('reach');
        $('dim').classList.remove('on');
        $('content').querySelector('.spot').style.opacity = '';
        Sfx.play('stop');
        restart(cabinet, 'thud');
      },
    }, pat);
  }

  /* NEXT STAGE 突入演出（長尺）:
     静止 → 画面ごとズームしながら光を吸い込む（集中線・稲妻） → 大爆発（画面揺れ・文字が1文字ずつ飛び込む・
     噴き上がる火花・金箔・花火） → 金庫扉が閉まる → ロックが1つずつ外れる → ステージ名の刻印
     → ドラムロール → 継ぎ目から光が溢れ、ズームアウトしながら扉が開く */
  const RUNG_Y = { 1: 620, 2: 430, 3: 240 };
  async function nextStageFx(st) {
    const to = st + 1, fin = to === 3;
    const colors = STAGE_COL[to], ACC = STAGE_ACC[to]; // 次のステージの色で演出する
    const content = $('content');
    const timers = [];
    const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
    const zap = (x1, y1, x2, y2) => { FX.lightning(x1, y1, x2, y2, Math.random() < 0.6 ? ACC : 'white', fin ? 5 : 4); Sfx.play('zap'); };

    // 1. 静止 → チャージ（画面がリールへ寄っていく）
    setPlate('spin', 'NEXT STAGE', '');
    await wait(450);
    $('dim').classList.add('on');
    win.classList.add('win');
    cabinet.classList.add('party', 'tremble');
    content.classList.add('zoom-charge');
    Sfx.play('riser', 1.9);
    Sfx.play('warp');
    FX.converge(CX, CY, fin ? 320 : 220, 1.9);
    FX.streaks(CX, CY, fin ? 150 : 100, 1.7, { inward: true, colors });
    later(0.8, () => FX.converge(CX, CY, fin ? 280 : 180, 1.1));
    [0.7, 1.15, 1.5, 1.75].slice(0, fin ? 4 : 2).forEach((t) => later(t, () => { const a = Math.random() * 6.28; zap(CX + Math.cos(a) * 760, CY + Math.sin(a) * 460, CX, CY); }));
    await wait(1900);

    // 2. 大爆発
    cabinet.classList.remove('tremble');
    content.classList.remove('zoom-charge');
    content.classList.add('zoom-punch');
    stageEl.dataset.stage = to; // 爆発と同時に世界の色が次のステージの色へ変わる
    quake();
    flash(false);
    restart(cabinet, 'shake');
    Sfx.play('impact');
    for (let i = 0; i < (fin ? 10 : 6); i++) { const a = (i / (fin ? 10 : 6)) * 6.28 + Math.random() * 0.4; FX.lightning(CX, CY, CX + Math.cos(a) * 900, CY + Math.sin(a) * 560, i % 2 ? ACC : 'white', 5); }
    FX.ring(CX, CY, 'white', 1100, 0.8);
    later(0.14, () => FX.ring(CX, CY, ACC, 1300, 1.0));
    later(0.3, () => FX.ring(CX, CY, ACC, 1500, 1.2));
    FX.burst(CX, CY, fin ? 480 : 340, { max: fin ? 1900 : 1600, life: 2, size: 28, colors });
    FX.streaks(CX, CY, fin ? 260 : 180, fin ? 3.0 : 2.3, { colors });
    FX.fountain(120, 930, fin ? 160 : 110, fin ? 2.8 : 2.0, colors, { vx: 160 });
    FX.fountain(1480, 930, fin ? 160 : 110, fin ? 2.8 : 2.0, colors, { vx: -160 });
    FX.flakes(fin ? 200 : 130, 2.0, colors);
    showBanner('next' + (fin ? ' final' : ''), fin ? 'FINAL STAGE' : 'STAGE UP', 'NEXT STAGE');

    stageEl.dataset.win = fin ? 7 : 6; // 画面全体を当選時と同じ全開状態に
    for (let t = 0.5; t < (fin ? 3.2 : 2.5); t += fin ? 0.24 : 0.34) {
      later(t, () => {
        const x = 200 + Math.random() * 1200, y = 110 + Math.random() * 480;
        Sfx.play('pop');
        setTimeout(() => { FX.burst(x, y, 80, { max: 700, colors }); FX.ring(x, y, Math.random() < 0.5 ? ACC : 'white', 280, 0.5); }, 300);
      });
    }
    later(0.75, () => { quake(); FX.ring(CX, CY, 'white', 1400, 0.9); }); // 文字が揃った瞬間の追撃
    if (fin) later(1.7, () => { flash(false); quake(); restart(cabinet, 'shake'); Sfx.play('thunder'); FX.ring(CX, CY, ACC, 1500, 1.0); FX.burst(CX, CY, 320, { max: 1800, life: 2, colors }); for (let i = 0; i < 6; i++) zap(CX, CY, rnd(0, 1600), rnd(0, 900)); });
    await wait(fin ? 3600 : 2800);
    timers.forEach(clearTimeout);
    delete stageEl.dataset.win;
    content.classList.remove('zoom-punch');
    await hideBanner();
    $('dim').classList.remove('on');

    // 3. 扉が閉まり、開門の儀式へ
    await ceremony(to);
    win.classList.remove('win');
    cabinet.classList.remove('party');
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  const STAGE_NAMES = { 2: 'SAPPHIRE STAGE', 3: 'RUBY FINAL' };
  async function ceremony(to) {
    const fin = to === 3;
    const label = $('shutterLabel'), bolts = $('bolts'), content = $('content');
    const colors = STAGE_COL[to], ACC = STAGE_ACC[to];
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = STAGE_NAMES[to] || '';
    label.classList.remove('show');
    const n = fin ? 5 : 3;
    bolts.innerHTML = new Array(n + 1).join('<i></i>');
    stageEl.classList.remove('opening', 'opening-slow', 'blast');
    stageEl.classList.toggle('fin', fin);

    // 閉門（ぶつかった瞬間に画面が揺れ、継ぎ目を火花が走る）
    stageEl.classList.add('shut');
    Sfx.play('shutterClose');
    await wait(440);
    quake();
    flash(true);
    FX.clear();
    for (let x = 60; x <= 1540; x += 74) FX.burst(x, 450, 10, { max: 460, life: 0.9, size: 14, colors });
    FX.lightning(0, 450, 800, 450, 'white', 4); FX.lightning(1600, 450, 800, 450, 'white', 4);
    setStage(to);
    FX.setAmbient(0);
    await wait(750);

    // ロック解除（1つずつ点灯。稲妻が継ぎ目へ走る）
    stageEl.classList.add('ceremony');
    await wait(500);
    for (let i = 0; i < n; i++) {
      const bx = 800 + (i - (n - 1) / 2) * 68;
      bolts.children[i].classList.add('on');
      Sfx.play('bolt', i / (n - 1));
      FX.burst(bx, 700, 26, { max: 420, life: 0.7, size: 12, colors });
      FX.lightning(bx, 690, bx + rnd(-60, 60), 455, i % 2 ? 'white' : ACC, 3);
      FX.ring(bx, 700, 'gold', 90, 0.35);
      await wait(fin ? 330 : 400);
    }
    await wait(350);

    // ステージ名の刻印（上から叩きつける）
    label.classList.add('show');
    stageEl.classList.add('named');
    await wait(330);
    Sfx.play('stamp');
    quake();
    flash(true);
    FX.ring(800, 450, ACC, 1000, 0.9);
    FX.ring(800, 450, 'white', 700, 0.6);
    FX.burst(800, 450, fin ? 300 : 200, { max: 1300, life: 1.6, colors });
    FX.streaks(800, 450, 120, 0.5, { colors });
    await wait(900);

    // ドラムロール（光が扉に吸い込まれていく。最終ステージは雷鳴つきで長い）
    const roll = fin ? 2.8 : 1.9;
    Sfx.play('roll', roll);
    stageEl.classList.add('rolling');
    FX.streaks(800, 450, fin ? 220 : 140, roll - 0.3, { inward: true, colors });
    FX.converge(800, 450, fin ? 240 : 150, roll);
    const tm = [];
    for (let t = 0.2; t < roll; t += fin ? 0.2 : 0.28) tm.push(setTimeout(() => FX.burst(200 + Math.random() * 1200, 450, 16, { max: 520, life: 0.8, size: 12, colors }), t * 1000));
    if (fin) [0.6, 1.3, 1.9, 2.4].forEach((t) => tm.push(setTimeout(() => { flash(true); quake(); Sfx.play('thunder'); FX.lightning(rnd(100, 1500), -100, rnd(300, 1300), 450, ACC, 6); FX.lightning(rnd(100, 1500), 1000, rnd(300, 1300), 450, 'white', 5); }, t * 1000)));
    await wait(roll * 1000);
    tm.forEach(clearTimeout);

    // 開門（ズームアウトしながら新ステージが現れる）
    label.classList.remove('show');
    stageEl.classList.remove('rolling');
    stageEl.classList.add('blast');
    Sfx.play('open', fin);
    flash(false);
    quake();
    await wait(200);
    stageEl.classList.add('opening-slow');
    stageEl.classList.remove('shut', 'ceremony', 'named');
    content.classList.add('reveal');
    restart(cabinet, 'shake');
    setStage(to); // 環境パーティクルを再開
    stageEl.dataset.win = fin ? 7 : 6;
    FX.ring(CX, CY, 'white', 1300, 1.0);
    setTimeout(() => FX.ring(CX, CY, ACC, 1500, 1.2), 160);
    FX.burst(CX, CY, fin ? 460 : 320, { max: 1700, life: 2, size: 26, colors });
    FX.streaks(CX, CY, fin ? 240 : 160, 1.2, { colors });
    [200, 600, 1000, 1400].forEach((x, i) => FX.fountain(x, 930, fin ? 90 : 60, 1.4 + i * 0.1, colors));
    FX.flakes(fin ? 220 : 140, 1.6, colors);
    // ラダーを光が駆け上がり、新しいステージが点灯する
    const y0 = RUNG_Y[to - 1], y1 = RUNG_Y[to];
    for (let i = 0; i <= 8; i++) setTimeout(() => FX.burst(180, y0 + ((y1 - y0) * i) / 8, 14, { max: 260, life: 0.6, size: 12, colors }), 300 + i * 50);
    setTimeout(() => { FX.ring(180, y1, 'gold', 260, 0.6); FX.burst(180, y1, 90, { max: 600, colors }); Sfx.play('stamp'); }, 760);
    await wait(1500);
    stageEl.classList.remove('opening-slow', 'blast', 'fin');
    content.classList.remove('reveal');
    delete stageEl.dataset.win;
    await wait(300);
  }

  /* 次のプレイへ戻るときの短いシャッター */
  async function transition(to) {
    const label = $('shutterLabel');
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = '';
    $('bolts').innerHTML = '';
    label.classList.remove('show');
    stageEl.classList.remove('opening');
    stageEl.classList.add('shut');
    Sfx.play('shutterClose');
    await wait(440);
    flash(true);
    label.classList.add('show');
    FX.clear();
    setStage(to);
    await wait(900);
    Sfx.play('shutterOpen');
    stageEl.classList.add('opening');
    stageEl.classList.remove('shut');
    label.classList.remove('show');
    await wait(720);
    stageEl.classList.remove('opening');
  }

  function showBanner(kind, label, value) {
    banner.className = 'banner ' + kind;
    $('bannerLabel').textContent = label;
    if (kind.indexOf('next') >= 0) $('bannerValue').innerHTML = value.split('').map((ch, i) => '<span style="--i:' + i + '">' + (ch === ' ' ? '&nbsp;' : ch) + '</span>').join('');
    else $('bannerValue').textContent = value;
    $('bannerValue').classList.remove('slam');
    void banner.offsetWidth;
    banner.classList.add('show');
    win.classList.add('veil'); // リール上の同じ文字と重ならないよう一時的に沈める
  }
  async function hideBanner() {
    $('bannerValue').classList.remove('slam');
    banner.classList.add('out');
    win.classList.remove('veil');
    await wait(460);
    banner.className = 'banner';
  }

  /* 当選演出。金額ごとに1段ずつ強くなる（WIN_LEVELS の並び順がそのまま演出レベル 1〜8）。 */
  const WIN_LEVELS = [500, 1000, 2000, 3000, 5000, 10000, 50000, 100000];
  const WIN_FX = [
    //  秒数  ラベル        粒子  金粉  花火間隔(秒)  揺れ回数  カウントアップ(秒)
    { dur: 2.2, label: 'WIN',       burst: 70,  rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 2.8, label: 'WIN',       burst: 110, rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 3.4, label: 'NICE WIN',  burst: 150, rain: 70,  fire: 0,    shake: 0, count: 0.5 },
    { dur: 4.0, label: 'BIG WIN',   burst: 190, rain: 130, fire: 1.0,  shake: 0, count: 0.7 },
    { dur: 4.8, label: 'BIG WIN',   burst: 230, rain: 200, fire: 0.75, shake: 1, count: 0.9 },
    { dur: 6.2, label: 'SUPER WIN', burst: 280, rain: 320, fire: 0.55, shake: 1, count: 1.3 },
    { dur: 8.4, label: 'MEGA WIN',  burst: 340, rain: 520, fire: 0.4,  shake: 2, count: 1.8 },
    { dur: 11.5, label: 'JACKPOT',  burst: 420, rain: 800, fire: 0.28, shake: 4, count: 2.4 },
  ];

  async function resultFx(res) {
    const v = res.value;
    if (v === 0) {
      await wait(250);
      win.classList.add('lose');
      Sfx.play('zero');
      setPlate('result zero', '0', '');
      await wait(1700);
      return;
    }
    const L = Math.max(1, WIN_LEVELS.filter((x) => x <= v).length);
    const fx = WIN_FX[L - 1];
    await wait(L >= 6 ? 600 : 250); // 一拍置いてから祝福
    const timers = [];
    const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
    const colors = sureShown ? RAINBOW.concat(['white']) : ['gold', 'white'].concat(STAGE_COL[curStage]); // 金＋そのステージの色（確定中は虹）

    win.classList.add('win');
    cabinet.classList.add('party');
    stageEl.dataset.win = L;
    setPlate('spin', fx.label, '');
    showBanner('win lv' + L, fx.label, fx.count ? '0' : fmtN(v));
    Sfx.play('win', L);

    // 開幕の一撃
    flash(L < 5);
    FX.burst(CX, CY, fx.burst, { max: 700 + L * 110, life: 1.3 + L * 0.1, size: 20 + L, colors });
    if (L >= 2) FX.ring(CX, CY, L >= 6 ? 'white' : STAGE_ACC[curStage], 800 + L * 50, 0.75);
    if (L >= 4) later(0.16, () => FX.ring(CX, CY, 'gold', 1000 + L * 40, 0.95));
    if (fx.shake) restart(cabinet, 'shake');
    if (L >= 6) $('dim').classList.add('on');

    // 金額カウントアップ → 確定の一撃
    if (fx.count) {
      const t0 = performance.now(), el = $('bannerValue');
      let lastTick = 0;
      const step = (now) => {
        const u = Math.min(1, (now - t0) / (fx.count * 1000));
        const e = 1 - Math.pow(1 - u, 3);
        el.textContent = fmtN(Math.round((v * e) / 100) * 100);
        if (now - lastTick > 55 && u < 1) { lastTick = now; Sfx.play('count', u); }
        if (u < 1 && stageEl.dataset.win) return requestAnimationFrame(step);
        el.textContent = fmtN(v);
      };
      requestAnimationFrame(step);
      later(fx.count, () => {
        restart($('bannerValue'), 'slam');
        Sfx.play('stop');
        FX.burst(CX, CY, 60 + L * 20, { max: 900, colors });
        if (L >= 5) flash(true);
      });
    }

    // 金粉と花火（レベルが上がるほど多く・速く・長く）
    if (fx.rain) FX.rain(fx.rain, fx.dur - 1.2, colors);
    if (L >= 2) FX.coins(20 + L * 22, Math.max(0.6, fx.dur - 1.6)); // 金貨のシャワー（金額が上がるほど多い）
    if (L >= 5) FX.flakes(L * 22, fx.dur - 1.5, colors);
    if (fx.fire) {
      for (let t = 0.6; t < fx.dur - 0.9; t += fx.fire) {
        later(t, () => {
          const x = 220 + Math.random() * 1160, y = 120 + Math.random() * 560;
          FX.burst(x, y, 50 + L * 8, { max: 500 + L * 40, colors });
          FX.ring(x, y, Math.random() < 0.4 ? STAGE_ACC[curStage] : 'gold', 220 + L * 15, 0.5);
        });
      }
    }
    // 追撃の衝撃波（SUPER WIN 以上）
    for (let i = 1; i < fx.shake; i++) {
      later((fx.dur / fx.shake) * i, () => {
        flash(false);
        restart(cabinet, 'shake');
        FX.ring(CX, CY, 'white', 1300, 0.9);
        FX.burst(CX, CY, 260, { max: 1500, life: 2, size: 28, colors });
      });
    }

    await wait(fx.dur * 1000);
    timers.forEach(clearTimeout);
    delete stageEl.dataset.win;
    $('dim').classList.remove('on');
    await hideBanner();
    cabinet.classList.remove('party');
    setPlate('result', fmtN(v), '');
  }

  /* ---------- 設定画面への隠し入口（左上エンブレム長押し） ---------- */
  function initSecret() {
    const crest = $('crest');
    let timer = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; crest.classList.remove('holding'); };
    crest.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (busy || !Store.state.pins) return;
      crest.classList.add('holding');
      timer = setTimeout(async () => {
        cancel();
        Sfx.play('button');
        const role = await UI.auth('PINを入力', ['staff', 'admin'], '設定画面', '営業設定PIN または 管理者PIN');
        if (!role || busy) return;
        try { Store.transact(() => Store.log('ADMIN_LOGIN', {}, role)); } catch (err) { /* ログのみ */ }
        Admin.open(role);
      }, 2500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => crest.addEventListener(ev, cancel));
  }

  async function firstRun() {
    await UI.confirm({
      title: '初期設定', ok: '登録を始める', cancel: false,
      html: '<p>ご利用の前に、2種類のPIN（4〜8桁の数字）を登録してください。登録が完了するまでアプリは使用できません。</p>' +
        '<dl class="kv"><dt>営業設定PIN</dt><dd>日常の営業設定・営業開始/終了・プレイ後のスタッフ認証</dd><dt>管理者PIN</dt><dd>履歴閲覧・プライズ上限ルール・PIN再発行など</dd></dl>' +
        '<p style="color:#8e8672;font-size:16px">登録後、設定画面は画面左上のエンブレムを約3秒長押しして開きます。</p>',
    });
    const staff = await UI.askNewPin('営業設定PINの登録', { solid: true, cancelable: false });
    const admin = await UI.askNewPin('管理者PINの登録', { solid: true, cancelable: false, differPin: staff, differMsg: '営業設定PINと同じ番号は使用できません。' });
    Store.transact((s) => {
      s.pins = { staff: Engine.makePin(staff), admin: Engine.makePin(admin) };
      Store.log('PIN_SETUP', {});
    });
    UI.toast('PINを登録しました。左上のエンブレムを長押しして営業設定を行ってください。', 'ok');
  }

  function guardGestures() {
    const scrollable = (t) => t.closest && t.closest('.adm-body, .dialog .body');
    document.addEventListener('touchmove', (e) => { if (!scrollable(e.target)) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart'].forEach((ev) =>
      document.addEventListener(ev, (e) => { if (!(e.target.tagName === 'INPUT')) e.preventDefault(); }));
    // 画面スリープ防止（対応端末のみ）
    const lock = () => { if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').catch(() => {}); };
    document.addEventListener('visibilitychange', lock);
    window.addEventListener('pointerdown', lock, { once: true });
  }

  async function init() {
    stageEl = $('stage'); cabinet = $('cabinet'); win = $('window'); plate = $('plate'); lockbar = $('lockbar'); banner = $('banner');
    layout();
    window.addEventListener('resize', layout);
    if (window.ResizeObserver) new ResizeObserver(layout).observe($('viewport'));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 300));
    guardGestures();
    try { Store.init(); }
    catch (err) {
      document.body.innerHTML = '<p style="color:#ff9d8c;padding:40px;font-size:20px">保存領域を利用できないため起動できません。プライベートブラウズを解除するか、ブラウザの設定を確認してください。<br>' + esc(err.message) + '</p>';
      return;
    }
    Sfx.init(Store.state.settings.volume);
    buildBulbs();
    FX.init($('fx'));
    Reel.init($('reel'));
    Lever.init(onPull);
    lockbar.addEventListener('click', onLockbar);
    initSecret();
    setStage(1);
    refresh();
    await new Promise((resolve) => {
      const sp = $('splash');
      sp.addEventListener('click', () => {
        Sfx.unlock();
        Sfx.play('ok');
        sp.classList.add('bye');
        setTimeout(() => sp.remove(), 600);
        resolve();
      }, { once: true });
    });
    if (!Store.state.pins) { await firstRun(); refresh(); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh };
})();
