const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Bunkeruz1_bot';
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 2);
const MAX_PLAYERS = 12;
const REVEAL_SEC = Number(process.env.REVEAL_SEC || 60);
const DISCUSS1_SEC = Number(process.env.DISCUSS1_SEC || 90); // 1-kartadan keyin
const DISCUSS2_SEC = Number(process.env.DISCUSS2_SEC || 80); // 2-kartadan keyin
const VOTE_SEC = Number(process.env.VOTE_SEC || 45);
const BETWEEN_SEC = Number(process.env.BETWEEN_SEC || 4);

const bot = new Telegraf(TOKEN || 'no-token');
const games = {};     // kod -> o'yin
const chatGame = {};  // chatId -> kod

// ---------- MA'LUMOTLAR ----------
const JOBS = ['Shifokor', 'Muhandis', 'O\'qituvchi', 'Oshpaz', 'Dehqon', 'Politsiyachi', 'Dasturchi', 'Psixolog', 'Quruvchi', 'Haydovchi', 'Blogger', 'Elektrik', 'Veterinar', 'Askar', 'Santexnik', 'Hamshira', 'Fermer', 'Mexanik'];
const HEALTH = ['Mutlaqo sog\'lom', 'Astma', 'Qand kasalligi', 'Yurak kasalligi', 'Ko\'zi ojiz', 'Allergiya', 'A\'lo jismoniy holat', 'Surunkali charchoq', 'Bir oyog\'i nogiron', 'Tez-tez kasal bo\'ladi'];
const TRAITS = ['Sabrli', 'Jizzaki', 'Yetakchi', 'Qo\'rqoq', 'Aqlli', 'Yolg\'onchi', 'Mehribon', 'Bag\'ritosh', 'Dovyurak', 'Xudbin'];
const HOBBIES = ['Baliq ovi', 'Shaxmat', 'Gitara', 'Bog\'dorchilik', 'Kitob o\'qish', 'Sport', 'Rasm chizish', 'Pishirish', 'Sayohat', 'Tikuvchilik'];
const ITEMS = ['Birinchi yordam qutisi', 'Pichoq', 'Urug\'lar to\'plami', 'Radio', 'Gitara', 'Fonar', 'Kitoblar', 'Ichimlik suvi', 'Asboblar qutisi', 'Gugurt va chaqmoq'];
const BAGGAGE = ['Konserva zaxirasi (3 oylik)', 'Dori-darmonlar sumkasi', 'Quyosh paneli', 'Kichik generator', 'Suv tozalash filtri', 'Sabzavot urug\'lari qopi', 'Kitoblar qutisi', 'Ko\'rpa-to\'shak va kiyimlar', 'Radiostansiya', 'Ov miltig\'i o\'rniga arbalet', 'Oilaviy rasmlar albomi', 'Bo\'sh chamadon', 'Mototsikl ehtiyot qismlari', 'Qadimiy xarita va kompas'];
const SECRETS = ['Aslida soxta diplom bilan ishlagan', 'Jinoyat sodir etgan', 'Bepusht', 'Yashirincha kasal', 'Yashirincha boshqalarni kuzatib, sirlarini yig\'ib yurgan', 'Hech kimga aytilmagan qarzi bor', 'Oziq-ovqatni yashirib saqlagan', 'Aslida ismi boshqa'];
const DISASTERS = [
  'Yadro urushi: tashqarida radiatsiya, 5 yil yashash kerak',
  'Zombi epidemiyasi: shaharlar vayron bo\'ldi',
  'Meteorit zarbasi: quyosh bir necha yil ko\'rinmaydi',
  'Global suv toshqini: quruqlik deyarli qolmadi',
  'O\'lik virus: yer yuzi aholisining ko\'pchiligi nobud bo\'ldi',
  'Super vulqon otilishi: osmonni kul qopladi, muzlik davri boshlandi'
];

const ATTRS = [
  { key: 'job', icon: '👷', label: 'Kasb' },
  { key: 'age', icon: '🎂', label: 'Yosh' },
  { key: 'sex', icon: '👫', label: 'Jins' },
  { key: 'health', icon: '❤️', label: 'Sog\'liq' },
  { key: 'trait', icon: '🧠', label: 'Xarakter' },
  { key: 'hobby', icon: '🎯', label: 'Hobbi' },
  { key: 'baggage', icon: '🧳', label: 'Bagaj' },
  { key: 'secret', icon: '🤫', label: 'Sir' }
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const makeCode = () => Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
const attrOf = (k) => ATTRS.find((a) => a.key === k);
const attrLine = (card, a) => `${a.icon} ${a.label}: ${card[a.key]}`;

function makeCard() {
  const age = 18 + Math.floor(Math.random() * 50);
  const female = Math.random() < 0.5;
  const sex = female ? (age < 30 ? 'Qiz' : 'Ayol') : 'Erkak';
  return {
    job: pick(JOBS),
    age: `${age} yosh`,
    sex,
    health: pick(HEALTH),
    trait: pick(TRAITS),
    hobby: pick(HOBBIES),
    baggage: pick(BAGGAGE),
    secret: pick(SECRETS)
  };
}

// ---------- TELEGRAM YORDAMCHILARI ----------
async function say(chatId, text, extra) {
  try {
    return await bot.telegram.sendMessage(chatId, text, extra);
  } catch (e) {
    console.log('send xato:', e.message);
    return null;
  }
}
async function edit(chatId, msgId, text, extra) {
  try {
    await bot.telegram.editMessageText(chatId, msgId, undefined, text, extra);
  } catch (e) {}
}

// ---------- O'YIN YORDAMCHILARI ----------
const alive = (g) => g.players.filter((p) => p.alive);
const findPlayer = (g, id) => g.players.find((p) => p.id === id);

function newPhase(g, phase) {
  g.phase = phase;
  g.phaseId++;
  clearTimeout(g.timer);
  return g.phaseId;
}
function setTimer(g, sec, fn) {
  const id = g.phaseId;
  g.timer = setTimeout(() => {
    if (g.phaseId === id && !g.finished) fn(g);
  }, sec * 1000);
}
function closeGame(g) {
  g.finished = true;
  g.phase = 'ended';
  g.phaseId++;
  clearTimeout(g.timer);
}

function lobbyText(g) {
  const list = g.players.length
    ? g.players.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
    : 'Hali hech kim yo\'q';
  return `🛡 BUNKER - xona ${g.code}\n\nO'yinchilar (${g.players.length}/${MAX_PLAYERS}):\n${list}\n\n"Qo'shilish" tugmasini bosing, bot sizga shaxsiy chatda karta beradi.\nKamida ${MIN_PLAYERS} o'yinchi kerak.`;
}
function lobbyKeyboard(g) {
  return Markup.inlineKeyboard([
    [Markup.button.url('➕ Qo\'shilish', `https://t.me/${BOT_USERNAME}?start=join_${g.code}`)],
    [Markup.button.callback('▶️ Boshlash', `start_${g.code}`)]
  ]);
}
async function refreshLobby(g) {
  await edit(g.chatId, g.msgId, lobbyText(g), lobbyKeyboard(g));
}

function createRoom(chatId, hostId) {
  const old = games[chatGame[chatId]];
  if (old) closeGame(old);
  let code = makeCode();
  while (games[code]) code = makeCode();
  const g = {
    code, chatId, hostId,
    players: [], started: false, finished: false,
    phase: 'lobby', phaseId: 0, timer: null,
    round: 0, msgId: null, eliminated: [],
    votes: new Map(), roundRevealed: new Set(),
    voteMsgId: null, createdAt: Date.now()
  };
  games[code] = g;
  chatGame[chatId] = code;
  return g;
}

function joinPlayer(g, id, name) {
  if (!g || g.finished) return { ok: false, text: 'Xona topilmadi yoki yopilgan.' };
  if (g.started) return { ok: false, text: 'O\'yin allaqachon boshlangan.' };
  if (findPlayer(g, id)) return { ok: false, text: 'Siz allaqachon qo\'shilgansiz. Guruhga qayting.' };
  if (g.players.length >= MAX_PLAYERS) return { ok: false, text: 'Xona to\'lgan.' };
  g.players.push({ id, name, card: null, revealed: [], alive: true });
  return { ok: true, text: '✅ Siz xonaga qo\'shildingiz. Guruhga qayting, o\'yin boshlanganda karta shu yerga keladi.' };
}

// ---------- O'YIN OQIMI ----------
function cardText(g, p, prompt) {
  const lines = ATTRS.map((a) => {
    const open = p.revealed.includes(a.key);
    return `${open ? '✅' : '▫️'} ${attrLine(p.card, a)}`;
  }).join('\n');
  let t = `🪪 SIZNING KARTANGIZ (raund ${g.round})\n\n${lines}\n\n✅ - boshqalarga ochilgan xususiyat`;
  if (prompt) t += `\n\nRaund ${g.round}, ${g.step}-karta: BITTA xususiyatni tanlab oching (${REVEAL_SEC} soniya):`;
  return t;
}
function revealKeyboard(g, p) {
  const left = ATTRS.filter((a) => !p.revealed.includes(a.key));
  const rows = [];
  for (let i = 0; i < left.length; i += 2) {
    rows.push(left.slice(i, i + 2).map((a) => Markup.button.callback(`${a.icon} ${a.label}`, `rev_${g.code}_${a.key}`)));
  }
  return Markup.inlineKeyboard(rows);
}

async function beginGame(g) {
  g.started = true;
  g.disaster = pick(DISASTERS);
  g.capacity = Math.max(1, Math.floor(g.players.length / 2));
  g.players.forEach((p) => {
    p.card = makeCard();
    p.revealed = [];
    p.alive = true;
  });
  await edit(g.chatId, g.msgId, `🛡 Xona ${g.code} - o'yin boshlandi`);
  await say(
    g.chatId,
    `🛡 O'YIN BOSHLANDI!\n\n☢️ Falokat: ${g.disaster}\n\n🚪 Bunkerda joy: ${g.capacity} kishi\n👥 O'yinchilar: ${g.players.length}\n\nOxirida faqat ${g.capacity} kishi bunkerga kiradi. Har raundda bitta o'yinchi haydaladi.`
  );
  await startRound(g);
}

async function startRound(g) {
  if (g.finished) return;
  if (alive(g).length <= g.capacity) return finishGame(g);
  g.round++;
  g.step = 1;
  await startReveal(g);
}

async function startReveal(g) {
  if (g.finished) return;
  g.roundRevealed = new Set();
  newPhase(g, 'reveal');
  await say(
    g.chatId,
    `🔔 RAUND ${g.round} - ${g.step}-karta ochiladi\n\n📂 Har bir tirik o'yinchi botdagi shaxsiy chatida bitta xususiyatini tanlab ochadi (${REVEAL_SEC} soniya).\n👥 Tirik: ${alive(g).length} | 🚪 Joy: ${g.capacity}`
  );
  for (const p of alive(g)) {
    if (p.revealed.length >= ATTRS.length) {
      g.roundRevealed.add(p.id);
      continue;
    }
    await say(p.id, cardText(g, p, true), revealKeyboard(g, p));
  }
  if (alive(g).every((p) => g.roundRevealed.has(p.id))) return endReveal(g);
  setTimer(g, REVEAL_SEC, endReveal);
}

// Xususiyat ochish: natija { ok, text }
async function revealAttr(g, userId, key) {
  if (!g || g.finished || g.phase !== 'reveal') return { ok: false, text: 'Bu raundda ochish vaqti tugagan.' };
  const p = findPlayer(g, userId);
  if (!p || !p.alive) return { ok: false, text: 'Siz o\'yinda emassiz.' };
  if (g.roundRevealed.has(p.id)) return { ok: false, text: 'Bu bosqichda allaqachon ochgansiz.' };
  const a = attrOf(key);
  if (!a || p.revealed.includes(key)) return { ok: false, text: 'Bu xususiyat allaqachon ochilgan.' };
  p.revealed.push(key);
  g.roundRevealed.add(p.id);
  await say(g.chatId, `👤 ${p.name} ochdi:\n${attrLine(p.card, a)}`);
  if (alive(g).every((x) => g.roundRevealed.has(x.id))) {
    setTimeout(() => endReveal(g), 500);
  }
  return { ok: true, text: 'Ochildi!' };
}

async function endReveal(g) {
  if (g.finished || g.phase !== 'reveal') return;
  newPhase(g, 'summary');
  // Vaqtida tanlamaganlar uchun karta o'zi ochilmaydi, shunchaki o'tkazib yuboriladi
  const skipped = alive(g).filter((p) => !g.roundRevealed.has(p.id));
  skipped.forEach((p) => g.roundRevealed.add(p.id));
  if (skipped.length) {
    await say(g.chatId, `⏰ Vaqtida karta ochmadi: ${skipped.map((p) => p.name).join(', ')}. Ular bu bosqichda yangi ma'lumot ochmadi.`);
  }
  const summary = alive(g)
    .map((p) => {
      const open = ATTRS.filter((a) => p.revealed.includes(a.key)).map((a) => `   ${attrLine(p.card, a)}`).join('\n');
      return `👤 ${p.name}\n${open || '   (hali hech narsa ochmagan)'}`;
    })
    .join('\n\n');
  await say(g.chatId, `📋 RAUND ${g.round} (${g.step}-karta) HOLATI\n\n${summary}\n\n🚪 Bunkerda joy: ${g.capacity} | 👥 Tirik: ${alive(g).length}`);
  await startDiscuss(g);
}

async function startDiscuss(g) {
  if (g.finished) return;
  newPhase(g, 'discuss');
  const first = g.step === 1;
  const sec = first ? DISCUSS1_SEC : DISCUSS2_SEC;
  await say(
    g.chatId,
    `💬 MUHOKAMA - ${g.step}-kartadan keyin (${sec} soniya)\n\nGuruhning ovozli chatida gaplashing: kim bunkerga loyiq emas? Kimning sirini fosh qilasiz?\n\n${first ? 'Keyin 2-karta ochiladi.' : 'Keyin ovoz berish boshlanadi.'} Xona egasi muhokamani tezroq tugatishi mumkin.`,
    Markup.inlineKeyboard([[Markup.button.callback(first ? '⏭ 2-kartaga o\'tish' : '⏭ Ovoz berishga o\'tish', `skip_${g.code}`)]])
  );
  setTimer(g, sec, afterDiscuss);
}

// Muhokamadan keyin: 1-karta bo'lsa 2-kartaga, 2-karta bo'lsa ovoz berishga
async function afterDiscuss(g) {
  if (g.finished || g.phase !== 'discuss') return;
  if (g.step === 1) {
    g.step = 2;
    return startReveal(g);
  }
  return startVote(g);
}

async function startVote(g) {
  if (g.finished || g.phase !== 'discuss') return;
  newPhase(g, 'vote');
  g.votes = new Map();
  const list = alive(g);
  const rows = [];
  for (let i = 0; i < list.length; i += 2) {
    rows.push(list.slice(i, i + 2).map((p) => Markup.button.callback(`❌ ${p.name}`, `vote_${g.code}_${p.id}`)));
  }
  const text = voteText(g);
  const msg = await say(g.chatId, text, Markup.inlineKeyboard(rows));
  g.voteMsgId = msg ? msg.message_id : null;
  g.voteKeyboard = Markup.inlineKeyboard(rows);
  setTimer(g, VOTE_SEC, endVote);
}
function voteText(g) {
  return `🗳 OVOZ BERISH (${VOTE_SEC} soniya)\n\nKimni bunkerdan haydaymiz? Tugmani bosing (o'zingizga ovoz bera olmaysiz, ovozni o'zgartirish mumkin).\n\nOvoz berganlar: ${g.votes.size}/${alive(g).length}`;
}

// Ovoz berish: natija { ok, text }
async function castVote(g, voterId, targetId) {
  if (!g || g.finished || g.phase !== 'vote') return { ok: false, text: 'Ovoz berish vaqti tugagan.' };
  const voter = findPlayer(g, voterId);
  const target = findPlayer(g, targetId);
  if (!voter || !voter.alive) return { ok: false, text: 'Faqat tirik o\'yinchilar ovoz beradi.' };
  if (!target || !target.alive) return { ok: false, text: 'Bu o\'yinchi allaqachon haydalgan.' };
  if (voterId === targetId) return { ok: false, text: 'O\'zingizga ovoz bera olmaysiz.' };
  g.votes.set(voterId, targetId);
  if (g.voteMsgId) await edit(g.chatId, g.voteMsgId, voteText(g), g.voteKeyboard);
  if (g.votes.size >= alive(g).length) setTimeout(() => endVote(g), 500);
  return { ok: true, text: `Ovoz qabul qilindi: ${target.name}` };
}

async function endVote(g) {
  if (g.finished || g.phase !== 'vote') return;
  newPhase(g, 'between');
  const tally = new Map();
  for (const t of g.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
  let candidates;
  let note = '';
  if (tally.size === 0) {
    candidates = alive(g);
    note = 'Hech kim ovoz bermadi, tasodif bilan tanlandi.';
  } else {
    const max = Math.max(...tally.values());
    candidates = alive(g).filter((p) => tally.get(p.id) === max);
    if (candidates.length > 1) note = 'Ovozlar teng bo\'ldi, tasodif bilan tanlandi.';
  }
  const out = pick(candidates);
  out.alive = false;
  g.eliminated.push(out);

  const results = alive(g)
    .concat([out])
    .map((p) => `${p.name}: ${tally.get(p.id) || 0} ovoz`)
    .join('\n');
  const fullCard = ATTRS.map((a) => attrLine(out.card, a)).join('\n');
  await say(
    g.chatId,
    `📊 OVOZ NATIJASI\n\n${results}\n${note ? '\n' + note + '\n' : ''}\n☠️ BUNKERDAN HAYDALDI: ${out.name}\n\n🪪 Uning to'liq kartasi:\n${fullCard}`
  );
  await say(out.id, '☠️ Siz bunkerdan haydaldingiz. Guruhda o\'yinni kuzatishda davom eting.');

  if (alive(g).length <= g.capacity) {
    return finishGame(g);
  }
  await say(g.chatId, `⏳ Keyingi raund ${BETWEEN_SEC} soniyadan keyin boshlanadi...`);
  setTimer(g, BETWEEN_SEC, startRound);
}

async function finishGame(g) {
  if (g.finished) return;
  closeGame(g);
  const winners = alive(g);
  const winText = winners
    .map((p) => `👤 ${p.name}\n` + ATTRS.map((a) => `   ${attrLine(p.card, a)}`).join('\n'))
    .join('\n\n');
  const outText = g.eliminated.length
    ? g.eliminated.map((p, i) => `${i + 1}. ${p.name} (${p.card.job})`).join('\n')
    : 'Hech kim';
  await say(
    g.chatId,
    `🏁 O'YIN TUGADI!\n\n☢️ Falokat: ${g.disaster}\n\n🏆 BUNKERGA KIRGANLAR (omon qoldi):\n\n${winText}\n\n☠️ Haydalganlar (tartib bilan):\n${outText}\n\n📊 Statistika: ${g.round} raund, ${g.players.length} o'yinchi, ${g.capacity} ta joy.\n\nYangi o'yin uchun /bunker yozing.`
  );
}

// ---------- BUYRUQLAR ----------
const RULES = `🛡 BUNKER QOIDALARI\n\n1. Dunyo falokatga uchradi. Bunkerda joy cheklangan.\n2. Har o'yinchiga tasodifiy karta beriladi (kasb, yosh, jins, sog'liq, xarakter, hobbi, bagaj, sir). Karta faqat botning shaxsiy chatida ko'rinadi.\n3. Har raundda hamma ikki marta xususiyat ochadi: 1-karta → muhokama (90 s) → 2-karta → muhokama (80 s) → ovoz berish.\n4. Muhokamada (ovozli chatda) o'zingizni ma'qul ko'rsating, boshqalarni gumon ostiga oling.\n5. Ovoz berish bilan bir o'yinchi haydaladi. Haydalganning kartasi to'liq ochiladi.\n6. Bunker sig'imicha odam qolguncha davom etadi. Qolganlar g'olib!\n\nBuyruqlar: /bunker - yangi xona, /stop - o'yinni to'xtatish, /qoidalar - qoidalar.`;

bot.command('qoidalar', (ctx) => ctx.reply(RULES));

bot.command('bunker', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('Bu buyruq guruhda ishlaydi. Meni guruhga qo\'shing va /bunker yozing.');
  }
  const g = createRoom(ctx.chat.id, ctx.from.id);
  const msg = await ctx.reply(lobbyText(g), lobbyKeyboard(g));
  g.msgId = msg.message_id;
});

bot.command('stop', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  const g = games[chatGame[ctx.chat.id]];
  if (!g || g.finished) return ctx.reply('Ochiq o\'yin yo\'q.');
  let allowed = ctx.from.id === g.hostId;
  if (!allowed) {
    try {
      const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      allowed = ['creator', 'administrator'].includes(m.status);
    } catch (e) {}
  }
  if (!allowed) return ctx.reply('Faqat xona egasi yoki guruh adminlari to\'xtata oladi.');
  closeGame(g);
  ctx.reply('🛑 O\'yin to\'xtatildi. Yangi o\'yin uchun /bunker yozing.');
});

bot.start(async (ctx) => {
  const payload = ctx.startPayload || '';
  if (!payload.startsWith('join_')) {
    return ctx.reply('Salom! Men BUNKER o\'yini botiman 🛡\n\nMeni guruhga qo\'shing va /bunker yozing. O\'yinchilar "Qo\'shilish" tugmasini bosib, shu yerda karta oladi.\n\nQoidalar: /qoidalar');
  }
  const g = games[payload.slice(5)];
  const name = ctx.from.first_name || ctx.from.username || 'O\'yinchi';
  const r = joinPlayer(g, ctx.from.id, name);
  await ctx.reply(r.text);
  if (r.ok) refreshLobby(g);
});

bot.action(/^start_([A-Z0-9]+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.started || g.finished) return ctx.answerCbQuery('O\'yin boshlangan yoki yopilgan.');
  if (ctx.from.id !== g.hostId) {
    return ctx.answerCbQuery('Faqat xona egasi boshlaydi.', { show_alert: true });
  }
  if (g.players.length < MIN_PLAYERS) {
    return ctx.answerCbQuery(`Kamida ${MIN_PLAYERS} o'yinchi kerak.`, { show_alert: true });
  }
  await ctx.answerCbQuery();
  await beginGame(g);
});

bot.action(/^rev_([A-Z0-9]+)_(\w+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  const r = await revealAttr(g, ctx.from.id, ctx.match[2]);
  if (!r.ok) return ctx.answerCbQuery(r.text, { show_alert: true });
  await ctx.answerCbQuery(r.text);
  const p = findPlayer(g, ctx.from.id);
  try {
    await ctx.editMessageText(cardText(g, p, false));
  } catch (e) {}
});

bot.action(/^skip_([A-Z0-9]+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.finished || g.phase !== 'discuss') return ctx.answerCbQuery('Muhokama tugagan.');
  if (ctx.from.id !== g.hostId) {
    return ctx.answerCbQuery('Faqat xona egasi o\'tkaza oladi.', { show_alert: true });
  }
  await ctx.answerCbQuery();
  await afterDiscuss(g);
});

bot.action(/^vote_([A-Z0-9]+)_(\d+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  const r = await castVote(g, ctx.from.id, Number(ctx.match[2]));
  return ctx.answerCbQuery(r.text, { show_alert: !r.ok });
});

bot.catch((err) => console.log('Xato:', err.message));

// ---------- ISHGA TUSHIRISH ----------
if (require.main === module) {
  const app = express();
  app.get('/', (req, res) => res.send('BUNKER bot ishlayapti'));
  app.listen(process.env.PORT || 3000);

  bot.launch({ dropPendingUpdates: true });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // Tugagan eski o'yinlarni tozalash
  setInterval(() => {
    const now = Date.now();
    for (const code of Object.keys(games)) {
      if (games[code].finished && now - games[code].createdAt > 3600 * 1000) delete games[code];
    }
  }, 600 * 1000);
}

module.exports = { bot, games, chatGame, createRoom, joinPlayer, beginGame, revealAttr, castVote, alive, findPlayer };
