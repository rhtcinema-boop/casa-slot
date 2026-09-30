/* 実行: node tests/engine.test.js */
const assert = require('assert');
const nodeCrypto = require('crypto');
const E = require('../js/engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const counts = (o) => Object.assign(E.emptyCounts(), o);
const rules = E.defaultCapRules();

test('上限ルール: 仕様の例', () => {
  assert.strictEqual(E.capFor(0, rules), 15000);
  assert.strictEqual(E.capFor(20, rules), 15000);
  assert.strictEqual(E.capFor(21, rules), 20000);
  assert.strictEqual(E.capFor(25, rules), 20000);
  assert.strictEqual(E.capFor(30, rules), 25000);
  assert.strictEqual(E.capFor(32, rules), 30000);
  assert.strictEqual(E.capFor(35, rules), 30000);
  assert.strictEqual(E.capFor(36, rules), 35000);
  assert.strictEqual(E.capFor(40, rules), 35000);
  assert.strictEqual(E.capFor(41, rules), 40000);
  assert.strictEqual(E.capFor(100, rules), 95000);
});

test('上限ルールの検証', () => {
  assert.deepStrictEqual(E.validateCapRules(rules), []);
  const bad = E.defaultCapRules();
  bad.ranges[1].from = 25;
  assert.ok(E.validateCapRules(bad).length > 0);
  const bad2 = E.defaultCapRules();
  bad2.beyond.step = 0;
  assert.ok(E.validateCapRules(bad2).length > 0);
});

test('設定検証: 合計不一致・上限超過・不正値は不可', () => {
  const c = counts({ '1:0': 20, '1:500': 6, '1:1000': 2, '2:0': 2, '2:1000': 1, '3:0': 1 });
  assert.strictEqual(E.validateSetup(32, c, rules).ok, true);
  assert.strictEqual(E.validateSetup(32, c, rules).prize, 6000);
  assert.strictEqual(E.validateSetup(31, c, rules).ok, false); // 合計不一致
  const over = counts({ '1:0': 31, '3:50000': 1 });
  assert.strictEqual(E.validateSetup(32, over, rules).ok, false); // 上限超過
  assert.strictEqual(E.validateSetup(0, E.emptyCounts(), rules).ok, false);
  assert.strictEqual(E.validateSetup(3, counts({ '1:0': 1.5, '1:500': 1.5 }), rules).ok, false);
  assert.strictEqual(E.validateSetup(1, counts({ '1:0': 2, '1:500': -1 }), rules).ok, false);
  assert.throws(() => E.createSession(1, 31, c, rules, 0));
});

test('抽選: 全本数を引くと設定内訳と完全一致し、以降は超過プレイ', () => {
  for (let round = 0; round < 50; round++) {
    const c = counts({ '1:0': 20, '1:500': 4, '1:1000': 2, '2:0': 3, '2:1000': 1, '2:2000': 1, '3:0': 2, '3:10000': 1 });
    const total = E.sumCounts(c);
    const s = E.createSession(1, total, c, rules, 0);
    for (let i = 0; i < total; i++) {
      const before = E.sumCounts(s.remaining);
      const r = E.draw(s);
      assert.strictEqual(r.overflow, false);
      assert.ok(s.remaining[r.key] > 0);
      E.applyDraw(s, r);
      assert.strictEqual(E.sumCounts(s.remaining), before - 1);
    }
    assert.deepStrictEqual(s.consumed, s.initial);
    assert.strictEqual(E.sumCounts(s.remaining), 0);
    assert.strictEqual(s.awarded, E.prizeTotal(c));
    const stages = new Set();
    for (let i = 0; i < 60; i++) {
      const r = E.draw(s);
      assert.strictEqual(r.overflow, true);
      assert.strictEqual(r.value, 0);
      assert.ok(r.stage >= 1 && r.stage <= 3);
      stages.add(r.stage);
      E.applyDraw(s, r);
    }
    assert.strictEqual(stages.size, 3); // 3パターンすべて出現
    assert.strictEqual(s.overflowCount, 60);
    assert.deepStrictEqual(s.consumed, s.initial); // 在庫は不変
    assert.strictEqual(s.playNo, total + 60);
  }
});

test('抽選: 出現頻度が残存本数に比例する', () => {
  const N = 40000;
  const hit = {};
  for (let i = 0; i < N; i++) {
    const s = E.createSession(1, 10, counts({ '1:0': 7, '2:0': 2, '3:10000': 1 }), rules, 0);
    const r = E.draw(s);
    hit[r.key] = (hit[r.key] || 0) + 1;
  }
  assert.ok(Math.abs(hit['1:0'] / N - 0.7) < 0.02);
  assert.ok(Math.abs(hit['2:0'] / N - 0.2) < 0.02);
  assert.ok(Math.abs(hit['3:10000'] / N - 0.1) < 0.02);
});

test('抽選: 決定的RNGで境界を確認', () => {
  const s = E.createSession(1, 3, counts({ '1:0': 1, '2:1000': 1, '3:0': 1 }), rules, 0);
  assert.strictEqual(E.draw(s, () => 0).key, '1:0');
  assert.strictEqual(E.draw(s, () => 1).key, '2:1000');
  assert.strictEqual(E.draw(s, () => 2).key, '3:0');
  assert.deepStrictEqual(E.pathFor(3), [1, 2, 3]);
});

test('営業途中の調整: 残り総本数・上限・整数条件', () => {
  const c = counts({ '1:0': 30, '2:5000': 2, '1:500': 3 });
  const s = E.createSession(1, 35, c, rules, 0); // 上限 30,000 / 設定 11,500
  E.applyDraw(s, { overflow: false, key: '2:5000', stage: 2, value: 5000 });
  assert.strictEqual(s.awarded, 5000);
  // 0 を 3本減らして 5000 を 3本増やす → 払出済5000 + 残存(5000*4 + 1500) = 26,500 ≤ 30,000
  const ok = Object.assign({}, s.remaining, { '1:0': 27, '2:5000': 4 });
  assert.strictEqual(E.validateAdjust(s, ok, rules).ok, true);
  // 逆方向
  const back = Object.assign({}, s.remaining, { '1:0': 31, '2:5000': 0 });
  assert.strictEqual(E.validateAdjust(s, back, rules).ok, true);
  // 残り総本数が変わる → 不可
  const bad = Object.assign({}, s.remaining, { '1:0': 28, '2:5000': 4 });
  assert.strictEqual(E.validateAdjust(s, bad, rules).ok, false);
  // 上限超過 → 不可
  const over = Object.assign({}, s.remaining, { '1:0': 25, '2:5000': 6 });
  assert.strictEqual(E.validateAdjust(s, over, rules).ok, false);
  // 負数 → 不可
  const neg = Object.assign({}, s.remaining, { '1:0': 35, '1:500': -1, '2:5000': 0 });
  assert.strictEqual(E.validateAdjust(s, neg, rules).ok, false);
});

test('SHA-256 が Node 標準実装と一致', () => {
  ['', 'abc', '1234', 'あいう', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)].forEach((m) => {
    assert.strictEqual(E.sha256(m), nodeCrypto.createHash('sha256').update(m, 'utf8').digest('hex'));
  });
});

test('PIN ハッシュ', () => {
  const rec = E.makePin('4321');
  assert.ok(E.checkPin('4321', rec));
  assert.ok(!E.checkPin('4322', rec));
  assert.ok(!E.checkPin('4321', null));
  assert.ok(!JSON.stringify(rec).includes('4321'));
});

console.log(process.exitCode ? '\nFAILED' : '\nall ' + passed + ' tests passed');
