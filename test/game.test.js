const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const { server, world } = H;
const G = server._game;
const A = server._admin;

const T0 = 1_700_000_000_000;
test.beforeEach(() => {
  H.reset();
  test.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 });
});
test.afterEach(() => {
  test.mock.timers.reset();
});

const CHAT = -100500;
const group = () => H.groupChat(CHAT, "O'yin guruhi");
const advance = async (ms) => {
  test.mock.timers.tick(ms);
  await H.flush();
};
const groupMsgs = () => world.sent.filter((m) => m.id === CHAT);
const liveMsgs = () => groupMsgs().filter((m) => m.text.startsWith('🛡 <b>BUNKER</b>'));
const dms = (uid) => world.sent.filter((m) => m.id === uid);

async function newGame(n = 4) {
  const users = [];
  for (let i = 1; i <= n; i++) users.push(H.user(2000 + i, 'P' + i));
  await H.say(users[0], '/bunker', group());
  const g = server.games[server.chatGame[CHAT]];
  for (const u of users) await H.say(u, '/start join_' + g.code, H.privateChat(u.id));
  return { g, users, host: users[0] };
}
async function startGame(n = 4) {
  const x = await newGame(n);
  await H.click(x.host, 'start_' + x.g.code, group());
  await H.flush();
  return x;
}
const reveal = (g, u, key) => H.click(u, `rev_${g.code}_${key}`, H.privateChat(u.id));
const ready = (g, u) => H.click(u, `ready_${g.code}`, group());
const vote = (g, u, target) => H.click(u, `vote_${g.code}_${target.id}`, group());
async function allReveal(g, users, key) {
  for (const u of users) await reveal(g, u, key);
  await advance(500);
}
const idle = async (g, limitSec = 2000) => {
  let sec = 0;
  while (!g.finished && sec < limitSec) {
    await advance(1000);
    sec++;
  }
  return sec;
};

// ---------- o'yin oqimi va vaqt hisobi ----------
test('hech kim hech narsa qilmasa ham o\'yin o\'zi tugaydi; vaqt hisobi to\'g\'ri', async () => {
  const { g } = await startGame(4);
  const sec = await idle(g);
  assert.equal(g.finished, true);
  assert.equal(g.round, 2); // 4 o'yinchi - 2 joy = 2 raund
  assert.equal(g.eliminated.length, 2);
  assert.equal(g.players.filter((p) => p.alive).length, 2);
  // raund: 60 (ochish) + 90 + 60 + 80 + 45 (ovoz) + 4 (oraliq) = 339 s; oxirgisida oraliq yo'q: 339 + 335 = 674 s
  assert.ok(sec >= 674 && sec <= 676, 'vaqt: ' + sec);
  assert.ok(groupMsgs().some((m) => /O'YIN TUGADI/.test(m.text)));
  assert.equal(A.getDB().gamesFinished, 1);
});

test('jonli xabar: har bosqichda bittadan, eskisi o\'chiriladi, doimiy xabarlar qoladi', async () => {
  const { g } = await startGame(4);
  assert.equal(liveMsgs().length, 1);
  const first = g.liveMsgId;
  assert.match(liveMsgs()[0].text, /1-karta ochiladi/);
  assert.ok(H.buttonsOf(liveMsgs()[0]).some((b) => b.url === 'https://t.me/Bunkeruz1_bot'));
  await advance(60000); // ochish vaqti tugadi -> summary + muhokama
  assert.equal(g.phase, 'discuss');
  assert.ok(world.deleted.some((d) => d.msgId === first), 'eski jonli xabar o\'chirilishi kerak');
  assert.equal(liveMsgs().length, 2);
  assert.notEqual(g.liveMsgId, first);
  assert.ok(groupMsgs().some((m) => /RAUND 1 \(1-karta\) HOLATI/.test(m.text)), 'holat doimiy xabar sifatida qoladi');
  // jonli xabar bir vaqtning o'zida faqat bitta (o'chirilmaganlar soni)
  const alive = liveMsgs().filter((m) => !world.deleted.some((d) => d.msgId === m.mid));
  assert.equal(alive.length, 1);
});

test('taymer chizig\'i: matematik to\'g\'ri va vaqt o\'tgani sari qisqaradi', async () => {
  const mk = (left, total) => ({ deadline: T0 + left * 1000, phaseSec: total });
  const bars = (g) => G.barLine(g);
  assert.match(bars(mk(60, 60)), /▓{10} 1:00/);
  assert.match(bars(mk(45, 60)), /▓{8}░{2} 45 s/); // ceil(7.5) = 8
  assert.match(bars(mk(30, 60)), /▓{5}░{5} 30 s/);
  assert.match(bars(mk(6, 60)), /▓{1}░{9} 6 s/);
  assert.match(bars(mk(0, 60)), /░{10} 0 s/);
  assert.match(bars(mk(90, 90)), /1:30/);
  assert.equal(G.barLine({ deadline: null }), '');
  // jonli xabarda ham yangilanadi
  const { g } = await startGame(4);
  const base = world.edits.length; // lobbi tahrirlari hisobga kirmaydi
  for (let i = 0; i < 3; i++) await advance(10000); // haqiqiy vaqtdagidek 10 soniyadan
  const last = world.edits[world.edits.length - 1];
  assert.equal(last.msgId, g.liveMsgId);
  assert.match(last.text, /▓{5}░{5} 30 s/);
  // 30 soniyada 10 soniyalik taymer 3 marta yangilaydi
  assert.equal(world.edits.length - base, 3);
});

test('hamma karta ochsa 0.5 soniyada keyingi bosqich, yangi ochilgani 🆕 bilan, eskisi qisqa', async () => {
  const { g, users } = await startGame(4);
  // kartalar tasodifiy; izohi bor aniq qiymatlarni qo'yamiz (test barqaror bo'lishi uchun)
  g.players.forEach((p) => {
    p.card.job = 'Shifokor (operatsiya qila oladi, kasallarni davolaydi)';
    p.card.health = "Yuragi zaif (og'ir ish qila olmaydi)";
  });
  for (const u of users) await reveal(g, u, 'job');
  assert.equal(g.phase, 'reveal'); // 500 ms oldin
  await advance(500);
  assert.equal(g.phase, 'discuss');
  const s1 = groupMsgs().find((m) => /\(1-karta\) HOLATI/.test(m.text));
  assert.equal((s1.text.match(/🆕/g) || []).length, 4);
  // ikkinchi karta: sog'liq. Avvalgi (kasb) qisqa, yangi (sog'liq) to'liq izoh bilan
  await advance(90000);
  assert.equal(g.step, 2);
  for (const u of users) await reveal(g, u, 'health');
  await advance(500);
  const s2 = groupMsgs().find((m) => /\(2-karta\) HOLATI/.test(m.text));
  const p1 = g.players[0];
  const jobHint = p1.card.job.match(/\((.*)\)/)[1];
  const healthHint = p1.card.health.match(/\((.*)\)/)[1];
  assert.ok(!s2.text.includes(jobHint), 'eski karta izohi qisqartirilishi kerak');
  assert.ok(s2.text.includes(healthHint), 'yangi karta to\'liq bo\'lishi kerak');
});

test('bir bosqichda ikki marta karta ochib bo\'lmaydi, ochilgan karta qayta ochilmaydi', async () => {
  const { g, users } = await startGame(4);
  let ctx = await reveal(g, users[0], 'job');
  assert.equal(ctx.answers[0].text, 'Ochildi!');
  ctx = await reveal(g, users[0], 'health');
  assert.match(ctx.answers[0].text, /allaqachon ochgansiz/);
  assert.deepEqual(g.players[0].revealed, ['job']);
  // begona odam ocha olmaydi
  ctx = await reveal(g, H.user(9999, 'Begona'), 'job');
  assert.match(ctx.answers[0].text, /o'yinda emassiz/);
});

// ---------- tayyorman ----------
test('"Tayyorman": tiriklarning yarmidan ko\'pi bossa muhokama tugaydi', async () => {
  // matematika: kerakli son = floor(n/2) + 1
  const need = (n) => G.readyNeed({ players: Array.from({ length: n }, () => ({ alive: true })) });
  assert.deepEqual([3, 4, 5, 6, 7, 12].map(need), [2, 3, 3, 4, 4, 7]);

  const { g, users } = await startGame(4);
  await allReveal(g, users, 'job');
  assert.equal(g.phase, 'discuss');
  await ready(g, users[0]);
  await ready(g, users[1]);
  assert.equal(g.ready.size, 2);
  assert.equal(g.phase, 'discuss'); // 4 kishidan 3 kerak
  const ctx = await ready(g, users[1]); // bekor qilish
  assert.equal(g.ready.size, 1);
  assert.match(ctx.answers[0].text, /bekor/);
  await ready(g, users[1]);
  assert.equal(g.phase, 'discuss');
  await ready(g, users[2]); // 3-chi: yarmidan ko'p
  await H.flush();
  assert.equal(g.phase, 'reveal');
  assert.equal(g.step, 2);
  // 2-muhokamadan keyin ovozga o'tadi
  await allReveal(g, users, 'health');
  for (const u of users.slice(0, 3)) await ready(g, u);
  await H.flush();
  assert.equal(g.phase, 'vote');
});

test('"Tayyorman": begona va haydalgan bosa olmaydi, muhokamadan tashqarida ishlamaydi', async () => {
  const { g, users } = await startGame(4);
  let ctx = await ready(g, users[0]); // hozir ochish bosqichi
  assert.match(ctx.answers[0].text, /Muhokama tugagan/);
  await allReveal(g, users, 'job');
  ctx = await ready(g, H.user(7777, 'Begona'));
  assert.equal(ctx.answers[0].extra.show_alert, true);
  g.players[3].alive = false;
  ctx = await ready(g, users[3]);
  assert.equal(ctx.answers[0].extra.show_alert, true);
  assert.equal(g.ready.size, 0);
});

test('"Xona egasi: o\'tkazish" faqat xona egasi va guruh adminlari uchun', async () => {
  const { g, users, host } = await startGame(4);
  await allReveal(g, users, 'job');
  let ctx = await H.click(users[1], 'skip_' + g.code, group());
  assert.match(ctx.answers[0].text, /Faqat xona egasi/);
  assert.equal(g.phase, 'discuss');
  ctx = await H.click(host, 'skip_' + g.code, group());
  await H.flush();
  assert.equal(g.phase, 'reveal');
  assert.equal(g.step, 2);
});

// ---------- ovoz berish ----------
test('jonli ovoz: tugmalarda soni, kim ovoz bergani; yangilash siyraklashtirilgan', async () => {
  const { g, users } = await startGame(4);
  g.step = 2;
  g.phase = 'discuss';
  await G.startVote(g);
  assert.equal(g.phase, 'vote');
  const before = world.edits.length;
  await vote(g, users[0], users[1]);
  await vote(g, users[2], users[1]);
  assert.equal(world.edits.length, before, 'darhol tahrir qilinmaydi (3.5 s ichida bittaga birlashadi)');
  await advance(3500);
  assert.equal(world.edits.length, before + 1);
  const e = world.edits[world.edits.length - 1];
  assert.match(e.text, /Ovoz berdi: <b>2\/4<\/b>/);
  const btn = [].concat(...e.extra.reply_markup.inline_keyboard).find((b) => b.callback_data === `vote_${g.code}_${users[1].id}`);
  assert.match(btn.text, /\(2\)/);
  assert.match(e.text, /✅ P1/);
  assert.match(e.text, /⏳ P2/);
  // o'ziga ovoz berib bo'lmaydi
  const ctx = await vote(g, users[3], users[3]);
  assert.match(ctx.answers[0].text, /o'zingizga/i);
});

test('teng ovoz: qayta ovoz, keyin ko\'p ovoz olgan haydaladi; hisoblar to\'g\'ri', async () => {
  const { g, users } = await startGame(4);
  g.step = 2;
  g.phase = 'discuss';
  await G.startVote(g);
  const [p1, p2, p3, p4] = users;
  await vote(g, p1, p2); // p2: 1
  await vote(g, p2, p1); // p1: 1
  await vote(g, p3, p1); // p1: 2
  await vote(g, p4, p2); // p2: 2  -> teng
  await advance(500);
  assert.equal(g.revote, true);
  assert.deepEqual(g.voteCandidates.map((p) => p.id).sort(), [p1.id, p2.id].sort());
  assert.ok(groupMsgs().some((m) => /Ovozlar teng bo'ldi/.test(m.text)));
  await vote(g, p1, p2);
  await vote(g, p2, p1);
  await vote(g, p3, p1);
  await vote(g, p4, p1); // p1: 3
  await advance(500);
  assert.equal(g.eliminated.length, 1);
  assert.equal(g.eliminated[0].id, p1.id);
  const res = groupMsgs().find((m) => /OVOZ NATIJASI/.test(m.text));
  assert.match(res.text, /P1: 2 ovoz/); // birinchi ovoz hisobi ko'rsatiladi
  assert.match(res.text, /BUNKERDAN HAYDALDI: P1/);
  assert.match(res.text, /Keyingi raund 4 soniyadan/);
  assert.equal(g.players[0].votesAgainst, 2); // faqat birinchi ovoz hisoblanadi
  // haydalgan ovoz bera olmaydi
  g.phase = 'vote';
  const ctx = await vote(g, p1, p2);
  assert.match(ctx.answers[0].text, /Faqat tirik/);
});

test('hech kim ovoz bermasa: tasodif bilan haydaladi va sababi to\'g\'ri yoziladi', async () => {
  const { g } = await startGame(4);
  g.step = 2;
  g.phase = 'discuss';
  await G.startVote(g);
  await advance(45000);
  assert.equal(g.eliminated.length, 1);
  const res = groupMsgs().find((m) => /OVOZ NATIJASI/.test(m.text));
  assert.match(res.text, /Hech kim ovoz bermadi, shuning uchun tasodif/);
  assert.doesNotMatch(res.text, /Qayta ovozda/);
});

test('ovoz berilgach vaqt kutilmaydi; haydalganda jonli xabar olib tashlanadi', async () => {
  const { g, users } = await startGame(4);
  g.step = 2;
  g.phase = 'discuss';
  await G.startVote(g);
  const live = g.liveMsgId;
  for (const u of users) await vote(g, u, users.find((x) => x !== u));
  await advance(500);
  assert.ok(g.eliminated.length >= 1 || g.revote, 'natija chiqishi kerak');
  assert.ok(world.deleted.some((d) => d.msgId === live), 'ovoz xabari o\'chirilishi kerak');
});

// ---------- oxirgi raundlar ----------
test('hamma karta ochilgach ochish bosqichi o\'tkazib yuboriladi (vaqt tejaladi)', async () => {
  const { g } = await startGame(4);
  const keys = ['job', 'age', 'sex', 'health', 'trait', 'hobby', 'baggage', 'secret'];
  g.players.forEach((p) => (p.revealed = keys.slice()));
  assert.equal(G.nothingToReveal(g), true);
  await advance(60000); // 1-raundning ochish bosqichini tugatamiz
  g.round = 1;
  g.phase = 'between';
  await G.startRound(g);
  assert.equal(g.round, 2);
  assert.equal(g.phase, 'discuss'); // ochishsiz to'g'ridan-to'g'ri muhokama
  assert.equal(g.step, 2);
  const before = Date.now();
  await advance(80000); // faqat 2-muhokama vaqti
  assert.equal(g.phase, 'vote');
  assert.equal(Date.now() - before, 80000);
});

// ---------- xatolarga chidamlilik (tuzatilgan kamchiliklar) ----------
test('"Boshlash" ikki marta tez bosilsa o\'yin bir marta boshlanadi', async () => {
  const { g, host } = await newGame(4);
  await Promise.all([H.click(host, 'start_' + g.code, group()), H.click(host, 'start_' + g.code, group())]);
  await H.flush();
  assert.equal(A.getDB().gamesStarted, 1);
  assert.equal(groupMsgs().filter((m) => /O'YIN BOSHLANDI/.test(m.text)).length, 1);
  assert.equal(liveMsgs().length, 1);
});

test('"Boshlash": begona bosa olmaydi, kam o\'yinchida rad etiladi', async () => {
  const { g, users } = await newGame(3);
  let ctx = await H.click(users[1], 'start_' + g.code, group());
  assert.match(ctx.answers[0].text, /Faqat xona egasi/);
  ctx = await H.click(users[0], 'start_' + g.code, group());
  assert.match(ctx.answers[0].text, /Kamida 4/);
  assert.equal(g.started, false);
});

test('guruh admini ham o\'yinni boshlay va to\'xtata oladi', async () => {
  const { g } = await newGame(4);
  world.chats[CHAT] = { title: 'G', count: 4, botStatus: 'administrator', canInvite: true }; // getChatMember: administrator
  const admin = H.user(3001, 'GuruhAdmin');
  const ctx = await H.click(admin, 'start_' + g.code, group());
  await H.flush();
  assert.equal(g.started, true, ctx.answers[0] && ctx.answers[0].text);
});

test('davom etayotgan o\'yin boshqa odamning /bunker buyrug\'idan o\'chib ketmaydi', async () => {
  const { g } = await startGame(4);
  const ctx = await H.say(H.user(8888, 'Qiziquvchi'), '/bunker', group());
  assert.match(ctx.replies[0].text, /o'yin davom etmoqda/);
  assert.equal(g.finished, false);
  assert.equal(server.games[server.chatGame[CHAT]], g);
});

test('ochiq xonada /bunker: xona qayta chiqariladi, o\'yinchilar saqlanadi, eskisi o\'chiriladi', async () => {
  const { g } = await newGame(3);
  const oldMsg = g.msgId;
  const ctx = await H.say(H.user(8888, 'Qiziquvchi'), '/bunker', group());
  assert.equal(server.games[server.chatGame[CHAT]], g);
  assert.equal(g.players.length, 3);
  assert.notEqual(g.msgId, oldMsg);
  assert.ok(world.deleted.some((d) => d.msgId === oldMsg));
  assert.match(ctx.replies[0].text, new RegExp(g.code));
});

test('/stop: o\'yin to\'xtaydi va jonli xabar olib tashlanadi', async () => {
  const { g, host } = await startGame(4);
  const live = g.liveMsgId;
  await H.say(host, '/stop', group());
  await H.flush();
  assert.equal(g.finished, true);
  assert.ok(world.deleted.some((d) => d.msgId === live));
  // to'xtatilgan o'yinda hech qanday taymer ishlamaydi
  const sentBefore = world.sent.length;
  await advance(10 * 60 * 1000);
  assert.equal(world.sent.length, sentBefore);
});

test('bot guruhdan chiqarilsa, o\'yin yopiladi', async () => {
  const { g } = await startGame(4);
  await H.memberUpdate(group(), H.user(1, 'X'), 'member', 'kicked');
  await H.flush();
  assert.equal(g.finished, true);
});

test('guruhga yuborish ishlamasa ham o\'yin to\'xtab qolmaydi', async () => {
  const { g } = await startGame(4);
  world.blocked.add(CHAT); // guruhga xabar yuborib bo'lmaydi (masalan, bot cheklangan)
  const sec = await idle(g);
  assert.equal(g.finished, true, 'o\'yin tugashi kerak, ' + sec + ' s');
});

test('jonli xabar: o\'chirib bo\'lmasa "tugadi" deb qoldiriladi (tugmalarsiz)', async () => {
  const { g } = await startGame(4);
  const live = g.liveMsgId;
  world.deleteFail = true;
  await advance(60000);
  const e = world.edits.find((x) => x.msgId === live && x.text === '✔️ Bosqich tugadi.');
  assert.ok(e, 'eski xabar tugmasiz qoldirilishi kerak');
  assert.equal(e.extra, undefined);
});

test('jonli xabar: foydalanuvchi o\'chirib yuborsa, yangisi chiqadi; "o\'zgarmadi" xatosi e\'tiborsiz', async () => {
  const { g, users } = await startGame(4);
  const live = g.liveMsgId;
  await advance(4000);
  world.editFail = H.apiError(400, 'Bad Request: message to edit not found');
  await reveal(g, users[0], 'job'); // o'zgarish -> tahrir -> topilmadi -> yangisini yuboradi
  await advance(3500);
  assert.notEqual(g.liveMsgId, live);
  assert.equal(liveMsgs().length, 2);
  world.editFail = H.apiError(400, 'Bad Request: message is not modified');
  const sent = world.sent.length;
  await reveal(g, users[1], 'job');
  await advance(3500);
  assert.equal(world.sent.length, sent, '"o\'zgarmadi" xatosida yangi xabar chiqmasligi kerak');
});

test('jonli xabar: Telegram 429 bersa, ko\'proq kutadi va xabar tashlamaydi', async () => {
  const { g, users } = await startGame(4);
  await advance(4000);
  world.editFail = Object.assign(new Error('Too Many Requests'), { response: { error_code: 429, parameters: { retry_after: 20 } } });
  await reveal(g, users[0], 'job');
  await advance(3500);
  const attempts = world.edits.length;
  world.editFail = null;
  await reveal(g, users[1], 'job');
  await advance(10000); // 20 s kutish tugamagan
  assert.equal(world.edits.length, attempts, '429 dan keyin kutish muddatida tahrir bo\'lmasligi kerak');
  await advance(15000);
  assert.ok(world.edits.length > attempts);
});

test('o\'yin tugagach hech qanday taymer va jonli xabar qolmaydi', async () => {
  const { g } = await startGame(4);
  await idle(g);
  await advance(1000);
  assert.equal(g.ticker, null);
  assert.equal(g.liveTimer, null);
  assert.equal(g.liveMsgId, null);
  const n = world.sent.length + world.edits.length;
  await advance(3600 * 1000);
  assert.equal(world.sent.length + world.edits.length, n);
});

// ---------- matematika ----------
test('aralashtirish tekis: 3 elementning 6 tartibi teng ehtimollik bilan chiqadi', () => {
  const N = 60000;
  const cnt = {};
  for (let i = 0; i < N; i++) {
    const k = G.shuffle([0, 1, 2]).join('');
    cnt[k] = (cnt[k] || 0) + 1;
  }
  const keys = Object.keys(cnt);
  assert.equal(keys.length, 6);
  for (const k of keys) assert.ok(Math.abs(cnt[k] - N / 6) < 450, k + ': ' + cnt[k]); // ~5 sigma
  // elementlar yo'qolmaydi
  assert.deepEqual(G.shuffle([5, 6, 7, 8]).sort(), [5, 6, 7, 8]);
});

test('kartalar: bir o\'yinda takrorlanmaydi (12 o\'yinchigacha)', async () => {
  const xs = await newGame(12);
  await H.click(xs.host, 'start_' + xs.g.code, group());
  await H.flush();
  assert.equal(xs.g.players.length, 12);
  for (const key of ['job', 'health', 'trait', 'hobby', 'baggage', 'secret']) {
    const vals = xs.g.players.map((p) => p.card[key]);
    assert.equal(new Set(vals).size, vals.length, key + ' takrorlandi');
  }
  // 13-o'yinchi qo'shila olmaydi
  const late = H.user(2999, 'Kech');
  const ctx = await H.say(late, '/start join_' + xs.g.code, H.privateChat(late.id));
  assert.match(ctx.replies[0].text, /boshlangan/);
});
