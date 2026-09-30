/* プレイヤー画面の進行制御: レイアウト、レバー、抽選確定、ステージ演出、スタッフ認証。 */
const Game = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const CX = 770, CY = 420;          // リール窓の中心（#content 座標）
  /* ステージごとのテーマカラー（粒子・稲妻・衝撃波の色）: 1=ゴールド / 2=サファイア / 3=ルビー */
  const STAGE_COL = { 1: ['gold', 'gold', 'white'], 2: ['blue', 'cyan', 'white', 'violet'], 3: ['red', 'gold', 'white', 'red'] };
  const STAGE_ACC = { 1: 'gold', 2: 'cyan', 3: 'red' };
  let sureShown = false, sureText = ['WIN CONFIRMED', '当選確定！']; // 確定演出が発生中か
  const RAINBOW = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet'];
  const MSG_EMPTY = '抽選可能回数がありません。設定を確認してください。';
  let stageH = 900, lastTrans = '';
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
    stageH = H;
    if (typeof FX !== 'undefined') FX.setGround(900 + (H - 900) / 2 + 6, () => Sfx.play('chip'));
  }

  /* 連続フラッシュ */
  function strobe(n, gap) { for (let i = 0; i < n; i++) setTimeout(() => flash(true), i * (gap || 130)); }
  /* 暗転（sec 秒）。明ける瞬間に閃光。 */
  async function blackout(sec, beat) {
    $('blackout').classList.add('on');
    if (beat !== false) { Sfx.play('heartbeat'); if (sec > 1.1) setTimeout(() => Sfx.play('heartbeat'), 600); }
    await wait(sec * 1000);
    $('blackout').classList.remove('on');
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
    renderLockbar();
    lockbar.classList.add('show');
  }
  function renderLockbar() {
    const p = Store.state.play;
    lockbar.innerHTML =
      '<div class="res"><small>RESULT</small><b class="' + (p.value === 0 ? 'zero' : '') + '">' + fmtN(p.value) + '</b></div>' +
      '<div class="side"><button class="btn" data-act="next">NEXT GAME</button></div>';
  }
  async function onLockbar(e) {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    Sfx.play('button');
    // NEXT GAME を押すと認証を求める（PINが通ったときだけ次のプレイへ進む）
    const role = await UI.auth('認証が必要です', ['staff', 'admin'], '次プレイ認証', 'PINを入力してください');
    if (!role || !Store.state.play || busy) return;
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
  const SURE_RATE = { freeze: 0.02, aura: 0.03, late: 0.03, aa: 0.3 }; // 虹は本当にたまに。aa は高額当選のプレイでの発生率
  const AA_MIN = 5000; // この金額以上が確定しているプレイでだけ AA（エースのペア）が出る
  function pickSure(play, st) {
    if (sureShown || !(play.value > 0) || play.overflow) return null;
    if (window.__fxTest && window.__fxTest.sure !== undefined) return window.__fxTest.sure;
    const r = Math.random();
    if (play.value >= AA_MIN && Math.random() < SURE_RATE.aa) return 'aa';
    if (r < SURE_RATE.freeze) return 'freeze';
    if (r < SURE_RATE.freeze + SURE_RATE.aura) return 'aura';
    if (st === play.stage && r < SURE_RATE.freeze + SURE_RATE.aura + SURE_RATE.late) return 'late';
    return null;
  }
  function announceSure(main, sub) {
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
    sureText = [main || 'WIN CONFIRMED', sub || '当選確定！'];
    setPlate('spin sure', sureText[0], sureText[1]);
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
    setPlate(sureShown ? 'spin sure' : 'spin', sureShown ? sureText[0] : 'GOOD LUCK', sureShown ? sureText[1] : 'STAGE ' + st);

    if (sure === 'freeze') { // 暗転フリーズ → 閃光
      $('blackout').classList.add('on');
      Sfx.play('freeze');
      await wait(1500);
      $('blackout').classList.remove('on');
      announceSure();
      await wait(1100);
    }
    if (sure === 'aa') await pocketAces();
    const extra = {};
    FX.cards(10, 0.3, { sweep: true });
    Sfx.play('shuffle');
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
    await wait(600);
    await blackout(1.3);                 // 暗転して一拍
    flash(true);
    $('dim').classList.add('on');
    win.classList.add('win');
    cabinet.classList.add('party', 'tremble');
    content.classList.add('zoom-charge');
    Sfx.play('riser', 2.8);
    Sfx.play('warp');
    FX.converge(CX, CY, fin ? 360 : 260, 2.8);
    FX.streaks(CX, CY, fin ? 220 : 150, 2.6, { inward: true, colors });
    later(0.8, () => FX.converge(CX, CY, fin ? 280 : 180, 1.1));
    [0.9, 1.5, 1.9, 2.2, 2.45, 2.65].slice(0, fin ? 6 : 4).forEach((t) => later(t, () => { const a = Math.random() * 6.28; zap(CX + Math.cos(a) * 760, CY + Math.sin(a) * 460, CX, CY); }));
    await wait(2800);

    // 2. 大爆発
    cabinet.classList.remove('tremble');
    content.classList.remove('zoom-charge');
    content.classList.add('zoom-punch');
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
    for (let t = 0.5; t < (fin ? 5.4 : 4.2); t += fin ? 0.24 : 0.34) {
      later(t, () => {
        const x = 200 + Math.random() * 1200, y = 110 + Math.random() * 480;
        Sfx.play('pop');
        setTimeout(() => { FX.burst(x, y, 80, { max: 700, colors }); FX.ring(x, y, Math.random() < 0.5 ? ACC : 'white', 280, 0.5); }, 300);
      });
    }
    later(0.75, () => { quake(); FX.ring(CX, CY, 'white', 1400, 0.9); }); // 文字が揃った瞬間の追撃
    if (fin) later(1.7, () => { flash(false); quake(); restart(cabinet, 'shake'); Sfx.play('thunder'); FX.ring(CX, CY, ACC, 1500, 1.0); FX.burst(CX, CY, 320, { max: 1800, life: 2, colors }); for (let i = 0; i < 6; i++) zap(CX, CY, rnd(0, 1600), rnd(0, 900)); });
    later(2.4, () => { strobe(4); quake(); FX.ring(CX, CY, ACC, 1500, 1.0); FX.burst(CX, CY, 280, { max: 1700, life: 2, colors }); Sfx.play('stamp'); });
    if (fin) later(3.8, () => { strobe(6, 100); quake(); Sfx.play('thunder'); FX.burst(CX, CY, 320, { max: 1800, life: 2, colors }); });
    await wait(fin ? 5800 : 4600);
    timers.forEach(clearTimeout);
    delete stageEl.dataset.win;
    content.classList.remove('zoom-punch');
    await hideBanner();
    $('dim').classList.remove('on');

    // 3. 扉が閉まり、開門の儀式へ
    await stageTransition(to);
    win.classList.remove('win');
    cabinet.classList.remove('party');
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  const STAGE_NAMES = { 2: 'SAPPHIRE STAGE', 3: 'RUBY FINAL' };
  const HANDS_UNUSED = {
    2: { name: 'FOUR OF A KIND', cards: [['A', '\u2660'], ['A', '\u2665'], ['A', '\u2666'], ['A', '\u2663'], ['K', '\u2660']] },
    3: { name: 'ROYAL FLUSH', cards: [['10', '\u2660'], ['J', '\u2660'], ['Q', '\u2660'], ['K', '\u2660'], ['A', '\u2660']] },
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  function mk(cls, html) { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; $('trans').appendChild(d); return d; }

  /* ステージ移行。パターンを毎回ランダムに選ぶ（同じものは連続させない）:
       shatter … 画面のガラスにヒビが入り、砕け散る
       chips   … チップがどんどん積み上がって画面を埋め、弾け飛ぶ
       vault   … 金庫扉が閉まり、ドラムロールのあと開く */
  const TRANS = { shatter: transShatter, chips: transChips, vault: transVault };
  async function stageTransition(to) {
    const names = Object.keys(TRANS);
    let p = window.__fxTest && window.__fxTest.trans;
    if (!TRANS[p]) { do p = names[Math.floor(Math.random() * names.length)]; while (p === lastTrans); }
    lastTrans = p;
    $('trans').innerHTML = '';
    await blackout(1.0);                 // 移行の前に暗転
    await TRANS[p](to);
    $('trans').innerHTML = '';
  }

  /* ステージ名の刻印（叩きつける） */
  async function stampStage(to, hold) {
    const label = $('shutterLabel'), fin = to === 3;
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = STAGE_NAMES[to] || '';
    label.classList.remove('stamp'); void label.offsetWidth;
    label.classList.add('show', 'stamp');
    stageEl.classList.add('named');
    stageEl.classList.toggle('fin', fin);
    await wait(330);
    Sfx.play('stamp');
    quake();
    flash(true);
    FX.ring(800, 450, STAGE_ACC[to], 1000, 0.9);
    FX.ring(800, 450, 'white', 700, 0.6);
    FX.burst(800, 450, fin ? 300 : 200, { max: 1300, life: 1.6, colors: STAGE_COL[to] });
    FX.streaks(800, 450, 120, 0.5, { colors: STAGE_COL[to] });
    await wait(hold);
  }
  function hideStamp() { $('shutterLabel').classList.remove('show', 'stamp'); stageEl.classList.remove('named'); }

  /* 新しいステージに到着: ズームアウトしながら全体が弾ける。全パターン共通の締め。 */
  async function arrive(to, title) {
    const fin = to === 3, colors = STAGE_COL[to], ACC = STAGE_ACC[to], content = $('content');
    if (curStage !== to) setStage(to); else FX.setAmbient([0, 0, 14, 30][to], colors);
    Sfx.play('open', fin);
    content.classList.add('reveal');
    restart(cabinet, 'shake');
    stageEl.dataset.win = fin ? 7 : 6;
    FX.ring(CX, CY, 'white', 1300, 1.0);
    setTimeout(() => FX.ring(CX, CY, ACC, 1500, 1.2), 160);
    FX.burst(CX, CY, fin ? 460 : 320, { max: 1700, life: 2, size: 26, colors });
    FX.streaks(CX, CY, fin ? 240 : 160, 1.2, { colors });
    [200, 600, 1000, 1400].forEach((x, i) => FX.fountain(x, 930, fin ? 90 : 60, 1.4 + i * 0.1, colors));
    FX.flakes(fin ? 220 : 140, 1.6, colors);
    // ステージ表示を光が駆け上がり、新しいステージが点灯する
    const y0 = RUNG_Y[to - 1], y1 = RUNG_Y[to];
    for (let i = 0; i <= 8; i++) setTimeout(() => FX.burst(180, y0 + ((y1 - y0) * i) / 8, 14, { max: 260, life: 0.6, size: 12, colors }), 300 + i * 50);
    setTimeout(() => { FX.ring(180, y1, ACC, 260, 0.6); FX.burst(180, y1, 90, { max: 600, colors }); }, 760);
    setTimeout(() => strobe(3), 500);
    if (title) { await wait(700); await stampStage(to, 1900); hideStamp(); await wait(300); }
    else await wait(2600);
    content.classList.remove('reveal');
    stageEl.classList.remove('fin');
    delete stageEl.dataset.win;
    await wait(250);
  }

  /* ---- ガラス ----
     中心から放射状に三角形の破片を敷き詰める。ヒビは破片の辺に沿って段階的に現れる。 */
  function glass() {
    const T = $('trans'), W = 1600, H = stageH, cx = 770, cy = H / 2 - 30, N = 11;
    const ang = [];
    for (let i = 0; i < N; i++) ang.push(((i + Math.random() * 0.55) / N) * Math.PI * 2);
    const ringPts = (r, sq) => ang.map((a) => { const k = 0.8 + Math.random() * 0.4; return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * sq * k]; });
    const r1 = ringPts(180, 0.8), r2 = ringPts(470, 0.72), r3 = ang.map((a) => [cx + Math.cos(a) * 2000, cy + Math.sin(a) * 2000]);
    const tris = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      tris.push({ p: [[cx, cy], r1[i], r1[j]], ring: 0 });
      tris.push({ p: [r1[i], r2[i], r2[j]], ring: 1 }, { p: [r1[i], r2[j], r1[j]], ring: 1 });
      tris.push({ p: [r2[i], r3[i], r3[j]], ring: 2 }, { p: [r2[i], r3[j], r2[j]], ring: 2 });
    }
    const shards = tris.map((t) => {
      const xs = t.p.map((q) => q[0]), ys = t.p.map((q) => q[1]);
      const l = Math.max(-20, Math.min.apply(null, xs)), tp = Math.max(-20, Math.min.apply(null, ys));
      const r = Math.min(W + 20, Math.max.apply(null, xs)), b = Math.min(H + 20, Math.max.apply(null, ys));
      const el = mk('shard');
      const mx = Math.max(l, Math.min(r, (xs[0] + xs[1] + xs[2]) / 3)), my = Math.max(tp, Math.min(b, (ys[0] + ys[1] + ys[2]) / 3));
      el.style.cssText = 'left:' + l + 'px;top:' + tp + 'px;width:' + (r - l) + 'px;height:' + (b - tp) + 'px;' +
        'transform-origin:' + (mx - l) + 'px ' + (my - tp) + 'px;';
      const poly = 'polygon(' + t.p.map((q) => (q[0] - l).toFixed(1) + 'px ' + (q[1] - tp).toFixed(1) + 'px').join(',') + ')';
      el.style.clipPath = poly; el.style.webkitClipPath = poly;
      const a = Math.floor(Math.random() * 360);
      el.style.background = 'linear-gradient(' + a + 'deg, rgba(255,255,255,' + (0.18 + Math.random() * 0.3).toFixed(2) + '), rgba(var(--acc),' + (0.1 + Math.random() * 0.2).toFixed(2) + ') 45%, rgba(255,255,255,.04))';
      return { el, mx, my, ring: t.ring };
    });
    // ヒビ（SVG）
    const seg = (a, b) => 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
    const d = ['', '', ''];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      d[0] += seg([cx, cy], r1[i]) + seg(r1[i], r1[j]);
      d[1] += seg(r1[i], r2[i]) + seg(r2[i], r2[j]) + seg(r1[i], r2[j]);
      d[2] += seg(r2[i], r3[i]) + seg(r2[i], r3[j]);
    }
    const svg = mk('', '<svg class="cracks" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + d.map((x) => '<path d="' + x + '"/>').join('') + '</svg>');
    const paths = svg.querySelectorAll('path');
    return {
      cx, cy,
      crack(i) { if (paths[i]) paths[i].classList.add('on'); },
      light() { shards.forEach((s) => s.el.classList.add('lit')); },
      burst() { // 破片が外へ飛び散りながら落ちる
        svg.remove();
        shards.forEach((s) => {
          const dx = s.mx - cx, dy = s.my - cy, L = Math.hypot(dx, dy) || 1, far = 500 + Math.random() * 700;
          const dur = 0.8 + Math.random() * 0.6, delay = s.ring * 0.05 + Math.random() * 0.08;
          s.el.style.transition = 'transform ' + dur + 's cubic-bezier(.2,.4,.7,1) ' + delay + 's, opacity ' + (dur * 0.5) + 's ease-in ' + (delay + dur * 0.5) + 's';
          s.el.style.transform = 'translate(' + ((dx / L) * far).toFixed(0) + 'px,' + ((dy / L) * far + 380).toFixed(0) + 'px) rotate3d(' + Math.random().toFixed(2) + ',' + Math.random().toFixed(2) + ',' + Math.random().toFixed(2) + ',' + (200 + Math.random() * 500).toFixed(0) + 'deg) scale(.7)';
          s.el.style.opacity = 0;
        });
      },
    };
  }
  /* ヒビ（steps 段階）→ 粉砕。粉砕の瞬間にステージが切り替わる。 */
  async function breakGlass(to, steps) {
    const fin = to === 3, g = glass();
    const plan = steps >= 3 ? [[0], [1], [2]] : steps === 2 ? [[0], [1, 2]] : [[0, 1, 2]];
    await frame();
    for (let i = 0; i < plan.length; i++) {
      plan[i].forEach((k) => g.crack(k));
      Sfx.play('crack', i / 2);
      restart(cabinet, 'thud');
      FX.burst(g.cx, g.cy - 0, 40 + i * 30, { max: 500 + i * 300, life: 0.7, size: 12, colors: ['white', 'silver'] });
      if (fin && i > 0) { flash(true); Sfx.play('thunder'); FX.lightning(rnd(200, 1400), -80, g.cx, 450, 'red', 5); }
      flash(true);
      await wait(fin ? 950 : 800);
    }
    g.light();
    Sfx.play('heartbeat');
    await wait(900);                     // 割れる直前の溜め
    Sfx.play('shatter');
    flash(false);
    quake();
    setStage(to);
    g.burst();
    FX.burst(CX, CY, 260, { max: 1800, life: 1.4, size: 16, colors: ['white', 'silver', 'white'] });
    FX.streaks(CX, CY, 140, 0.5, { colors: ['white', 'silver'] });
  }

  async function transShatter(to) {
    await stampStage(to, 1400);          // ガラスに次のステージ名が刻まれる
    hideStamp();
    await wait(300);
    await breakGlass(to, 3);
    await arrive(to, false);
  }

  /* ---- カード（AA の確定演出で使用） ---- */
  function pcard(rank, suit) {
    const red = suit === '\u2665' || suit === '\u2666';
    const c = '<span class="cr">' + rank + '<i>' + suit + '</i></span>';
    return mk('pcard' + (red ? ' red' : ''), '<div class="b"></div><div class="f">' + c + '<span class="big">' + suit + '</span><span class="cr br">' + rank + '<i>' + suit + '</i></span></div>');
  }
  const place = (el, x, y, rz, ry, s) => { el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotateZ(' + rz + 'deg) rotateY(' + ry + 'deg) scale(' + s + ')'; };

  async function transChips(to) {
    const fin = to === 3, cols = fin ? ['red', 'gold', 'black', 'white'] : ['blue', 'white', 'black', 'purple'];
    const cover = mk('cover');
    await frame();
    cover.classList.add('on');
    FX.setAmbient(0);
    // 少しずつ → どんどん → 雪崩、と3段階で積み上がる
    const waves = fin ? [[60, 1.2, 22], [140, 1.4, 27], [260, 1.6, 32], [200, 1.2, 36]] : [[60, 1.2, 22], [140, 1.4, 27], [240, 1.6, 32]];
    for (let i = 0; i < waves.length; i++) {
      FX.chips(waves[i][0], waves[i][1], cols, { land: true, size: waves[i][2] });
      Sfx.play('chipfall', waves[i][1] + 0.4);
      if (i > 0) { flash(true); restart(cabinet, 'thud'); }
      await wait(waves[i][1] * 1000 + 250);
    }
    await wait(900);
    await blackout(0.7, false);
    setStage(to);
    FX.setAmbient(0);
    await stampStage(to, fin ? 2400 : 1800);
    if (fin) { strobe(5, 110); Sfx.play('thunder'); await wait(500); }
    hideStamp();
    FX.releasePile();                     // チップが弾け飛ぶ
    Sfx.play('impact'); Sfx.play('chipfall', 1);
    cover.classList.remove('on');
    flash(false); quake();
    await arrive(to, false);
  }

  async function transVault(to) {
    const fin = to === 3, colors = STAGE_COL[to], ACC = STAGE_ACC[to];
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
    await wait(700);
    stageEl.classList.add('ceremony');
    await wait(450);
    await stampStage(to, 1500);
    // ドラムロール（光が扉に吸い込まれていく。最終ステージは雷鳴つきで長い）
    const roll = fin ? 4.0 : 3.0;
    Sfx.play('roll', roll);
    stageEl.classList.add('rolling');
    FX.streaks(800, 450, fin ? 220 : 140, roll - 0.3, { inward: true, colors });
    FX.converge(800, 450, fin ? 240 : 150, roll);
    const tm = [];
    for (let t = 0.2; t < roll; t += fin ? 0.2 : 0.28) tm.push(setTimeout(() => FX.burst(200 + Math.random() * 1200, 450, 16, { max: 520, life: 0.8, size: 12, colors }), t * 1000));
    if (fin) [0.6, 1.3, 1.9, 2.4].forEach((t) => tm.push(setTimeout(() => { flash(true); quake(); Sfx.play('thunder'); FX.lightning(rnd(100, 1500), -100, rnd(300, 1300), 450, ACC, 6); FX.lightning(rnd(100, 1500), 1000, rnd(300, 1300), 450, 'white', 5); }, t * 1000)));
    await wait(roll * 1000);
    tm.forEach(clearTimeout);
    // 開門
    hideStamp();
    stageEl.classList.remove('rolling');
    stageEl.classList.add('blast');
    flash(false);
    quake();
    await wait(200);
    stageEl.classList.add('opening-slow');
    stageEl.classList.remove('shut', 'ceremony');
    await arrive(to, false);
    stageEl.classList.remove('opening-slow', 'blast');
  }

  /* AA（エースのペア）: 高額当選が確定しているプレイでだけ出る。
     暗転 → 伏せた2枚が配られる → 1枚ずつめくれて A・A → 閃光。 */
  async function pocketAces() {
    const y = stageH / 2 - 20;
    const cover = mk('cover');
    const cards = [['A', '\u2660'], ['A', '\u2665']].map((c, i) => { const el = pcard(c[0], c[1]); place(el, 800, -420, rnd(-160, 160), 0, 1.25); return { el, x: 800 + (i ? 170 : -170), rz: i ? 7 : -7 }; });
    await frame();
    cover.classList.add('on');
    Sfx.play('freeze');
    await wait(900);
    for (const c of cards) { place(c.el, c.x, y, c.rz, 0, 1.25); Sfx.play('deal'); await wait(380); }
    await wait(700);
    place(cards[0].el, cards[0].x, y, cards[0].rz, 180, 1.25); Sfx.play('flip'); Sfx.play('bolt', 0.3);
    setTimeout(() => { flash(true); FX.burst(cards[0].x, 450, 60, { max: 700, colors: ['white', 'gold'] }); }, 220);
    await wait(1500);                                   // 2枚目は溜める
    Sfx.play('heartbeat');
    await wait(700);
    place(cards[1].el, cards[1].x, y, cards[1].rz, 180, 1.25); Sfx.play('flip'); Sfx.play('bolt', 1);
    await wait(260);
    cards.forEach((c) => c.el.classList.add('hot'));
    flash(false); quake();
    FX.ring(800, 450, 'white', 1200, 0.9);
    FX.chips(80, 1.0, ['gold', 'black', 'red']);
    announceSure('BIG WIN CONFIRMED', '高額当選確定！');
    await wait(2200);
    cards.forEach((c, i) => place(c.el, c.x + (i ? 900 : -900), -500, i ? 60 : -60, 180, 1));
    cover.classList.remove('on');
    await wait(500);
    $('trans').innerHTML = '';
  }

  /* 次のプレイへ戻るときの短いシャッター */
  async function transition(to) {
    const label = $('shutterLabel');
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = '';
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
  const CHIP_LV = [['red'], ['blue', 'red'], ['green', 'red', 'blue'], ['black', 'green', 'blue'], ['purple', 'black', 'red'], ['gold', 'black', 'purple'], ['gold', 'black', 'white', 'purple'], ['gold', 'gold', 'black', 'white']];
  const WIN_FX = [
    //  秒数  ラベル        粒子  金粉  花火間隔(秒)  揺れ回数  カウントアップ(秒)
    { dur: 3.4, label: 'WIN',       burst: 70,  rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 4.2, label: 'WIN',       burst: 110, rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 5.4, label: 'NICE WIN',  burst: 150, rain: 70,  fire: 0,    shake: 0, count: 0.9 },
    { dur: 6.6, label: 'BIG WIN',   burst: 190, rain: 130, fire: 1.0,  shake: 0, count: 1.2 },
    { dur: 8.2, label: 'BIG WIN',   burst: 230, rain: 200, fire: 0.75, shake: 1, count: 1.6 },
    { dur: 10.5, label: 'SUPER WIN', burst: 280, rain: 320, fire: 0.55, shake: 1, count: 2.2 },
    { dur: 13.5, label: 'MEGA WIN',  burst: 340, rain: 520, fire: 0.4,  shake: 2, count: 3.0 },
    { dur: 17, label: 'JACKPOT',   burst: 420, rain: 800, fire: 0.28, shake: 4, count: 4.0 },
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
    if (L >= 3) await blackout(L >= 6 ? 1.5 : 0.8); // 暗転で溜めてから一気に明ける
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
    // カジノチップ: 低額は雨、中額から画面下に積み上がり、高額は噴水も加わる。色は金額で変わる
    const chipCols = CHIP_LV[L - 1];
    Sfx.play('chipfall', fx.dur - 1.5);
    if (L <= 2) FX.chips(20 + L * 20, fx.dur - 1.4, chipCols);
    else FX.chips(40 + L * 34, fx.dur - 1.6, chipCols, { land: true, size: 20 });
    if (L >= 6) {
      [0.5, fx.dur * 0.4, fx.dur * 0.68, fx.dur * 0.82].slice(0, L - 4).forEach((t) => later(t, () => {
        FX.chipFountain(240, 930, 55, 0.8, chipCols, { land: true, vx: 220 });
        FX.chipFountain(1360, 930, 55, 0.8, chipCols, { land: true, vx: -220 });
        Sfx.play('chipfall', 1.2);
      }));
    }
    if (L >= 3) FX.cards(6 + L * 2, 0.5, { x: CX, y: CY });
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

    // 連続フラッシュ・途中の暗転 → 再点火・締めの一撃
    if (L >= 4) for (let t = 1.4; t < fx.dur - 2; t += L >= 6 ? 0.9 : 1.4) later(t, () => flash(true));
    if (L >= 5) later(fx.dur * 0.5, () => {
      $('blackout').classList.add('on');
      setTimeout(() => { $('blackout').classList.remove('on'); flash(false); quake(); Sfx.play('impact'); FX.ring(CX, CY, 'white', 1400, 1.0); FX.burst(CX, CY, 300, { max: 1700, life: 2, size: 26, colors }); strobe(3); }, 450);
    });
    if (L >= 3) later(fx.dur - 1.7, () => {
      restart($('bannerValue'), 'slam'); Sfx.play('stamp'); flash(false); quake();
      FX.ring(CX, CY, 'gold', 1300, 1.0); FX.burst(CX, CY, 200 + L * 30, { max: 1600, life: 1.6, colors });
    });
    await wait(fx.dur * 1000);
    timers.forEach(clearTimeout);
    delete stageEl.dataset.win;
    $('dim').classList.remove('on');
    FX.releasePile(); // 積み上がったチップを弾き飛ばして片付ける
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
