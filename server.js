const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Bunkeruz1_bot';
const WINNERS = 2; // bunkerda doim 2 ta joy
const MAX_PLAYERS = 12;
// Quyidagi qiymatlar admin paneldagi "Sozlamalar" bo'limidan o'zgartiriladi (applySettings)
const ENV_DEFAULTS = {
  minPlayers: Math.max(3, Number(process.env.MIN_PLAYERS || 4)),
  reveal: Number(process.env.REVEAL_SEC || 60),
  discuss1: Number(process.env.DISCUSS1_SEC || 90), // 1-kartadan keyin
  discuss2: Number(process.env.DISCUSS2_SEC || 80), // 2-kartadan keyin
  vote: Number(process.env.VOTE_SEC || 45),
  revote: Number(process.env.REVOTE_SEC || 30),
  between: Number(process.env.BETWEEN_SEC || 4)
};
let MIN_PLAYERS = ENV_DEFAULTS.minPlayers;
let REVOTE_SEC = ENV_DEFAULTS.revote;
let REVEAL_SEC = ENV_DEFAULTS.reveal;
let DISCUSS1_SEC = ENV_DEFAULTS.discuss1;
let DISCUSS2_SEC = ENV_DEFAULTS.discuss2;
let VOTE_SEC = ENV_DEFAULTS.vote;
let BETWEEN_SEC = ENV_DEFAULTS.between;

const bot = new Telegraf(TOKEN || 'no-token');
const games = {};     // kod -> o'yin
const chatGame = {};  // chatId -> kod

// ---------- STATISTIKA VA ADMIN PANEL ----------
const fs = require('fs');
const path = require('path');
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_KEY || '';
const DATA_FILE = process.env.DATA_FILE || './data.json';
const DAY_MS = 86400000;
const BROADCAST_DELAY_MS = Number(process.env.BROADCAST_DELAY_MS || 60);
const START_TIME = Date.now();
let DB = { users: {}, chats: {}, gamesStarted: 0, gamesFinished: 0, gamesLog: [] };
let saveTimer = null;
let pendingBroadcast = '';
let broadcasting = false;
let adminInput = null; // admin shaxsiy xabar yozishni kutayotgan holat: { id, label, isG }
let pendingDirect = null; // yuborilishi tasdiqlanishini kutayotgan xabar: { id, label, text, isG }

// --- sozlamalar ---
const SETTING_DEFS = [
  { key: 'minPlayers', label: "Eng kam o'yinchi", unit: 'kishi', step: 1, min: 3, max: MAX_PLAYERS },
  { key: 'reveal', label: 'Karta ochish', unit: 'soniya', step: 10, min: 20, max: 180 },
  { key: 'discuss1', label: '1-muhokama', unit: 'soniya', step: 10, min: 20, max: 300 },
  { key: 'discuss2', label: '2-muhokama', unit: 'soniya', step: 10, min: 20, max: 300 },
  { key: 'vote', label: 'Ovoz berish', unit: 'soniya', step: 5, min: 15, max: 120 },
  { key: 'revote', label: 'Qayta ovoz', unit: 'soniya', step: 5, min: 15, max: 120 },
  { key: 'between', label: "Raund oralig'i", unit: 'soniya', step: 1, min: 1, max: 30 }
];
const TOGGLE_DEFS = [
  { key: 'maintenance', label: 'Texnik ish (yangi o\'yin ochilmaydi)', def: false },
  { key: 'notifyUsers', label: 'Yangi foydalanuvchi haqida xabar', def: true },
  { key: 'notifyGroups', label: 'Yangi guruh haqida xabar', def: true }
];
function ensureSettings() {
  const s = DB.settings && typeof DB.settings === 'object' ? DB.settings : {};
  if (!s.values || typeof s.values !== 'object') s.values = {};
  TOGGLE_DEFS.forEach((t) => {
    if (typeof s[t.key] !== 'boolean') s[t.key] = t.def;
  });
  DB.settings = s;
  return s;
}
function getSetting(key) {
  const d = SETTING_DEFS.find((x) => x.key === key);
  const v = ensureSettings().values[key];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.min(d.max, Math.max(d.min, v));
  return ENV_DEFAULTS[key];
}
function applySettings() {
  MIN_PLAYERS = getSetting('minPlayers');
  REVEAL_SEC = getSetting('reveal');
  DISCUSS1_SEC = getSetting('discuss1');
  DISCUSS2_SEC = getSetting('discuss2');
  VOTE_SEC = getSetting('vote');
  REVOTE_SEC = getSetting('revote');
  BETWEEN_SEC = getSetting('between');
}

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
  await loadDBRaw();
  ensureSettings();
  applySettings();
}
async function loadDBRaw() {
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
// --- guruh ma'lumotlari (Telegram'dan jonli olinadi) ---
async function memberCount(chatId) {
  try {
    return await bot.telegram.callApi('getChatMemberCount', { chat_id: chatId });
  } catch (e) {
    return null;
  }
}
async function botUserId() {
  if (bot.botInfo && bot.botInfo.id) return bot.botInfo.id;
  const me = await bot.telegram.getMe();
  return me.id;
}
// havola: ochiq guruh -> t.me/username; yopiq guruh -> saqlangan yoki yangi yaratilgan taklif havolasi
// (yangi havola yaratish uchun bot guruhda admin bo'lishi va "havola orqali taklif qilish" huquqi bo'lishi kerak)
async function ensureChatLink(chat, force) {
  const c = DB.chats[chat.id];
  if (chat.username) return `https://t.me/${chat.username}`;
  if (c && c.link && !force) return c.link;
  try {
    const link = await bot.telegram.exportChatInviteLink(chat.id);
    if (c && link) {
      c.link = link;
      saveSoon();
    }
    return link || '';
  } catch (e) {
    return force ? '' : (c && c.link) || '';
  }
}
// guruh haqida: nomi, a'zolar soni va kirish havolasi
async function chatInfoHtml(chat) {
  const members = await memberCount(chat.id);
  const link = await ensureChatLink(chat, false);
  return (
    `\n🏘 Guruh: <b>${esc(chat.title || '')}</b>` +
    `\n👥 A'zolar: <b>${members == null ? '?' : members}</b>` +
    (link
      ? `\n🔗 Kirish havolasi: ${link}`
      : `\n🔗 Havola yo'q: botni guruhda <b>admin</b> qiling ("havola orqali taklif qilish" huquqi bilan), keyin havola o'zi keladi.`)
  );
}
const startedCount = () => Object.values(DB.users).filter((u) => u.started).length;

async function trackMiddleware(ctx, next) {
  // taqiqlangan foydalanuvchi botdan foydalana olmaydi (bot egasi bundan mustasno)
  const me = ctx.from && DB.users[ctx.from.id];
  if (me && me.banned && ctx.from.id !== ADMIN_ID && ctx.updateType !== 'my_chat_member') {
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Siz botdan foydalanishdan chetlatilgansiz.', { show_alert: true });
      else if (ctx.chat && ctx.chat.type === 'private') await ctx.reply('Siz botdan foydalanishdan chetlatilgansiz.');
    } catch (e) {}
    return;
  }
  const st = ensureSettings();
  try {
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const isPrivate = ctx.chat && ctx.chat.type === 'private';
    const interactive = !!ctx.callbackQuery || isPrivate || text.startsWith('/');
    if (interactive) {
      const isStart = isPrivate && text.startsWith('/start');
      const newStart = trackUser(ctx.from, isStart);
      const newChat = trackChat(ctx.chat);
      if (newStart && ctx.from.id !== ADMIN_ID && st.notifyUsers) {
        notifyAdmin(`🆕 Yangi foydalanuvchi: ${userLink(ctx.from)}\nJami: <b>${startedCount()}</b>`);
      }
      if (newChat && st.notifyGroups) {
        const total = Object.values(DB.chats).filter((c) => c.active).length;
        chatInfoHtml(ctx.chat).then((info) => notifyAdmin(`🏘 Bot yangi guruhda ishlatildi:` + info + `\nJami guruh: <b>${total}</b>`));
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
const PER_PAGE = 8;
const short = (s, n) => {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const menuKb = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📊 Statistika', 'adm_stats'), Markup.button.callback('🏘 Guruhlar', 'adm_g_0')],
    [Markup.button.callback('👥 Foydalanuvchilar', 'adm_u_all_0'), Markup.button.callback('🎮 O\'yinlar', 'adm_live')],
    [Markup.button.callback('📢 Xabar yuborish', 'adm_bc'), Markup.button.callback('⚙️ Sozlamalar', 'adm_set')]
  ]);
const backKb = (name) =>
  Markup.inlineKeyboard([[Markup.button.callback('⬅️ Menyu', 'adm_menu'), Markup.button.callback('🔄 Yangilash', `adm_${name}`)]]);
const MENU_TEXT = '🛠 BUNKER boshqaruv paneli\n\nKerakli bo\'limni tanlang:';

function paginate(list, page, per) {
  per = per || PER_PAGE;
  const pages = Math.max(1, Math.ceil(list.length / per));
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  return { items: list.slice(p * per, p * per + per), page: p, pages };
}
function navRow(prefix, p) {
  const row = [];
  if (p.page > 0) row.push(Markup.button.callback('⬅️', `${prefix}${p.page - 1}`));
  row.push(Markup.button.callback(`${p.page + 1}/${p.pages}`, 'adm_noop'));
  if (p.page < p.pages - 1) row.push(Markup.button.callback('➡️', `${prefix}${p.page + 1}`));
  return row;
}
const broadcastTargets = () => Object.values(DB.users).filter((u) => u.started && !u.blocked && !u.banned);

function viewStats() {
  const now = Date.now();
  const users = Object.values(DB.users);
  const started = users.filter((u) => u.started);
  const blocked = started.filter((u) => u.blocked).length;
  const banned = users.filter((u) => u.banned).length;
  const within = (d) => users.filter((u) => now - u.last < d * DAY_MS).length;
  const newIn = (d) => started.filter((u) => now - u.first < d * DAY_MS).length;
  const chats = Object.values(DB.chats);
  const activeChats = chats.filter((c) => c.active).length;
  const live = Object.values(games).filter((g) => !g.finished).length;
  const text =
    `📊 <b>BUNKER statistikasi</b>\n\n` +
    `👥 Botga start bosganlar: <b>${started.length}</b>\n` +
    `   🆕 24 soatda: ${newIn(1)} | 7 kunda: ${newIn(7)}\n` +
    `   🚫 Botni bloklaganlar: ${blocked}\n` +
    `   ⛔ Taqiqlanganlar: ${banned}\n\n` +
    `🔥 Faol foydalanuvchilar:\n   24 soat: <b>${within(1)}</b> | 7 kun: <b>${within(7)}</b> | 30 kun: <b>${within(30)}</b>\n\n` +
    `🏘 Guruhlar: <b>${activeChats}</b> (jami qo'shilgan: ${chats.length})\n\n` +
    `🎮 O'yinlar: boshlangan <b>${DB.gamesStarted || 0}</b>, tugagan <b>${DB.gamesFinished || 0}</b>\n` +
    `   Hozir o'ynalayotgan: <b>${live}</b>\n\n` +
    (ensureSettings().maintenance ? `🛠 <b>Texnik ish rejimi YOQILGAN</b> (yangi o'yin ochilmaydi)\n\n` : '') +
    `🕒 Server ishga tushgan: ${fmtTime(START_TIME)}\n` +
    `💾 Saqlash: ${useSb() ? 'Supabase (doimiy)' : 'vaqtinchalik fayl (qayta ishga tushsa o\'chishi mumkin)'}`;
  return { text, kb: backKb('stats') };
}

// ----- foydalanuvchilar -----
const USER_FILTERS = { all: 'Hammasi', new: 'Yangi', active: 'Faol', banned: 'Taqiq' };
function userList(filter) {
  const now = Date.now();
  const all = Object.values(DB.users);
  const byLast = (a, b) => (b.last || 0) - (a.last || 0);
  if (filter === 'new') return all.filter((u) => u.started).sort((a, b) => (b.first || 0) - (a.first || 0));
  if (filter === 'active') return all.filter((u) => now - (u.last || 0) < 7 * DAY_MS).sort(byLast);
  if (filter === 'banned') return all.filter((u) => u.banned).sort(byLast);
  return all.sort(byLast);
}
const userLabel = (u) => short(`${u.banned ? '⛔ ' : ''}${u.name || 'Nomalum'}${u.username ? ' @' + u.username : ''} · ${u.games || 0}`, 48);
function viewUsers(filter, page) {
  if (!USER_FILTERS[filter]) filter = 'all';
  const list = userList(filter);
  const p = paginate(list, page);
  const tabs = Object.keys(USER_FILTERS).map((k) => Markup.button.callback((k === filter ? '• ' : '') + USER_FILTERS[k], `adm_u_${k}_0`));
  const rows = [tabs];
  p.items.forEach((u) => rows.push([Markup.button.callback(userLabel(u), `adm_ui_${u.id}`)]));
  rows.push(navRow(`adm_u_${filter}_`, p));
  rows.push([Markup.button.callback('⬅️ Menyu', 'adm_menu'), Markup.button.callback('🔄 Yangilash', `adm_u_${filter}_${p.page}`)]);
  const text =
    `👥 <b>Foydalanuvchilar</b> (${USER_FILTERS[filter]}): <b>${list.length}</b> ta\n\n` +
    (list.length ? `Kerakli odamni bosing (raqam - o'ynagan o'yinlari).` : `Bu bo'limda hech kim yo'q.`) +
    `\n\n🔎 Qidirish: <code>/odam ism</code>, <code>/odam @username</code> yoki <code>/odam ID</code>`;
  return { text, kb: Markup.inlineKeyboard(rows) };
}
function viewUser(id) {
  const u = DB.users[id];
  const back = [Markup.button.callback('⬅️ Foydalanuvchilar', 'adm_u_all_0')];
  if (!u) return { text: 'Foydalanuvchi topilmadi.', kb: Markup.inlineKeyboard([back]) };
  const text =
    `👤 <b>${esc(u.name || 'Nomalum')}</b>${u.username ? ' @' + esc(u.username) : ''}\n` +
    `🆔 <code>${u.id}</code>\n\n` +
    `📅 Birinchi kirgan: ${u.first ? fmtTime(u.first) : '-'}\n` +
    `🕒 Oxirgi faollik: ${u.last ? fmtTime(u.last) : '-'}\n` +
    `🎮 O'ynagan o'yinlari: <b>${u.games || 0}</b>\n` +
    `▶️ Start bosgan: ${u.started ? 'ha' : 'yo\'q'} | 🚫 Botni bloklagan: ${u.blocked ? 'ha' : 'yo\'q'}\n` +
    `⛔ Holat: <b>${u.banned ? 'TAQIQLANGAN' : 'oddiy'}</b>\n\n` +
    `<a href="tg://user?id=${u.id}">Profilini ochish</a>`;
  const rows = [
    [
      u.banned ? Markup.button.callback('✅ Taqiqni olib tashlash', `adm_uu_${u.id}`) : Markup.button.callback('⛔ Taqiqlash', `adm_ub_${u.id}`),
      Markup.button.callback('📩 Xabar yozish', `adm_m_u_${u.id}`)
    ],
    [Markup.button.callback('⬅️ Foydalanuvchilar', 'adm_u_all_0'), Markup.button.callback('🔄 Yangilash', `adm_ui_${u.id}`)]
  ];
  return { text, kb: Markup.inlineKeyboard(rows) };
}
function findUsers(q) {
  q = String(q || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  const all = Object.values(DB.users);
  if (/^\d+$/.test(q) && DB.users[q]) return [DB.users[q]];
  return all
    .filter((u) => String(u.id) === q || (u.username || '').toLowerCase() === q || (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q))
    .sort((a, b) => (b.last || 0) - (a.last || 0))
    .slice(0, PER_PAGE);
}

// ----- guruhlar -----
function viewGroups(page) {
  const list = Object.values(DB.chats).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.last || 0) - (a.last || 0));
  const p = paginate(list, page);
  const rows = p.items.map((c) => [Markup.button.callback(short(`${c.active ? '🏘' : '🚫'} ${c.title || c.id} · 🎮${c.games || 0}`, 48), `adm_gi_${c.id}`)]);
  rows.push(navRow('adm_g_', p));
  rows.push([Markup.button.callback('⬅️ Menyu', 'adm_menu'), Markup.button.callback('🔄 Yangilash', `adm_g_${p.page}`)]);
  const active = list.filter((c) => c.active).length;
  const text =
    `🏘 <b>Guruhlar</b>: faol <b>${active}</b>, jami ${list.length}\n\n` +
    (list.length ? `Guruhni bosing: a'zolar soni, kirish havolasi va boshqaruv tugmalari chiqadi.\n🚫 - bot chiqib ketgan guruh. 🎮 - o'yinlar soni.` : `Hali hech qaysi guruhda ishlatilmagan.`);
  return { text, kb: Markup.inlineKeyboard(rows) };
}
const isGone = (e) => !!(e && e.response && (e.response.error_code === 400 || e.response.error_code === 403));
async function viewGroup(id) {
  const c = DB.chats[id];
  const back = [Markup.button.callback('⬅️ Guruhlar', 'adm_g_0')];
  if (!c) return { text: 'Guruh topilmadi.', kb: Markup.inlineKeyboard([back]) };
  let info = null;
  let offline = false;
  try {
    info = await bot.telegram.getChat(id);
  } catch (e) {
    if (isGone(e)) {
      c.active = false;
      saveSoon();
    } else {
      offline = true;
    }
  }
  let members = null;
  let botStatus = null;
  let canInvite = false;
  let link = '';
  if (info) {
    c.title = info.title || c.title;
    c.active = true;
    members = await memberCount(id);
    try {
      const m = await bot.telegram.getChatMember(id, await botUserId());
      botStatus = m.status;
      canInvite = m.status === 'administrator' && m.can_invite_users !== false;
    } catch (e) {}
    link = await ensureChatLink({ id, username: info.username }, false);
  } else if (c.link) {
    link = c.link;
  }
  const g = games[chatGame[id]];
  const live = g && !g.finished ? g : null;
  const adminLine =
    botStatus === 'administrator'
      ? canInvite
        ? '✅ admin (havola yarata oladi)'
        : '⚠️ admin, lekin "havola orqali taklif qilish" huquqi yo\'q'
      : botStatus
        ? '⚪ oddiy a\'zo (havola uchun admin qilish kerak)'
        : '❓ aniqlanmadi';
  const text =
    `🏘 <b>${esc(c.title || id)}</b>\n` +
    `🆔 <code>${id}</code>${info && info.username ? ' @' + esc(info.username) : ''}\n\n` +
    (info
      ? `👥 A'zolar: <b>${members == null ? '?' : members}</b>\n🤖 Botning huquqi: ${adminLine}\n`
      : offline
        ? `⚠️ Telegram javob bermadi, keyinroq "Yangilash" ni bosing.\n`
        : `🚫 Bot bu guruhda yo'q (chiqarilgan yoki guruh yopilgan).\n`) +
    (link ? `🔗 Havola: ${link}\n` : info ? `🔗 Havola yo'q: botni guruhda admin qiling ("havola orqali taklif qilish" huquqi bilan).\n` : '') +
    `\n🎮 O'yinlar: <b>${c.games || 0}</b>\n` +
    `📅 Qo'shilgan: ${c.first ? fmtTime(c.first) : '-'} | oxirgi: ${c.last ? fmtTime(c.last) : '-'}\n` +
    (live ? `▶️ Hozirgi o'yin: <b>${esc(live.code)}</b>, ${live.players.length} kishi, raund ${live.round}` : `▶️ Hozirgi o'yin: yo'q`);
  const rows = [];
  if (link && /^https?:\/\//.test(link)) rows.push([Markup.button.url('🚪 Guruhga kirish', link)]);
  if (info) {
    const r = [Markup.button.callback('📩 Guruhga xabar', `adm_m_g_${id}`)];
    if (botStatus === 'administrator' && !info.username) r.push(Markup.button.callback('🔗 Yangi havola', `adm_gn_${id}`));
    rows.push(r);
    const r2 = [];
    if (live) r2.push(Markup.button.callback('🛑 O\'yinni to\'xtatish', `adm_gs_${id}`));
    r2.push(Markup.button.callback('🚪 Guruhdan chiqish', `adm_gl_${id}`));
    rows.push(r2);
  }
  rows.push([Markup.button.callback('⬅️ Guruhlar', 'adm_g_0'), Markup.button.callback('🔄 Yangilash', `adm_gi_${id}`)]);
  return { text, kb: Markup.inlineKeyboard(rows) };
}
function viewGroupLeave(id) {
  const c = DB.chats[id];
  return {
    text: `🚪 <b>${esc((c && c.title) || id)}</b> guruhidan chiqaymi?\n\nBot guruhdan chiqadi va u yerdagi o'yin to'xtatiladi. Qaytadan kirish uchun guruh a'zolari botni yana qo'shishi kerak.`,
    kb: Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, chiqish', `adm_gy_${id}`), Markup.button.callback('❌ Yo\'q', `adm_gi_${id}`)]])
  };
}

// ----- o'yinlar va xabar yuborish -----
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
  const n = broadcastTargets().length;
  return {
    text: `📢 <b>Xabar yuborish</b>\n\nBotga start bosgan <b>${n}</b> kishiga xabar yuboriladi (taqiqlanganlarga yuborilmaydi).\n\nBuyruq bilan yozing:\n<code>/xabar Salom! Yangi o'yin qo'shildi 🎉</code>\n\nAvval ko'rib chiqish chiqadi, "Yuborish" tugmasini bosgandan keyingina ketadi.\n\nBitta odamga yoki bitta guruhga yozish uchun uning kartochkasidagi "Xabar" tugmasidan foydalaning.`,
    kb: backKb('bc')
  };
}

// ----- sozlamalar -----
function viewSettings() {
  const s = ensureSettings();
  const lines = SETTING_DEFS.map((d) => `• ${d.label}: <b>${getSetting(d.key)}</b> ${d.unit}`).join('\n');
  const tl = TOGGLE_DEFS.map((t) => `• ${t.label}: <b>${s[t.key] ? 'YOQILGAN' : 'o\'chiq'}</b>`).join('\n');
  const rows = SETTING_DEFS.map((d) => [
    Markup.button.callback('➖', `adm_s_${d.key}_d`),
    Markup.button.callback(`${d.label}: ${getSetting(d.key)}`, 'adm_noop'),
    Markup.button.callback('➕', `adm_s_${d.key}_u`)
  ]);
  TOGGLE_DEFS.forEach((t) => rows.push([Markup.button.callback(`${s[t.key] ? '✅' : '⬜'} ${t.label}`, `adm_t_${t.key}`)]));
  rows.push([Markup.button.callback('♻️ Vaqtlarni asl holiga', 'adm_s_reset'), Markup.button.callback('⬅️ Menyu', 'adm_menu')]);
  return {
    text: `⚙️ <b>Sozlamalar</b>\n\n<b>O'yin:</b>\n${lines}\n\n<b>Bot:</b>\n${tl}\n\n➖ ➕ tugmalari qiymatni o'zgartiradi. Yangi qiymat keyingi bosqichdan boshlab kuchga kiradi va bot qayta ishga tushsa ham saqlanadi.`,
    kb: Markup.inlineKeyboard(rows)
  };
}

const VIEWS = {
  stats: viewStats,
  active: () => viewUsers('active', 0),
  new: () => viewUsers('new', 0),
  chats: () => viewGroups(0),
  live: viewLive,
  bc: viewBroadcast,
  set: viewSettings
};
const viewNew = VIEWS.new;
const viewActive = VIEWS.active;
const viewChats = VIEWS.chats;

async function showView(ctx, v) {
  v = await v;
  const extra = Object.assign({ parse_mode: 'HTML', disable_web_page_preview: true }, v.kb);
  try {
    await ctx.editMessageText(v.text, extra);
  } catch (e) {
    if (!/not modified/i.test(e.message || '')) console.log('panel yangilash xatosi:', e.message);
  }
}
async function sendView(ctx, v) {
  v = await v;
  await ctx.reply(v.text, Object.assign({ parse_mode: 'HTML', disable_web_page_preview: true }, v.kb));
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

// admin tugmalari uchun umumiy o'ram: faqat bot egasi bosa oladi, xatolar botni yiqitmaydi
function adminAction(re, fn) {
  bot.action(re, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('Faqat bot egasi uchun.', { show_alert: true });
    try {
      await fn(ctx);
    } catch (e) {
      console.log('admin xatosi:', e.message);
      try {
        await ctx.answerCbQuery('Xatolik: ' + short(e.message, 150), { show_alert: true });
      } catch (_) {}
    }
  });
}
const idOf = (ctx) => Number(ctx.match[1]);

adminAction(/^adm_(stats|active|new|chats|live|bc|set)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, VIEWS[ctx.match[1]]());
});
adminAction('adm_noop', (ctx) => ctx.answerCbQuery());
adminAction('adm_menu', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(MENU_TEXT, menuKb());
  } catch (e) {}
});
adminAction(/^adm_stop_([A-Z0-9]+)$/, async (ctx) => {
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

// ----- guruhlar -----
adminAction(/^adm_g_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, viewGroups(ctx.match[1]));
});
adminAction(/^adm_gi_(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, viewGroup(idOf(ctx)));
});
adminAction(/^adm_gn_(-?\d+)$/, async (ctx) => {
  const id = idOf(ctx);
  let info;
  try {
    info = await bot.telegram.getChat(id);
  } catch (e) {
    return ctx.answerCbQuery('Guruhga ulanib bo\'lmadi: ' + short(e.message, 120), { show_alert: true });
  }
  const link = await ensureChatLink({ id, username: info.username }, true);
  await ctx.answerCbQuery(link ? 'Yangi havola olindi' : 'Havola yaratib bo\'lmadi: bot admin emas yoki huquqi yo\'q', { show_alert: !link });
  await showView(ctx, viewGroup(id));
});
adminAction(/^adm_gl_(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, viewGroupLeave(idOf(ctx)));
});
adminAction(/^adm_gy_(-?\d+)$/, async (ctx) => {
  const id = idOf(ctx);
  try {
    await bot.telegram.leaveChat(id);
  } catch (e) {
    return ctx.answerCbQuery('Chiqib bo\'lmadi: ' + short(e.message, 120), { show_alert: true });
  }
  const c = DB.chats[id];
  if (c) c.active = false;
  const g = games[chatGame[id]];
  if (g && !g.finished) closeGame(g);
  saveSoon();
  await ctx.answerCbQuery('Guruhdan chiqildi');
  await showView(ctx, viewGroups(0));
});
adminAction(/^adm_gs_(-?\d+)$/, async (ctx) => {
  const id = idOf(ctx);
  const g = games[chatGame[id]];
  if (g && !g.finished) {
    closeGame(g);
    say(id, '🛑 O\'yin bot egasi tomonidan to\'xtatildi. Yangi o\'yin uchun /bunker yozing.');
    await ctx.answerCbQuery('To\'xtatildi');
  } else {
    await ctx.answerCbQuery('Bu guruhda faol o\'yin yo\'q.');
  }
  await showView(ctx, viewGroup(id));
});

// ----- foydalanuvchilar -----
adminAction(/^adm_u_(all|new|active|banned)_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, viewUsers(ctx.match[1], ctx.match[2]));
});
adminAction(/^adm_ui_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showView(ctx, viewUser(idOf(ctx)));
});
adminAction(/^adm_ub_(\d+)$/, async (ctx) => {
  const id = idOf(ctx);
  const u = DB.users[id];
  if (!u) return ctx.answerCbQuery('Foydalanuvchi topilmadi.', { show_alert: true });
  if (id === ADMIN_ID) return ctx.answerCbQuery('Bot egasini taqiqlab bo\'lmaydi.', { show_alert: true });
  u.banned = true;
  saveSoon();
  await ctx.answerCbQuery('Taqiqlandi');
  await showView(ctx, viewUser(id));
});
adminAction(/^adm_uu_(\d+)$/, async (ctx) => {
  const id = idOf(ctx);
  const u = DB.users[id];
  if (!u) return ctx.answerCbQuery('Foydalanuvchi topilmadi.', { show_alert: true });
  u.banned = false;
  saveSoon();
  await ctx.answerCbQuery('Taqiq olib tashlandi');
  await showView(ctx, viewUser(id));
});
bot.command('odam', async (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const q = ctx.message.text.replace(/^\/odam(@\w+)?\s*/i, '').trim();
  if (!q) return ctx.reply('Kimni qidiramiz? Masalan:\n/odam Ali\n/odam @username\n/odam 123456789');
  const found = findUsers(q);
  if (!found.length) return ctx.reply('Hech kim topilmadi.');
  if (found.length === 1) return sendView(ctx, viewUser(found[0].id));
  const rows = found.map((u) => [Markup.button.callback(userLabel(u), `adm_ui_${u.id}`)]);
  rows.push([Markup.button.callback('⬅️ Menyu', 'adm_menu')]);
  await ctx.reply(`🔎 Topildi: ${found.length} ta`, Markup.inlineKeyboard(rows));
});

// ----- bitta odamga yoki bitta guruhga xabar -----
adminAction(/^adm_m_(g|u)_(-?\d+)$/, async (ctx) => {
  const isG = ctx.match[1] === 'g';
  const id = Number(ctx.match[2]);
  const rec = isG ? DB.chats[id] : DB.users[id];
  const label = isG ? (rec && rec.title) || String(id) : (rec && rec.name) || String(id);
  adminInput = { id, label, isG };
  pendingDirect = null;
  await ctx.answerCbQuery();
  await showView(ctx, {
    text: `✍️ <b>${esc(label)}</b> ga yuboriladigan xabarni shu yerga yozing.`,
    kb: Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'adm_mcancel')]])
  });
});
adminAction('adm_mcancel', async (ctx) => {
  adminInput = null;
  pendingDirect = null;
  await ctx.answerCbQuery('Bekor qilindi');
  try {
    await ctx.editMessageText('❌ Xabar yuborish bekor qilindi.');
  } catch (e) {}
});
adminAction('adm_mgo', async (ctx) => {
  const d = pendingDirect;
  if (!d) return ctx.answerCbQuery('Yuboriladigan xabar yo\'q.', { show_alert: true });
  pendingDirect = null;
  let res;
  try {
    await bot.telegram.sendMessage(d.id, d.text);
    res = `✅ Yuborildi: ${d.label}`;
    await ctx.answerCbQuery('Yuborildi');
  } catch (e) {
    if (!d.isG && e && e.response && e.response.error_code === 403 && DB.users[d.id]) {
      DB.users[d.id].blocked = true;
      saveSoon();
    }
    res = `❌ Yuborilmadi (${d.label}): ${short(e.message, 200)}`;
    await ctx.answerCbQuery('Yuborilmadi', { show_alert: true });
  }
  try {
    await ctx.editMessageText(res);
  } catch (e) {}
});

// ----- sozlamalar -----
adminAction(new RegExp(`^adm_s_(${SETTING_DEFS.map((d) => d.key).join('|')})_(d|u)$`), async (ctx) => {
  const d = SETTING_DEFS.find((x) => x.key === ctx.match[1]);
  const up = ctx.match[2] === 'u';
  const cur = getSetting(d.key);
  const next = Math.min(d.max, Math.max(d.min, cur + (up ? d.step : -d.step)));
  if (next === cur) return ctx.answerCbQuery(`Chegara: ${up ? 'eng ko\'pi' : 'eng kami'} ${cur} ${d.unit}`);
  ensureSettings().values[d.key] = next;
  applySettings();
  saveSoon();
  await ctx.answerCbQuery(`${d.label}: ${next} ${d.unit}`);
  await showView(ctx, viewSettings());
});
adminAction('adm_s_reset', async (ctx) => {
  ensureSettings().values = {};
  applySettings();
  saveSoon();
  await ctx.answerCbQuery('Asl holiga qaytarildi');
  await showView(ctx, viewSettings());
});
adminAction(new RegExp(`^adm_t_(${TOGGLE_DEFS.map((t) => t.key).join('|')})$`), async (ctx) => {
  const s = ensureSettings();
  const key = ctx.match[1];
  s[key] = !s[key];
  saveSoon();
  await ctx.answerCbQuery(s[key] ? 'Yoqildi' : 'O\'chirildi');
  await showView(ctx, viewSettings());
});

// ----- hammaga xabar -----
bot.command('xabar', async (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const text = ctx.message.text.replace(/^\/xabar(@\w+)?\s*/i, '').trim();
  if (!text) return ctx.reply('Xabar matnini buyruq bilan birga yozing:\n/xabar Salom! Yangi o\'yin qo\'shildi 🎉');
  pendingBroadcast = text;
  await ctx.reply(
    `📢 Quyidagi xabar ${broadcastTargets().length} kishiga yuboriladi:\n\n${text}`,
    Markup.inlineKeyboard([[Markup.button.callback('✅ Yuborish', 'adm_bc_go'), Markup.button.callback('❌ Bekor qilish', 'adm_bc_cancel')]])
  );
});
adminAction('adm_bc_cancel', async (ctx) => {
  pendingBroadcast = '';
  await ctx.answerCbQuery('Bekor qilindi');
  try {
    await ctx.editMessageText('❌ Xabar yuborish bekor qilindi.');
  } catch (e) {}
});
adminAction('adm_bc_go', async (ctx) => {
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
  try {
    for (const u of broadcastTargets()) {
      try {
        await bot.telegram.sendMessage(u.id, text);
        ok++;
      } catch (e) {
        fail++;
        if (e && e.response && e.response.error_code === 403) u.blocked = true;
      }
      await new Promise((r) => setTimeout(r, BROADCAST_DELAY_MS));
    }
  } finally {
    broadcasting = false;
    saveSoon();
  }
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
    } else if (gone) {
      const c = DB.chats[ctx.chat.id];
      if (c) c.active = false;
      const g = games[chatGame[ctx.chat.id]];
      if (g && !g.finished) closeGame(g);
    } else {
      // bot guruhga qo'shildi yoki admin qilindi -> egaga guruh haqida xabar
      const old = ctx.myChatMember.old_chat_member.status;
      const wasIn = old === 'member' || old === 'administrator' || old === 'creator';
      const promoted = old !== 'administrator' && st === 'administrator';
      trackChat(ctx.chat); // o'rtadagi "yangi guruh" xabari takrorlanmasligi uchun
      if ((!wasIn || promoted) && ensureSettings().notifyGroups) {
        const head = wasIn ? '⭐ Bot guruhda admin qilindi' : '➕ Bot yangi guruhga qo\'shildi';
        const adder = ctx.from ? `\nQo'shgan: ${userLink(ctx.from)}` : '';
        notifyAdmin(head + adder + (await chatInfoHtml(ctx.chat)));
      }
    }
    saveSoon();
  } catch (e) {
    console.log('my_chat_member xatosi:', e.message);
  }
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
const OUT_IMAGES = 3; // assets/out_0..out_2
const DISASTERS = [
  "Yadro urushi: tashqarida zaharli nur, 5 yil yashash kerak",
  "Zombi kasalligi: shaharlar vayron bo'ldi",
  "Osmondan tosh yog'di: quyosh bir necha yil ko'rinmaydi",
  "Katta toshqin: quruqlik deyarli qolmadi",
  "O'lat kasalligi: yer yuzi aholisining ko'pchiligi nobud bo'ldi",
  "Vulqon otildi: osmonni kul qopladi, qattiq sovuq boshlandi"
];

// Fisher-Yates: har bir tartib teng ehtimollik bilan chiqadi (sort(() => random - 0.5) tekis emas)
function shuffle(arr) {
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function drawer(arr) {
  let pool = [];
  return () => {
    if (!pool.length) pool = shuffle(arr);
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

// ---------- RASMLAR ----------
// assets/ papkasidagi rasmlar to'g'ridan-to'g'ri fayldan yuboriladi (internet manzili kerak emas).
// Birinchi yuborishdan keyin Telegram bergan file_id eslab qolinadi: keyingi safar qayta yuklanmaydi.
const ASSET_DIR = path.join(__dirname, 'assets');
const photoIds = {};
const PHOTO_CAPTION_MAX = 1000; // Telegram limiti 1024 belgi
// Rasm bilan yuboradi; rasm bo'lmasa, juda uzun bo'lsa yoki yuborilmasa oddiy matn sifatida yuboradi (o'yin to'xtamaydi)
async function sayPhoto(chatId, name, caption, extra) {
  const file = path.join(ASSET_DIR, name + '.jpg');
  if (caption.length <= PHOTO_CAPTION_MAX && fs.existsSync(file)) {
    let stream = null;
    try {
      let src = photoIds[name];
      if (!src) {
        stream = fs.createReadStream(file);
        src = { source: stream, filename: name + '.jpg' };
      }
      const m = await bot.telegram.sendPhoto(chatId, src, Object.assign({ caption }, extra));
      if (!photoIds[name] && m && m.photo && m.photo.length) photoIds[name] = m.photo[m.photo.length - 1].file_id;
      return m;
    } catch (e) {
      console.log('rasm yuborilmadi:', e && e.message);
      delete photoIds[name]; // file_id eskirgan bo'lishi mumkin: keyingi safar fayldan yuboriladi
      if (stream) stream.destroy();
    }
  }
  return say(chatId, caption, extra);
}

// ---------- O'YIN YORDAMCHILARI ----------
const alive = (g) => g.players.filter((p) => p.alive);
const findPlayer = (g, id) => g.players.find((p) => p.id === id);

// Taymer ichidagi xato butun botni yiqitmasligi uchun: har qanday xato faqat logga yoziladi
function later(ms, fn) {
  const t = setTimeout(() => {
    Promise.resolve()
      .then(fn)
      .catch((e) => console.log('taymer xatosi:', e && e.message));
  }, ms);
  if (t && t.unref) t.unref();
  return t;
}

function newPhase(g, phase) {
  g.phase = phase;
  g.phaseId++;
  clearTimeout(g.timer);
  g.deadline = null;
  liveStopTimers(g);
  return g.phaseId;
}
function setTimer(g, sec, fn) {
  const id = g.phaseId;
  g.phaseSec = sec;
  g.deadline = Date.now() + sec * 1000;
  g.timer = setTimeout(() => {
    if (g.phaseId !== id || g.finished) return;
    Promise.resolve()
      .then(() => fn(g))
      .catch((e) => console.log('taymer xatosi:', e && e.message));
  }, sec * 1000);
}
function closeGame(g) {
  g.finished = true;
  g.phase = 'ended';
  g.phaseId++;
  clearTimeout(g.timer);
  g.deadline = null;
  liveRetire(g);
}

// ---------- JONLI XABAR ----------
// Har bosqichda guruhda BITTA xabar turadi va o'zi yangilanadi: chat to'lib ketmaydi.
// Bosqich almashganda eskisi o'chirilib, yangisi chatning pastiga chiqadi (signal ham boradi).
// Telegram guruhga tahrirlashni cheklaydi (daqiqasiga ~20 ta), shuning uchun yangilashlar siyraklashtiriladi.
const LIVE_MIN_EDIT_MS = Number(process.env.LIVE_MIN_EDIT_MS || 3500);
const LIVE_TICK_MS = Number(process.env.LIVE_TICK_MS || 10000);

const fmtLeft = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
};
// taymer chizig'i: 10 ta bo'lak, qolgan vaqtga mutanosib
function barLine(g) {
  if (!g.deadline) return '';
  const left = Math.max(0, g.deadline - Date.now());
  const total = Math.max(1, (g.phaseSec || 1) * 1000);
  const filled = Math.min(10, Math.max(0, Math.ceil((left / total) * 10)));
  return `⏳ ${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${fmtLeft(left)}`;
}
// muhokamani erta tugatish uchun kerakli "tayyorman" soni: tiriklarning yarmidan ko'pi
const readyNeed = (g) => Math.floor(alive(g).length / 2) + 1;
const voteCounts = (g) => {
  const m = new Map();
  for (const t of g.votes.values()) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

function liveRender(g) {
  if (!g || g.finished || !g.started || !g.disaster) return null;
  const head = `🛡 <b>BUNKER</b> · xona <code>${g.code}</code>\n☢️ ${esc(g.disaster)}\n🚪 Joy: <b>${g.capacity}</b> · 👥 Tirik: <b>${alive(g).length}</b> · 🔔 Raund <b>${g.round}</b>`;
  const bar = barLine(g);
  let body = '';
  let rows = [];
  if (g.phase === 'reveal') {
    const list = alive(g)
      .map((p) => `${g.roundRevealed && g.roundRevealed.has(p.id) ? '✅' : '⏳'} ${esc(p.name)}`)
      .join('\n');
    const done = alive(g).filter((p) => g.roundRevealed && g.roundRevealed.has(p.id)).length;
    body = `📂 <b>${g.step}-karta ochiladi</b>\nHar kim botdagi shaxsiy chatida bitta xususiyatini tanlab ochadi.\n\n${list}\n\nOchganlar: <b>${done}/${alive(g).length}</b>`;
    rows = [[Markup.button.url('🪪 Kartamni ochish', `https://t.me/${BOT_USERNAME}`)]];
  } else if (g.phase === 'discuss') {
    const first = g.step === 1;
    const k = g.ready ? g.ready.size : 0;
    body =
      `💬 <b>MUHOKAMA · ${g.step}-kartadan keyin</b>\nGuruhning ovozli chatida gaplashing: kim bunkerga loyiq emas? Kimning sirini fosh qilasiz?\n\n` +
      `${first ? 'Keyin 2-karta ochiladi.' : 'Keyin ovoz berish boshlanadi.'}\n✅ Tayyor: <b>${k}/${alive(g).length}</b> (tugatish uchun <b>${readyNeed(g)}</b> kishi kerak)`;
    rows = [
      [Markup.button.callback(`✅ Tayyorman (${k}/${readyNeed(g)})`, `ready_${g.code}`)],
      [Markup.button.callback(first ? '⏭ Xona egasi: 2-kartaga o\'tish' : '⏭ Xona egasi: ovozga o\'tish', `skip_${g.code}`)]
    ];
  } else if (g.phase === 'vote') {
    const counts = voteCounts(g);
    const who = voters(g)
      .map((p) => `${g.votes.has(p.id) ? '✅' : '⏳'} ${esc(p.name)}`)
      .join('  ');
    const title = g.revote
      ? `🔁 <b>QAYTA OVOZ</b>\nOvozlar teng bo'ldi. Faqat teng chiqqanlar o'rtasida ovoz beriladi.`
      : `🗳 <b>OVOZ BERISH</b>`;
    body = `${title}\n\nKimni bunkerdan haydaymiz? Tugmani bosing (o'zingizga ovoz bera olmaysiz, ovozni o'zgartirish mumkin).\n\nOvoz berdi: <b>${g.votes.size}/${voters(g).length}</b>\n${who}`;
    const list = g.voteCandidates;
    for (let i = 0; i < list.length; i += 2) {
      rows.push(list.slice(i, i + 2).map((p) => Markup.button.callback(short(`❌ ${p.name} (${counts.get(p.id) || 0})`, 30), `vote_${g.code}_${p.id}`)));
    }
  } else {
    return null;
  }
  const text = `${head}\n\n${body}${bar ? '\n\n' + bar : ''}`;
  const extra = Object.assign({ parse_mode: 'HTML', disable_web_page_preview: true }, rows.length ? Markup.inlineKeyboard(rows) : {});
  return { text, extra, sig: text + JSON.stringify(extra.reply_markup || null) };
}

// jonli xabar ustidagi barcha amallar navbat bilan bajariladi (bir-biriga xalaqit bermaydi)
function liveEnqueue(g, fn) {
  g.liveQ = (g.liveQ || Promise.resolve()).then(fn).catch((e) => console.log('jonli xabar xatosi:', e && e.message));
  return g.liveQ;
}
function liveStopTimers(g) {
  if (g.ticker) clearInterval(g.ticker);
  g.ticker = null;
  if (g.liveTimer) clearTimeout(g.liveTimer);
  g.liveTimer = null;
}
// eski jonli xabarni olib tashlash (o'chirib bo'lmasa, tugmalarsiz "tugadi" deb qoldiramiz)
async function liveDropNow(g) {
  const id = g.liveMsgId;
  g.liveMsgId = null;
  g.liveSig = '';
  if (!id) return;
  try {
    await bot.telegram.deleteMessage(g.chatId, id);
  } catch (e) {
    try {
      await bot.telegram.editMessageText(g.chatId, id, undefined, '✔️ Bosqich tugadi.');
    } catch (e2) {}
  }
}
async function liveSendNew(g) {
  const r = liveRender(g);
  if (!r) return;
  const m = await say(g.chatId, r.text, r.extra);
  if (m && m.message_id) {
    g.liveMsgId = m.message_id;
    g.liveSig = r.sig;
    g.liveAt = Date.now();
  }
}
// yangi bosqich: eskisini olib tashlab, yangisini yuboradi va taymer chizig'ini yurgizadi
function liveOpen(g) {
  return liveEnqueue(g, async () => {
    if (g.finished) return;
    await liveDropNow(g);
    await liveSendNew(g);
    if (g.finished || !g.liveMsgId) return;
    if (g.ticker) clearInterval(g.ticker);
    g.ticker = setInterval(() => liveRefresh(g), LIVE_TICK_MS);
    if (g.ticker.unref) g.ticker.unref();
  });
}
function liveRetire(g) {
  liveStopTimers(g);
  return liveEnqueue(g, () => liveDropNow(g));
}
async function liveEditNow(g) {
  if (g.finished || !g.liveMsgId) return;
  const r = liveRender(g);
  if (!r || r.sig === g.liveSig) return;
  try {
    await bot.telegram.editMessageText(g.chatId, g.liveMsgId, undefined, r.text, r.extra);
    g.liveSig = r.sig;
    g.liveAt = Date.now();
  } catch (e) {
    const resp = e && e.response;
    const d = (resp && resp.description) || (e && e.message) || '';
    if (/not modified/i.test(d)) {
      g.liveSig = r.sig;
      g.liveAt = Date.now();
    } else if (resp && resp.error_code === 429) {
      g.liveAt = Date.now() + (((resp.parameters && resp.parameters.retry_after) || 5) * 1000);
    } else if (/not found|can't be edited|MESSAGE_ID_INVALID/i.test(d)) {
      // xabar o'chirib yuborilgan: yangisini chiqaramiz
      g.liveMsgId = null;
      await liveSendNew(g);
    } else {
      console.log('jonli xabar tahrir xatosi:', d);
    }
  }
}
// o'zgarish bo'lganda chaqiriladi; tez-tez chaqirilsa ham Telegram'ga kamida LIVE_MIN_EDIT_MS oralig'ida boradi
function liveRefresh(g) {
  if (g.finished || !g.liveMsgId) return;
  const wait = LIVE_MIN_EDIT_MS - (Date.now() - (g.liveAt || 0));
  if (wait <= 0) return liveEnqueue(g, () => liveEditNow(g));
  if (g.liveTimer) return;
  g.liveTimer = later(wait, () => {
    g.liveTimer = null;
    return liveEnqueue(g, () => liveEditNow(g));
  });
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
// "Avtomexanik (har qanday mashinani tuzatadi)" -> asosiy qism va izoh
function splitHint(v) {
  const m = String(v).match(/^(.*?)\s*\((.*)\)\s*$/);
  return m ? { main: m[1], hint: m[2] } : { main: String(v), hint: '' };
}
// Karta matni (HTML): qalin sarlavha, izoh alohida qatorda kursivda
function cardText(g, p, prompt) {
  const lines = ATTRS.map((a) => {
    const open = p.revealed.includes(a.key);
    const { main, hint } = splitHint(p.card[a.key]);
    return `${open ? '👁' : '🔒'} <b>${a.label}:</b> ${esc(main)}` + (hint ? `\n      <i>${esc(hint)}</i>` : '');
  }).join('\n');
  let t = `🪪 <b>SIZNING KARTANGIZ</b> · raund ${g.round}\n━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━\n🔒 faqat siz ko'rasiz   👁 hammaga ochiq`;
  if (prompt) t += `\n\n👉 <b>${g.step}-karta:</b> bitta xususiyatni tanlab oching (${REVEAL_SEC} soniya)`;
  return t;
}

// Guruhga qaytish havolasi: ochiq guruh (username) yoki yopiq superguruh (t.me/c/...)
function groupLink(g) {
  if (g.chatUsername) return `https://t.me/${g.chatUsername}`;
  const id = String(g.chatId);
  if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}`;
  return null;
}
function backRow(g) {
  const link = g && groupLink(g);
  return link ? [Markup.button.url('⬅️ Guruhga qaytish', link)] : null;
}
// HTML rejimidagi xabar uchun qo'shimcha parametrlar (tugmalar bilan)
function htmlKb(rows) {
  const clean = rows.filter(Boolean);
  return clean.length ? Object.assign({ parse_mode: 'HTML' }, Markup.inlineKeyboard(clean)) : { parse_mode: 'HTML' };
}
function revealKeyboard(g, p) {
  const left = ATTRS.filter((a) => !p.revealed.includes(a.key));
  const rows = [];
  for (let i = 0; i < left.length; i += 2) {
    rows.push(left.slice(i, i + 2).map((a) => Markup.button.callback(`${a.icon} ${a.label}`, `rev_${g.code}_${a.key}`)));
  }
  rows.push(backRow(g));
  return htmlKb(rows);
}

async function beginGame(g) {
  if (g.finished) return;
  g.started = true;
  g.disasterIdx = Math.floor(Math.random() * DISASTERS.length);
  g.disaster = DISASTERS[g.disasterIdx];
  g.capacity = WINNERS;
  const draws = makeDraws();
  g.players.forEach((p) => {
    p.card = makeCard(draws);
    p.revealed = [];
    p.fresh = null;
    p.alive = true;
    p.votesAgainst = 0;
  });
  recordGameStart(g);
  await edit(g.chatId, g.msgId, `🛡 Xona ${g.code} - o'yin boshlandi`);
  await sayPhoto(
    g.chatId,
    `disaster_${g.disasterIdx}`,
    `🛡 O'YIN BOSHLANDI!\n\n☢️ Falokat: ${g.disaster}\n\n🚪 Bunkerda joy: ${g.capacity} kishi\n👥 O'yinchilar: ${g.players.length}\n\nOxirida faqat ${g.capacity} kishi bunkerga kiradi. Har raundda bitta o'yinchi haydaladi.`
  );
  await startRound(g);
}

// hamma tirik o'yinchining barcha kartasi allaqachon ochiq bo'lsa, ochadigan hech narsa qolmagan
const nothingToReveal = (g) => alive(g).every((p) => p.revealed.length >= ATTRS.length);

async function startRound(g) {
  if (g.finished) return;
  if (alive(g).length <= g.capacity) return finishGame(g);
  g.round++;
  g.step = 1;
  // 8 ta xususiyat 4 raundga yetadi; undan keyingi raundlarda ochish bosqichi o'tkazib yuboriladi
  if (nothingToReveal(g)) {
    g.step = 2;
    return startDiscuss(g);
  }
  await startReveal(g);
}

async function startReveal(g) {
  if (g.finished) return;
  g.roundRevealed = new Set();
  newPhase(g, 'reveal');
  const need = [];
  for (const p of alive(g)) {
    p.fresh = null;
    if (p.revealed.length >= ATTRS.length) g.roundRevealed.add(p.id);
    else need.push(p);
  }
  if (!need.length) return endReveal(g);
  setTimer(g, REVEAL_SEC, endReveal);
  await liveOpen(g);
  for (const p of need) {
    if (g.finished || g.phase !== 'reveal') break; // vaqt tugab bo'lgan bo'lsa eskirgan karta yubormaymiz
    await say(p.id, cardText(g, p, true), revealKeyboard(g, p));
  }
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
  p.fresh = key;
  g.roundRevealed.add(p.id);
  liveRefresh(g);
  if (alive(g).every((x) => g.roundRevealed.has(x.id))) {
    later(500, () => endReveal(g));
  }
  return { ok: true, text: 'Ochildi!' };
}

async function endReveal(g) {
  if (g.finished || g.phase !== 'reveal') return;
  newPhase(g, 'summary');
  await liveRetire(g);
  // Vaqtida tanlamaganlar uchun karta o'zi ochilmaydi, shunchaki o'tkazib yuboriladi
  const skipped = alive(g).filter((p) => !g.roundRevealed.has(p.id));
  skipped.forEach((p) => g.roundRevealed.add(p.id));
  // yangi ochilgani to'liq izoh bilan, avvalgilari qisqa ko'rinadi (xabar uzun bo'lib ketmasligi uchun)
  const summary = alive(g)
    .map((p) => {
      const open = ATTRS.filter((a) => p.revealed.includes(a.key))
        .map((a) => (p.fresh === a.key ? `   ${attrLine(p.card, a)} 🆕` : `   ${a.icon} ${a.label}: ${splitHint(p.card[a.key]).main}`))
        .join('\n');
      return `👤 ${p.name}\n${open || '   (hali hech narsa ochmagan)'}`;
    })
    .join('\n\n');
  const skipLine = skipped.length ? `\n\n⏰ Vaqtida karta ochmadi: ${skipped.map((p) => p.name).join(', ')}. Ular bu bosqichda yangi ma'lumot ochmadi.` : '';
  await say(g.chatId, `📋 RAUND ${g.round} (${g.step}-karta) HOLATI\n\n${summary}${skipLine}\n\n🚪 Bunkerda joy: ${g.capacity} | 👥 Tirik: ${alive(g).length}`);
  await startDiscuss(g);
}

async function startDiscuss(g) {
  if (g.finished) return;
  newPhase(g, 'discuss');
  g.ready = new Set();
  setTimer(g, g.step === 1 ? DISCUSS1_SEC : DISCUSS2_SEC, afterDiscuss);
  await liveOpen(g);
}

// Muhokamadan keyin: 1-karta bo'lsa 2-kartaga, 2-karta bo'lsa ovoz berishga
async function afterDiscuss(g) {
  if (g.finished || g.phase !== 'discuss') return;
  if (g.step === 1) {
    g.step = 2;
    if (nothingToReveal(g)) return startVote(g);
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
  setTimer(g, tied ? REVOTE_SEC : VOTE_SEC, endVote);
  await liveOpen(g);
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
  liveRefresh(g);
  if (g.votes.size >= voters(g).length) later(500, () => endVote(g));
  return { ok: true, text: `Ovoz qabul qilindi: ${target.name}` };
}

async function endVote(g) {
  if (g.finished || g.phase !== 'vote') return;
  newPhase(g, 'counting');
  await liveRetire(g);
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
    if (tally.size === 0) note = 'Hech kim ovoz bermadi, shuning uchun tasodif bilan tanlandi.';
    else
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
  const last = alive(g).length <= g.capacity;
  const head = `📊 OVOZ NATIJASI\n\n${results}\n${note ? '\n' + note + '\n' : ''}\n☠️ BUNKERDAN HAYDALDI: ${out.name}`;
  const tail = `🪪 Uning to'liq kartasi:\n${fullCard}` + (last ? '' : `\n\n⏳ Keyingi raund ${BETWEEN_SEC} soniyadan keyin boshlanadi...`);
  const img = `out_${Math.floor(Math.random() * OUT_IMAGES)}`;
  if (head.length <= PHOTO_CAPTION_MAX) {
    // rasm ostida natija, keyingi xabarda haydalganning kartasi
    await sayPhoto(g.chatId, img, head);
    await say(g.chatId, tail);
  } else {
    // natija rasm ostiga sig'masa (ko'p o'yinchi): rasm qisqa, natija alohida xabarda
    await sayPhoto(g.chatId, img, `☠️ BUNKERDAN HAYDALDI: ${out.name}`);
    await say(g.chatId, `${head}\n\n${tail}`);
  }
  await say(out.id, '☠️ Siz bunkerdan haydaldingiz. Guruhda o\'yinni kuzatishda davom eting.');

  if (last) return finishGame(g);
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
  await sayPhoto(g.chatId, 'win', `🏁 O'YIN TUGADI!\n\n🏆 BUNKERGA KIRGANLAR: ${winners.map((p) => p.name).join(', ')}`);
  await say(
    g.chatId,
    `☢️ Falokat: ${g.disaster}\n\n🏆 BUNKERGA KIRGANLAR (omon qoldi):\n\n${winText}\n\n☠️ Haydalganlar (tartib bilan):\n${outText}\n\n📊 Statistika: ${g.round} raund, ${g.players.length} o'yinchi, ${g.capacity} ta joy.\n\nYangi o'yin uchun /bunker yozing.`,
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

⏰ Vaqtida karta ochmasangiz, o'tkazib yuboriladi va boshqalar sizdan gumon qiladi.

⚡ Hamma karta ochsa yoki hamma ovoz bersa, vaqt kutilmaydi.
♾ 8 ta xususiyat 4 raundga yetadi. Hamma kartasi ochilgach, raundlar faqat muhokama va ovozdan iborat bo'ladi.`,

`📖 QOIDALAR 5/6 - MUHOKAMA

Bu o'yinning eng qiziq qismi. Ovozli chatda gaplashing:

• O'zingiz nega kerakligingizni tushuntiring: "Men shifokorman, kasallarni davolayman"
• Boshqalarning kamchiligini aytib, ularni gumon ostiga oling
• Yolg'on gapirish mumkin! Lekin ochilgan kartangiz bilan qarama-qarshi bo'lmasin
• Falokatga qarab fikr yuriting: kasallik tarqalsa shifokor kerak, urushda askar
• Gapingiz tugasa "✅ Tayyorman" tugmasini bosing: tiriklarning yarmidan ko'pi bossa, muhokama tugaydi

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
  if (ensureSettings().maintenance && !isAdmin(ctx)) {
    return ctx.reply('🛠 Bot hozir texnik ishlar uchun vaqtincha yopiq. Birozdan keyin qayta urinib ko\'ring.');
  }
  const old = games[chatGame[ctx.chat.id]];
  if (old && !old.finished) {
    // davom etayotgan o'yinni tasodifan o'chirib yubormaslik uchun yangi xona ochilmaydi
    if (old.started) {
      return ctx.reply(`⚠️ Bu guruhda o'yin davom etmoqda (xona ${old.code}). To'xtatish uchun xona egasi yoki guruh admini /stop yozadi.`);
    }
    // xona ochiq turibdi: uni chatning pastiga qayta chiqaramiz
    const m = await ctx.reply(lobbyText(old), lobbyKeyboard(old));
    const prev = old.msgId;
    old.msgId = m.message_id;
    if (prev) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, prev);
      } catch (e) {}
    }
    return;
  }
  const g = createRoom(ctx.chat.id, ctx.from.id);
  g.chatUsername = ctx.chat.username || null;
  const msg = await ctx.reply(lobbyText(g), lobbyKeyboard(g));
  g.msgId = msg.message_id;
});

// xona egasi yoki guruh adminimi?
async function canManage(ctx, g) {
  if (ctx.from.id === g.hostId) return true;
  try {
    const m = await ctx.telegram.getChatMember(g.chatId, ctx.from.id);
    return ['creator', 'administrator'].includes(m.status);
  } catch (e) {
    return false;
  }
}

bot.command('stop', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  const g = games[chatGame[ctx.chat.id]];
  if (!g || g.finished) return ctx.reply('Ochiq o\'yin yo\'q.');
  if (!(await canManage(ctx, g))) return ctx.reply('Faqat xona egasi yoki guruh adminlari to\'xtata oladi.');
  if (g.finished) return;
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
  await ctx.reply(r.text, htmlKb([backRow(g)]));
  if (r.ok) refreshLobby(g);
});

bot.action(/^start_([A-Z0-9]+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.started || g.finished) return ctx.answerCbQuery('O\'yin boshlangan yoki yopilgan.');
  if (!(await canManage(ctx, g))) {
    return ctx.answerCbQuery('Faqat xona egasi yoki guruh adminlari boshlaydi.', { show_alert: true });
  }
  // yuqoridagi tekshiruvda kutish bo'lgani uchun holatni qayta tekshiramiz (ikki marta bosilsa, o'yin ikki marta boshlanmasin)
  if (g.started || g.finished) return ctx.answerCbQuery('O\'yin boshlangan yoki yopilgan.');
  if (g.players.length < MIN_PLAYERS) {
    return ctx.answerCbQuery(`Kamida ${MIN_PLAYERS} o'yinchi kerak.`, { show_alert: true });
  }
  g.started = true;
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
    await ctx.editMessageText(cardText(g, p, false), htmlKb([backRow(g)]));
  } catch (e) {}
});

bot.action(/^skip_([A-Z0-9]+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.finished || g.phase !== 'discuss') return ctx.answerCbQuery('Muhokama tugagan.');
  if (!(await canManage(ctx, g))) {
    return ctx.answerCbQuery('Faqat xona egasi yoki guruh adminlari o\'tkaza oladi.', { show_alert: true });
  }
  await ctx.answerCbQuery();
  await afterDiscuss(g);
});

// "Tayyorman": tiriklarning yarmidan ko'pi bossa, muhokama tugaydi
bot.action(/^ready_([A-Z0-9]+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  if (!g || g.finished || g.phase !== 'discuss') return ctx.answerCbQuery('Muhokama tugagan.');
  const p = findPlayer(g, ctx.from.id);
  if (!p || !p.alive) return ctx.answerCbQuery('Faqat tirik o\'yinchilar bosa oladi.', { show_alert: true });
  const on = !g.ready.has(p.id);
  if (on) g.ready.add(p.id);
  else g.ready.delete(p.id);
  await ctx.answerCbQuery(on ? 'Siz tayyorsiz ✅' : 'Tayyorlik bekor qilindi');
  if (g.finished || g.phase !== 'discuss') return;
  if (g.ready.size >= readyNeed(g)) return afterDiscuss(g);
  liveRefresh(g);
});

bot.action(/^vote_([A-Z0-9]+)_(\d+)$/, async (ctx) => {
  const g = games[ctx.match[1]];
  const r = await castVote(g, ctx.from.id, Number(ctx.match[2]));
  return ctx.answerCbQuery(r.text, { show_alert: !r.ok });
});

// bot egasi "Xabar yozish" tugmasini bosgandan keyin yozgan oddiy matn -> ko'rib chiqish va tasdiqlash
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if (ctx.chat.type !== 'private' || !isAdmin(ctx) || !adminInput || text.startsWith('/')) return next();
  if (text.length > 4000) return ctx.reply('Xabar juda uzun (4000 belgidan oshmasin). Qisqaroq yozing.');
  pendingDirect = { id: adminInput.id, label: adminInput.label, isG: adminInput.isG, text };
  adminInput = null;
  await ctx.reply(
    `📩 "${pendingDirect.label}" ga quyidagi xabar yuboriladi:\n\n${short(text, 3000)}`,
    Markup.inlineKeyboard([[Markup.button.callback('✅ Yuborish', 'adm_mgo'), Markup.button.callback('❌ Bekor qilish', 'adm_mcancel')]])
  );
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
  // kutilmagan xato butun botni (va barcha o'yinlarni) to'xtatib qo'ymasligi uchun
  process.on('unhandledRejection', (e) => console.log('Ushlanmagan xato:', e && e.message));
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
      const g = games[code];
      // tashlab ketilgan xonalar (3 soat) va juda uzoq cho'zilgan o'yinlar (6 soat) yopiladi
      if (!g.finished && now - g.createdAt > (g.started ? 6 : 3) * 3600 * 1000) closeGame(g);
      if (g.finished && now - g.createdAt > 3600 * 1000) delete games[code];
    }
  }, 600 * 1000);
}

module.exports = { _game: { DISASTERS, ASSET_DIR, OUT_IMAGES, sayPhoto, photoIds, liveRender, startRound, afterDiscuss, startVote, endVote, finishGame, nothingToReveal, readyNeed, barLine, shuffle, setTimer }, _admin: { trackMiddleware, trackUser, trackChat, loadDB, saveNow, getDB: () => DB, viewStats, viewNew, viewActive, viewChats, viewLive, viewBroadcast, viewUsers, viewUser, viewGroups, viewGroup, viewSettings, findUsers, ensureSettings, getSetting, applySettings, SETTING_DEFS, getLimits: () => ({ MIN_PLAYERS, REVEAL_SEC, DISCUSS1_SEC, DISCUSS2_SEC, VOTE_SEC, REVOTE_SEC, BETWEEN_SEC }) }, bot, games, chatGame, createRoom, joinPlayer, beginGame, revealAttr, castVote, alive, findPlayer };
