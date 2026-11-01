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

function startGame(room) {
  const n = room.players.length;
  room.started = true;
  room.phase = "cards";
  room.disaster = DISASTERS[Math.floor(Math.random() * DISASTERS.length)];
  room.capacity = Math.max(1, Math.floor(n / 2));

  const jobs = pickMany(KASB, n);
  const healths = pickMany(SOGLIQ, n);
  const chars = pickMany(XARAKTER, n);
  const hobbies = pickMany(HOBBI, n);
  const items = pickMany(BUYUM, n);
  const secrets = pickMany(SIR, n);

  room.players.forEach((p, i) => {
    const age = 18 + Math.floor(Math.random() * 58);
    p.revealed = {};
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

function broadcast(room) {
  if (room.started) {
    room.players.forEach((p) => {
      send(p.ws, {
        type: "game",
        code: room.code,
        hostId: room.hostId,
        phase: room.phase,
        disaster: room.disaster,
        capacity: room.capacity,
        total: room.players.length,
        me: p.traits || [],
        players: room.players.map((x) => ({
          id: x.id,
          name: x.name,
          online: !!x.ws,
          revealed: x.revealed || {},
        })),
      });
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
    delete rooms[room.code];
    return;
  }
  if (room.hostId === id) room.hostId = room.players[0].id;
  broadcast(room);
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

    if (msg.type === "lobby") {
      const room = rooms[ws.roomCode];
      if (!room || room.hostId !== ws.playerId) return;
      room.started = false;
      room.phase = "lobby";
      room.players.forEach((p) => {
        p.traits = null;
        p.revealed = {};
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
    }
    // Hamma chiqib ketsa, 10 daqiqadan keyin xonani o'chiramiz
    setTimeout(() => {
      const r = rooms[room.code];
      if (r && r.players.every((x) => !x.ws)) delete rooms[room.code];
    }, 10 * 60 * 1000);
  });
});

server.listen(PORT, () => {
  console.log("BUNKER server ishga tushdi, port: " + PORT);
});
