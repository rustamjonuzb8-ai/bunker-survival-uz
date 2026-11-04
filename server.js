const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Bunkeruz1_bot';
const WINNERS = 2; // bunkerda doim 2 ta joy
const MIN_PLAYERS = Math.max(3, Number(process.env.MIN_PLAYERS || 4));
const REVOTE_SEC = Number(process.env.REVOTE_SEC || 30);
const MAX_PLAYERS = 12;
const REVEAL_SEC = Number(process.env.REVEAL_SEC || 60);
const DISCUSS1_SEC = Number(process.env.DISCUSS1_SEC || 90); // 1-kartadan keyin
const DISCUSS2_SEC = Number(process.env.DISCUSS2_SEC || 80); // 2-kartadan keyin
const VOTE_SEC = Number(process.env.VOTE_SEC || 45);
const BETWEEN_SEC = Number(process.env.BETWEEN_SEC || 4);

const bot = new Telegraf(TOKEN || 'no-token');
const games = {};     // kod -> o'yin
const chatGame = {};  // chatId -> kod

// ---------- STATISTIKA VA ADMIN PANEL ----------
const fs = require('fs');
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_KEY || '';
const DATA_FILE = process.env.DATA_FILE || './data.json';
const DAY_MS = 86400000;
const START_TIME = Date.now();
let DB = { users: {}, chats: {}, gamesStarted: 0, gamesFinished: 0, gamesLog: [] };
let saveTimer = null;
let pendingBroadcast = '';
let broadcasting = false;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtTime = (ts) => new Date(ts + 5 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
const userLink = (u) =>
  `<a href="tg://user?id=${u.id}">${esc(u.name || u.first_name || 'Nomalum')}</a>${u.username ? ' @' + esc(u.username) : ''}`;
const useSb = () => !!(SB_URL && SB_KEY && typeof fetch === 'function');
function sbHeaders() {
  const h = { apikey: SB_KEY };
  if (SB_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SB_KEY}`;
  return h;
}

// --- saqlash va yuklash ---
async function loadDB() {
  if (useSb()) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/store?id=eq.main&select=data`, { headers: sbHeaders() });
      if (r.ok) {
        const rows = await r.json();
        if (rows[0] && rows[0].data) {
          DB = Object.assign(DB, rows[0].data);
          console.log('Statistika Supabase\'dan yuklandi');
          return;
        }
      } else {
        console.log('Supabase o\'qish xatosi:', r.status);
      }
    } catch (e) {
      console.log('Supabase o\'qish xatosi:', e.message);
    }
  }
  try {
    if (fs.existsSync(DATA_FILE)) DB = Object.assign(DB, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (e) {
    console.log('Fayl o\'qish xatosi:', e.message);
  }
}
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 3000);
  if (saveTimer.unref) saveTimer.unref();
}
async function saveNow() {
  saveTimer = null;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DB));
  } catch (e) {}
  if (useSb()) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/store?on_conflict=id`, {
        method: 'POST',
        headers: Object.assign({}, sbHeaders(), { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify([{ id: 'main', data: DB }])
      });
      if (!r.ok) console.log('Supabase yozish xatosi:', r.status, await r.text());
    } catch (e) {
      console.log('Supabase yozish xatosi:', e.message);
    }
  }
}

// --- kuzatish ---
function trackUser(from, isStart) {
  if (!from || from.is_bot) return false;
  const now = Date.now();
  let u = DB.users[from.id];
  if (!u) u = DB.users[from.id] = { id: from.id, first: now, games: 0, started: false, blocked: false };
  u.name = from.first_name || '';
  u.username = from.username || '';
  u.last = now;
  let newStart = false;
  if (isStart) {
    if (!u.started) {
      u.started = true;
      newStart = true;
    }
    u.blocked = false;
  }
  saveSoon();
  return newStart;
}
function trackChat(chat) {
  if (!chat || chat.type === 'private') return false;
  let isNew = false;
  let c = DB.chats[chat.id];
  if (!c) {
    c = DB.chats[chat.id] = { id: chat.id, first: Date.now(), games: 0, active: true };
    isNew = true;
  }
  c.title = chat.title || '';
  c.last = Date.now();
  c.active = true;
  saveSoon();
  return isNew;
}
async function notifyAdmin(html) {
  if (!ADMIN_ID) return;
  try {
    await bot.telegram.sendMessage(ADMIN_ID, html, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {}
}
const startedCount = () => Object.values(DB.users).filter((u) => u.started).length;

async function trackMiddleware(ctx, next) {
  try {
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const isPrivate = ctx.chat && ctx.chat.type === 'private';
    const interactive = !!ctx.callbackQuery || isPrivate || text.startsWith('/');
    if (interactive) {
      const isStart = isPrivate && text.startsWith('/start');
      const newStart = trackUser(ctx.from, isStart);
      const newChat = trackChat(ctx.chat);
      if (newStart && ctx.from.id !== ADMIN_ID) {
        notifyAdmin(`🆕 Yangi foydalanuvchi: ${userLink(ctx.from)}\nJami: <b>${startedCount()}</b>`);
      }
      if (newChat) {
        const total = Object.values(DB.chats).filter((c) => c.active).length;
        notifyAdmin(`🏘 Bot yangi guruhda ishlatildi: <b>${esc(ctx.chat.title)}</b>\nJami guruh: <b>${total}</b>`);
      }
    }
  } catch (e) {
    console.log('kuzatish xatosi:', e.message);
  }
  return next();
}
bot.use(trackMiddleware);

function recordGameStart(g) {
  g.players.forEach((p) => {
    const u = DB.users[p.id];
    if (u) u.games = (u.games || 0) + 1;
  });
  const c = DB.chats[g.chatId];
  if (c) c.games = (c.games || 0) + 1;
  DB.gamesStarted = (DB.gamesStarted || 0) + 1;
  saveSoon();
}
function recordGameEnd(g) {
  DB.gamesFinished = (DB.gamesFinished || 0) + 1;
  DB.gamesLog = (DB.gamesLog || []).concat([{ t: Date.now(), chat: g.chatId, players: g.players.length, rounds: g.round }]).slice(-500);
  saveSoon();
}

// --- admin ko'rinishlari ---
const isAdmin = (ctx) => !!(ADMIN_ID && ctx.from && ctx.from.id === ADMIN_ID);
const menuKb = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📊 Statistika', 'adm_stats'), Markup.button.callback('🔥 Faollar', 'adm_active')],
    [Markup.button.callback('🆕 Yangi odamlar', 'adm_new'), Markup.button.callback('🏘 Guruhlar', 'adm_chats')],
    [Markup.button.callback('🎮 Hozirgi o\'yinlar', 'adm_live'), Markup.button.callback('📢 Xabar yuborish', 'adm_bc')]
  ]);
const backKb = (name) =>
  Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menyu', 'adm_menu'), Markup.button.callback('🔄 Yangilash', `adm_${name}`)]]);
const MENU_TEXT = '🛠 BUNKER boshqaruv paneli\n\nKerakli bo\'limni tanlang:';

function viewStats() {
  const now = Date.now();
  const users = Object.values(DB.users);
  const started = users.filter((u) => u.started);
  const blocked = started.filter((u) => u.blocked).length;
  const within = (d) => users.filter((u) => now - u.last < d * DAY_MS).length;
  const newIn = (d) => started.filter((u) => now - u.first < d * DAY_MS).length;
  const chats = Object.values(DB.chats);
  const activeChats = chats.filter((c) => c.active).length;
  const live = Object.values(games).filter((g) => !g.finished).length;
  const text =
    `📊 <b>BUNKER statistikasi</b>\n\n` +
    `👥 Botga start bosganlar: <b>${started.length}</b>\n` +
    `   🆕 24 soatda: ${newIn(1)} | 7 kunda: ${newIn(7)}\n` +
    `   🚫 Botni bloklaganlar: ${blocked}\n\n` +
    `🔥 Faol foydalanuvchilar:\n   24 soat: <b>${within(1)}</b> | 7 kun: <b>${within(7)}</b> | 30 kun: <b>${within(30)}</b>\n\n` +
    `🏘 Guruhlar: <b>${activeChats}</b> (jami qo'shilgan: ${chats.length})\n\n` +
    `🎮 O'yinlar: boshlangan <b>${DB.gamesStarted || 0}</b>, tugagan <b>${DB.gamesFinished || 0}</b>\n` +
    `   Hozir o'ynalayotgan: <b>${live}</b>\n\n` +
    `🕒 Server ishga tushgan: ${fmtTime(START_TIME)}\n` +
    `💾 Saqlash: ${useSb() ? 'Supabase (doimiy)' : 'vaqtinchalik fayl (qayta ishga tushsa o\'chishi mumkin)'}`;
  return { text, kb: backKb('stats') };
}
function viewNew() {
  const list = Object.values(DB.users).filter((u) => u.started).sort((a, b) => b.first - a.first).slice(0, 15);
  const body = list.length ? list.map((u, i) => `${i + 1}. ${userLink(u)} - ${fmtTime(u.first)}`).join('\n') : 'Hali hech kim yo\'q.';
  return { text: `🆕 <b>Oxirgi 15 ta yangi foydalanuvchi</b>\n\n${body}`, kb: backKb('new') };
}
function viewActive() {
  const now = Date.now();
  const list = Object.values(DB.users).filter((u) => now - u.last < 7 * DAY_MS).sort((a, b) => b.last - a.last);
  const body = list.length
    ? list.slice(0, 15).map((u, i) => `${i + 1}. ${userLink(u)} - ${fmtTime(u.last)} | o'yin: ${u.games || 0}`).join('\n')
    : 'Oxirgi 7 kunda faol odam yo\'q.';
  return { text: `🔥 <b>Faol foydalanuvchilar (7 kun): ${list.length} kishi</b>\nEng so'nggi 15 tasi:\n\n${body}`, kb: backKb('active') };
}
function viewChats() {
  const list = Object.values(DB.chats).filter((c) => c.active).sort((a, b) => b.last - a.last);
  const body = list.length
    ? list.slice(0, 15).map((c, i) => `${i + 1}. <b>${esc(c.title || c.id)}</b> - o'yin: ${c.games || 0} | oxirgi: ${fmtTime(c.last)}`).join('\n')
    : 'Hali hech qaysi guruhda ishlatilmagan.';
  return { text: `🏘 <b>Guruhlar: ${list.length} ta</b>\n\n${body}`, kb: backKb('chats') };
}
function viewLive() {
  const live = Object.values(games).filter((g) => !g.finished);
  const PH = { lobby: 'xona ochiq', reveal: 'karta ochish', summary: 'natija', discuss: 'muhokama', vote: 'ovoz berish', between: 'raund oralig\'i' };
  const body = live.length
    ? live
        .map((g) => {
          const c = DB.chats[g.chatId];
          return `• <b>${esc(g.code)}</b> | ${esc((c && c.title) || g.chatId)} | ${PH[g.phase] || g.phase} | raund ${g.round} | ${g.players.length} kishi`;
        })
        .join('\n')
    : 'Hozir o\'ynalayotgan o\'yin yo\'q.';
  const rows = live.slice(0, 8).map((g) => [Markup.button.callback(`🛑 ${g.code} ni to'xtatish`, `adm_stop_${g.code}`)]);
  rows.push([Markup.button.callback('⬅️ Menyu', 'adm_menu'), Markup.button.callback('🔄 Yangilash', 'adm_live')]);
  return { text: `🎮 <b>Hozirgi o'yinlar</b>\n\n${body}`, kb: Markup.inlineKeyboard(rows) };
}
function viewBroadcast() {
  const n = Object.values(DB.users).filter((u) => u.started && !u.blocked).length;
  return {
    text: `📢 <b>Xabar yuborish</b>\n\nBotga start bosgan <b>${n}</b> kishiga xabar yuboriladi.\n\nBuyruq bilan yozing:\n<code>/xabar Salom! Yangi o'yin qo'shildi 🎉</code>\n\nAvval ko'rib chiqish chiqadi, "Yuborish" tugmasini bosgandan keyingina ketadi.`,
    kb: backKb('bc')
  };
}
const VIEWS = { stats: viewStats, active: viewActive, new: viewNew, chats: viewChats, live: viewLive, bc: viewBroadcast };

async function showView(ctx, v) {
  const extra = Object.assign({ parse_mode: 'HTML', disable_web_page_preview: true }, v.kb);
  try {
    await ctx.editMessageText(v.text, extra);
  } catch (e) {}
}

// --- buyruqlar ---
bot.command('id', (ctx) => ctx.reply(`Sizning Telegram ID'ingiz: ${ctx.from.id}`));

bot.command('admin', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!ADMIN_ID) {
    return ctx.reply(
      `Boshqaruv paneli hali sozlanmagan.\n\nSizning Telegram ID'ingiz: ${ctx.from.id}\n\nRender → Environment → ADMIN_ID nomi bilan shu raqamni qo'shing va saqlang.`
    );
  }
  if (!isAdmin(ctx)) return ctx.reply('Bu buyruq faqat bot egasi uchun.');
  await ctx.reply(MENU_TEXT, menuKb());
});

bot.action(/^adm_(stats|active|new|chats|live|bc)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
  await ctx.answerCbQuery();
  await showView(ctx, VIEWS[ctx.match[1]]());
});
bot.action('adm_menu', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(MENU_TEXT, menuKb());
  } catch (e) {}
});
bot.action(/^adm_stop_([A-Z0-9]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
  const g = games[ctx.match[1]];
  if (g && !g.finished) {
    closeGame(g);
    say(g.chatId, '🛑 O\'yin bot egasi tomonidan to\'xtatildi. Yangi o\'yin uchun /bunker yozing.');
    await ctx.answerCbQuery('To\'xtatildi');
  } else {
    await ctx.answerCbQuery('Bu o\'yin allaqachon tugagan.');
  }
  await showView(ctx, viewLive());
});

bot.command('xabar', async (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const text = ctx.message.text.replace(/^\/xabar(@\w+)?\s*/i, '').trim();
  if (!text) return ctx.reply('Xabar matnini buyruq bilan birga yozing:\n/xabar Salom! Yangi o\'yin qo\'shildi 🎉');
  const targets = Object.values(DB.users).filter((u) => u.started && !u.blocked).length;
  pendingBroadcast = text;
  await ctx.reply(
    `📢 Quyidagi xabar ${targets} kishiga yuboriladi:\n\n${text}`,
    Markup.inlineKeyboard([[Markup.button.callback('✅ Yuborish', 'adm_bc_go'), Markup.button.callback('❌ Bekor qilish', 'adm_bc_cancel')]])
  );
});
bot.action('adm_bc_cancel', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
  pendingBroadcast = '';
  await ctx.answerCbQuery('Bekor qilindi');
  try {
    await ctx.editMessageText('❌ Xabar yuborish bekor qilindi.');
  } catch (e) {}
});
bot.action('adm_bc_go', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
  if (!pendingBroadcast) return ctx.answerCbQuery('Yuboriladigan xabar yo\'q.', { show_alert: true });
  if (broadcasting) return ctx.answerCbQuery('Yuborish davom etmoqda.', { show_alert: true });
  await ctx.answerCbQuery('Yuborish boshlandi...');
  try {
    await ctx.editMessageText('⏳ Xabar yuborilmoqda...');
  } catch (e) {}
  const text = pendingBroadcast;
  pendingBroadcast = '';
  broadcasting = true;
  let ok = 0;
  let fail = 0;
  for (const u of Object.values(DB.users)) {
    if (!u.started || u.blocked) continue;
    try {
      await bot.telegram.sendMessage(u.id, text);
      ok++;
    } catch (e) {
      fail++;
      if (e && e.response && e.response.error_code === 403) u.blocked = true;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  broadcasting = false;
  saveSoon();
  await notifyAdmin(`📢 Xabar yuborildi.\n✅ Yetib bordi: <b>${ok}</b>\n❌ Yetmadi: <b>${fail}</b>`);
});

// bot guruhdan chiqarilsa yoki foydalanuvchi botni bloklasa
bot.on('my_chat_member', async (ctx) => {
  try {
    const st = ctx.myChatMember.new_chat_member.status;
    const gone = st === 'kicked' || st === 'left';
    if (ctx.chat.type === 'private') {
      const u = DB.users[ctx.from.id];
      if (u) u.blocked = gone;
    } else {
      const c = DB.chats[ctx.chat.id];
      if (c) c.active = !gone;
    }
    saveSoon();
  } catch (e) {}
});


// ---------- MA'LUMOTLAR ----------
const JOBS = [
  "Shifokor (operatsiya qila oladi, kasallarni davolaydi)",
  "Oshpaz (oz mahsulotdan ham to'yimli ovqat qiladi)",
  "Dehqon (ekin ekadi, hosil yetishtiradi)",
  "Elektrchi (chiroq va generatorni ishlatadi)",
  "Hamshira (yarani bog'laydi, dori beradi)",
  "Sobiq askar (o'zini himoya qiladi, jasur)",
  "O'qituvchi (ko'p narsa biladi, bolalarga dars beradi)",
  "Dasturchi (kompyuterni yaxshi biladi, lekin bunkerda internet yo'q)",
  "Blogger (obunachisi ko'p, lekin ish qo'lidan kelmaydi)",
  "Ruhshunos (odamlarni tinchlantiradi, janjalni bosadi)",
  "Quruvchi (devor va tomni tuzatadi)",
  "Veterinar (hayvonlarni davolaydi, mol-qo'y boqishni biladi)",
  "Suv ustasi (quvur va suvni tuzatadi)",
  "Avtomexanik (har qanday mashinani tuzatadi)",
  "Aktyor (hammani kuldiradi, lekin amaliy foydasi kam)",
  "Deputat (gapga usta, ishga usta emas)",
  "Dorixonachi (dorilarni va ularning zararini biladi)",
  "Militsioner (tartib saqlaydi, baquvvat)",
  "Sartarosh (hamma bilan til topishadi, foydasi kam)",
  "O'simlik bilimdoni (qaysi o'simlik yeyiladi, qaysi biri zaharli ekanini biladi)"
];
const HEALTH = [
  "Yong'oqdan zaharlanadi (bir dona yong'oq yesa ham og'ir ahvolga tushadi)",
  "Changdan nafasi qisadi (doim yo'talib, aksirib yuradi)",
  "Ba'zi dorilar unga to'g'ri kelmaydi (ichsa, tanasi shishib, nafasi qisadi)",
  "Non yeya olmaydi (non va xamir ovqatdan qattiq kasal bo'ladi)",
  "Nafas yo'li kasalligi (maxsus nafas dorisi kerak, u 2 oyga yetadi)",
  "Qand kasalligi (har kuni ukol kerak, zaxirasi 1 oyga yetadi)",
  "Yuragi zaif (og'ir ish qila olmaydi)",
  "Ko'zi ko'rmaydi (faqat eshitib va paypaslab yuradi)",
  "Yaxshi eshitmaydi (xavf haqida ogohlantirishni eshitmay qolishi mumkin)",
  "Bir oyog'i sun'iy (tez yura olmaydi, lekin ishlay oladi)",
  "Tutqanoq kasalligi (qattiq qo'rqsa, hushidan ketib yiqiladi)",
  "Berk joydan qo'rqadi (tor joyda vahimaga tushadi, bunker unga og'ir)",
  "Beli doim og'riydi (og'ir yuk ko'tara olmaydi)",
  "Uyqusizlik (uxlamasa jahli chiqib, xato qiladi)",
  "Qon bosimi baland (har kuni dori ichishi kerak)",
  "Jigari kasal (oddiy ovqat yeya olmaydi, maxsus ovqat kerak)",
  "Juda baquvvat va sog'lom",
  "Temirdek sog'lom (yillar davomida shamollamagan)"
];
const TRAITS = [
  "Sabrli (janjalni bosadi, lekin ishni sekin qiladi)",
  "Jizzaki (tez achchiqlanadi, janjal chiqaradi)",
  "Yo'lboshchi (odamlarni boshqaradi, qaror qiladi)",
  "Qo'rqoq (xavfda vahimaga tushadi)",
  "Aqlli (qiyin paytda yo'l topadi, lekin o'zini katta oladi)",
  "Yolg'onchi (ishonarli gapiradi, lekin aldaydi)",
  "Mehribon (hammaga yordam beradi, o'zini o'ylamaydi)",
  "Xudbin (faqat o'zini o'ylaydi)",
  "Jasur (xavfda oldinga chiqadi, ba'zan o'ylamay)",
  "Ochko'z (ovqatni yashirincha ko'proq yeydi)",
  "Hazilkash (kayfiyatni ko'taradi, lekin jiddiy paytda ham hazillashadi)",
  "Tartibli (hamma narsani hisoblaydi, tartibni buzganni yoqtirmaydi)",
  "Dangasa (ishdan qochadi, lekin gapga chechan)",
  "Tez ranjiydi (kichik gapdan ham xafa bo'lib, jamoani buzadi)"
];
const HOBBIES = [
  "Baliq ovlash (baliq tutadi, suv topadi)",
  "Shaxmat (bir necha qadam oldinni o'ylaydi)",
  "Gitara chalish (ko'ngil ochadi, lekin ovqat bermaydi)",
  "Bog' qilish (kichik joyda ham ekin ekadi)",
  "Kitob o'qish (ko'p biladi, lekin amalda kam ishlaydi)",
  "Og'ir tosh ko'tarish (juda kuchli)",
  "Rasm chizish (chiroyli, lekin foydasi kam)",
  "Ovqat pishirish (konservadan ham mazali taom qiladi)",
  "Ov qilish (hayvon izini biladi, o'rmonda adashmaydi)",
  "Tikuvchilik (kiyim va ko'rpani tikadi)",
  "Radio yasash (aloqa uskunasini yig'adi, tashqi dunyo bilan bog'laydi)",
  "Tog'ga chiqish (chidamli, qiyinchilikka ko'nikkan)",
  "Kompyuter o'yini (soatlab o'tira oladi, lekin hayotda sust)",
  "Mashina tuzatish (mayda uskunalarni tuzata oladi)"
];
const BAGGAGE = [
  "Konserva (3 oyga yetadi)",
  "Dori sumkasi (og'riq dorisi, bint, yod)",
  "Quyosh batareyasi (oz miqdorda elektr beradi)",
  "Qo'lda aylantiriladigan generator (chiroq va radio uchun)",
  "Suv tozalagich (1 yilga yetadi)",
  "Sabzavot urug'i (ekilsa 4 oyda hosil beradi)",
  "Kitoblar qutisi (tabobat va dehqonchilik haqida)",
  "Ko'rpa-to'shak va issiq kiyim (hamma uchun yetadi)",
  "Aloqa radiosi (boshqa bunkerlar bilan gaplashadi)",
  "Oilaviy rasmlar albomi (foydasiz, lekin yoqimli)",
  "Bo'sh chamadon (ichida hech narsa yo'q)",
  "Asboblar qutisi (bolg'a, arra, mix)",
  "Gugurt va chaqmoq (olov yoqishga yetadi)",
  "Eski xarita va kompas (tashqarida yo'l topishga yordam beradi)",
  "Xo'roz va 3 ta tovuq (tuxum va go'sht beradi)",
  "Katta chodir (qo'shimcha joy beradi)",
  "Gitara va nay (ko'ngil ochadi, lekin joy oladi)"
];
const SECRETS = [
  "Diplomi soxta (aslida kasbini yaxshi bilmaydi)",
  "Oldin o'g'rilik qilib qamalgan",
  "Farzand ko'rolmaydi (shuning uchun oilasi buzilgan)",
  "Yashirincha og'ir kasal (bir yilga ham yetmaydi, hech kimga aytmagan)",
  "Yashirincha boshqalarni kuzatib, sirlarini yig'ib yurgan",
  "Katta qarzga botgan (qarz egalari uni qidirmoqda)",
  "Ovqatni yashirincha o'zi uchun yig'ib qo'ygan",
  "Aslida ismi boshqa (haqiqiy ismini yashirgan)",
  "Sobiq eri yoki xotini uni qidirmoqda",
  "Aslida qo'rqoq, lekin hammaga o'zini jasur deydi",
  "Ishni boshqalarga qildirib, o'zi ishlagan bo'lib ko'rsatgan",
  "Hayvondan qattiq qo'rqadi (mol-qo'y bilan ishlay olmaydi)",
  "Yolg'on gapirmasdan turolmaydi",
  "Yashirin xizmatda ishlagan (ko'p sir biladi, lekin hammaga xavfli)",
  "Boshqa odamning hujjati bilan yashaydi"
];
const DISASTERS = [
  "Yadro urushi: tashqarida zaharli nur, 5 yil yashash kerak",
  "Zombi kasalligi: shaharlar vayron bo'ldi",
  "Osmondan tosh yog'di: quyosh bir necha yil ko'rinmaydi",
  "Katta toshqin: quruqlik deyarli qolmadi",
  "O'lat kasalligi: yer yuzi aholisining ko'pchiligi nobud bo'ldi",
  "Vulqon otildi: osmonni kul qopladi, qattiq sovuq boshlandi"
];

function drawer(arr) {
  let pool = [];
  return () => {
    if (!pool.length) pool = arr.slice().sort(() => Math.random() - 0.5);
    return pool.pop();
  };
}
function makeDraws() {
  return {
    job: drawer(JOBS), health: drawer(HEALTH), trait: drawer(TRAITS),
    hobby: drawer(HOBBIES), baggage: drawer(BAGGAGE), secret: drawer(SECRETS)
  };
}

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

function makeCard(draws) {
  const d = draws || makeDraws();
  const age = 18 + Math.floor(Math.random() * 50);
  const female = Math.random() < 0.5;
  const sex = female ? (age < 30 ? 'Qiz' : 'Ayol') : 'Erkak';
  return {
    job: d.job(),
    age: `${age} yosh`,
    sex,
    health: d.health(),
    trait: d.trait(),
    hobby: d.hobby(),
    baggage: d.baggage(),
    secret: d.secret()
  };
}

// ---------- TELEGRAM YORDAMCHILARI ----------
async function say(chatId, text, extra) {
  // Telegram limiti 4096 belgi: uzun xabarni bo'laklarga ajratamiz
  const parts = [];
  let rest = String(text);
  while (rest.length > 3800) {
    let cut = rest.lastIndexOf('\n\n', 3800);
    if (cut < 1000) cut = rest.lastIndexOf('\n', 3800);
    if (cut < 1000) cut = 3800;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  parts.push(rest);
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    try {
      last = await bot.telegram.sendMessage(chatId, parts[i], i === parts.length - 1 ? extra : undefined);
    } catch (e) {
      console.log('send xato:', e.message);
    }
  }
  return last;
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
    [Markup.button.callback('▶️ Boshlash', `start_${g.code}`)],
    [Markup.button.url('📖 O\'yin qoidasi', `https://t.me/${BOT_USERNAME}?start=rules`)]
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
  g.players.push({ id, name, card: null, revealed: [], alive: true, votesAgainst: 0 });
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
  g.capacity = WINNERS;
  const draws = makeDraws();
  g.players.forEach((p) => {
    p.card = makeCard(draws);
    p.revealed = [];
    p.alive = true;
    p.votesAgainst = 0;
  });
  recordGameStart(g);
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

// Ovoz beruvchilar: faqat tirik o'yinchilar
function voters(g) {
  return alive(g);
}

async function startVote(g, tied) {
  if (g.finished) return;
  if (!tied && g.phase !== 'discuss') return;
  newPhase(g, 'vote');
  g.votes = new Map();
  g.revote = !!tied;
  g.voteCandidates = tied || alive(g);
  const list = g.voteCandidates;
  const rows = [];
  for (let i = 0; i < list.length; i += 2) {
    rows.push(list.slice(i, i + 2).map((p) => Markup.button.callback(`❌ ${p.name}`, `vote_${g.code}_${p.id}`)));
  }
  g.voteKeyboard = Markup.inlineKeyboard(rows);
  const msg = await say(g.chatId, voteText(g), g.voteKeyboard);
  g.voteMsgId = msg ? msg.message_id : null;
  setTimer(g, tied ? REVOTE_SEC : VOTE_SEC, endVote);
}
function voteText(g) {
  const sec = g.revote ? REVOTE_SEC : VOTE_SEC;
  const head = g.revote
    ? `🔁 QAYTA OVOZ (${sec} soniya)\n\nOvozlar teng bo'ldi. Faqat teng chiqqanlar o'rtasida ovoz beriladi.`
    : `🗳 OVOZ BERISH (${sec} soniya)`;
  return `${head}\n\nKimni bunkerdan haydaymiz? Tugmani bosing (o'zingizga ovoz bera olmaysiz, ovozni o'zgartirish mumkin).\n\nOvoz berganlar: ${g.votes.size}/${voters(g).length}`;
}

// Ovoz berish: natija { ok, text }
async function castVote(g, voterId, targetId) {
  if (!g || g.finished || g.phase !== 'vote') return { ok: false, text: 'Ovoz berish vaqti tugagan.' };
  const voter = findPlayer(g, voterId);
  const target = findPlayer(g, targetId);
  if (!voter || !voter.alive) return { ok: false, text: 'Faqat tirik o\'yinchilar ovoz beradi.' };
  if (!target || !target.alive || !g.voteCandidates.includes(target)) {
    return { ok: false, text: 'Bu o\'yinchiga ovoz berib bo\'lmaydi.' };
  }
  if (voterId === targetId) return { ok: false, text: 'O\'zingizga ovoz bera olmaysiz.' };
  g.votes.set(voterId, targetId);
  if (g.voteMsgId) await edit(g.chatId, g.voteMsgId, voteText(g), g.voteKeyboard);
  if (g.votes.size >= voters(g).length) setTimeout(() => endVote(g), 500);
  return { ok: true, text: `Ovoz qabul qilindi: ${target.name}` };
}

async function endVote(g) {
  if (g.finished || g.phase !== 'vote') return;
  newPhase(g, 'counting');
  const tally = new Map();
  for (const t of g.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
  const wasRevote = g.revote;
  if (!wasRevote) {
    // butun o'yin davomidagi ovozlar hisobi (tengsizlikni hal qilish uchun)
    for (const [id, c] of tally) {
      const p = findPlayer(g, id);
      if (p) p.votesAgainst = (p.votesAgainst || 0) + c;
    }
    g.firstTally = new Map(tally);
  }
  let candidates;
  let note = '';
  if (tally.size === 0) {
    candidates = g.voteCandidates;
    note = 'Hech kim ovoz bermadi.';
  } else {
    const max = Math.max(...tally.values());
    candidates = g.voteCandidates.filter((p) => tally.get(p.id) === max);
  }
  // 1) Teng bo'lsa: faqat teng chiqqanlar o'rtasida qayta ovoz
  if (candidates.length > 1 && !wasRevote && tally.size > 0) {
    await say(g.chatId, `⚖️ Ovozlar teng bo'ldi: ${candidates.map((p) => p.name).join(', ')}.\nHozir faqat shular o'rtasida qayta ovoz beriladi.`);
    return startVote(g, candidates);
  }
  // 2) Yana teng bo'lsa: o'yin davomida ko'proq ovoz olgan haydaladi, 3) oxirgi chora - tasodif
  let out;
  if (candidates.length === 1) {
    out = candidates[0];
  } else {
    const maxAgainst = Math.max(...candidates.map((p) => p.votesAgainst || 0));
    const worst = candidates.filter((p) => (p.votesAgainst || 0) === maxAgainst);
    out = pick(worst);
    note =
      worst.length === 1
        ? 'Qayta ovozda ham teng bo\'ldi. O\'yin davomida ko\'proq ovoz olgani haydaldi.'
        : 'Hamma ko\'rsatkich teng bo\'ldi, tasodif bilan tanlandi.';
  }

  const base = wasRevote && g.firstTally ? g.firstTally : tally;
  let results = alive(g).map((p) => `${p.name}: ${base.get(p.id) || 0} ovoz`).join('\n');
  if (wasRevote) {
    results += '\n\nQayta ovoz:\n' + g.voteCandidates.map((p) => `${p.name}: ${tally.get(p.id) || 0} ovoz`).join('\n');
  }
  newPhase(g, 'between');
  out.alive = false;
  g.eliminated.push(out);

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
  recordGameEnd(g);
  const winners = alive(g);
  const winText = winners
    .map((p) => `👤 ${p.name}\n` + ATTRS.map((a) => `   ${attrLine(p.card, a)}`).join('\n'))
    .join('\n\n');
  const outText = g.eliminated.length
    ? g.eliminated.map((p, i) => `${i + 1}. ${p.name} (${p.card.job})`).join('\n')
    : 'Hech kim';
  await say(
    g.chatId,
    `🏁 O'YIN TUGADI!\n\n☢️ Falokat: ${g.disaster}\n\n🏆 BUNKERGA KIRGANLAR (omon qoldi):\n\n${winText}\n\n☠️ Haydalganlar (tartib bilan):\n${outText}\n\n📊 Statistika: ${g.round} raund, ${g.players.length} o'yinchi, ${g.capacity} ta joy.\n\nYangi o'yin uchun /bunker yozing.`,
    Markup.inlineKeyboard([[Markup.button.url('➕ Botni boshqa guruhga qo\'shish', `https://t.me/${BOT_USERNAME}?startgroup=true`)]])
  );
}

// ---------- BUYRUQLAR ----------
const RULES_BTN = "📖 O'yin qoidasi";

function rulePages() {
  return [
`📖 QOIDALAR 1/6 - O'YIN G'OYASI

Dunyo falokatga uchradi. Siz va do'stlaringiz omon qolish uchun bunkerga yashirindingiz, lekin joy cheklangan: hammaga yetmaydi.

🎯 Maqsad: oxirigacha bunkerdan haydalmay qolish.

Qanday qilib? O'zingizni foydali ko'rsating, boshqalarning kamchiligini fosh qiling va ovoz berishda o'zingizni himoya qiling.`,

`📖 QOIDALAR 2/6 - BOSHLASH

1️⃣ Botni guruhga qo'shing.
2️⃣ Guruhda /bunker yozing.
3️⃣ Hamma "➕ Qo'shilish" tugmasini bosadi, botga Start bosadi va guruhga qaytadi.
4️⃣ Xona egasi "▶️ Boshlash" tugmasini bosadi.

👥 Kamida ${MIN_PLAYERS}, ko'pi bilan ${MAX_PLAYERS} o'yinchi.
🔒 Kartangiz faqat botning shaxsiy chatiga keladi, boshqalar ko'rmaydi.
🎙 Gaplashish uchun guruhning ovozli chatini yoqing.`,

`📖 QOIDALAR 3/6 - KARTANGIZ

Har o'yinchida 8 ta xususiyat bor:

👷 Kasb: bunkerda nima qila olasiz
🎂 Yosh va 👫 Jins
❤️ Sog'liq: kasallik yoki zaif joyingiz (sizni zaif qilishi mumkin)
🧠 Xarakter: boshqalar bilan munosabat
🎯 Hobbi: qo'shimcha ko'nikma
🧳 Bagaj: bunkerga olib kirgan narsangiz
🤫 Sir: eng xavfli xususiyat, ochilsa sizga qarshi ishlatiladi

💡 Boshqalar faqat siz OCHGAN xususiyatlarni ko'radi. Qaysini qachon ochishni o'zingiz hal qilasiz.`,

`📖 QOIDALAR 4/6 - RAUND

Har raund shunday o'tadi:

1️⃣ 1-karta: hamma bitta xususiyatini ochadi (${REVEAL_SEC} soniya)
2️⃣ Muhokama (${DISCUSS1_SEC} soniya)
3️⃣ 2-karta: yana bitta xususiyat (${REVEAL_SEC} soniya)
4️⃣ Muhokama (${DISCUSS2_SEC} soniya)
5️⃣ Ovoz berish (${VOTE_SEC} soniya), bitta o'yinchi haydaladi

⏰ Vaqtida karta ochmasangiz, o'tkazib yuboriladi va boshqalar sizdan gumon qiladi.`,

`📖 QOIDALAR 5/6 - MUHOKAMA

Bu o'yinning eng qiziq qismi. Ovozli chatda gaplashing:

• O'zingiz nega kerakligingizni tushuntiring: "Men shifokorman, kasallarni davolayman"
• Boshqalarning kamchiligini aytib, ularni gumon ostiga oling
• Yolg'on gapirish mumkin! Lekin ochilgan kartangiz bilan qarama-qarshi bo'lmasin
• Falokatga qarab fikr yuriting: kasallik tarqalsa shifokor kerak, urushda askar

Misol: "Dilya, sen blogger ekansan, bunkerda obunachilar bizga ovqat bermaydi. Sen ortiqchasan."`,

`📖 QOIDALAR 6/6 - OVOZ VA G'ALABA

🗳 Ovoz berishda ismlar tugmasi chiqadi. O'zingizga ovoz bera olmaysiz, ovozni o'zgartirish mumkin.
⚖️ Ovozlar teng bo'lsa, faqat teng chiqqanlar o'rtasida qayta ovoz beriladi. Yana teng bo'lsa, o'yin davomida ko'proq ovoz olgan haydaladi.
☠️ Haydalganning kartasi to'liq ochiladi.
🏁 Bunkerda HAR DOIM 2 ta joy bor. 2 kishi qolganda o'yin tugaydi va ikkalasi ham G'OLIB.

Misol: 6 o'yinchi bo'lsa, 4 raund o'tadi, 4 kishi haydaladi, 2 kishi bunkerga kiradi.

Buyruqlar: /bunker - yangi xona, /stop - to'xtatish, /qoidalar - qoidalar.`
  ];
}

function ruleKeyboard(i) {
  const last = rulePages().length - 1;
  const row = [];
  if (i > 0) row.push(Markup.button.callback('⬅️ Orqaga', `rule_${i - 1}`));
  if (i < last) row.push(Markup.button.callback('Keyingi ➡️', `rule_${i + 1}`));
  return Markup.inlineKeyboard([row]);
}

async function sendRules(ctx) {
  await ctx.reply(rulePages()[0], ruleKeyboard(0));
}

bot.command('qoidalar', sendRules);
bot.hears(RULES_BTN, sendRules);
bot.action('rules_open', async (ctx) => {
  await ctx.answerCbQuery();
  await sendRules(ctx);
});
bot.action(/^rule_(\d+)$/, async (ctx) => {
  const i = Number(ctx.match[1]);
  const pages = rulePages();
  if (i < 0 || i >= pages.length) return ctx.answerCbQuery();
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(pages[i], ruleKeyboard(i));
  } catch (e) {}
});


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
  if (payload === 'rules') return sendRules(ctx);
  if (!payload.startsWith('join_')) {
    return ctx.reply(
      'Salom! Men BUNKER o\'yini botiman 🛡\n\nMeni guruhga qo\'shing va /bunker yozing. O\'yinchilar "Qo\'shilish" tugmasini bosib, shu yerda karta oladi.\n\nO\'yin qoidasini o\'rganish uchun pastdagi tugmani bosing 👇',
      Markup.inlineKeyboard([
        [Markup.button.url('➕ Guruhga qo\'shish', `https://t.me/${BOT_USERNAME}?startgroup=true`)],
        [Markup.button.callback(RULES_BTN, 'rules_open')]
      ])
    );
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

  loadDB()
    .catch((e) => console.log('loadDB xatosi:', e.message))
    .then(() => bot.launch({ dropPendingUpdates: true }))
    .catch((e) => console.log('launch xatosi:', e.message));
  process.once('SIGINT', () => {
    saveNow();
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    saveNow();
    bot.stop('SIGTERM');
  });

  // Tugagan eski o'yinlarni tozalash
  setInterval(() => {
    const now = Date.now();
    for (const code of Object.keys(games)) {
      if (games[code].finished && now - games[code].createdAt > 3600 * 1000) delete games[code];
    }
  }, 600 * 1000);
}

module.exports = { _admin: { trackMiddleware, trackUser, trackChat, loadDB, saveNow, getDB: () => DB, viewStats, viewNew, viewActive, viewChats, viewLive, viewBroadcast }, bot, games, chatGame, createRoom, joinPlayer, beginGame, revealAttr, castVote, alive, findPlayer };
