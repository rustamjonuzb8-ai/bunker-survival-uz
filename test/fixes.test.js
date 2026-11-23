// Tekshiruvda topilgan xatolar va mantiqsizliklarning tuzatilishi
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const C = require('../cards.js');
const { server, world } = H;
const G = server._game;

const T0 = 1_700_000_000_000;
test.beforeEach(() => {
  H.reset();
  Object.keys(G.photoIds).forEach((k) => delete G.photoIds[k]);
  test.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 });
});
test.afterEach(() => test.mock.timers.reset());

const CHAT = -100888;
const group = () => H.groupChat(CHAT, "O'yin guruhi");
const advance = async (ms) => {
  test.mock.timers.tick(ms);
  await H.flush();
};
const groupTexts = () => [
  ...world.sent.filter((m) => m.id === CHAT).map((m) => m.text),
  ...world.photos.filter((x) => x.id === CHAT).map((x) => x.caption)
];
const findGroup = (re) => groupTexts().find((t) => re.test(t));

async function startGame(n = 4) {
  const users = [];
  for (let i = 1; i <= n; i++) users.push(H.user(4000 + i, 'R' + i));
  await H.say(users[0], '/bunker', group());
  const g = server.games[server.chatGame[CHAT]];
  for (const u of users) await H.say(u, '/start join_' + g.code, H.privateChat(u.id));
  await H.click(users[0], 'start_' + g.code, group());
  await H.flush();
  return { g, users, P: g.players };
}
async function toVote(g) {
  g.step = 2;
  g.phase = 'discuss';
  await G.startVote(g);
  await H.flush();
}
const vote = (g, u, t) => H.click(u, `vote_${g.code}_${t.id}`, group());
const idle = async (g, limitSec = 2000) => {
  for (let s = 0; !g.finished && s < limitSec; s++) await advance(1000);
};

// ---------- 1. qayta ovoz juda erta yopilmaydi ----------
test('qayta ovoz: eski "hamma ovoz berdi" taymeri yangi ovozlashni yopib yubormaydi', async () => {
  const { g, users } = await startGame(4);
  await toVote(g);
  await vote(g, users[0], users[1]);
  await vote(g, users[1], users[0]);
  await vote(g, users[2], users[0]);
  await vote(g, users[3], users[1]); // 2:2, hamma ovoz berdi: 0,5 s da yopiladi
  await advance(200);
  await vote(g, users[3], users[1]); // yana bosdi (xuddi sinovdagidek)
  await advance(300);
  assert.equal(g.revote, true, 'qayta ovoz boshlandi');
  assert.equal(g.phase, 'vote');
  await advance(1000); // eski taymer shu orada ishlagan bo'lardi
  assert.equal(g.phase, 'vote', 'qayta ovoz hali ochiq');
  assert.equal(g.eliminated.length, 0, 'hech kim vaqtidan oldin haydalmadi');
  // endi qayta ovoz odatdagidek o'tadi
  await vote(g, users[0], users[1]);
  await vote(g, users[1], users[0]);
  await vote(g, users[2], users[0]);
  await vote(g, users[3], users[0]);
  await advance(500);
  assert.equal(g.eliminated.length, 1);
  assert.equal(g.eliminated[0].id, users[0].id);
});

test('bosqich yopish taymeri faqat o\'z bosqichiga tegishli', async () => {
  const { g } = await startGame(4);
  let calls = 0;
  g.phase = 'vote';
  G.closeSoon(g, () => calls++);
  G.closeSoon(g, () => calls++); // ikki marta rejalashtirilmaydi
  await advance(500);
  assert.equal(calls, 1);
  g.phaseId++;
  G.closeSoon(g, () => calls++);
  g.phaseId++; // bosqich almashdi
  await advance(500);
  assert.equal(calls, 1, 'eskirgan taymer ishlamaydi');
});

// ---------- 2. 0 yoki 1 kishi qolsa ----------
test('3 kishi karta ochmay chiqsa: yolg\'iz g\'olib, sababi yoziladi, "davom etadi" deyilmaydi', async () => {
  const { g, users } = await startGame(4);
  await H.click(users[0], `rev_${g.code}_job`, H.privateChat(users[0].id));
  await advance(60000);
  await advance(10000);
  assert.equal(g.finished, true);
  const kick = findGroup(/o'yindan chiqdi/);
  assert.ok(kick && /o'yin yakunlanadi/.test(kick), 'chiqarish xabarida yakun yoziladi');
  assert.doesNotMatch(kick, /O'yin davom etadi/);
  const fin = findGroup(/BUNKERGA KIRGANLAR \(omon qoldi\)/);
  assert.match(fin, /yagona faol qolgani uchun yolg'iz g'olib/);
  assert.match(fin, /R1/);
});

test('hamma karta ochmay chiqsa: "faollik bo\'lmagani uchun yakunlandi", g\'olib yo\'q, g\'alaba rasmi yo\'q', async () => {
  const { g } = await startGame(4);
  await idle(g);
  assert.equal(g.finished, true);
  assert.ok(findGroup(/Partiya faollik bo'lmagani uchun yakunlandi/));
  assert.ok(!world.photos.some((x) => /BUNKERGA KIRGANLAR/.test(x.caption || '')), 'g\'alaba rasmi yo\'q');
  assert.ok(!findGroup(/BUNKERGA KIRGANLAR \(omon qoldi\)/));
  assert.ok(findGroup(/Haydalganlar/));
});

test('o\'yin davom etadigan chiqarishda "O\'yin davom etadi" yoziladi', async () => {
  const { g, users } = await startGame(5);
  for (const u of users.slice(0, 4)) await H.click(u, `rev_${g.code}_job`, H.privateChat(u.id));
  await advance(60000);
  await advance(10000);
  assert.equal(g.finished, false);
  assert.match(findGroup(/o'yindan chiqdi/), /O'yin davom etadi/);
});

// ---------- 3. ovoz bo'lmaganda haqiqiy sabab ----------
test('ovoz bo\'lmasa: o\'yin davomida eng ko\'p ovoz olgan haydaladi va sabab shuni aytadi', async () => {
  const { g, P } = await startGame(4);
  P[0].votesAgainst = 1;
  P[2].votesAgainst = 3;
  await toVote(g);
  await advance(45000);
  assert.equal(g.eliminated[0].id, P[2].id);
  const res = findGroup(/OVOZ NATIJASI/);
  assert.match(res, /Bu safar ovoz bo'lmadi\. O'yin davomida eng ko'p ovoz R3 olgani uchun u chiqdi\./);
  assert.doesNotMatch(res, /tasodif/);
});

test('ovoz bo\'lmasa va o\'yin davomidagi ovozlar teng bo\'lsa: faqat shunda tasodif', async () => {
  const { g, P } = await startGame(4);
  P.forEach((p) => (p.votesAgainst = 2));
  await toVote(g);
  await advance(45000);
  assert.match(findGroup(/OVOZ NATIJASI/), /ovozlar ham teng bo'lgani uchun tasodif bilan tanlandi/);
});

// ---------- 4. kartalar tugagach ----------
test('hamma karta ochilgach muhokama matni va tugmasi to\'g\'ri (2-karta va\'da qilinmaydi)', async () => {
  const { g } = await startGame(4);
  const keys = G.ATTRS.map((a) => a.key);
  g.step = 1;
  g.phase = 'discuss';
  g.ready = new Set();
  const before = G.liveRender(g);
  assert.match(before.text, /Keyin 2-karta ochiladi/);
  g.players.forEach((p) => (p.revealed = keys.slice()));
  const live = G.liveRender(g);
  assert.doesNotMatch(live.text, /2-karta ochiladi/);
  assert.match(live.text, /Barcha kartalar ochildi\. Muhokamadan keyin ovoz beramiz/);
  const skip = live.extra.reply_markup.inline_keyboard.flat().find((b) => /^skip_/.test(b.callback_data));
  assert.match(skip.text, /ovozga o'tish/);
});

test('ochiladigan karta qolmagan raundda sarlavhada "2-kartadan keyin" yozilmaydi', async () => {
  const { g } = await startGame(4);
  const keys = G.ATTRS.map((a) => a.key);
  g.players.forEach((p) => (p.revealed = keys.slice()));
  g.round = 1;
  g.phase = 'between';
  await G.startRound(g);
  assert.equal(g.phase, 'discuss');
  const live = G.liveRender(g);
  assert.doesNotMatch(live.text, /kartadan keyin/);
  assert.match(live.text, /MUHOKAMA/);
  assert.match(live.text, /Barcha kartalar ochildi/);
});

// ---------- 5. karta matni va mexanika mosligi ----------
test('"Anonim xat": natijada kim ishlatgani va kimga ekani e\'lon qilinmaydi', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  P[0].pw = { mech: 'mark', used: false };
  assert.equal(G.usePower(g, P[0].id, P[1].id).ok, true);
  await vote(g, users[0], users[2]);
  await vote(g, users[1], users[2]);
  await vote(g, users[2], users[3]);
  await vote(g, users[3], users[2]);
  await advance(500);
  const t = groupTexts().find((x) => /Bitta qo'shimcha ovoz qo'shildi/.test(x));
  assert.ok(t, 'e\'lon bor');
  const line = t.split('\n').find((l) => /Bitta qo'shimcha ovoz/.test(l));
  assert.doesNotMatch(line, /R1|R2/, 'ismlar yo\'q');
});

test('"Aloqani uzish" matni mexanikaga mos: ovoz beradi, lekin hisoblanmaydi', () => {
  const t = C.POWERS.find((x) => x.startsWith('Aloqani uzish'));
  assert.match(t, /ovoz beradi, lekin uning ovozi bu raundda hisoblanmaydi/);
  assert.doesNotMatch(t, /ovoz bera olmaydi/);
});

// ---------- 6. mantiqsiz juftliklar ----------
const CAT = { job: 'JOBS', health: 'HEALTH', trait: 'TRAITS', hobby: 'HOBBIES', baggage: 'BAGGAGE', secret: 'SECRETS', age: 'AGES' };
const mainOf = (v) => v.split(' (')[0];

test('juftliklar jadvalidagi har bir nom haqiqiy kartaga to\'g\'ri keladi (jadval eskirmaydi)', () => {
  for (const rule of C.CLASHES) {
    for (const [key, test] of rule) {
      assert.ok(CAT[key], key);
      if (typeof test === 'function') {
        assert.ok(C[CAT[key]].some((v) => test(v)), `${key}: funksiya hech qaysi kartaga mos kelmadi`);
      } else {
        for (const name of test) assert.ok(C[CAT[key]].some((v) => mainOf(v) === name), `${key}: "${name}" topilmadi`);
      }
    }
  }
});

test('clash(): mantiqsiz juftlikni topadi, oddiy kartani o\'tkazadi', () => {
  const by = (list, name) => list.find((v) => mainOf(v) === name);
  const ok = { job: by(C.JOBS, 'Jarroh'), health: by(C.HEALTH, "Mutlaqo sog'lom"), age: by(C.AGES, '34 yosh') };
  assert.equal(C.clash(ok), null);
  assert.deepEqual(C.clash({ job: by(C.JOBS, 'Jarroh'), health: by(C.HEALTH, "Bir qo'li ishlamaydi") }), ['health', 'job']);
  assert.ok(C.clash({ health: by(C.HEALTH, "Ovozi yo'q"), hobby: by(C.HOBBIES, "Qo'shiq aytish") }));
  assert.ok(C.clash({ secret: by(C.SECRETS, "O'qishni bilmaydi"), job: by(C.JOBS, 'Yozuvchi') }));
  assert.ok(C.clash({ age: by(C.AGES, '73 yosh'), job: by(C.JOBS, 'Bokschi') }));
  assert.ok(C.clash({ age: by(C.AGES, '19 yosh'), job: by(C.JOBS, 'Sudya') }));
  // qiziqarli lekin inkor qilmaydigan juftlik ruxsat etiladi
  assert.equal(C.clash({ job: by(C.JOBS, 'Sudya'), secret: by(C.SECRETS, 'Unga hech kim ishonmaydi') }), null);
});

test('fixClashes: 4, 12 va 30 o\'yinchida 300 tadan o\'yin - mantiqsiz juftlik ham, takror ham qolmaydi', () => {
  for (const n of [4, 12, 30]) {
    for (let t = 0; t < 300; t++) {
      const draws = G.makeDraws();
      const players = Array.from({ length: n }, (_, i) => ({ id: i, card: G.makeCard(draws) }));
      assert.equal(G.fixClashes(players), true, `${n} o'yinchi, ${t}-o'yin`);
      for (const p of players) assert.equal(C.clash(p.card), null);
      for (const key of ['job', 'health', 'trait', 'hobby', 'baggage', 'secret', 'age', 'power']) {
        const vals = players.map((p) => p.card[key]);
        assert.equal(new Set(vals).size, vals.length, `${key} takrorlandi`);
      }
    }
  }
});

test('o\'yin boshlanganda hech kimda mantiqsiz juftlik yo\'q', async () => {
  for (let i = 0; i < 20; i++) {
    H.reset();
    const { P } = await startGame(12);
    for (const p of P) assert.equal(C.clash(p.card), null);
    Object.keys(server.games).forEach((k) => delete server.games[k]);
    Object.keys(server.chatGame).forEach((k) => delete server.chatGame[k]);
  }
});

test('"Almashtirish" imkoniyati mantiqsiz juftlik hosil qilmaydi', async () => {
  const { g, P } = await startGame(4);
  g.phase = 'discuss';
  const voiceless = C.HEALTH.find((v) => mainOf(v) === "Ovozi yo'q");
  for (let i = 0; i < 200; i++) {
    for (const key of ['trait', 'hobby', 'secret']) {
      P[0].card.health = voiceless;
      P[0].revealed = [];
      P[0].pw = { mech: 'swap', used: false };
      const r = G.usePower(g, P[0].id, key);
      assert.equal(r.ok, true);
      assert.equal(C.clash(P[0].card), null, `${key}: ${P[0].card[key]}`);
    }
  }
});

// ---------- 7. to'liq partiyalar ----------
// 4 dan 12 kishigacha: hamma faol, ovozlar tasodifiy (durang ham chiqadi). Raund soni = boshlaganlar - 2.
for (let n = 4; n <= 12; n++) {
  test(`to'liq partiya, ${n} o'yinchi: ${n - 2} raund, 2 g'olib, ${n - 2} haydalgan`, async () => {
    const { g, users } = await startGame(n);
    for (let i = 0; i < 20000 && !g.finished; i++) {
      const alive = g.players.filter((p) => p.alive);
      if (g.phase === 'reveal') {
        for (const p of alive) {
          const key = G.ATTRS.map((a) => a.key).find((k) => !p.revealed.includes(k));
          if (key && !g.roundRevealed.has(p.id)) await H.click(users.find((u) => u.id === p.id), `rev_${g.code}_${key}`, H.privateChat(p.id));
        }
        await advance(600);
      } else if (g.phase === 'discuss') {
        for (const p of alive) await H.click(users.find((u) => u.id === p.id), `ready_${g.code}`, group());
        await advance(600);
      } else if (g.phase === 'vote') {
        for (const p of alive) {
          const options = g.voteCandidates.filter((c) => c.id !== p.id);
          const t = options[Math.floor(Math.random() * options.length)];
          await H.click(users.find((u) => u.id === p.id), `vote_${g.code}_${t.id}`, group());
        }
        await advance(600);
      } else await advance(1000);
    }
    assert.equal(g.finished, true);
    assert.equal(g.round, n - 2);
    assert.equal(g.players.filter((p) => p.alive).length, 2);
    assert.equal(g.eliminated.length, n - 2);
    assert.ok(findGroup(/BUNKERGA KIRGANLAR \(omon qoldi\)/));
    assert.ok(!findGroup(/Partiya faollik bo'lmagani/));
  });
}
