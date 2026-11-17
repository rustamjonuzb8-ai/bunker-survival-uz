// Soxta Telegram: telegraf va express o'rnatilmagan bo'lsa ham server.js ni to'liq sinash uchun.
// Haqiqiy Telegram'ga hech narsa yuborilmaydi: barcha chaqiruvlar yozib boriladi.
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ADMIN_ID = 111;
const DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bunker-test-')), 'data.json');
process.env.ADMIN_ID = String(ADMIN_ID);
process.env.BOT_TOKEN = 'test-token';
process.env.DATA_FILE = DATA_FILE;
process.env.BROADCAST_DELAY_MS = '0';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const Markup = {
  inlineKeyboard: (rows) => ({ reply_markup: { inline_keyboard: rows } }),
  keyboard: (rows) => {
    const m = { reply_markup: { keyboard: rows } };
    m.resize = () => m;
    m.persistent = () => m;
    return m;
  },
  button: {
    callback: (text, data) => ({ text, callback_data: data }),
    url: (text, url) => ({ text, url })
  }
};

const world = { chats: {}, sent: [], left: [], edits: [], deleted: [], photos: [], photoFail: false, msgSeq: 100, linkSeq: 0, blocked: new Set(), editFail: null, deleteFail: false };
const apiError = (code, msg) => Object.assign(new Error(msg), { response: { error_code: code, description: msg } });

const telegram = {
  async sendMessage(id, text, extra) {
    if (world.blocked.has(id)) throw apiError(403, 'Forbidden: bot was blocked by the user');
    const mid = ++world.msgSeq;
    world.sent.push({ id, text, extra, mid });
    return { message_id: mid };
  },
  async sendPhoto(id, src, extra) {
    if (world.photoFail) throw apiError(400, 'Bad Request: wrong file identifier');
    const mid = ++world.msgSeq;
    const isFile = typeof src === 'object';
    if (isFile && src.source && src.source.destroy) src.source.destroy();
    world.photos.push({ id, name: isFile ? src.filename : null, fileId: isFile ? null : src, caption: extra && extra.caption, mid });
    return { message_id: mid, photo: [{ file_id: 'FID' + mid }] };
  },
  async editMessageText(chatId, msgId, inline, text, extra) {
    world.edits.push({ chatId, msgId, text, extra });
    if (world.editFail) throw world.editFail;
  },
  async deleteMessage(chatId, msgId) {
    world.deleted.push({ chatId, msgId });
    if (world.deleteFail) throw apiError(400, "Bad Request: message can't be deleted");
    return true;
  },
  async getMe() {
    return { id: 999, username: 'Bunkeruz1_bot' };
  },
  async getChat(id) {
    const c = world.chats[id];
    if (!c) throw apiError(400, 'Bad Request: chat not found');
    if (c.down) throw new Error('ETIMEDOUT');
    return { id, title: c.title, username: c.username, type: 'supergroup' };
  },
  async callApi(method, payload) {
    if (method === 'getChatMemberCount') {
      const c = world.chats[payload.chat_id];
      if (!c) throw apiError(400, 'Bad Request: chat not found');
      return c.count;
    }
    throw new Error('mock: noma\'lum metod ' + method);
  },
  async getChatMember(id) {
    const c = world.chats[id];
    if (!c) throw apiError(400, 'Bad Request: chat not found');
    return { status: c.botStatus, can_invite_users: c.canInvite };
  },
  async exportChatInviteLink(id) {
    const c = world.chats[id];
    if (!c || c.botStatus !== 'administrator' || !c.canInvite) throw apiError(400, 'Bad Request: not enough rights');
    world.linkSeq++;
    return `https://t.me/+LINK${world.linkSeq}`;
  },
  async leaveChat(id) {
    if (!world.chats[id]) throw apiError(400, 'Bad Request: chat not found');
    world.left.push(id);
    return true;
  }
};

class FakeTelegraf {
  constructor() {
    this.handlers = [];
    this.telegram = telegram;
    this.botInfo = { id: 999, username: 'Bunkeruz1_bot' };
  }
  use(fn) {
    this.handlers.push({ kind: 'use', fn });
  }
  command(name, fn) {
    this.handlers.push({ kind: 'command', name, fn });
  }
  start(fn) {
    this.handlers.push({ kind: 'command', name: 'start', fn });
  }
  action(trigger, fn) {
    this.handlers.push({ kind: 'action', trigger, fn });
  }
  hears(trigger, fn) {
    this.handlers.push({ kind: 'hears', trigger, fn });
  }
  on(event, fn) {
    this.handlers.push({ kind: 'on', event, fn });
  }
  catch() {}
  launch() {
    return Promise.resolve();
  }
  stop() {}

  async handleUpdate(update) {
    const ctx = { update, telegram, replies: [], edits: [], answers: [], match: null, startPayload: '' };
    if (update.message) {
      ctx.updateType = 'message';
      ctx.message = update.message;
      ctx.chat = update.message.chat;
      ctx.from = update.message.from;
    } else if (update.callback_query) {
      ctx.updateType = 'callback_query';
      ctx.callbackQuery = update.callback_query;
      ctx.chat = update.callback_query.message.chat;
      ctx.from = update.callback_query.from;
    } else if (update.my_chat_member) {
      ctx.updateType = 'my_chat_member';
      ctx.myChatMember = update.my_chat_member;
      ctx.chat = update.my_chat_member.chat;
      ctx.from = update.my_chat_member.from;
    }
    ctx.reply = async (text, extra) => {
      ctx.replies.push({ text, extra });
      return { message_id: ++world.msgSeq };
    };
    ctx.editMessageText = async (text, extra) => {
      ctx.edits.push({ text, extra });
    };
    ctx.answerCbQuery = async (text, extra) => {
      ctx.answers.push({ text, extra });
    };

    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : null;
    const chain = [];
    for (const h of this.handlers) {
      if (h.kind === 'use') chain.push(h);
      else if (h.kind === 'command' && text !== null) {
        const m = new RegExp(`^/${h.name}(@\\w+)?(\\s+(.*))?$`, 's').exec(text);
        if (m) chain.push(Object.assign({}, h, { payload: m[3] || '' }));
      } else if (h.kind === 'action' && ctx.callbackQuery) {
        const d = ctx.callbackQuery.data;
        if (typeof h.trigger === 'string') {
          if (h.trigger === d) chain.push(Object.assign({}, h, { match: [d] }));
        } else {
          const m = h.trigger.exec(d);
          if (m) chain.push(Object.assign({}, h, { match: m }));
        }
      } else if (h.kind === 'hears' && text !== null) {
        const ok = Array.isArray(h.trigger) ? h.trigger.includes(text) : typeof h.trigger === 'string' ? h.trigger === text : h.trigger.test(text);
        if (ok) chain.push(h);
      } else if (h.kind === 'on') {
        if (h.event === 'text' && text !== null) chain.push(h);
        if (h.event === 'my_chat_member' && ctx.myChatMember) chain.push(h);
        if (h.event === 'callback_query' && ctx.callbackQuery) chain.push(h);
      }
    }
    let i = 0;
    const run = async () => {
      const h = chain[i++];
      if (!h) return;
      if (h.match) ctx.match = h.match;
      if (h.kind === 'command' && h.name === 'start') ctx.startPayload = h.payload;
      await h.fn(ctx, run);
    };
    await run();
    return ctx;
  }
}

const fakeExpress = () => ({ get() {}, listen() {} });

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'telegraf') return { Telegraf: FakeTelegraf, Markup };
  if (request === 'express') return fakeExpress;
  return origLoad.apply(this, arguments);
};

const server = require('../server.js');

// ---------- test yordamchilari ----------
const ADMIN = { id: ADMIN_ID, first_name: 'Egasi', username: 'owner' };
const user = (id, name, username) => ({ id, first_name: name || 'Odam' + id, username });
const privateChat = (id) => ({ id, type: 'private' });
const groupChat = (id, title, username) => ({ id, type: 'supergroup', title: title || 'Guruh ' + id, username });

let msgSeq = 0;
const say = (from, text, chat) =>
  server.bot.handleUpdate({ message: { message_id: ++msgSeq, text, from, chat: chat || privateChat(from.id) } });
const click = (from, data, chat) =>
  server.bot.handleUpdate({
    callback_query: { id: String(++msgSeq), from, data, message: { message_id: 1, chat: chat || privateChat(from.id) } }
  });
const adminSay = (text) => say(ADMIN, text);
const adminClick = (data) => click(ADMIN, data);
const memberUpdate = (chat, from, oldStatus, newStatus) =>
  server.bot.handleUpdate({
    my_chat_member: { chat, from, old_chat_member: { status: oldStatus }, new_chat_member: { status: newStatus } }
  });

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const buttonsOf = (msg) => {
  const kb = msg && msg.extra && msg.extra.reply_markup && msg.extra.reply_markup.inline_keyboard;
  return kb ? [].concat(...kb) : [];
};
const allDataOf = (msg) => buttonsOf(msg).map((b) => b.callback_data).filter(Boolean);
const lastEdit = (ctx) => ctx.edits[ctx.edits.length - 1];

function reset() {
  const DB = server._admin.getDB();
  DB.users = {};
  DB.chats = {};
  DB.settings = undefined;
  DB.gamesStarted = 0;
  DB.gamesFinished = 0;
  DB.kickedAfk = 0;
  server._admin.ensureSettings();
  server._admin.applySettings();
  Object.keys(server.games).forEach((k) => delete server.games[k]);
  Object.keys(server.chatGame).forEach((k) => delete server.chatGame[k]);
  world.chats = {};
  world.sent.length = 0;
  world.left.length = 0;
  world.edits.length = 0;
  world.photos.length = 0;
  world.photoFail = false;
  world.deleted.length = 0;
  world.editFail = null;
  world.deleteFail = false;
  world.linkSeq = 0;
  world.blocked = new Set();
}
function seedUsers(n, extra) {
  const DB = server._admin.getDB();
  for (let i = 1; i <= n; i++) {
    DB.users[1000 + i] = Object.assign(
      { id: 1000 + i, name: 'Ali' + i, username: 'ali' + i, first: 1e12 + i * 1000, last: Date.now() - i * 1000, games: i % 3, started: true, blocked: false },
      extra || {}
    );
  }
}
function seedChats(n) {
  const DB = server._admin.getDB();
  for (let i = 1; i <= n; i++) {
    DB.chats[-1001000000000 - i] = { id: -1001000000000 - i, title: 'Guruh ' + i, first: 1e12, last: Date.now() - i * 1000, games: i, active: true };
  }
}

module.exports = {
  server, world, ADMIN, ADMIN_ID, DATA_FILE, apiError, user, privateChat, groupChat, say, click, adminSay, adminClick,
  memberUpdate, flush, buttonsOf, allDataOf, lastEdit, reset, seedUsers, seedChats
};
