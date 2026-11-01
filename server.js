const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Sahifalarni public papkasidan beradi
app.use(express.static(path.join(__dirname, "public")));

// Server ishlayotganini tekshirish uchun
app.get("/health", (req, res) => {
  res.json({ ok: true, game: "BUNKER" });
});

// Real vaqt aloqasi (keyingi qadamlarda o'yin shu yerda ishlaydi)
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", text: "BUNKER serveriga ulandingiz" }));
});

server.listen(PORT, () => {
  console.log("BUNKER server ishga tushdi, port: " + PORT);
});
