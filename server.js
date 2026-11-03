const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = 'Bunkeruz1_bot';
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 2);
const MAX_PLAYERS = 12;

// Render uchun oddiy server
const app = express();
app.get('/', (req, res) => res.send('BUNKER bot ishlayapti'));
app.listen(process.env.PORT || 3000);

const bot = new Telegraf(TOKEN);
const games = {};     // kod -> o'yin
const chatGame = {};  // chatId -> kod

const JOBS = ['Shifokor', 'Muhandis', 'O\'qituvchi', 'Oshpaz', 'Dehqon', 'Politsiyachi', 'Dasturchi', 'Psixolog', 'Quruvchi', 'Haydovchi', 'Blogger', 'Elektrik', 'Veterinar', 'Askar'];
const HEALTH = ['Mutlaqo sog\'lom', 'Astma', 'Qand kasalligi', 'Yurak kasalligi', 'Ko\'zi ojiz', 'Allergiya', 'A\'lo jismoniy holat', 'Surunkali charchoq'];
const TRAITS = ['Sabrli', 'Jizzaki', 'Yetakchi', 'Qo\'rqoq', 'Aqlli', 'Yolg\'onchi', 'Mehribon', 'Bag\'ritosh'];
const HOBBIES = ['Baliq ovi', 'Shaxmat', 'Gitara', 'Bog\'dorchilik', 'Kitob o\'qish', 'Sport', 'Rasm chizish', 'Pishirish'];
const ITEMS = ['Birinchi yordam qutisi', 'Pichoq', 'Urug\'lar to\'plami', 'Radio', 'Gitara', 'Fonar', 'Kitoblar', 'Ichimlik suvi'];
const SECRETS = ['Aslida soxta diplom bilan ishlagan', 'Jinoyat sodir etgan', 'Bepusht', 'Yashirincha kasal', 'Boshqalarni ayg\'oqchilik qilgan', 'Hech kimga aytilmagan qarzi bor'];
const DISASTERS = [
  'Yadro urushi: tashqarida radiatsiya, 5 yil yashash kerak',
  'Zombi epidemiyasi: shaharlar vayron bo\'ldi',
  'Meteorit zarbasi: quyosh bir necha yil ko\'rinmaydi',
  'Global suv toshqini: quruqlik deyarli qolmadi',
  'O\'lik virus: yer yuzi aholisining ko\'pchiligi nobud bo\'ldi'
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const makeCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();

function makeCard() {
  return {
    job: pick(JOBS),
    age: 18 + Math.floor(Math.random() * 50),
    health: pick(HEALTH),
    trait: pick(TRAITS),
    hobby: pick(HOBBIES),
    item: pick(ITEMS),
    secret: pick(SECRETS)
  };
}

function lobbyText(g) {
  const list = g.players.length
    ? g.players.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
    : 'Hali hech kim yo\'q';
  return `🛡 BUNKER - xona ${g.code}\n\nO'yinchilar (${g.players.length}/${MAX_PLAYERS}):\n${list}\n\n"Qo'shilish" tugmasini bosing, bot sizga shaxsiy chatda karta beradi.`;
}

function lobbyKeyboard(g) {
  return Markup.inlineKeyboard([
    [Markup.button.url('➕ Qo\'shilish', `https://t.me/${BOT_USERNAME}?start=join_${g.code}`)],
    [Markup.button.callback('▶️ Boshlash', `start_${g.code}`)]
  ]);
}

async function refreshLobby(g) {
  try {
    await bot.telegram.editMessageText(g.chatId, g.msgId, undefined, lobbyText(g), lobbyKeyboard(g));
  } catch (e) {}
}

bot.command('bunker', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('Bu buyruq guruhda ishlaydi. Meni guruhga qo\'shing va /bunker yozing.');
  }
  // Eski xona bo'lsa, uni yopib, yangisini ochamiz
  const old = games[chatGame[ctx.chat.id]];
  if (old) old.finished = true;

  const g = {
    code: makeCode(),
    chatId: ctx.chat.id,
    hostId: ctx.from.id,
    players: [],
    started: false,
    finished: false,
    msgId: null
  };
  const msg = await ctx.reply(lobbyText(g), lobbyKeyboard(g));
  g.msgId = msg.message_id;
  games[g.code] = g;
  chatGame[ctx.chat.id] = g.code;
});

bot.command('stop', async (ctx) => {
  const g = games[chatGame[ctx.chat.id]];
  if (!g || g.finished) return ctx.reply('Ochiq o\'yin yo\'q.');
  g.finished = true;
  ctx.reply('🛑 O\'yin to\'xtatildi. Yangi o\'yin uchun /bunker yozing.');
});

bot.start(async (ctx) => {
  const payload = ctx.startPayload || '';
  if (!payload.startsWith('join_')) {
    return ctx.reply('Salom! Men BUNKER o\'yini botiman 🛡\n\nMeni guruhga qo\'shing va /bunker yozing. O\'yinchilar "Qo\'shilish" tugmasini bosib, shu yerda karta oladi.');
  }
  const g = games[payload.slice(5)];
  if (!g || g.finished) return ctx.reply('Xona topilmadi yoki yopilgan.');
  if (g.started) return ctx.reply('O\'yin allaqachon boshlangan.');
  if (g.players.find((p) => p.id === ctx.from.id)) {
    return ctx.reply('Siz allaqachon qo\'shilgansiz. Guruhga qayting.');
  }
  if (g.players.length >= MAX_PLAYERS) return ctx.reply('Xona to\'lgan.');
  const name = ctx.from.first_name || ctx.from.username || 'O\'yinchi';
  g.players.push({ id: ctx.from.id, name, card: null });
  await ctx.reply('✅ Siz xonaga qo\'shildingiz. Guruhga qayting, o\'yin boshlanganda karta shu yerga keladi.');
  refreshLobby(g);
});

bot.action(/^start_(.+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.started || g.finished) return ctx.answerCbQuery('O\'yin boshlangan yoki yopilgan.');
  if (ctx.from.id !== g.hostId) {
    return ctx.answerCbQuery('Faqat xona egasi boshlaydi.', { show_alert: true });
  }
  if (g.players.length < MIN_PLAYERS) {
    return ctx.answerCbQuery(`Kamida ${MIN_PLAYERS} o'yinchi kerak.`, { show_alert: true });
  }
  g.started = true;
  g.disaster = pick(DISASTERS);
  g.capacity = Math.max(1, Math.floor(g.players.length / 2));
  await ctx.answerCbQuery();

  const failed = [];
  for (const p of g.players) {
    p.card = makeCard();
    const c = p.card;
    const text = `🪪 SIZNING KARTANGIZ\n\n👷 Kasb: ${c.job}\n🎂 Yosh: ${c.age}\n❤️ Sog'liq: ${c.health}\n🧠 Xarakter: ${c.trait}\n🎯 Hobbi: ${c.hobby}\n🎒 Buyum: ${c.item}\n🤫 Sir: ${c.secret}\n\nBu kartani boshqalarga ko'rsatmang. Qaysi xususiyatni ochishni o'zingiz hal qilasiz.`;
    try {
      await bot.telegram.sendMessage(p.id, text);
    } catch (e) {
      failed.push(p.name);
    }
  }

  let msg = `🛡 O'YIN BOSHLANDI!\n\n☢️ Falokat: ${g.disaster}\n\n🚪 Bunkerda joy: ${g.capacity} kishi\n👥 O'yinchilar: ${g.players.length}\n\nKartalar shaxsiy chatlarga yuborildi.`;
  if (failed.length) msg += `\n\n⚠️ Karta yetib bormadi: ${failed.join(', ')} (botga /start bosish kerak)`;
  await bot.telegram.sendMessage(g.chatId, msg);
  try {
    await bot.telegram.editMessageText(g.chatId, g.msgId, undefined, `🛡 Xona ${g.code} - o'yin boshlandi`);
  } catch (e) {}
});

bot.catch((err) => console.log('Xato:', err.message));
bot.launch({ dropPendingUpdates: true });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
