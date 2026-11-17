const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../cards.js');

const KEYS = ['JOBS', 'HEALTH', 'TRAITS', 'HOBBIES', 'BAGGAGE', 'SECRETS', 'AGES', 'POWERS'];
const STOP = new Set(['va', 'bilan', 'lekin', 'bir', 'marta', 'yoki', 'uchun', 'emas', 'ham', "o'zi", 'kam', "ko'p"]);
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

for (const k of KEYS) {
  test(`${k}: aynan 30 ta, takrorlanmaydi, "Nom (izoh)" shaklida`, () => {
    const L = C[k];
    assert.equal(L.length, 30);
    assert.equal(new Set(L).size, 30, 'bir xil matn bor');
    const mains = L.map((t) => t.split(' (')[0]);
    assert.equal(new Set(mains).size, 30, 'bir xil nom bor');
    for (const t of L) assert.match(t, /^[^()]+ \([^()]+\)$/, t); // splitHint shuni kutadi
  });

  test(`${k}: bir-biriga o'xshamaydi (so'zlar kesishuvi 0.4 dan past)`, () => {
    const L = C[k];
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const s = jaccard(words(L[i]), words(L[j]));
        assert.ok(s < 0.4, `${L[i]} <> ${L[j]}: ${s.toFixed(2)}`);
      }
  });
}

test("kategoriyalar orasida ham bir xil nom yo'q", () => {
  const all = [].concat(...KEYS.map((k) => C[k].map((t) => t.split(' (')[0])));
  assert.equal(new Set(all).size, all.length);
});

test("balans: har kategoriyada o'rtacha ball nolga yaqin, foydali ham, yuk ham bor", () => {
  for (const k of KEYS.filter((x) => x !== 'POWERS')) {
    const v = C.RAW[k].map((x) => x[1]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    assert.ok(Math.abs(mean) <= 0.5, `${k}: o'rtacha ${mean.toFixed(2)}`);
    assert.ok(v.some((x) => x >= 2) && v.some((x) => x <= -2 || x <= -1), `${k}: ikki chetki ham bo'lishi kerak`);
    assert.ok(v.every((x) => x >= -2 && x <= 2));
  }
});

test('imkoniyatlar: har biri bor mexanikaga bog\'langan va hammasi ishlatilgan', () => {
  const known = ['dbl', 'shield', 'veto', 'mark', 'peek', 'peekSecret', 'force', 'swap'];
  const used = new Set();
  for (const [text, mech] of C.RAW.POWERS) {
    assert.ok(known.includes(mech), text);
    assert.equal(C.POWER_MECH.get(text), mech);
    used.add(mech);
  }
  assert.equal(used.size, known.length);
});
