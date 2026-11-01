const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, game: "BUNKER", rooms: Object.keys(rooms).length });
});

// Barcha xonalar xotirada saqlanadi
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
