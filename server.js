// SECTOR ZERO — Telegram Mini App o'yini (server)
const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Sozlamalar ----------
const MIN_PLAYERS = 4; // haqiqiy o'yin uchun 6 qiling
const MAX_PLAYERS = 12;
const ROLES_SECONDS = 12;
const NIGHT_SECONDS = 40;
const DISCUSS_SECONDS = 90;
const VOTE_SECONDS = 45;
const RESULT_SECONDS = 10;

const ROLE_INFO = {
  fuqaro: {
    title: "Oddiy Arxitektor",
    desc: "Maxsus qobiliyatingiz yo'q. Kunduzi kuzating, muhokama qiling va to'g'ri ovoz bering."
  },
  xaker: {
    title: "Xaker",
    desc: "Har tuni bitta o'yinchining jamoasini (Arxitektor yoki Isyonchi) tekshirasiz."
  },
  xavfsizlik: {
    title: "Xavfsizlik xodimi",
    desc: "Har tuni bitta o'yinchini (o'zingizni ham) isyonchilar hujumidan himoya qilasiz."
  },
  isyonchi: {
    title: "Isyonchi",
    desc: "Har tuni jamoangiz bilan birga bitta Arxitektorni yo'q qilasiz."
  },
  diversant: {
    title: "Diversant",
    desc: "Tunda jamoa bilan birga bitta Arxitektorni yo'q qilasiz va yana bir o'yinchini ertangi ovozdan mahrum qilasiz."
  }
};

const ACTIONS = {
  xaker: [{ kind: "check", title: "🔍 Kimning jamoasini tekshirasiz?" }],
  xavfsizlik: [{ kind: "protect", title: "🛡 Kimni himoya qilasiz?" }],
  isyonchi: [{ kind: "kill", title: "🗡 Kimni yo'q qilamiz?" }],
  diversant: [
    { kind: "kill", title: "🗡 Kimni yo'q qilamiz?" },
    { kind: "block", title: "📡 Kimni ovozdan mahrum qilasiz?" }
  ]
};

const rooms = {};

// ---------- Yordamchi funksiyalar ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let t = 0; t < 50; t++) {
    let c = "";
    for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms[c]) return c;
  }
  return null;
}

function sanitizeName(n) {
  return String(n || "").replace(/\s+/g, " ").trim().slice(0, 16);
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }
}

function sendError(ws, text, fatal) {
  send(ws, { type: "error", text, fatal: !!fatal });
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.endsAt = 0;
}

function deleteRoom(room) {
  clearTimer(room);
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  delete rooms[room.code];
}

function members(room) {
  return room.players.filter((p) => !p.left);
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive && !p.left);
}

function getPlayer(room, id) {
  return room.players.find((p) => p.id === id && !p.left);
}

function addChat(room, entry) {
  entry.ts = Date.now();
  room.chat.push(entry);
  if (room.chat.length > 80) room.chat.shift();
}

function addSystem(room, text) {
  addChat(room, { kind: "sys", text });
}

function setPhase(room, phase, seconds, onEnd) {
  clearTimer(room);
  room.phase = phase;
  room.onEnd = onEnd || null;
  if (seconds && onEnd) {
    room.endsAt = Date.now() + seconds * 1000;
    room.timer = setTimeout(() => {
      room.timer = null;
      room.endsAt = 0;
      onEnd(room);
    }, seconds * 1000);
  }
  broadcast(room);
}

// ---------- Holatni yuborish ----------
function viewFor(room, viewer) {
  const isEnd = room.phase === "end";
  const alive = alivePlayers(room);
  const redLeft = alive.filter((p) => p.team === "red").length;
  const info = ROLE_INFO[viewer.role] || ROLE_INFO.fuqaro;

  const me = {
    id: viewer.id,
    alive: viewer.alive,
    team: viewer.team,
    role: viewer.role,
    roleTitle: info.title,
    roleDesc: info.desc,
    mates:
      viewer.team === "red"
        ? members(room)
            .filter((p) => p.team === "red" && p.id !== viewer.id)
            .map((p) => ({ id: p.id, name: p.name, alive: p.alive }))
        : [],
    actions: [],
    teamPicks: [],
    checks: viewer.checks,
    blocked: room.blocked === viewer.id && ["discuss", "vote", "result"].includes(room.phase)
  };

  if (room.phase === "night" && viewer.alive) {
    const mine = room.acts[viewer.id] || {};
    me.actions = (ACTIONS[viewer.role] || []).map((a) => ({
      kind: a.kind,
      title: a.title,
      target: mine[a.kind] || null
    }));
    if (viewer.team === "red") {
      alive
        .filter((p) => p.team === "red")
        .forEach((p) => {
          const t = room.acts[p.id] && room.acts[p.id].kill;
          const tp = t ? getPlayer(room, t) : null;
          me.teamPicks.push({ by: p.name, target: tp ? tp.name : null });
        });
    }
  }

  const players = members(room).map((p) => ({
    id: p.id,
    name: p.name,
    online: p.online,
    alive: p.alive,
    team: isEnd || p.revealed ? p.team : null,
    role: isEnd ? p.role : null,
    voted: room.phase === "vote" ? !!room.votes[p.id] : false
  }));

  const chat = room.chat.filter(
    (c) => c.kind !== "red" || viewer.team === "red" || isEnd
  );

  const chatPhase = ["discuss", "vote", "result"].includes(room.phase);
  return {
    type: "game",
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === viewer.id,
    phase: room.phase,
    day: room.day,
    secondsLeft: room.endsAt ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)) : 0,
    aliveCount: alive.length,
    redLeft,
    redTotal: room.redTotal,
    players,
    me,
    chat,
    canChat: chatPhase && viewer.alive,
    canRedChat: room.phase === "night" && viewer.alive && viewer.team === "red",
    myVote: room.votes[viewer.id] || null,
    lastResult: room.lastResult,
    lastNight: room.lastNight,
    endInfo: room.endInfo
  };
}

function broadcast(room) {
  if (room.phase === "lobby") {
    const players = members(room).map((p) => ({ id: p.id, name: p.name, online: p.online }));
    members(room).forEach((p) => {
      send(p.ws, {
        type: "room",
        code: room.code,
        hostId: room.hostId,
        isHost: room.hostId === p.id,
        players,
        min: MIN_PLAYERS,
        max: MAX_PLAYERS,
        you: p.id
      });
    });
    return;
  }
  members(room).forEach((p) => send(p.ws, viewFor(room, p)));
}

// ---------- O'yin oqimi ----------
function startGame(room) {
  room.players = room.players.filter((p) => !p.left && p.online);
  const list = shuffle(room.players);
  const n = list.length;
  const redN = Math.max(1, Math.floor(n / 3));
  room.redTotal = redN;

  list.forEach((p, i) => {
    p.alive = true;
    p.revealed = false;
    p.checks = [];
    if (i < redN) {
      p.team = "red";
      p.role = i === 0 ? "diversant" : "isyonchi";
    } else {
      p.team = "blue";
      const k = i - redN;
      p.role = k === 0 ? "xaker" : k === 1 ? "xavfsizlik" : "fuqaro";
    }
  });

  room.day = 0;
  room.acts = {};
  room.votes = {};
  room.blocked = null;
  room.lastResult = null;
  room.lastNight = null;
  room.endInfo = null;
  room.chat = [];
  addSystem(room, "🛰 SECTOR ZERO boshlandi. Arxitektorlar ichida isyonchilar yashiringan!");
  setPhase(room, "roles", ROLES_SECONDS, beginNight);
}

function beginNight(room) {
  room.day += 1;
  room.acts = {};
  room.votes = {};
  room.blocked = null;
  room.lastNight = null;
  addSystem(room, `🌙 ${room.day}-tun boshlandi. Shahar uxladi...`);
  setPhase(room, "night", NIGHT_SECONDS, resolveNight);
}

function nightDone(room) {
  const alive = alivePlayers(room);
  return alive.every((p) =>
    (ACTIONS[p.role] || []).every((a) => room.acts[p.id] && room.acts[p.id][a.kind])
  );
}

function resolveNight(room) {
  if (room.phase !== "night") return;
  const alive = alivePlayers(room);

  // Xaker tekshiruvi (tun boshidagi holat bo'yicha)
  const hacker = alive.find((p) => p.role === "xaker");
  if (hacker) {
    const t = room.acts[hacker.id] && room.acts[hacker.id].check;
    const tp = t ? getPlayer(room, t) : null;
    if (tp) hacker.checks.push({ name: tp.name, team: tp.team, day: room.day });
  }

  // Himoya
  const guard = alive.find((p) => p.role === "xavfsizlik");
  const protectedId = guard && room.acts[guard.id] ? room.acts[guard.id].protect : null;

  // Diversant
  const dv = alive.find((p) => p.role === "diversant");
  room.blocked = dv && room.acts[dv.id] && room.acts[dv.id].block ? room.acts[dv.id].block : null;

  // Yo'q qilish (isyonchilar ovozi)
  const votes = {};
  alive
    .filter((p) => p.team === "red")
    .forEach((p) => {
      const t = room.acts[p.id] && room.acts[p.id].kill;
      if (t) votes[t] = (votes[t] || 0) + 1;
    });
  let victim = null;
  const ids = Object.keys(votes);
  if (ids.length) {
    const max = Math.max(...ids.map((i) => votes[i]));
    const top = ids.filter((i) => votes[i] === max);
    victim = top[Math.floor(Math.random() * top.length)];
  }

  let text;
  const vp = victim ? getPlayer(room, victim) : null;
  if (vp && vp.id !== protectedId) {
    vp.alive = false;
    text = `🌅 ${room.day}-tong. Tunda ${vp.name} yo'q qilindi.`;
  } else {
    text = `🌅 ${room.day}-tong. Bu tunda hech kim yo'q qilinmadi.`;
  }
  room.lastNight = text;
  addSystem(room, text);

  if (checkWin(room)) return;
  room.votes = {};
  setPhase(room, "discuss", DISCUSS_SECONDS, beginVote);
}

function beginVote(room) {
  if (room.phase !== "discuss") return;
  room.votes = {};
  addSystem(room, "🗳 Ovoz berish boshlandi!");
  setPhase(room, "vote", VOTE_SECONDS, finishVote);
}

function voteDone(room) {
  const voters = alivePlayers(room).filter((p) => p.id !== room.blocked);
  return voters.length > 0 && voters.every((p) => room.votes[p.id]);
}

function finishVote(room) {
  if (room.phase !== "vote") return;
  const tally = {};
  Object.keys(room.votes).forEach((vid) => {
    const t = room.votes[vid];
    if (t && t !== "abstain" && getPlayer(room, t)) tally[t] = (tally[t] || 0) + 1;
  });
  const ids = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
  const tallyList = ids.map((i) => ({ name: getPlayer(room, i).name, count: tally[i] }));

  let ejected = null;
  let text;
  if (ids.length && (ids.length === 1 || tally[ids[0]] > tally[ids[1]])) {
    const p = getPlayer(room, ids[0]);
    p.alive = false;
    p.revealed = true;
    ejected = { name: p.name, team: p.team };
    text =
      p.team === "red"
        ? `🔴 ${p.name} chiqarib yuborildi. U ISYONCHI edi!`
        : `🔵 ${p.name} chiqarib yuborildi. U Arxitektor edi...`;
  } else {
    text = "⚖️ Ovozlar teng yoki yetarli emas. Hech kim chiqarilmadi.";
  }
  room.lastResult = { text, tally: tallyList, ejected };
  addSystem(room, text);

  if (checkWin(room)) return;
  setPhase(room, "result", RESULT_SECONDS, beginNight);
}

function checkWin(room) {
  const alive = alivePlayers(room);
  const r = alive.filter((p) => p.team === "red").length;
  const b = alive.filter((p) => p.team === "blue").length;
  if (r === 0) {
    endGame(room, "blue", "Barcha isyonchilar yo'q qilindi. Arxitektorlar g'alaba qozondi!");
    return true;
  }
  if (r >= b) {
    endGame(room, "red", "Isyonchilar soni Arxitektorlarga tenglashdi. Isyonchilar g'alaba qozondi!");
    return true;
  }
  return false;
}

function endGame(room, winner, text) {
  clearTimer(room);
  room.endInfo = { winner, text };
  addSystem(room, text);
  setPhase(room, "end", 0, null);
}

function backToLobby(room) {
  clearTimer(room);
  room.players = room.players.filter((p) => !p.left);
  room.players.forEach((p) => {
    p.alive = true;
    p.team = null;
    p.role = null;
    p.revealed = false;
    p.checks = [];
  });
  room.chat = [];
  room.acts = {};
  room.votes = {};
  room.blocked = null;
  room.lastResult = null;
  room.lastNight = null;
  room.endInfo = null;
  room.phase = "lobby";
  broadcast(room);
}

function pickNewHost(room) {
  const list = members(room);
  const next = list.find((p) => p.online) || list[0];
  room.hostId = next ? next.id : null;
}

function removePlayer(room, p) {
  if (room.phase === "lobby") {
    room.players = room.players.filter((x) => x !== p);
  } else {
    p.left = true;
    p.alive = false;
    p.online = false;
    p.ws = null;
    if (room.phase !== "end") addSystem(room, `🚪 ${p.name} o'yindan chiqib ketdi.`);
  }
  if (members(room).length === 0) {
    deleteRoom(room);
    return;
  }
  if (room.hostId === p.id) pickNewHost(room);

  if (room.phase !== "lobby" && room.phase !== "end" && room.phase !== "roles") {
    if (checkWin(room)) return;
    if (room.phase === "night" && nightDone(room)) {
      clearTimer(room);
      resolveNight(room);
      return;
    }
    if (room.phase === "vote" && voteDone(room)) {
      clearTimer(room);
      finishVote(room);
      return;
    }
  }
  broadcast(room);
}

// ---------- Xabarlar ----------
function detach(id, exceptCode) {
  Object.values(rooms).forEach((room) => {
    if (room.code === exceptCode) return;
    const p = room.players.find((x) => x.id === id && !x.left);
    if (p) removePlayer(room, p);
  });
}

function handleCreate(ws, m) {
  const id = String(m.id || "").slice(0, 40);
  const name = sanitizeName(m.name);
  if (!id || !name) return sendError(ws, "Ismingizni yozing.");
  detach(id, null);
  const code = makeCode();
  if (!code) return sendError(ws, "Xona yaratib bo'lmadi, qayta urinib ko'ring.");
  const room = {
    code,
    hostId: id,
    players: [],
    phase: "lobby",
    day: 0,
    timer: null,
    endsAt: 0,
    onEnd: null,
    chat: [],
    acts: {},
    votes: {},
    blocked: null,
    lastResult: null,
    lastNight: null,
    endInfo: null,
    redTotal: 0,
    emptyTimer: null
  };
  rooms[code] = room;
  const p = {
    id, name, ws, online: true, alive: true, team: null, role: null, revealed: false, checks: [], left: false
  };
  room.players.push(p);
  ws.pid = id;
  ws.code = code;
  broadcast(room);
}

function handleJoin(ws, m) {
  const id = String(m.id || "").slice(0, 40);
  const name = sanitizeName(m.name);
  const code = String(m.code || "").trim().toUpperCase();
  if (!id) return sendError(ws, "Xatolik: ID yo'q.", true);
  const room = rooms[code];
  if (!room) return sendError(ws, "Bunday xona topilmadi.", true);

  const existing = room.players.find((p) => p.id === id && !p.left);
  if (existing) {
    if (existing.ws && existing.ws !== ws) {
      existing.ws.code = null;
      try { existing.ws.close(); } catch (e) {}
    }
    existing.ws = ws;
    existing.online = true;
    ws.pid = id;
    ws.code = code;
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    if (!members(room).some((p) => p.id === room.hostId && p.online)) room.hostId = id;
    broadcast(room);
    return;
  }

  if (!name) return sendError(ws, "Ismingizni yozing.", false);
  if (room.phase !== "lobby") return sendError(ws, "O'yin allaqachon boshlangan.", true);
  if (members(room).length >= MAX_PLAYERS) return sendError(ws, "Xona to'la.", true);
  if (members(room).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return sendError(ws, "Bu ism xonada band. Boshqa ism yozing.");
  }
  detach(id, code);
  room.players.push({
    id, name, ws, online: true, alive: true, team: null, role: null, revealed: false, checks: [], left: false
  });
  ws.pid = id;
  ws.code = code;
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
  broadcast(room);
}

function handleMessage(ws, m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "create") return handleCreate(ws, m);
  if (m.type === "join") return handleJoin(ws, m);

  const room = ws.code ? rooms[ws.code] : null;
  if (!room) return;
  const p = room.players.find((x) => x.id === ws.pid && !x.left);
  if (!p) return;

  switch (m.type) {
    case "leave": {
      ws.code = null;
      removePlayer(room, p);
      send(ws, { type: "left" });
      break;
    }
    case "start": {
      if (room.hostId !== p.id || room.phase !== "lobby") return;
      const online = members(room).filter((x) => x.online);
      if (online.length < MIN_PLAYERS) {
        return sendError(ws, `Kamida ${MIN_PLAYERS} ta o'yinchi kerak.`);
      }
      startGame(room);
      break;
    }
    case "chat": {
      const text = String(m.text || "").trim().slice(0, 200);
      if (!text) return;
      if (["discuss", "vote", "result"].includes(room.phase) && p.alive) {
        addChat(room, { kind: "msg", from: p.name, fromId: p.id, text });
        broadcast(room);
      } else if (room.phase === "night" && p.alive && p.team === "red") {
        addChat(room, { kind: "red", from: p.name, fromId: p.id, text });
        broadcast(room);
      }
      break;
    }
    case "act": {
      if (room.phase !== "night" || !p.alive) return;
      const def = (ACTIONS[p.role] || []).find((a) => a.kind === m.kind);
      if (!def) return;
      const t = getPlayer(room, String(m.target || ""));
      if (!t || !t.alive) return;
      if (def.kind === "kill" && (t.id === p.id || t.team === "red")) {
        return sendError(ws, "Bu o'yinchini tanlab bo'lmaydi.");
      }
      if ((def.kind === "check" || def.kind === "block") && t.id === p.id) {
        return sendError(ws, "O'zingizni tanlab bo'lmaydi.");
      }
      room.acts[p.id] = room.acts[p.id] || {};
      room.acts[p.id][def.kind] = t.id;
      if (nightDone(room)) {
        clearTimer(room);
        resolveNight(room);
      } else {
        broadcast(room);
      }
      break;
    }
    case "vote":
    case "abstain": {
      if (room.phase !== "vote" || !p.alive) return;
      if (room.blocked === p.id) return sendError(ws, "Siz bugun ovoz bera olmaysiz.");
      if (m.type === "abstain") {
        room.votes[p.id] = "abstain";
      } else {
        const t = getPlayer(room, String(m.target || ""));
        if (!t || !t.alive) return;
        if (t.id === p.id) return sendError(ws, "O'zingizga ovoz bera olmaysiz.");
        room.votes[p.id] = t.id;
      }
      if (voteDone(room)) {
        clearTimer(room);
        finishVote(room);
      } else {
        broadcast(room);
      }
      break;
    }
    case "next": {
      if (room.hostId !== p.id) return;
      if (!["roles", "discuss", "vote", "result"].includes(room.phase)) return;
      const fn = room.onEnd;
      if (!fn) return;
      clearTimer(room);
      fn(room);
      break;
    }
    case "lobby": {
      if (room.hostId !== p.id || room.phase !== "end") return;
      backToLobby(room);
      break;
    }
  }
}

function onClose(ws) {
  const room = ws.code ? rooms[ws.code] : null;
  if (!room) return;
  const p = room.players.find((x) => x.id === ws.pid && !x.left);
  if (!p || p.ws !== ws) return;
  p.online = false;
  p.ws = null;
  if (room.hostId === p.id) pickNewHost(room);
  if (!members(room).some((x) => x.online)) {
    if (!room.emptyTimer) {
      room.emptyTimer = setTimeout(() => deleteRoom(room), 10 * 60 * 1000);
    }
  }
  broadcast(room);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    try {
      handleMessage(ws, m);
    } catch (e) {
      console.error("handleMessage xatosi:", e);
    }
  });
  ws.on("close", () => onClose(ws));
  ws.on("error", () => {});
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {}
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("SECTOR ZERO server ishga tushdi, port " + PORT));
