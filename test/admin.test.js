const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const H = require('./helpers.js');
const { server, world, ADMIN, ADMIN_ID } = H;
const A = server._admin;

test.beforeEach(() => H.reset());

const strangers = H.user(555, 'Begona', 'begona');

// ---------- kirish va xavfsizlik ----------
test('/admin: egasiga menyu chiqadi, 6 ta bo\'lim', async () => {
  const ctx = await H.adminSay('/admin');
  assert.equal(ctx.replies.length, 1);
  assert.deepEqual(H.allDataOf(ctx.replies[0]), ['adm_stats', 'adm_g_0', 'adm_u_all_0', 'adm_live', 'adm_bc', 'adm_set']);
});

test('/admin: begona odamga rad javobi, guruhda jim', async () => {
  const ctx = await H.say(strangers, '/admin');
  assert.match(ctx.replies[0].text, /faqat bot egasi/);
  const g = await H.say(strangers, '/admin', H.groupChat(-100777));
  assert.equal(g.replies.length, 0);
});

test('begona odam hech bir admin tugmasini bosa olmaydi', async () => {
  H.seedUsers(2);
  H.seedChats(2);
  const data = [
    'adm_stats', 'adm_menu', 'adm_noop', 'adm_g_0', 'adm_gi_-1001000000001', 'adm_gn_-1001000000001', 'adm_gl_-1001000000001',
    'adm_gy_-1001000000001', 'adm_gs_-1001000000001', 'adm_u_all_0', 'adm_u_banned_0', 'adm_ui_1001', 'adm_ub_1001', 'adm_uu_1001',
    'adm_m_g_-1001000000001', 'adm_m_u_1001', 'adm_mgo', 'adm_mcancel', 'adm_s_minPlayers_u', 'adm_s_reset', 'adm_t_maintenance',
    'adm_bc_go', 'adm_bc_cancel', 'adm_stop_ABCD', 'adm_set', 'adm_live', 'adm_bc'
  ];
  const before = JSON.stringify(A.getDB());
  for (const d of data) {
    const ctx = await H.click(strangers, d);
    assert.equal(ctx.edits.length, 0, d + ': tahrirlanmasligi kerak');
    assert.equal(ctx.answers.length, 1, d);
    assert.match(ctx.answers[0].text, /faqat bot egasi/i, d);
  }
  assert.equal(world.sent.length, 0);
  assert.equal(world.left.length, 0);
  // begona odam bosgani sababli faqat "oxirgi faollik" yozilishi mumkin; sozlama va taqiqlar o'zgarmasligi kerak
  const after = A.getDB();
  assert.equal(after.users[1001].banned, undefined);
  assert.equal(A.getSetting('minPlayers'), 4);
  assert.notEqual(before, undefined);
});

test('begona odamning oddiy matni xabar yuborishga aylanmaydi', async () => {
  await H.adminClick('adm_m_u_1001'); // egasi xabar yozish holatida
  const ctx = await H.say(strangers, 'salom');
  assert.equal(ctx.replies.length, 0);
});

test('barcha tugmalar callback_data 64 baytdan oshmaydi', async () => {
  H.seedUsers(30);
  H.seedChats(30);
  const id = -1001999999999;
  world.chats[id] = { title: 'Yopiq', count: 5, botStatus: 'administrator', canInvite: true };
  A.getDB().chats[id] = { id, title: 'Yopiq', first: 1, last: 2, games: 0, active: true };
  const views = [A.viewStats(), A.viewUsers('all', 1), A.viewUser(1001), A.viewGroups(2), await A.viewGroup(id), A.viewSettings()];
  for (const v of views) {
    for (const b of [].concat(...v.kb.reply_markup.inline_keyboard)) {
      if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
    }
  }
});

// ---------- foydalanuvchilar ----------
test('foydalanuvchilar: sahifalash 8 tadan, tugmalar to\'g\'ri', async () => {
  H.seedUsers(20);
  let ctx = await H.adminClick('adm_u_all_0');
  let e = H.lastEdit(ctx);
  assert.match(e.text, /Foydalanuvchilar.*21/); // 20 ta + bot egasining o'zi
  const rows = e.extra.reply_markup.inline_keyboard;
  assert.equal(rows.filter((r) => r[0].callback_data.startsWith('adm_ui_')).length, 8);
  assert.ok(H.allDataOf(e).includes('adm_u_all_1'));
  ctx = await H.adminClick('adm_u_all_2');
  e = H.lastEdit(ctx);
  assert.equal(e.extra.reply_markup.inline_keyboard.filter((r) => r[0].callback_data.startsWith('adm_ui_')).length, 5);
  assert.ok(!H.allDataOf(e).includes('adm_u_all_3'));
  // chegaradan tashqari sahifa xavfsiz
  ctx = await H.adminClick('adm_u_all_99');
  assert.match(H.lastEdit(ctx).text, /Foydalanuvchilar/);
});

test('foydalanuvchilar: filtrlar (yangi, faol, taqiq)', async () => {
  H.seedUsers(3);
  const DB = A.getDB();
  DB.users[1002].last = Date.now() - 20 * 86400000; // faol emas
  DB.users[1003].banned = true;
  assert.match(H.lastEdit(await H.adminClick('adm_u_active_0')).text, /\(Faol\): <b>3<\/b>/);
  assert.match(H.lastEdit(await H.adminClick('adm_u_banned_0')).text, /\(Taq.*\): <b>1<\/b>/);
  assert.match(H.lastEdit(await H.adminClick('adm_u_new_0')).text, /\(Yangi\): <b>3<\/b>/);
  // bo'sh ro'yxat
  DB.users[1003].banned = false;
  assert.match(H.lastEdit(await H.adminClick('adm_u_banned_0')).text, /hech kim yo'q/);
});

test('foydalanuvchi kartochkasi, taqiqlash va taqiqni olish', async () => {
  H.seedUsers(1);
  let ctx = await H.adminClick('adm_ui_1001');
  assert.match(H.lastEdit(ctx).text, /Ali1/);
  assert.ok(H.allDataOf(H.lastEdit(ctx)).includes('adm_ub_1001'));
  ctx = await H.adminClick('adm_ub_1001');
  assert.equal(A.getDB().users[1001].banned, true);
  assert.ok(H.allDataOf(H.lastEdit(ctx)).includes('adm_uu_1001'));
  assert.match(H.lastEdit(ctx).text, /TAQIQLANGAN/);
  ctx = await H.adminClick('adm_uu_1001');
  assert.equal(A.getDB().users[1001].banned, false);
});

test('bot egasini va mavjud bo\'lmagan odamni taqiqlab bo\'lmaydi', async () => {
  A.getDB().users[ADMIN_ID] = { id: ADMIN_ID, name: 'Egasi', first: 1, last: 1 };
  let ctx = await H.adminClick('adm_ub_' + ADMIN_ID);
  assert.ok(!A.getDB().users[ADMIN_ID].banned);
  assert.equal(ctx.answers[0].extra.show_alert, true);
  ctx = await H.adminClick('adm_ub_424242');
  assert.match(ctx.answers[0].text, /topilmadi/);
  ctx = await H.adminClick('adm_ui_424242');
  assert.match(H.lastEdit(ctx).text, /topilmadi/);
});

test('taqiqlangan odam botdan foydalana olmaydi, egasi taqiqlanmaydi', async () => {
  const bad = H.user(777, 'Yomon');
  await H.say(bad, '/start');
  A.getDB().users[777].banned = true;
  let ctx = await H.say(bad, '/start');
  assert.match(ctx.replies[0].text, /chetlatilgansiz/);
  ctx = await H.click(bad, 'rules_open');
  assert.match(ctx.answers[0].text, /chetlatilgansiz/);
  ctx = await H.say(bad, '/bunker', H.groupChat(-100555));
  assert.equal(ctx.replies.length, 0); // guruhda jim
  assert.equal(Object.keys(server.games).length, 0);
  // taqiqlangan odam botni guruhga qo'shsa, guruh hisobga olinadi
  await H.memberUpdate(H.groupChat(-100555, 'G'), bad, 'left', 'member');
  assert.ok(A.getDB().chats[-100555]);
  // egasi har doim ishlaydi
  A.getDB().users[ADMIN_ID] = { id: ADMIN_ID, name: 'Egasi', first: 1, last: 1, banned: true };
  ctx = await H.adminSay('/admin');
  assert.equal(ctx.replies.length, 1);
});

test('/odam: ism, @username va ID bo\'yicha qidiruv', async () => {
  H.seedUsers(12);
  let ctx = await H.adminSay('/odam Ali5');
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /Ali5/);
  ctx = await H.adminSay('/odam @ali7');
  assert.match(ctx.replies[0].text, /Ali7/);
  ctx = await H.adminSay('/odam 1009');
  assert.match(ctx.replies[0].text, /Ali9/);
  ctx = await H.adminSay('/odam ali');
  assert.match(ctx.replies[0].text, /Topildi: 8 ta/); // ko'p natija -> ro'yxat (8 tagacha)
  ctx = await H.adminSay('/odam yoq-odam');
  assert.match(ctx.replies[0].text, /topilmadi/);
  ctx = await H.adminSay('/odam');
  assert.match(ctx.replies[0].text, /Kimni qidiramiz/);
  ctx = await H.say(strangers, '/odam Ali');
  assert.equal(ctx.replies.length, 0);
});

// ---------- guruhlar ----------
test('guruhlar ro\'yxati: sahifalash, chiqib ketganlari oxirida', async () => {
  H.seedChats(10);
  A.getDB().chats[-1001000000001].active = false;
  const ctx = await H.adminClick('adm_g_0');
  const e = H.lastEdit(ctx);
  assert.match(e.text, /faol <b>9<\/b>, jami 10/);
  const items = e.extra.reply_markup.inline_keyboard.filter((r) => r[0].callback_data.startsWith('adm_gi_'));
  assert.equal(items.length, 8);
  const ctx2 = await H.adminClick('adm_g_1');
  const items2 = H.lastEdit(ctx2).extra.reply_markup.inline_keyboard.filter((r) => r[0].callback_data.startsWith('adm_gi_'));
  assert.equal(items2.length, 2);
  assert.match(items2[1][0].text, /🚫/); // chiqib ketgan oxirida
  // eski "Guruhlar" tugmasi ham ishlaydi
  assert.match(H.lastEdit(await H.adminClick('adm_chats')).text, /Guruhlar/);
});

test('guruh kartochkasi: ochiq guruh -> t.me havola, a\'zolar soni', async () => {
  const id = -1001234567890;
  world.chats[id] = { title: 'Ochiq', username: 'ochiqguruh', count: 42, botStatus: 'member', canInvite: false };
  A.getDB().chats[id] = { id, title: 'Eski nom', first: 1e12, last: 1e12, games: 3, active: true };
  const e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /<b>Ochiq<\/b>/);
  assert.match(e.text, /A'zolar: <b>42<\/b>/);
  assert.match(e.text, /https:\/\/t\.me\/ochiqguruh/);
  assert.match(e.text, /oddiy a'zo/);
  const url = H.buttonsOf(e).find((b) => b.url);
  assert.equal(url.url, 'https://t.me/ochiqguruh');
  assert.equal(A.getDB().chats[id].title, 'Ochiq'); // nom yangilandi
  assert.ok(!H.allDataOf(e).includes('adm_gn_' + id)); // ochiq guruhga yangi havola kerak emas
});

test('guruh kartochkasi: yopiq guruhda bot admin -> havola yaratiladi va saqlanadi', async () => {
  const id = -1001111111111;
  world.chats[id] = { title: 'Yopiq', count: 7, botStatus: 'administrator', canInvite: true };
  A.getDB().chats[id] = { id, title: 'Yopiq', first: 1e12, last: 1e12, games: 0, active: true };
  let e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /https:\/\/t\.me\/\+LINK1/);
  assert.match(e.text, /havola yarata oladi/);
  assert.equal(A.getDB().chats[id].link, 'https://t.me/+LINK1');
  // qayta ochilsa yangi havola yaratilmaydi (eskisi qayta ishlatiladi)
  e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /\+LINK1/);
  assert.equal(world.linkSeq, 1);
  // "Yangi havola" tugmasi yangisini yaratadi
  assert.ok(H.allDataOf(e).includes('adm_gn_' + id));
  const ctx = await H.adminClick('adm_gn_' + id);
  assert.match(H.lastEdit(ctx).text, /\+LINK2/);
  assert.equal(A.getDB().chats[id].link, 'https://t.me/+LINK2');
});

test('guruh kartochkasi: bot admin emas -> havola yo\'q, tushunarli ogohlantirish', async () => {
  const id = -1002222222222;
  world.chats[id] = { title: 'Oddiy', count: 3, botStatus: 'member', canInvite: false };
  A.getDB().chats[id] = { id, title: 'Oddiy', first: 1e12, last: 1e12, games: 0, active: true };
  const e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /Havola yo'q/);
  assert.equal(H.buttonsOf(e).filter((b) => b.url).length, 0);
  // yangi havola so'ralsa, sabab aytiladi
  world.chats[id].botStatus = 'administrator';
  world.chats[id].canInvite = false;
  const ctx = await H.adminClick('adm_gn_' + id);
  assert.equal(ctx.answers[0].extra.show_alert, true);
  assert.match(ctx.answers[0].text, /bot admin emas/);
});

test('guruh kartochkasi: bot chiqarilgan guruh -> faol emas deb belgilanadi', async () => {
  const id = -1003333333333; // world.chats da yo'q -> Telegram 400
  A.getDB().chats[id] = { id, title: 'Ketgan', first: 1e12, last: 1e12, games: 2, active: true, link: 'https://t.me/+OLD' };
  const e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /Bot bu guruhda yo'q/);
  assert.equal(A.getDB().chats[id].active, false);
  assert.ok(!H.allDataOf(e).includes('adm_gl_' + id)); // chiqish tugmasi yo'q
});

test('guruh kartochkasi: Telegram vaqtincha javob bermasa guruh o\'chirilmaydi', async () => {
  const id = -1004444444444;
  world.chats[id] = { title: 'Sekin', count: 1, botStatus: 'member', down: true };
  A.getDB().chats[id] = { id, title: 'Sekin', first: 1e12, last: 1e12, games: 0, active: true };
  const e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.match(e.text, /javob bermadi/);
  assert.equal(A.getDB().chats[id].active, true);
});

test('guruhdan chiqish: avval tasdiq so\'raydi, keyin chiqadi va o\'yinni yopadi', async () => {
  const id = -1005555555555;
  world.chats[id] = { title: 'Chiqamiz', count: 9, botStatus: 'member' };
  A.getDB().chats[id] = { id, title: 'Chiqamiz', first: 1e12, last: 1e12, games: 0, active: true };
  await H.say(H.user(1, 'Host'), '/bunker', H.groupChat(id, 'Chiqamiz'));
  const g = server.games[server.chatGame[id]];
  assert.ok(g && !g.finished);
  let ctx = await H.adminClick('adm_gl_' + id);
  assert.match(H.lastEdit(ctx).text, /chiqaymi/);
  assert.equal(world.left.length, 0); // hali chiqmagan
  ctx = await H.adminClick('adm_gy_' + id);
  assert.deepEqual(world.left, [id]);
  assert.equal(A.getDB().chats[id].active, false);
  assert.equal(g.finished, true);
  // Telegram xato bersa holat o'zgarmaydi
  const id2 = -1006666666666;
  A.getDB().chats[id2] = { id: id2, title: 'Yoq', first: 1, last: 1, games: 0, active: true };
  ctx = await H.adminClick('adm_gy_' + id2);
  assert.equal(A.getDB().chats[id2].active, true);
  assert.match(ctx.answers[0].text, /Chiqib bo'lmadi/);
});

test('guruh kartochkasidan o\'yinni to\'xtatish', async () => {
  const id = -1007777777777;
  world.chats[id] = { title: 'O\'yin', count: 4, botStatus: 'member' };
  A.getDB().chats[id] = { id, title: "O'yin", first: 1e12, last: 1e12, games: 0, active: true };
  await H.say(H.user(1, 'Host'), '/bunker', H.groupChat(id));
  const g = server.games[server.chatGame[id]];
  let e = H.lastEdit(await H.adminClick('adm_gi_' + id));
  assert.ok(H.allDataOf(e).includes('adm_gs_' + id));
  assert.match(e.text, new RegExp(g.code));
  e = H.lastEdit(await H.adminClick('adm_gs_' + id));
  assert.equal(g.finished, true);
  assert.ok(!H.allDataOf(e).includes('adm_gs_' + id));
  // faol o'yin yo'q bo'lsa xato bermaydi
  const ctx = await H.adminClick('adm_gs_' + id);
  assert.match(ctx.answers[0].text, /faol o'yin yo'q/);
});

// ---------- bitta odamga / guruhga xabar ----------
test('guruhga xabar: yozish -> ko\'rib chiqish -> yuborish', async () => {
  const id = -1008888888888;
  A.getDB().chats[id] = { id, title: 'Maqsad', first: 1, last: 1, games: 0, active: true };
  await H.adminClick(`adm_m_g_${id}`);
  let ctx = await H.adminSay('Salom guruh!');
  assert.match(ctx.replies[0].text, /Maqsad.*Salom guruh!/s);
  assert.deepEqual(H.allDataOf(ctx.replies[0]), ['adm_mgo', 'adm_mcancel']);
  assert.equal(world.sent.length, 0); // tasdiqlanmaguncha ketmaydi
  ctx = await H.adminClick('adm_mgo');
  assert.deepEqual(world.sent.map((m) => [m.id, m.text]), [[id, 'Salom guruh!']]);
  assert.match(H.lastEdit(ctx).text, /Yuborildi/);
  // ikkinchi marta bosilsa qayta ketmaydi
  ctx = await H.adminClick('adm_mgo');
  assert.equal(world.sent.length, 1);
  assert.equal(ctx.answers[0].extra.show_alert, true);
});

test('odamga xabar: bekor qilish va bloklagan odam', async () => {
  H.seedUsers(1);
  await H.adminClick('adm_m_u_1001');
  await H.adminSay('Salom');
  let ctx = await H.adminClick('adm_mcancel');
  assert.match(H.lastEdit(ctx).text, /bekor/i);
  ctx = await H.adminClick('adm_mgo');
  assert.equal(world.sent.length, 0);
  // bloklagan odamga yuborish: xato ko'rsatiladi va "bloklagan" deb belgilanadi
  world.blocked.add(1001);
  await H.adminClick('adm_m_u_1001');
  await H.adminSay('Qayta');
  ctx = await H.adminClick('adm_mgo');
  assert.match(H.lastEdit(ctx).text, /Yuborilmadi/);
  assert.equal(A.getDB().users[1001].blocked, true);
});

test('xabar yozish holatida buyruqlar xalaqit bermaydi, juda uzun matn rad etiladi', async () => {
  H.seedUsers(1);
  await H.adminClick('adm_m_u_1001');
  let ctx = await H.adminSay('/admin'); // buyruq xabar sifatida olinmaydi
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /boshqaruv paneli/);
  ctx = await H.adminSay('x'.repeat(4001));
  assert.match(ctx.replies[0].text, /juda uzun/);
  ctx = await H.adminSay('Normal');
  assert.match(ctx.replies[0].text, /Normal/);
  // holat yo'q bo'lsa oddiy matn e'tiborsiz
  await H.adminClick('adm_mcancel');
  ctx = await H.adminSay('hech narsa');
  assert.equal(ctx.replies.length, 0);
});

// ---------- hammaga xabar ----------
test('/xabar: taqiqlangan va bloklaganlarga yuborilmaydi', async () => {
  H.seedUsers(5);
  const DB = A.getDB();
  DB.users[1002].banned = true;
  DB.users[1003].blocked = true;
  DB.users[1004].started = false;
  let ctx = await H.adminSay('/xabar Yangilik!');
  assert.match(ctx.replies[0].text, /2 kishiga/);
  assert.match(H.lastEdit(await H.adminClick('adm_bc')).text, /<b>2<\/b> kishiga/);
  await H.adminClick('adm_bc_go');
  await H.flush();
  const toUsers = world.sent.filter((m) => m.id !== ADMIN_ID).map((m) => m.id).sort();
  assert.deepEqual(toUsers, [1001, 1005]);
  assert.ok(world.sent.some((m) => m.id === ADMIN_ID && /Yetib bordi: <b>2<\/b>/.test(m.text)));
  // takror bosilsa yana ketmaydi
  const before = world.sent.length;
  await H.adminClick('adm_bc_go');
  assert.equal(world.sent.length, before);
  // 403 bo'lsa "bloklagan" deb belgilanadi
  world.blocked.add(1001);
  await H.adminSay('/xabar Yana');
  await H.adminClick('adm_bc_go');
  assert.equal(DB.users[1001].blocked, true);
});

// ---------- sozlamalar ----------
test('sozlamalar: ➕➖ qiymatni o\'zgartiradi va o\'yinga darhol qo\'llanadi', async () => {
  let e = H.lastEdit(await H.adminClick('adm_set'));
  assert.match(e.text, /Eng kam o'yinchi: <b>4<\/b>/);
  await H.adminClick('adm_s_minPlayers_u');
  assert.equal(A.getSetting('minPlayers'), 5);
  assert.equal(A.getLimits().MIN_PLAYERS, 5);
  await H.adminClick('adm_s_vote_u');
  assert.equal(A.getLimits().VOTE_SEC, 50);
  await H.adminClick('adm_s_reveal_d');
  assert.equal(A.getLimits().REVEAL_SEC, 50);
  e = H.lastEdit(await H.adminClick('adm_s_between_u'));
  assert.match(e.text, /Raund oralig'i: <b>5<\/b>/);
  assert.equal(A.getLimits().BETWEEN_SEC, 5);
});

test('sozlamalar: chegaradan o\'tib bo\'lmaydi', async () => {
  for (let i = 0; i < 10; i++) await H.adminClick('adm_s_minPlayers_d');
  assert.equal(A.getSetting('minPlayers'), 3);
  let ctx = await H.adminClick('adm_s_minPlayers_d');
  assert.match(ctx.answers[0].text, /Chegara/);
  assert.equal(ctx.edits.length, 0);
  for (let i = 0; i < 20; i++) await H.adminClick('adm_s_minPlayers_u');
  assert.equal(A.getSetting('minPlayers'), 12);
  for (let i = 0; i < 40; i++) await H.adminClick('adm_s_vote_d');
  assert.equal(A.getSetting('vote'), 15);
  for (let i = 0; i < 40; i++) await H.adminClick('adm_s_discuss1_u');
  assert.equal(A.getSetting('discuss1'), 300);
});

test('sozlamalar: tugmasi bor har bir qiymat ishlaydi, asl holiga qaytarish', async () => {
  for (const d of A.SETTING_DEFS) {
    const def = A.getSetting(d.key);
    await H.adminClick(`adm_s_${d.key}_u`);
    assert.equal(A.getSetting(d.key), Math.min(d.max, def + d.step), d.key);
  }
  await H.adminClick('adm_s_reset');
  assert.deepEqual(A.getLimits(), { MIN_PLAYERS: 4, REVEAL_SEC: 60, DISCUSS1_SEC: 90, DISCUSS2_SEC: 80, VOTE_SEC: 45, REVOTE_SEC: 30, BETWEEN_SEC: 4, KICK_GRACE_SEC: 10 });
});

test('sozlamalar: saqlanadi va qayta ishga tushganda tiklanadi', async () => {
  await H.adminClick('adm_s_minPlayers_u');
  await H.adminClick('adm_s_vote_u');
  await H.adminClick('adm_t_maintenance');
  await A.saveNow();
  const saved = JSON.parse(fs.readFileSync(H.DATA_FILE, 'utf8'));
  assert.equal(saved.settings.values.minPlayers, 5);
  assert.equal(saved.settings.maintenance, true);
  // serverni "qayta ishga tushirish": xotirani tozalab, fayldan yuklash
  const DB = A.getDB();
  DB.settings = undefined;
  A.applySettings();
  assert.equal(A.getLimits().MIN_PLAYERS, 4);
  await A.loadDB();
  assert.equal(A.getLimits().MIN_PLAYERS, 5);
  assert.equal(A.getLimits().VOTE_SEC, 50);
  assert.equal(A.getDB().settings.maintenance, true);
});

test('sozlamalar: buzilgan saqlangan qiymat o\'yinni buzmaydi', async () => {
  const DB = A.getDB();
  DB.settings = { values: { minPlayers: 'abc', vote: -5, reveal: 99999, between: null }, maintenance: 'ha' };
  A.ensureSettings();
  A.applySettings();
  const L = A.getLimits();
  assert.equal(L.MIN_PLAYERS, 4); // matn -> asl qiymat
  assert.equal(L.VOTE_SEC, 15); // juda kichik -> chegaraga
  assert.equal(L.REVEAL_SEC, 180); // juda katta -> chegaraga
  assert.equal(L.BETWEEN_SEC, 4);
  assert.equal(A.getDB().settings.maintenance, false); // noto'g'ri turdagi bayroq -> standart
});

test('texnik ish rejimi: begonaga yangi o\'yin ochilmaydi, egasiga ochiladi', async () => {
  await H.adminClick('adm_t_maintenance');
  assert.match(H.lastEdit(await H.adminClick('adm_stats')).text, /Texnik ish rejimi YOQILGAN/);
  let ctx = await H.say(H.user(5, 'Oddiy'), '/bunker', H.groupChat(-100900));
  assert.match(ctx.replies[0].text, /texnik ishlar/);
  assert.equal(Object.keys(server.games).length, 0);
  ctx = await H.say(ADMIN, '/bunker', H.groupChat(-100901));
  assert.equal(Object.keys(server.games).length, 1);
  await H.adminClick('adm_t_maintenance'); // o'chirish
  ctx = await H.say(H.user(5, 'Oddiy'), '/bunker', H.groupChat(-100902));
  assert.equal(Object.keys(server.games).length, 2);
});

test('sozlamalar: bildirishnomalarni o\'chirish ishlaydi', async () => {
  await H.adminClick('adm_t_notifyUsers');
  await H.adminClick('adm_t_notifyGroups');
  await H.say(H.user(321, 'Yangi'), '/start');
  await H.say(H.user(322, 'Yana'), '/bunker', H.groupChat(-100321, 'Yangi guruh'));
  await H.memberUpdate(H.groupChat(-100322, 'Yana guruh'), H.user(322, 'Yana'), 'left', 'member');
  await H.flush();
  assert.equal(world.sent.length, 0);
  // yoqilsa xabar keladi
  await H.adminClick('adm_t_notifyUsers');
  await H.say(H.user(323, 'Uchinchi'), '/start');
  await H.flush();
  assert.ok(world.sent.some((m) => /Yangi foydalanuvchi/.test(m.text)));
});

// ---------- guruhga qo'shilganda egaga xabar ----------
test('bot guruhga qo\'shildi: egaga nomi, a\'zolar soni va havola keladi', async () => {
  const id = -100123456;
  world.chats[id] = { title: 'Yangi guruh', count: 17, botStatus: 'administrator', canInvite: true };
  await H.memberUpdate(H.groupChat(id, 'Yangi guruh'), H.user(9, 'Qoshdi', 'qoshdi'), 'left', 'administrator');
  await H.flush();
  assert.equal(world.sent.length, 1);
  const m = world.sent[0];
  assert.equal(m.id, ADMIN_ID);
  assert.match(m.text, /yangi guruhga qo'shildi/);
  assert.match(m.text, /Yangi guruh/);
  assert.match(m.text, /A'zolar: <b>17<\/b>/);
  assert.match(m.text, /https:\/\/t\.me\/\+LINK1/);
  assert.match(m.text, /Qoshdi/);
  // shu guruhda birinchi buyruq yozilganda ikkinchi marta "yangi guruh" xabari kelmaydi
  await H.say(H.user(9, 'Qoshdi'), '/bunker', H.groupChat(id, 'Yangi guruh'));
  await H.flush();
  assert.equal(world.sent.length, 1);
});

test('bot oddiy a\'zo sifatida qo\'shildi, keyin admin qilindi: ikkinchi xabarda havola', async () => {
  const id = -100654321;
  world.chats[id] = { title: 'Keyin admin', count: 5, botStatus: 'member', canInvite: false };
  await H.memberUpdate(H.groupChat(id, 'Keyin admin'), H.user(9, 'Q'), 'left', 'member');
  await H.flush();
  assert.match(world.sent[0].text, /Havola yo'q/);
  world.chats[id].botStatus = 'administrator';
  world.chats[id].canInvite = true;
  await H.memberUpdate(H.groupChat(id, 'Keyin admin'), H.user(9, 'Q'), 'member', 'administrator');
  await H.flush();
  assert.equal(world.sent.length, 2);
  assert.match(world.sent[1].text, /admin qilindi/);
  assert.match(world.sent[1].text, /https:\/\/t\.me\/\+LINK1/);
  // huquqi o'zgarmagan (admin -> admin) holat yangi xabar chiqarmaydi
  await H.memberUpdate(H.groupChat(id, 'Keyin admin'), H.user(9, 'Q'), 'administrator', 'administrator');
  await H.flush();
  assert.equal(world.sent.length, 2);
});

test('bot guruhdan chiqarildi: guruh faol emas deb belgilanadi, xabar kelmaydi', async () => {
  const id = -100777000;
  A.getDB().chats[id] = { id, title: 'Ketdi', first: 1, last: 1, games: 0, active: true };
  await H.memberUpdate(H.groupChat(id, 'Ketdi'), H.user(9, 'Q'), 'member', 'kicked');
  await H.flush();
  assert.equal(A.getDB().chats[id].active, false);
  assert.equal(world.sent.length, 0);
  // qayta qo'shilsa yana faol bo'ladi va xabar keladi
  world.chats[id] = { title: 'Ketdi', count: 2, botStatus: 'member' };
  await H.memberUpdate(H.groupChat(id, 'Ketdi'), H.user(9, 'Q'), 'kicked', 'member');
  await H.flush();
  assert.equal(A.getDB().chats[id].active, true);
  assert.equal(world.sent.length, 1);
});

test('foydalanuvchi botni bloklasa/qaytarsa belgilanadi', async () => {
  H.seedUsers(1);
  await H.memberUpdate(H.privateChat(1001), H.user(1001, 'Ali1'), 'member', 'kicked');
  assert.equal(A.getDB().users[1001].blocked, true);
  await H.memberUpdate(H.privateChat(1001), H.user(1001, 'Ali1'), 'kicked', 'member');
  assert.equal(A.getDB().users[1001].blocked, false);
});

// ---------- statistika va qolgan bo'limlar ----------
test('statistika va hozirgi o\'yinlar bo\'limlari xatosiz ishlaydi', async () => {
  H.seedUsers(3, {});
  A.getDB().users[1001].banned = true;
  let e = H.lastEdit(await H.adminClick('adm_stats'));
  assert.match(e.text, /Taqiqlanganlar: 1/);
  await H.say(H.user(1, 'Host'), '/bunker', H.groupChat(-100444, 'Test guruh'));
  A.getDB().chats[-100444] = A.getDB().chats[-100444] || { id: -100444, title: 'Test guruh' };
  e = H.lastEdit(await H.adminClick('adm_live'));
  assert.match(e.text, /Test guruh/);
  const code = Object.keys(server.games)[0];
  assert.ok(H.allDataOf(e).includes('adm_stop_' + code));
  e = H.lastEdit(await H.adminClick('adm_stop_' + code));
  assert.match(e.text, /o'ynalayotgan o'yin yo'q/);
  assert.match(H.lastEdit(await H.adminClick('adm_menu')).text, /boshqaruv paneli/);
  // eski tugmalar (oldingi versiyadagi xabarlarda qolgan) hamon ishlaydi
  assert.match(H.lastEdit(await H.adminClick('adm_new')).text, /Foydalanuvchilar/);
  assert.match(H.lastEdit(await H.adminClick('adm_active')).text, /Foydalanuvchilar/);
});

test('o\'yinning o\'zi buzilmagan: xona ochish va qo\'shilish ishlaydi', async () => {
  const host = H.user(1, 'Host');
  await H.say(host, '/bunker', H.groupChat(-100888, 'O\'yin guruhi'));
  const g = server.games[server.chatGame[-100888]];
  assert.ok(g);
  const r = server.joinPlayer(g, 1, 'Host');
  assert.equal(r.ok, true);
  // admin sozlamasi kamida o'yinchi sonini oshirsa, boshlash tugmasi shuni talab qiladi
  await H.adminClick('adm_s_minPlayers_u');
  const ctx = await H.click(host, 'start_' + g.code, H.groupChat(-100888));
  assert.match(ctx.answers[0].text, /Kamida 5/);
});
