<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>BUNKER</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; }
    body {
      min-height: 100vh;
      background: radial-gradient(circle at 50% 0%, #2a2a2a 0%, #121212 60%, #0a0a0a 100%);
      color: #eee;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
    }
    .box { width: 100%; max-width: 420px; margin: 0 auto; text-align: center; }
    .screen { display: none; }
    .screen.active { display: block; animation: fadeIn 0.4s; }
    .icon { font-size: 60px; animation: pulse 2s infinite; margin-top: 10px; }
    h1 {
      font-size: 42px;
      letter-spacing: 8px;
      color: #ffc400;
      text-shadow: 0 0 20px rgba(255, 196, 0, 0.4);
      margin: 8px 0 6px;
    }
    .sub { color: #999; margin-bottom: 20px; font-size: 15px; }
    .status {
      display: inline-block;
      padding: 7px 14px;
      border-radius: 20px;
      font-size: 13px;
      background: #222;
      border: 1px solid #444;
      margin-bottom: 22px;
    }
    .status.ok { color: #6dff8a; border-color: #2e7d3f; }
    .status.bad { color: #ff5252; border-color: #b71c1c; }
    input {
      width: 100%;
      padding: 15px;
      margin-bottom: 12px;
      background: #1b1b1b;
      border: 1px solid #444;
      border-radius: 12px;
      color: #fff;
      font-size: 16px;
      text-align: center;
      outline: none;
    }
    input:focus { border-color: #ffc400; }
    input.code { letter-spacing: 6px; text-transform: uppercase; font-weight: 700; }
    .btn {
      display: block;
      width: 100%;
      padding: 15px;
      margin-bottom: 12px;
      border: none;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn.yellow { background: #ffc400; color: #111; }
    .btn.red { background: #c62828; color: #fff; }
    .btn.gray { background: #2a2a2a; color: #ddd; border: 1px solid #444; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn:active:not(:disabled) { transform: scale(0.97); }
    .or { color: #666; margin: 6px 0 12px; font-size: 14px; }
    .codebox {
      background: #1b1b1b;
      border: 2px dashed #ffc400;
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 16px;
      cursor: pointer;
    }
    .codebox small { color: #999; display: block; margin-bottom: 4px; }
    .codebox .big { font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #ffc400; }
    .count { color: #aaa; margin-bottom: 10px; font-size: 14px; }
    .hint { color: #888; font-size: 13px; margin-bottom: 12px; }

    .players { list-style: none; margin-bottom: 10px; }
    .players li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      background: #1b1b1b;
      border: 1px solid #333;
      border-left: 4px solid #c62828;
      border-radius: 10px;
      padding: 9px 12px;
      margin-bottom: 7px;
      text-align: left;
    }
    .players li.me { border-left-color: #ffc400; }
    .players li.off { opacity: 0.45; }
    .players li.dead { opacity: 0.6; border-left-color: #555; background: #151515; }
    .players li.dead .pname { text-decoration: line-through; }
    .players .tag { font-size: 12px; color: #888; }
    .players .revs {
      width: 100%;
      margin-top: 7px;
      padding-top: 7px;
      border-top: 1px solid #2c2c2c;
      font-size: 12px;
      color: #ccc;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px 10px;
    }
    .players .revs b { color: #ffc400; font-weight: 600; }

    /* ===== O'YIN EKRANI (butun ekran) ===== */
    #gameScreen.active {
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      max-width: 480px;
      margin: 0 auto;
      background: radial-gradient(circle at 50% 0%, #2a2a2a 0%, #121212 60%, #0a0a0a 100%);
      z-index: 5;
      animation: none;
      text-align: left;
    }
    .ghead {
      flex: 0 0 auto;
      padding: 8px 12px 6px;
      background: #141414;
      border-bottom: 1px solid #c62828;
      position: relative;
    }
    .hrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .hdis { font-size: 14px; font-weight: 800; color: #ff5252; cursor: pointer; flex: 1; }
    .hmenu {
      background: #2a2a2a;
      color: #ddd;
      border: 1px solid #444;
      border-radius: 8px;
      font-size: 17px;
      width: 36px;
      height: 30px;
      cursor: pointer;
    }
    .hdistext { display: none; font-size: 12px; color: #ddd; line-height: 1.45; margin: 5px 0 2px; }
    .hphase { font-size: 14px; font-weight: 700; color: #ffc400; margin-top: 3px; }
    .htimer { font-size: 17px; font-weight: 800; color: #ff5252; min-width: 80px; text-align: right; }
    .hsub { font-size: 12px; color: #aaa; margin-top: 1px; }
    .menupanel {
      display: none;
      position: absolute;
      right: 10px;
      top: 46px;
      background: #1d1d1d;
      border: 1px solid #555;
      border-radius: 12px;
      padding: 8px;
      z-index: 30;
      min-width: 220px;
    }
    .menupanel .btn { margin-bottom: 6px; padding: 12px; font-size: 15px; }
    .menupanel .btn:last-child { margin-bottom: 0; }

    .gmain { flex: 1 1 auto; min-height: 0; position: relative; }
    .pane { display: none; height: 100%; overflow-y: auto; padding: 8px 12px; -webkit-overflow-scrolling: touch; }
    .pane.active { display: block; }

    .gnote {
      background: #1b1b1b;
      border: 1px solid #444;
      border-radius: 10px;
      padding: 7px 10px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #ccc;
    }
    .gnote.red { border-color: #c62828; background: #1f1212; color: #ffb3b3; }
    .gnote.gold { border-color: #ffc400; background: #1f1a08; color: #ffe08a; }

    /* Kartalar: 2 ustun */
    .cardsgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .card {
      position: relative;
      background: #1b1b1b;
      border: 1px solid #333;
      border-left: 4px solid #ffc400;
      border-radius: 10px;
      padding: 8px 10px;
      min-height: 58px;
    }
    .card.secret { border-left-color: #c62828; background: #221414; }
    .card.opened { border-left-color: #2e7d3f; }
    .card .clabel { font-size: 11px; color: #999; margin-bottom: 2px; }
    .card .cvalue { font-size: 14px; font-weight: 600; line-height: 1.25; padding-right: 30px; }
    .card .copened { position: absolute; top: 7px; right: 8px; font-size: 14px; }
    .openico {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #ffc400;
      color: #111;
      border: none;
      font-size: 16px;
      cursor: pointer;
    }
    .openico:active { transform: scale(0.9); }
    .votebtn {
      padding: 8px 12px;
      background: #c62828;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .votebtn.sel { background: #2e7d3f; }

    /* Chat: doim pastda ko'rinadi */
    .chatpanel {
      flex: 0 0 auto;
      position: relative;
      padding: 6px 12px;
      background: #101010;
      border-top: 1px solid #333;
    }
    .chatbox {
      height: 104px;
      overflow-y: auto;
      background: #141414;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 8px 34px 8px 8px;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .chatpanel.big .chatbox { height: 34vh; }
    .chatexp {
      position: absolute;
      top: 10px;
      right: 18px;
      width: 28px;
      height: 26px;
      background: rgba(40, 40, 40, 0.95);
      color: #ccc;
      border: 1px solid #555;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      z-index: 2;
    }
    .msg { margin-bottom: 5px; word-break: break-word; }
    .msg.sys { color: #aaa; font-style: italic; font-size: 12px; }
    .msg b { color: #9ecbff; }
    .msg.mine b { color: #ffc400; }
    .chatrow { display: flex; gap: 8px; }
    .chatrow input { flex: 1; min-width: 0; margin-bottom: 0; text-align: left; padding: 10px 12px; }
    .chatrow button {
      padding: 0 18px;
      background: #ffc400;
      color: #111;
      border: none;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
    }
    .chatclosed { text-align: center; color: #888; font-size: 12px; padding: 6px; }

    .actionbar {
      flex: 0 0 auto;
      padding: 8px 12px 0;
      background: #101010;
      display: none;
    }
    .actionbar .btn { margin-bottom: 8px; padding: 12px; font-size: 16px; }
    .tabbar {
      flex: 0 0 auto;
      display: flex;
      background: #141414;
      border-top: 1px solid #333;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .tabbtn {
      flex: 1;
      position: relative;
      padding: 11px 4px;
      background: none;
      border: none;
      color: #888;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .tabbtn.active { color: #ffc400; box-shadow: inset 0 3px 0 #ffc400; }
    .tabbtn .dot {
      display: none;
      position: absolute;
      top: 5px;
      right: 18%;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: #e53935;
      color: #fff;
      font-size: 11px;
      line-height: 16px;
      font-weight: 700;
    }
    .tabbtn .dot.show { display: block; }

    /* Natija / yakun oynasi */
    .overlay {
      display: none;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 20;
      padding: 10px;
      overflow-y: auto;
    }
    .overlay.show { display: block; }
    .obox {
      background: #1a1414;
      border: 1px solid #c62828;
      border-radius: 14px;
      padding: 12px;
      animation: fadeIn 0.35s;
    }
    .obox.gold { border-color: #ffc400; background: #1f1a08; }
    .obox h3 { font-size: 19px; color: #ff5252; margin-bottom: 8px; }
    .obox.gold h3 { color: #ffc400; }
    .obox .row { font-size: 14px; margin-bottom: 4px; color: #ddd; }
    .obox .note { font-size: 13px; color: #aaa; margin: 8px 0 5px; }
    .obox .btn { margin-top: 10px; margin-bottom: 0; }

    #toast {
      position: fixed;
      left: 50%;
      bottom: 110px;
      transform: translateX(-50%) translateY(200px);
      background: #c62828;
      color: #fff;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 15px;
      max-width: 90%;
      transition: transform 0.3s;
      z-index: 50;
    }
    #toast.show { transform: translateX(-50%) translateY(0); }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  </style>
</head>
<body>
  <div class="box">

    <!-- BOSH EKRAN -->
    <div id="homeScreen" class="screen active">
      <div class="icon">☢️</div>
      <h1>BUNKER</h1>
      <p class="sub">Apokalipsisdan keyin kim omon qoladi?</p>
      <div id="status" class="status">Serverga ulanmoqda...</div>

      <input id="nameInput" type="text" maxlength="20" placeholder="Ismingiz" autocomplete="off">
      <button class="btn yellow" onclick="createRoom()">🚪 Xona yaratish</button>
      <div class="or">— yoki —</div>
      <input id="codeInput" class="code" type="text" maxlength="5" placeholder="XONA KODI" autocomplete="off">
      <button class="btn red" onclick="joinRoom()">🔑 Kod bilan kirish</button>
    </div>

    <!-- LOBBI EKRANI -->
    <div id="lobbyScreen" class="screen">
      <div class="icon">🚪</div>
      <h1 style="font-size:30px;letter-spacing:5px;">LOBBI</h1>
      <div id="status2" class="status">Serverga ulanmoqda...</div>

      <div class="codebox" id="codeBox">
        <small>Xona kodi (bosib nusxalang)</small>
        <div class="big" id="roomCode">-----</div>
      </div>

      <button class="btn gray" onclick="inviteFriends()">📨 Do'stlarni taklif qilish</button>

      <div class="count" id="countText"></div>
      <ul class="players" id="playersList"></ul>

      <button class="btn yellow" id="startBtn" onclick="startGame()" style="display:none;">▶️ O'yinni boshlash</button>
      <p class="hint" id="hintText"></p>
      <button class="btn gray" onclick="leaveRoom()">⬅️ Xonadan chiqish</button>
    </div>

    <!-- O'YIN EKRANI -->
    <div id="gameScreen" class="screen">

      <div class="ghead">
        <div class="hrow">
          <div class="hdis" id="hDisaster" onclick="toggleDisaster()"></div>
          <button class="hmenu" onclick="toggleMenu()">☰</button>
        </div>
        <div class="hdistext" id="hDisasterText"></div>
        <div class="hrow">
          <div class="hphase" id="hPhase"></div>
          <div class="htimer" id="hTimer"></div>
        </div>
        <div class="hsub" id="hSub"></div>

        <div class="menupanel" id="menuPanel">
          <div id="gstatusWrap" class="status" style="margin:0 0 8px;font-size:12px;"></div>
          <button class="btn gray" id="menuBack" onclick="menuBack()" style="display:none;">🔄 Lobbiga qaytish</button>
          <button class="btn gray" onclick="menuLeave()">⬅️ Xonadan chiqish</button>
        </div>
      </div>

      <div class="gmain">
        <div class="pane active" id="tabCards"></div>
        <div class="pane" id="tabPlayers"></div>
        <div class="overlay" id="overlay"></div>
      </div>

      <div class="chatpanel" id="chatPanel">
        <div class="chatbox" id="chatBox"></div>
        <button class="chatexp" onclick="toggleChat()">⤢</button>
        <div class="chatrow" id="chatRow">
          <input id="chatInput" type="text" maxlength="200" placeholder="Xabar yozing..." autocomplete="off">
          <button onclick="sendChat()">➤</button>
        </div>
        <div class="chatclosed" id="chatClosed" style="display:none;"></div>
      </div>

      <div class="actionbar" id="actionBar"></div>

      <div class="tabbar">
        <button class="tabbtn active" id="tbCards" onclick="setTab('cards')">
          🪪 Karta<span class="dot" id="dotCards">!</span>
        </button>
        <button class="tabbtn" id="tbPlayers" onclick="setTab('players')">
          👥 O'yinchilar<span class="dot" id="dotPlayers">!</span>
        </button>
      </div>
    </div>

  </div>

  <div id="toast"></div>

  <script>
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      try { tg.ready(); } catch (e) {}
      try { tg.expand(); } catch (e) {}
      try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
    }

    // ---- Foydalanuvchi ----
    var myId = null;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      myId = "tg" + tg.initDataUnsafe.user.id;
    } else {
      try { myId = localStorage.getItem("bunkerId"); } catch (e) {}
      if (!myId) {
        myId = "u" + Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem("bunkerId", myId); } catch (e) {}
      }
    }

    var nameInput = document.getElementById("nameInput");
    var savedName = "";
    try { savedName = localStorage.getItem("bunkerName") || ""; } catch (e) {}
    if (!savedName && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      savedName = tg.initDataUnsafe.user.first_name || "";
    }
    nameInput.value = savedName;

    // ---- Holat ----
    var ws = null;
    var currentCode = null;
    var myName = savedName;
    var deadline = 0;
    var lastGame = null;
    var activeTab = "cards";
    var lastPhaseKey = "";
    var dismissedKey = "";
    var SCREENS = ["homeScreen", "lobbyScreen", "gameScreen"];

    function showScreen(id) {
      SCREENS.forEach(function (s) {
        document.getElementById(s).classList.remove("active");
      });
      document.getElementById(id).classList.add("active");
    }

    function setStatus(ok, text) {
      ["status", "status2", "gstatusWrap"].forEach(function (id) {
        var e = document.getElementById(id);
        e.textContent = text;
        e.className = "status " + (ok ? "ok" : "bad");
      });
    }

    var toastTimer = null;
    function toast(text) {
      var e = document.getElementById("toast");
      e.textContent = text;
      e.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { e.classList.remove("show"); }, 2800);
    }

    // Taymer
    setInterval(function () {
      var e = document.getElementById("hTimer");
      if (!deadline) { e.textContent = ""; return; }
      var s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      e.textContent = "⏱ " + s + " s";
    }, 500);

    // ---- Server bilan aloqa ----
    function connect() {
      var proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(proto + "://" + location.host);

      ws.onopen = function () {
        setStatus(true, "🟢 Server bilan aloqa bor");
        if (currentCode) {
          send({ type: "join", id: myId, name: myName, code: currentCode });
        }
      };

      ws.onmessage = function (event) {
        var m;
        try { m = JSON.parse(event.data); } catch (e) { return; }

        if (m.type === "room") {
          currentCode = m.code;
          deadline = 0;
          lastPhaseKey = "";
          dismissedKey = "";
          renderLobby(m);
          showScreen("lobbyScreen");
        }
        if (m.type === "game") {
          currentCode = m.code;
          renderGame(m);
          showScreen("gameScreen");
        }
        if (m.type === "error") {
          toast(m.text);
          if (m.fatal) {
            currentCode = null;
            showScreen("homeScreen");
          }
        }
        if (m.type === "left") {
          currentCode = null;
          deadline = 0;
          lastPhaseKey = "";
          showScreen("homeScreen");
        }
      };

      ws.onclose = function () {
        setStatus(false, "🔴 Aloqa uzildi, qayta ulanmoqda...");
        setTimeout(connect, 2000);
      };
      ws.onerror = function () {
        setStatus(false, "🔴 Serverga ulanib bo'lmadi");
      };
    }

    function send(obj) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(obj));
        return true;
      }
      toast("Server bilan aloqa yo'q. Biroz kuting...");
      return false;
    }

    function getName() {
      var name = nameInput.value.trim();
      if (!name) {
        toast("Avval ismingizni yozing");
        nameInput.focus();
        return null;
      }
      myName = name;
      try { localStorage.setItem("bunkerName", name); } catch (e) {}
      return name;
    }

    // ---- Tugmalar ----
    function createRoom() {
      var name = getName();
      if (!name) return;
      send({ type: "create", id: myId, name: name });
    }

    function joinRoom() {
      var name = getName();
      if (!name) return;
      var code = document.getElementById("codeInput").value.trim().toUpperCase();
      if (code.length !== 5) {
        toast("Xona kodi 5 ta belgidan iborat");
        return;
      }
      send({ type: "join", id: myId, name: name, code: code });
    }

    function leaveRoom() { send({ type: "leave" }); }
    function startGame() { send({ type: "start" }); }
    function backToLobby() { send({ type: "lobby" }); }
    function nextRound() { send({ type: "nextround" }); }
    function skipPhase() { send({ type: "skip" }); }

    function toggleDisaster() {
      var e = document.getElementById("hDisasterText");
      e.style.display = e.style.display === "block" ? "none" : "block";
    }
    function toggleMenu() {
      var e = document.getElementById("menuPanel");
      e.style.display = e.style.display === "block" ? "none" : "block";
    }
    function menuLeave() {
      document.getElementById("menuPanel").style.display = "none";
      leaveRoom();
    }
    function menuBack() {
      document.getElementById("menuPanel").style.display = "none";
      backToLobby();
    }
    function toggleChat() {
      document.getElementById("chatPanel").classList.toggle("big");
      var box = document.getElementById("chatBox");
      box.scrollTop = box.scrollHeight;
    }

    function sendChat() {
      var inp = document.getElementById("chatInput");
      var t = inp.value.trim();
      if (!t) return;
      if (send({ type: "chat", text: t })) inp.value = "";
    }
    document.getElementById("chatInput").onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendChat(); }
    };

    function inviteFriends() {
      var text = "☢️ BUNKER o'yiniga qo'shil! Xona kodi: " + currentCode;
      var link = "https://t.me/Bunkeruz1_bot";
      var url = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text);
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(url);
      } else {
        window.open(url, "_blank");
      }
    }

    document.getElementById("codeBox").onclick = function () {
      var c = currentCode;
      if (!c) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(c).then(
          function () { toast("Kod nusxalandi: " + c); },
          function () { toast("Kod: " + c); }
        );
      } else {
        toast("Kod: " + c);
      }
    };

    // ---- Tablar ----
    function setTab(name) {
      activeTab = name;
      document.getElementById("tabCards").classList.toggle("active", name === "cards");
      document.getElementById("tabPlayers").classList.toggle("active", name === "players");
      document.getElementById("tbCards").classList.toggle("active", name === "cards");
      document.getElementById("tbPlayers").classList.toggle("active", name === "players");
    }

    // ---- Lobbi chizish ----
    function renderLobby(m) {
      document.getElementById("roomCode").textContent = m.code;
      document.getElementById("countText").textContent =
        "O'yinchilar: " + m.players.length + " / " + m.max + " (kamida " + m.min + " kerak)";

      var list = document.getElementById("playersList");
      list.innerHTML = "";
      m.players.forEach(function (p) {
        var li = document.createElement("li");
        if (p.id === myId) li.className = "me";
        if (!p.online) li.className += " off";

        var left = document.createElement("span");
        left.textContent = (p.id === m.hostId ? "👑 " : "👤 ") + p.name;

        var right = document.createElement("span");
        right.className = "tag";
        right.textContent = (p.id === myId ? "siz" : "") + (p.online ? "" : " (uzilgan)");

        li.appendChild(left);
        li.appendChild(right);
        list.appendChild(li);
      });

      var startBtn = document.getElementById("startBtn");
      var hint = document.getElementById("hintText");
      var isHost = m.hostId === myId;
      if (isHost) {
        startBtn.style.display = "block";
        startBtn.disabled = m.players.length < m.min;
        hint.textContent = m.players.length < m.min
          ? "Boshlash uchun yana " + (m.min - m.players.length) + " ta o'yinchi kerak"
          : "Hammasi tayyor!";
      } else {
        startBtn.style.display = "none";
        hint.textContent = "Xona egasi o'yinni boshlashini kuting...";
      }
    }

    // ---- Yordamchilar ----
    function el(tag, cls, text) {
      var d = document.createElement(tag);
      if (cls) d.className = cls;
      if (text !== undefined) d.textContent = text;
      return d;
    }

    function makeBtn(text, cls, handler) {
      var b = el("button", "btn " + cls, text);
      b.onclick = handler;
      return b;
    }

    // ---- Chat ----
    function renderChat(list) {
      var box = document.getElementById("chatBox");
      var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = "";
      list.forEach(function (c) {
        var d = el("div", "msg");
        if (c.system) {
          d.className = "msg sys";
          d.textContent = c.text;
        } else {
          d.className = "msg" + (c.id === myId ? " mine" : "");
          d.appendChild(el("b", "", c.name + ": "));
          d.appendChild(document.createTextNode(c.text));
        }
        box.appendChild(d);
      });
      if (nearBottom) box.scrollTop = box.scrollHeight;
    }

    // ---- O'yin ekranini chizish ----
    function renderGame(m) {
      lastGame = m;
      var phase = m.phase;
      var alive = m.players.filter(function (p) { return p.alive; });
      var isHost = m.hostId === myId;
      var phaseKey = phase + ":" + m.round;

      deadline = m.secondsLeft > 0 ? Date.now() + m.secondsLeft * 1000 : 0;

      document.getElementById("hDisaster").textContent = m.disaster.title + " ▾";
      document.getElementById("hDisasterText").textContent = m.disaster.text;

      var doneCount = alive.filter(function (p) { return p.done; }).length;
      var votedCount = alive.filter(function (p) { return p.voted; }).length;
      var title = "", sub = "";
      if (phase === "reveal") {
        title = "🔔 " + m.round + "-raund: kartani oching";
        sub = "Ochganlar: " + doneCount + "/" + alive.length;
      } else if (phase === "discuss") {
        title = "💬 Muhokama";
        sub = "Bahslashing, himoya qiling";
      } else if (phase === "vote") {
        title = "🗳 Ovoz berish";
        sub = "Ovoz berganlar: " + votedCount + "/" + alive.length;
      } else if (phase === "result") {
        title = "☠️ " + m.round + "-raund natijasi";
      } else if (phase === "end") {
        title = "🏁 O'yin tugadi";
      }
      document.getElementById("hPhase").textContent = title;
      document.getElementById("hSub").textContent =
        "🛡 Joy: " + m.capacity + " · Tirik: " + m.aliveCount + (sub ? " · " + sub : "");

      // Bosqich o'zgarsa kerakli tabni ochamiz
      if (phaseKey !== lastPhaseKey) {
        lastPhaseKey = phaseKey;
        dismissedKey = "";
        if (phase === "reveal") setTab("cards");
        else setTab("players");
      }

      // Qizil nuqtalar
      document.getElementById("dotCards").classList.toggle(
        "show", phase === "reveal" && m.myAlive && !m.mydone);
      document.getElementById("dotPlayers").classList.toggle(
        "show", phase === "vote" && m.myAlive && !m.myVote);

      document.getElementById("menuBack").style.display = isHost ? "block" : "none";

      renderCardsPane(m);
      renderPlayersPane(m);

      renderChat(m.chat || []);
      var chatAllowed = m.myAlive && (phase === "reveal" || phase === "discuss" || phase === "vote");
      document.getElementById("chatRow").style.display = chatAllowed ? "flex" : "none";
      var closed = document.getElementById("chatClosed");
      if (chatAllowed) {
        closed.style.display = "none";
      } else {
        closed.style.display = "block";
        closed.textContent = m.myAlive ? "Chat hozir yopiq" : "Haydalgan o'yinchilar yoza olmaydi";
      }

      renderOverlay(m, phaseKey);
      renderActionBar(m, phaseKey, isHost);
    }

    function renderCardsPane(m) {
      var pane = document.getElementById("tabCards");
      var phase = m.phase;
      pane.innerHTML = "";

      if (!m.myAlive && phase !== "end") {
        pane.appendChild(el("div", "gnote red", "👀 Siz bunkerdan haydalgansiz. Faqat tomosha qila olasiz."));
      } else if (phase === "reveal") {
        pane.appendChild(el("div", "gnote gold", m.mydone
          ? "✅ Bu raundda kartangizni ochdingiz. Boshqalarni kuting."
          : "👆 Bitta kartaning 👁 tugmasini bosib, hammaga oching."));
      } else {
        pane.appendChild(el("div", "gnote", "Bu kartalarni faqat siz ko'ryapsiz (ochilganlaridan tashqari)."));
      }

      var canOpen = phase === "reveal" && m.myAlive && !m.mydone;
      var grid = el("div", "cardsgrid");
      m.me.forEach(function (t) {
        var div = el("div", "card" + (t.key === "secret" ? " secret" : "") + (t.opened ? " opened" : ""));
        div.appendChild(el("div", "clabel", t.label));
        div.appendChild(el("div", "cvalue", t.value));
        if (t.opened) {
          div.appendChild(el("div", "copened", "✅"));
        } else if (canOpen) {
          var btn = el("button", "openico", "👁");
          btn.onclick = function () { send({ type: "reveal", key: t.key }); };
          div.appendChild(btn);
        }
        grid.appendChild(div);
      });
      pane.appendChild(grid);
    }

    function renderPlayersPane(m) {
      var pane = document.getElementById("tabPlayers");
      var phase = m.phase;
      var scroll = pane.scrollTop;
      pane.innerHTML = "";

      if (phase === "vote") {
        pane.appendChild(el("div", "gnote red", m.myAlive
          ? "🗳 Kimni haydaymiz? O'yinchi yonidagi tugmani bosing. Fikringizni o'zgartirishingiz mumkin."
          : "👀 Siz tomoshabinsiz, ovoz bera olmaysiz."));
      }

      var ul = el("ul", "players");
      m.players.forEach(function (p) {
        var li = el("li", "");
        if (p.id === myId) li.className = "me";
        if (!p.alive) li.className += " dead";
        else if (!p.online) li.className += " off";

        li.appendChild(el("span", "pname", (p.id === m.hostId ? "👑 " : "👤 ") + p.name));

        var canVote = phase === "vote" && m.myAlive && p.alive && p.id !== myId;
        if (canVote) {
          var btn = el("button", "votebtn" + (m.myVote === p.id ? " sel" : ""),
            m.myVote === p.id ? "✅ Tanlandi" : "🗳 Ovoz");
          btn.onclick = function () { send({ type: "vote", target: p.id }); };
          li.appendChild(btn);
        } else {
          var tag = "";
          if (!p.alive) tag = "☠️ haydalgan";
          else if (phase === "reveal") tag = p.done ? "✅" : "⏳";
          else if (phase === "vote") tag = p.voted ? "✅ ovoz berdi" : "⏳";
          if (p.id === myId) tag += (tag ? " · " : "") + "siz";
          li.appendChild(el("span", "tag", tag));
        }

        var keys = Object.keys(p.revealed || {});
        if (keys.length > 0) {
          var revs = el("div", "revs");
          keys.forEach(function (k) {
            var row = el("div", "");
            row.appendChild(el("b", "", p.revealed[k].label + ": "));
            row.appendChild(document.createTextNode(p.revealed[k].value));
            revs.appendChild(row);
          });
          li.appendChild(revs);
        }
        ul.appendChild(li);
      });
      pane.appendChild(ul);
      pane.scrollTop = scroll;
    }

    function renderOverlay(m, phaseKey) {
      var ov = document.getElementById("overlay");
      var phase = m.phase;
      var isHost = m.hostId === myId;
      var wanted = (phase === "result" && m.lastResult) || (phase === "end" && m.endInfo);
      if (!wanted || dismissedKey === phaseKey) {
        ov.classList.remove("show");
        ov.innerHTML = "";
        return;
      }
      ov.innerHTML = "";
      ov.classList.add("show");

      if (phase === "result") {
        var r = m.lastResult;
        var box = el("div", "obox");
        box.appendChild(el("h3", "", "☠️ " + r.name + " bunkerdan haydaldi!"));
        if (r.noVotes) box.appendChild(el("div", "note", "Hech kim ovoz bermadi, shuning uchun tasodifiy tanlandi."));
        else if (r.tie) box.appendChild(el("div", "note", "Ovozlar teng bo'ldi, shuning uchun tasodifiy tanlandi."));
        r.tally.forEach(function (t) {
          box.appendChild(el("div", "row", t.name + " — " + t.votes + " ovoz"));
        });
        if (r.votes.length > 0) {
          box.appendChild(el("div", "note", "Kim kimga ovoz berdi:"));
          r.votes.forEach(function (v) {
            box.appendChild(el("div", "row", v.from + " → " + v.to));
          });
        }
        box.appendChild(el("div", "note", "Uning hamma kartalari «O'yinchilar» tabida ochildi."));
        if (isHost) {
          box.appendChild(makeBtn(
            m.aliveCount <= m.capacity ? "🏁 O'yinni yakunlash" : "➡️ Keyingi raund",
            "yellow", nextRound));
        } else {
          box.appendChild(el("div", "note", "Xona egasi davom ettirishini kuting..."));
        }
        box.appendChild(makeBtn("✖ Yopish", "gray", function () {
          dismissedKey = phaseKey;
          renderGame(lastGame);
        }));
        ov.appendChild(box);
      } else {
        var e = m.endInfo;
        var eb = el("div", "obox gold");
        eb.appendChild(el("h3", "", "🏆 Bunkerga kirganlar"));
        if (e.winners.length === 0) eb.appendChild(el("div", "row", "Hech kim omon qolmadi."));
        e.winners.forEach(function (w) {
          eb.appendChild(el("div", "row", "🏆 " + w.name + (w.id === myId ? " (siz)" : "")));
        });
        eb.appendChild(el("div", "note", "📊 Statistika · Raundlar: " + e.rounds));
        e.stats.forEach(function (s) {
          eb.appendChild(el("div", "row",
            (s.alive ? "✅ " : "☠️ ") + s.name + " — jami " + s.totalVotes + " ovoz oldi"));
        });
        if (isHost) eb.appendChild(makeBtn("🔄 Yangi o'yin (lobbiga)", "yellow", backToLobby));
        eb.appendChild(makeBtn("⬅️ Xonadan chiqish", "gray", leaveRoom));
        eb.appendChild(makeBtn("✖ Yopish", "gray", function () {
          dismissedKey = phaseKey;
          renderGame(lastGame);
        }));
        ov.appendChild(eb);
      }
    }

    function renderActionBar(m, phaseKey, isHost) {
      var bar = document.getElementById("actionBar");
      var phase = m.phase;
      bar.innerHTML = "";
      var any = false;

      if (isHost && phase === "discuss") {
        bar.appendChild(makeBtn("⏭ Ovoz berishga o'tish", "yellow", skipPhase));
        any = true;
      } else if (isHost && phase === "vote") {
        bar.appendChild(makeBtn("⏭ Ovozni yakunlash", "yellow", skipPhase));
        any = true;
      } else if (phase === "result" && dismissedKey === phaseKey) {
        if (isHost) {
          bar.appendChild(makeBtn(
            m.aliveCount <= m.capacity ? "🏁 O'yinni yakunlash" : "➡️ Keyingi raund",
            "yellow", nextRound));
        }
        bar.appendChild(makeBtn("📊 Natijani ko'rish", "gray", function () {
          dismissedKey = "";
          renderGame(lastGame);
        }));
        any = true;
      } else if (phase === "end" && dismissedKey === phaseKey) {
        bar.appendChild(makeBtn("🏆 Yakunni ko'rish", "gray", function () {
          dismissedKey = "";
          renderGame(lastGame);
        }));
        any = true;
      }
      bar.style.display = any ? "block" : "none";
    }

    connect();
  </script>
</body>
</html>
