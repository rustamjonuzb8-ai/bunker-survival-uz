const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const { server, world } = H;
const G = server._game;

const T0 = 1_700_000_000_000;
test.beforeEach(() => {
  H.reset();
  Object.keys(G.photoIds).forEach((k) => delete G.photoIds[k]);
  test.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 });
});
test.afterEach(() => test.mock.timers.reset());

const CHAT = -100777;
const group = () => H.groupChat(CHAT, "O'yin guruhi");
const advance = async (ms) => {
  test.mock.timers.tick(ms);
  await H.flush();
};
const groupMsgs = () => world.sent.filter((m) => m.id === CHAT);
const groupTexts = () => [...groupMsgs().map((m) => m.text), ...world.photos.filter((x) => x.id === CHAT).map((x) => x.caption)];
const dms = (uid) => world.sent.filter((m) => m.id === uid);

async function startGame(n = 4) {
  const users = [];
  for (let i = 1; i <= n; i++) users.push(H.user(3000 + i, 'Q' + i));
  await H.say(users[0], '/bunker', group());
  const g = server.games[server.chatGame[CHAT]];
  for (const u of users) await H.say(u, '/start join_' + g.code, H.privateChat(u.id));
  await H.click(users[0], 'start_' + g.code, group());
  await H.flush();
  return { g, users, P: g.players };
}
// ovoz berish bosqichiga to'g'ridan-to'g'ri o'tish
async function toVote(g) {
  g.phase = 'discuss';
  await G.startVote(g);
  await H.flush();
}
const give = (p, mech) => {
  p.pw = { mech, used: false };
};
const castAll = async (g, users, map) => {
  // map: [ovoz beruvchi indeksi, nishon indeksi]
  for (const [a, b] of map) await H.click(users[a], `vote_${g.code}_${users[b].id}`, group());
};

test('har o\'yinchiga imkoniyat beriladi va u kartada ⚡ bilan ko\'rinadi', async () => {
  const { g, P } = await startGame(6);
  for (const p of P) {
    assert.ok(p.card.power && p.pw && p.pw.used === false);
    assert.equal(p.pw.mech, require('../cards.js').POWER_MECH.get(p.card.power));
  }
  assert.equal(new Set(P.map((p) => p.card.power)).size, P.length, 'imkoniyatlar takrorlanmaydi');
  assert.equal(G.ATTRS.length, 9);
  assert.ok(dms(P[0].id).some((m) => m.text.includes('<b>Imkoniyat:</b>')), 'karta matnida imkoniyat bor');
});

test('hisob formulasi: 300 tasodifiy holatda mustaqil hisob bilan bir xil', async () => {
  const { g, P } = await startGame(6);
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let t = 0; t < 300; t++) {
    g.voteCandidates = P.slice();
    g.votes = new Map();
    g.fx = G.newFx();
    for (const p of P) if (rnd(4)) {
      let tg;
      do tg = P[rnd(P.length)]; while (tg.id === p.id);
      g.votes.set(p.id, tg.id);
    }
    for (const p of P) {
      if (!rnd(5)) g.fx.dbl.add(p.id);
      if (!rnd(6)) g.fx.veto.add(p.id);
      if (!rnd(6)) g.fx.mark.push(p.id);
    }
    const exp = {};
    for (const [v, tg] of g.votes) exp[tg] = (exp[tg] || 0) + (g.fx.veto.has(v) ? 0 : g.fx.dbl.has(v) ? 2 : 1);
    for (const m of g.fx.mark) exp[m] = (exp[m] || 0) + 1;
    const got = G.weightedTally(g);
    for (const p of P) assert.equal(got.get(p.id) || 0, exp[p.id] || 0);
    // yig'indi: sanalgan ovozlar = oddiy + qo'shimcha - bekor qilingan
    const sum = [...got.values()].reduce((a, b) => a + b, 0);
    const expSum = Object.values(exp).reduce((a, b) => a + b, 0);
    assert.equal(sum, expSum);
  }
});

test('himoya: eng ko\'p ovoz olsa ham haydalmaydi, keyingi eng ko\'pi haydaladi', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  give(P[2], 'shield');
  const r = G.usePower(g, P[2].id);
  assert.equal(r.ok, true);
  await castAll(g, users, [[0, 2], [1, 2], [3, 2], [2, 0]]); // C ga 3 ovoz, C himoyalangan
  await advance(500);
  assert.equal(g.eliminated.length, 1);
  assert.equal(g.eliminated[0].id, P[0].id, 'A haydaladi (1 ovoz), C emas');
  assert.ok(P[2].alive);
  assert.ok(groupTexts().some((t) => /himoyalangan/.test(t) && /ishlatilgan imkoniyatlar/.test(t)), 'e\'lon qilinadi');
});

test('hamma himoyalangan bo\'lsa o\'yin qotib qolmaydi (himoya bekor)', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  for (const p of P) {
    give(p, 'shield');
    assert.equal(G.usePower(g, p.id).ok, true);
  }
  await castAll(g, users, [[0, 1], [1, 2], [2, 3], [3, 0]]);
  await advance(500);
  assert.ok(g.eliminated.length === 1 || g.revote, 'natija chiqdi yoki qayta ovoz');
});

test('ovozni bekor qilish: nishonning ovozi sanalmaydi va durang buziladi', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  give(P[0], 'veto');
  assert.equal(G.usePower(g, P[0].id, P[3].id).ok, true); // D ning ovozi sanalmaydi
  await castAll(g, users, [[0, 1], [2, 1], [1, 0], [3, 0]]); // oddiy holatda 2:2 durang
  await advance(500);
  assert.equal(g.revote, false);
  assert.equal(g.eliminated[0].id, P[1].id, 'B 2 ovoz, A 1 ovoz');
  assert.ok(groupTexts().some((t) => /ovozi sanalmadi/.test(t)));
});

test('qo\'shimcha ovoz va ikki ovoz: durangni buzadi / yaratadi', async () => {
  let { g, users, P } = await startGame(4);
  await toVote(g);
  give(P[2], 'mark');
  assert.equal(G.usePower(g, P[2].id, P[1].id).ok, true);
  await castAll(g, users, [[0, 1], [1, 0], [2, 0], [3, 1]]); // 2:2 + mark B => B 3
  await advance(500);
  assert.equal(g.eliminated[0].id, P[1].id);

  H.reset();
  Object.keys(server.games).forEach((k) => delete server.games[k]);
  ({ g, users, P } = await startGame(4));
  await toVote(g);
  give(P[0], 'dbl');
  assert.equal(G.usePower(g, P[0].id).ok, true);
  await castAll(g, users, [[0, 2], [1, 3], [2, 3], [3, 1]]); // oddiy: D=2 yutadi; dbl bilan C=2 ham => durang
  await advance(500);
  assert.equal(g.revote, true);
  assert.deepEqual(g.voteCandidates.map((p) => p.id).sort(), [P[2].id, P[3].id].sort());
});

test('bir marta: ikkinchi marta va bir vaqtda ikki marta bosish rad etiladi', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  give(P[0], 'dbl');
  const priv = H.privateChat(P[0].id);
  const [c1, c2] = await Promise.all([H.click(users[0], 'pwu_' + g.code, priv), H.click(users[0], 'pwu_' + g.code, priv)]);
  const oks = [c1, c2].filter((c) => c.answers.some((a) => /Bajarildi/.test(a.text)));
  assert.equal(oks.length, 1, 'faqat bittasi o\'tadi');
  assert.equal(g.fx.log.length, 1);
  assert.equal(G.usePower(g, P[0].id).ok, false);
});

test('noto\'g\'ri vaqt, o\'ziga, begona, haydalgan: rad etiladi va imkoniyat sarflanmaydi', async () => {
  const { g, P } = await startGame(4);
  g.phase = 'discuss';
  give(P[0], 'dbl');
  assert.match(G.usePower(g, P[0].id).text, /ovoz berish paytida/);
  assert.equal(P[0].pw.used, false);
  give(P[1], 'veto');
  await toVote(g);
  assert.match(G.usePower(g, P[1].id, P[1].id).text, /O'zingizga/);
  assert.equal(G.usePower(g, 99999).ok, false);
  P[2].alive = false;
  give(P[2], 'dbl');
  assert.equal(G.usePower(g, P[2].id).ok, false);
  assert.equal(G.usePower(g, P[1].id, P[2].id).ok, false, 'haydalganga ishlatib bo\'lmaydi');
  assert.equal(P[1].pw.used, false);
});

test('ko\'rish: faqat o\'zi ko\'radi, guruhga hech narsa chiqmaydi; sir ochiq bo\'lsa sarflanmaydi', async () => {
  const { g, P } = await startGame(4);
  g.phase = 'discuss';
  give(P[0], 'peek');
  const before = groupMsgs().length;
  const r = G.usePower(g, P[0].id, P[1].id);
  assert.equal(r.ok, true);
  assert.ok(!r.group);
  assert.match(r.text, /yopiq kartasi/);
  assert.equal(groupMsgs().length, before);
  assert.equal(P[1].revealed.length, 0, 'nishonning kartasi ochilmaydi');
  give(P[2], 'peekSecret');
  P[3].revealed.push('secret');
  const r2 = G.usePower(g, P[2].id, P[3].id);
  assert.equal(r2.ok, false);
  assert.equal(P[2].pw.used, false);
  const r3 = G.usePower(g, P[2].id, P[1].id);
  assert.equal(r3.ok, true);
  assert.ok(r3.text.includes(P[1].card.secret));
});

test('majburan ochish: nishonning yopiq kartasi hammaga ochiladi', async () => {
  const { g, P } = await startGame(4);
  g.phase = 'discuss';
  give(P[0], 'force');
  const r = G.usePower(g, P[0].id, P[1].id);
  assert.equal(r.ok, true);
  assert.equal(P[1].revealed.length, 1);
  assert.match(r.group, /yopiq kartasi ochildi/);
  // hammasi ochiq bo'lsa ishlamaydi va sarflanmaydi
  P[2].revealed = G.ATTRS.map((a) => a.key);
  give(P[3], 'force');
  assert.equal(G.usePower(g, P[3].id, P[2].id).ok, false);
  assert.equal(P[3].pw.used, false);
});

test('almashtirish: yangi karta hech kimda yo\'q qiymatdan, ochiq kartani almashtirib bo\'lmaydi', async () => {
  const { g, P } = await startGame(6);
  g.phase = 'discuss';
  give(P[0], 'swap');
  P[0].revealed = ['job'];
  assert.equal(G.usePower(g, P[0].id, 'job').ok, false, 'ochiq karta');
  assert.equal(G.usePower(g, P[0].id, 'age').ok, false, 'yosh almashmaydi');
  assert.equal(P[0].pw.used, false);
  const old = P[0].card.secret;
  const r = G.usePower(g, P[0].id, 'secret');
  assert.equal(r.ok, true);
  assert.notEqual(P[0].card.secret, old);
  const vals = P.map((p) => p.card.secret);
  assert.equal(new Set(vals).size, vals.length, 'sir takrorlanmaydi');
  assert.ok(r.text.includes(P[0].card.secret));
});

test('tugma oqimi: guruhdagi "⚡ Imkoniyatim" -> shaxsiy chatda nishonlar tugmasi -> ishlatish', async () => {
  const { g, users, P } = await startGame(4);
  await toVote(g);
  give(P[0], 'veto');
  const ctx = await H.click(users[0], 'pw_' + g.code, group());
  assert.match(ctx.answers[0].text, /Shaxsiy chatga/);
  const dm = dms(P[0].id).filter((m) => /Sizning imkoniyatingiz/.test(m.text)).pop();
  assert.ok(dm, 'shaxsiy xabar keldi');
  const datas = H.allDataOf(dm).filter((d) => d.startsWith('pwt_'));
  assert.equal(datas.length, 3, 'o\'zidan boshqa 3 kishi');
  assert.ok(!datas.some((d) => d.endsWith('_' + P[0].id)));
  const c2 = await H.click(users[0], datas[0], H.privateChat(P[0].id));
  assert.match(c2.answers[0].text, /Bajarildi/);
  assert.equal(P[0].pw.used, true);
  // begona bosa olmaydi
  const c3 = await H.click(H.user(1, 'Begona'), 'pw_' + g.code, group());
  assert.match(c3.answers[0].text, /o'yinda emassiz/);
});

test('imkoniyat tugmasi muhokama va ovoz xabarida bor', async () => {
  const { g } = await startGame(4);
  g.phase = 'discuss';
  const live = G.liveRender(g);
  assert.ok(live.extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'pw_' + g.code));
  await toVote(g);
  const live2 = G.liveRender(g);
  assert.ok(live2.extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'pw_' + g.code));
});

test('raund o\'tgach ta\'sirlar tozalanadi, ishlatilgan imkoniyat qaytmaydi', async () => {
  const { g, users, P } = await startGame(5);
  await toVote(g);
  give(P[0], 'dbl');
  G.usePower(g, P[0].id);
  await castAll(g, users, [[0, 1], [1, 2], [2, 1], [3, 1], [4, 1]]);
  await advance(500);
  assert.equal(g.fx.dbl.size, 0);
  assert.equal(g.fx.log.length, 0);
  assert.equal(P[0].pw.used, true);
  await advance(4000); // keyingi raund
  g.phase = 'discuss';
  await G.startVote(g);
  assert.equal(G.usePower(g, P[0].id).ok, false);
});
