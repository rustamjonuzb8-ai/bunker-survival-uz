const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 1; // TEST UCHUN. Keyin 4 ga qaytaramiz
const MAX_PLAYERS = 12;
const MAX_ROUNDS = 7;
const DISCUSS_SECONDS = 90;
const VOTE_SECONDS = 45;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, game: "BUNKER", rooms: Object.keys(rooms).length });
});

// ---------- O'YIN MA'LUMOTLARI ----------

const DISASTERS = [
  { title: "☢️ Yadroviy urush", text: "Yer yuzining katta qismi radiatsiya ostida. Tashqarida kamida 20 yil yashab bo'lmaydi." },
  { title: "🦠 Zombi virusi", text: "Noma'lum virus odamlarni jonli o'liklarga aylantirmoqda. Shaharlar bo'm-bo'sh, yo'llar yopilgan." },
  { title: "☄️ Asteroid urilishi", text: "Ulkan asteroid Yerga urildi. Osmon changdan qoraydi, quyosh nuri yetib kelmayapti." },
  { title: "🌊 Global suv toshqini", text: "Okeanlar qirg'oqlarni bosdi. Quruqlik deyarli qolmadi, ichimlik suvi kam." },
  { title: "🧊 Yangi muzlik davri", text: "Harorat -60 darajaga tushdi. Hamma narsa muzlab qoldi, ekin ekib bo'lmaydi." },
  { title: "🤖 Mashinalar qo'zg'oloni", text: "Sun'iy intellekt odamlarga qarshi chiqdi. Barcha texnika dushmanga aylandi." },
];

const KASB = ["Shifokor-jarroh", "Muhandis-elektrik", "Oshpaz", "Dehqon", "O'qituvchi", "Politsiyachi", "Dasturchi", "Santexnik", "Haydovchi", "Psixolog", "Quruvchi", "Veterinar", "Hamshira", "Askar", "Fermer"];
const SOGLIQ = ["To'liq sog'lom", "Astma kasalligi bor", "Qandli diabet", "Yurak kasalligi", "Ajoyib chidamlilik", "Bir ko'zi ko'rmaydi", "Changga allergiya", "Oyog'i nogiron", "Tez charchaydi", "Temir salomatlik", "Surunkali bel og'rig'i", "Eshitishi zaif", "Qon bosimi baland"];
const XARAKTER = ["Rahmdil va sabrli", "Johil va tajovuzkor", "Aqlli rahbar", "Qo'rqoq", "Hazilkash", "Ochko'z", "Sodiq do'st", "Yolg'onchi", "Kamgap va kuzatuvchan", "Ishonchsiz", "Jasur", "Hasadgo'y", "Tashabbuskor"];
const HOBBI = ["Baliq ovlash", "Bog'dorchilik", "Shaxmat", "Ovchilik", "Gitara chalish", "Yoga", "Kitob o'qish", "Yog'och o'ymakorligi", "Boks", "Pazandachilik", "Radio yig'ish", "Rasm chizish", "Sayohat qilish"];
const BUYUM = ["Birinchi yordam to'plami", "Chiroq va batareyalar", "Urug'lar to'plami", "Suv filtri", "Gitara", "3 oylik ratsiya", "Dorilar to'plami", "Ko'p vazifali pichoq", "Radio qabul qilgich", "Qo'l generatori", "Qalin ko'rpa-to'shak", "Kitoblar to'plami", "Kompas va xarita"];
const SIR = ["Aslida jinoyat sodir etgan", "Yashirin og'ir kasalligi bor", "Boy merosga ega", "Hech kimga aytmagan qarzi bor", "Mashhur shaxsning qarindoshi", "Oldin ham bunkerda yashagan", "Oilasi tashqarida qolib ketgan", "Soxta diplom bilan ishlagan", "Bunker egasining tanishi", "Yashirin oziq-ovqat zaxirasi bor", "Ikki xil hayot kechirgan", "O'zini begunoh deb da'vo qiladi", "Kelajakni bashorat qila oladi"];

const LABELS = {
  job: "💼 Kasb",
  age: "🎂 Yosh",
  health: "❤️ Sog'liq",
  character: "🧠 Xarakter",
  hobby: "🎯 Hobbi",
  item: "🎒 Buyum",
  secret: "🤫 Sir",
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function pickMany(pool, n) {
  return shuffle(pool).slice(0, n);
}

// ---------- XONALAR ----------

const rooms = {};

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 5; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]);
  return code;
}

function send(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function deleteRoom(room) {
  clearTimer(room);
  delete rooms[room.code];
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

function nameOf(room, id) {
  const p = room.players.find((x) => x.id === id);
  return p ? p.name : "?";
}

function addSystem(room, text) {
  room.chat.push({ system: true, text: text });
  if (room.chat.length > 80) room.chat.shift();
}

function secondsLeft(room) {
  if (!room.phaseEnds) return 0;
  return Math.max(0, Math.ceil((room.phaseEnds - Date.now()) / 1000));
}

function setPhase(room, phase, seconds, onEnd) {
  clearTimer(room);
  room.phase = phase;
  room.phaseEnds = seconds ? Date.now() + seconds * 1000 : 0;
  if (seconds) {
    room.timer = setTimeout(function () {
      room.timer = null;
      if (rooms[room.code] === room && room.phase === phase) onEnd(room);
    }, seconds * 1000);
  }
}

function broadcast(room) {
  if (room.started) {
    const base = {
      type: "game",
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      round: room.round,
      maxRounds: MAX_ROUNDS,
      disaster: room.disaster,
      capacity: room.capacity,
      total: room.players.length,
      aliveCount: alivePlayers(room).length,
      secondsLeft: secondsLeft(room),
      chat: room.chat.slice(-60),
      lastResult: room.phase === "result" ? room.lastResult : null,
      endInfo: room.phase === "end" ? room.endInfo : null,
      players: room.players.map((x) => ({
        id: x.id,
        name: x.name,
        online: !!x.ws,
        done: !!x.done,
        alive: !!x.alive,
        voted: !!(room.votes && room.votes[x.id]),
        revealed: x.revealed || {},
      })),
    };
    room.players.forEach((p) => {
      send(
        p.ws,
        Object.assign({}, base, {
          mydone: !!p.done,
          myAlive: !!p.alive,
          myVote: (room.votes && room.votes[p.id]) || null,
          me: (p.traits || []).map((t) => ({
            key: t.key,
            label: t.label,
            value: t.value,
            opened: !!(p.revealed && p.revealed[t.key]),
          })),
        })
      );
    });
    return;
  }
  const state = {
    type: "room",
    code: room.code,
    hostId: room.hostId,
    min: MIN_PLAYERS,
    max: MAX_PLAYERS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      online: !!p.ws,
    })),
  };
  room.players.forEach((p) => send(p.ws, state));
}

// ---------- O'YIN BOSQICHLARI ----------

function startGame(room) {
  const n = room.players.length;
  room.started = true;
  room.round = 1;
  room.disaster = DISASTERS[Math.floor(Math.random() * DISASTERS.length)];
  room.capacity = Math.max(1, Math.floor(n / 2));
  room.chat = [];
  room.votes = {};
  room.lastResult = null;
  room.endInfo = null;

  const jobs = pickMany(KASB, n);
  const healths = pickMany(SOGLIQ, n);
  const chars = pickMany(XARAKTER, n);
  const hobbies = pickMany(HOBBI, n);
  const items = pickMany(BUYUM, n);
  const secrets = pickMany(SIR, n);

  room.players.forEach((p, i) => {
    const age = 18 + Math.floor(Math.random() * 58);
    p.revealed = {};
    p.done = false;
    p.alive = true;
    p.totalVotes = 0;
    p.lastChat = 0;
    p.traits = [
      { key: "job", label: LABELS.job, value: jobs[i] },
      { key: "age", label: LABELS.age, value: age + " yosh" },
      { key: "health", label: LABELS.health, value: healths[i] },
      { key: "character", label: LABELS.character, value: chars[i] },
      { key: "hobby", label: LABELS.hobby, value: hobbies[i] },
      { key: "item", label: LABELS.item, value: items[i] },
      { key: "secret", label: LABELS.secret, value: secrets[i] },
    ];
  });

  setPhase(room, "reveal", 0);
  addSystem(room, "1-raund boshlandi. Har kim bitta kartasini hammaga ochsin.");
}

function revealDone(room) {
  const online = alivePlayers(room).filter((p) => p.ws);
  return online.length > 0 && online.every((p) => p.done);
}

function voteDone(room) {
  const online = alivePlayers(room).filter((p) => p.ws);
  return online.length > 0 && online.every((p) => room.votes[p.id]);
}

function beginDiscuss(room) {
  setPhase(room, "discuss", DISCUSS_SECONDS, beginVote);
  addSystem(room, "💬 Muhokama boshlandi! O'zingizni himoya qiling va boshqalarni tinglang.");
  broadcast(room);
}

function beginVote(room) {
  if (alivePlayers(room).length <= room.capacity) {
    return endGame(room);
  }
  room.votes = {};
  setPhase(room, "vote", VOTE_SECONDS, finishVote);
  addSystem(room, "🗳 Ovoz berish boshlandi! Bunkerdan kimni haydaysiz?");
  broadcast(room);
}

function finishVote(room) {
  if (room.phase !== "vote") return;
  const alive = alivePlayers(room);
  const counts = {};
  alive.forEach((p) => {
    counts[p.id] = 0;
  });
  Object.keys(room.votes).forEach((voter) => {
    const target = room.votes[voter];
    if (counts[target] !== undefined) counts[target] += 1;
  });
  let max = 0;
  alive.forEach((p) => {
    if (counts[p.id] > max) max = counts[p.id];
  });
  const top = alive.filter((p) => counts[p.id] === max);
  const out = top[Math.floor(Math.random() * top.length)];

  alive.forEach((p) => {
    p.totalVotes += counts[p.id];
  });

  out.alive = false;
  out.traits.forEach((t) => {
    out.revealed[t.key] = { label: t.label, value: t.value };
  });

  room.lastResult = {
    eliminatedId: out.id,
    name: out.name,
    tie: top.length > 1,
    noVotes: max === 0,
    tally: alive
      .map((p) => ({ id: p.id, name: p.name, votes: counts[p.id] }))
      .sort((a, b) => b.votes - a.votes),
    votes: Object.keys(room.votes).map((voter) => ({
      from: nameOf(room, voter),
      to: nameOf(room, room.votes[voter]),
    })),
  };

  setPhase(room, "result", 0);
  addSystem(room, "☠️ " + out.name + " bunkerdan haydaldi.");
  broadcast(room);
}

function endGame(room) {
  const winners = alivePlayers(room);
  room.players.forEach((p) => {
    (p.traits || []).forEach((t) => {
      p.revealed[t.key] = { label: t.label, value: t.value };
    });
  });
  room.endInfo = {
    rounds: room.round,
    winners: winners.map((p) => ({ id: p.id, name: p.name })),
    stats: room.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        alive: !!p.alive,
        totalVotes: p.totalVotes || 0,
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes),
  };
  setPhase(room, "end", 0);
  addSystem(room, "🏁 O'yin tugadi!");
  broadcast(room);
}

function afterPresenceChange(room) {
  if (!room.started) return;
  if (room.phase === "reveal" && revealDone(room)) return beginDiscuss(room);
  if (room.phase === "vote" && voteDone(room)) return finishVote(room);
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 20);
}

function removePlayer(ws) {
  const room = rooms[ws.roomCode];
  const id = ws.playerId;
  ws.roomCode = null;
  if (!room) return;
  room.players = room.players.filter((p) => p.id !== id);
  if (room.players.length === 0) {
    deleteRoom(room);
    return;
  }
  if (room.hostId === id) room.hostId = room.players[0].id;
  if (room.started && room.votes) delete room.votes[id];
  broadcast(room);
  afterPresenceChange(room);
}

wss.on("connection", (ws) => {
  ws.playerId = null;
  ws.roomCode = null;

  send(ws, { type: "hello", text: "BUNKER serveriga ulandingiz" });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      const id = String(msg.id || "");
      const name = cleanName(msg.name);
      if (!id || !name) {
        return send(ws, { type: "error", text: "Ismingizni yozing" });
      }
      if (ws.roomCode) removePlayer(ws);
      const code = makeCode();
      const room = {
        code: code,
        hostId: id,
        started: false,
        phase: "lobby",
        round: 0,
        chat: [],
        votes: {},
        timer: null,
        phaseEnds: 0,
        players: [{ id: id, name: name, ws: ws }],
      };
      rooms[code] = room;
      ws.playerId = id;
      ws.roomCode = code;
      broadcast(room);
    }

    if (msg.type === "join") {
      const id = String(msg.id || "");
      const name = cleanName(msg.name);
      const code = String(msg.code || "").trim().toUpperCase();
      if (!id || !name) {
        return send(ws, { type: "error", text: "Ismingizni yozing" });
      }
      const room = rooms[code];
      if (!room) {
        return send(ws, { type: "error", text: "Bunday xona topilmadi", fatal: true });
      }
      const existing = room.players.find((p) => p.id === id);
      if (existing) {
        if (existing.ws && existing.ws !== ws) existing.ws.roomCode = null;
        existing.ws = ws;
        existing.name = name;
      } else {
        if (room.started) {
          return send(ws, { type: "error", text: "O'yin allaqachon boshlangan", fatal: true });
        }
        if (room.players.length >= MAX_PLAYERS) {
          return send(ws, { type: "error", text: "Xona to'lgan", fatal: true });
        }
        room.players.push({ id: id, name: name, ws: ws });
      }
      ws.playerId = id;
      ws.roomCode = code;
      broadcast(room);
    }

    if (msg.type === "start") {
      const room = rooms[ws.roomCode];
      if (!room || room.hostId !== ws.playerId || room.started) return;
      if (room.players.length < MIN_PLAYERS) {
        return send(ws, { type: "error", text: "O'yinchilar yetarli emas" });
      }
      startGame(room);
      broadcast(room);
    }

    // Xususiyatni hammaga ochish
    if (msg.type === "reveal") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started || room.phase !== "reveal") return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p || !p.alive) return;
      if (p.done) {
        return send(ws, { type: "error", text: "Bu raundda allaqachon ochgansiz" });
      }
      const t = (p.traits || []).find((x) => x.key === msg.key);
      if (!t || p.revealed[t.key]) return;
      p.revealed[t.key] = { label: t.label, value: t.value };
      p.done = true;
      addSystem(room, "👁 " + p.name + " ochdi: " + t.label + " — " + t.value);
      if (revealDone(room)) {
        beginDiscuss(room);
      } else {
        broadcast(room);
      }
    }

    // WEBRTC: ovoz signallarini faqat bir xonadagi tirik o'yinchilarga uzatish
    if (msg.type === "voice-signal") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started) return;

      if (!["reveal", "discuss", "vote"].includes(room.phase)) return;

      const sender = room.players.find((p) => p.id === ws.playerId);
      const targetId = String(msg.to || "");
      const target = room.players.find((p) => p.id === targetId);

      if (!sender || !sender.alive || !sender.ws || sender.ws !== ws) return;
      if (!target || !target.alive || !target.ws) return;
      if (sender.id === target.id) return;

      if (!msg.data || typeof msg.data !== "object") return;

      let dataSize;
      try {
        dataSize = JSON.stringify(msg.data).length;
      } catch (e) {
        return;
      }

      if (dataSize > 16000) return;

      send(target.ws, {
        type: "voice-signal",
        from: sender.id,
        data: msg.data
      });
    }

    // Chat
    if (msg.type === "chat") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started) return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p || !p.alive) return;
      if (room.phase !== "reveal" && room.phase !== "discuss" && room.phase !== "vote") return;
      const text = String(msg.text || "").trim().slice(0, 200);
      if (!text) return;
      const now = Date.now();
      if (p.lastChat && now - p.lastChat < 600) return;
      p.lastChat = now;
      room.chat.push({ id: p.id, name: p.name, text: text });
      if (room.chat.length > 80) room.chat.shift();
      broadcast(room);
    }

    // Ovoz berish
    if (msg.type === "vote") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started || room.phase !== "vote") return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p || !p.alive) return;
      const target = room.players.find((x) => x.id === msg.target);
      if (!target || !target.alive || target.id === p.id) {
        return send(ws, { type: "error", text: "Bu o'yinchiga ovoz bera olmaysiz" });
      }
      room.votes[p.id] = target.id;
      if (voteDone(room)) {
        finishVote(room);
      } else {
        broadcast(room);
      }
    }

    // Xona egasi: muhokamani yoki ovoz berishni tezlatish
    if (msg.type === "skip") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started || room.hostId !== ws.playerId) return;
      if (room.phase === "discuss") beginVote(room);
      else if (room.phase === "vote") finishVote(room);
    }

    // Xona egasi: natijadan keyin keyingi raund
    if (msg.type === "nextround") {
      const room = rooms[ws.roomCode];
      if (!room || !room.started || room.hostId !== ws.playerId) return;
      if (room.phase !== "result") return;
      if (alivePlayers(room).length <= room.capacity || room.round >= MAX_ROUNDS) {
        return endGame(room);
      }
      room.round += 1;
      room.votes = {};
      room.lastResult = null;
      room.players.forEach((x) => {
        x.done = false;
      });
      setPhase(room, "reveal", 0);
      addSystem(room, room.round + "-raund boshlandi. Har kim bitta kartasini hammaga ochsin.");
      broadcast(room);
    }

    if (msg.type === "lobby") {
      const room = rooms[ws.roomCode];
      if (!room || room.hostId !== ws.playerId) return;
      clearTimer(room);
      room.started = false;
      room.phase = "lobby";
      room.round = 0;
      room.chat = [];
      room.votes = {};
      room.lastResult = null;
      room.endInfo = null;
      room.phaseEnds = 0;
      room.players.forEach((p) => {
        p.traits = null;
        p.revealed = {};
        p.done = false;
        p.alive = true;
      });
      broadcast(room);
    }

    if (msg.type === "leave") {
      removePlayer(ws);
      send(ws, { type: "left" });
    }
  });

  ws.on("close", () => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    const p = room.players.find((x) => x.id === ws.playerId);
    if (p && p.ws === ws) {
      p.ws = null;
      broadcast(room);
      afterPresenceChange(room);
    }
    // Hamma chiqib ketsa, 10 daqiqadan keyin xonani o'chiramiz
    setTimeout(() => {
      const r = rooms[room.code];
      if (r === room && r.players.every((x) => !x.ws)) deleteRoom(r);
    }, 10 * 60 * 1000);
  });
});

server.listen(PORT, () => {
  console.log("BUNKER server ishga tushdi, port: " + PORT);
});
