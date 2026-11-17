// O'yin rasmlarini (assets/*.jpg) yaratadi. Faqat rasmlarni qayta yasash kerak bo'lganda ishlatiladi:
//   node tools/make-images.js        (playwright va Chromium kerak; botning o'zi bunga muhtoj emas)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

// falokatlar tartibi server.js dagi DISASTERS bilan bir xil bo'lishi kerak
const DISASTERS = [
  { file: 'disaster_0', icon: '☢️', title: 'YADRO URUSHI', sub: 'Tashqarida zaharli nur. 5 yil yashirinib turish kerak.', glow: '#8bc34a' },
  { file: 'disaster_1', icon: '🧟', title: 'ZOMBI KASALLIGI', sub: 'Shaharlar vayron bo\'ldi. Tashqarida hech kim omon emas.', glow: '#9ccc65' },
  { file: 'disaster_2', icon: '☄️', title: 'OSMONDAN TOSH YOG\'DI', sub: 'Quyosh bir necha yil ko\'rinmaydi.', glow: '#ff7043' },
  { file: 'disaster_3', icon: '🌊', title: 'KATTA TOSHQIN', sub: 'Quruqlik deyarli qolmadi. Bunker oxirgi najot.', glow: '#29b6f6' },
  { file: 'disaster_4', icon: '☣️', title: 'O\'LAT KASALLIGI', sub: 'Yer yuzi aholisining ko\'pchiligi nobud bo\'ldi.', glow: '#fdd835' },
  { file: 'disaster_5', icon: '🌋', title: 'VULQON OTILDI', sub: 'Osmonni kul qopladi. Qattiq sovuq boshlandi.', glow: '#ff5722' }
];
const OUTS = [
  { file: 'out_0', icon: '🚪', title: 'BUNKERDAN HAYDALDI', sub: 'Eshik yopildi. Siz tashqarida qoldingiz.', glow: '#e53935', red: true },
  { file: 'out_1', icon: '☠️', title: 'BUNKERDAN HAYDALDI', sub: 'Bunker endi sizsiz davom etadi.', glow: '#e53935', red: true },
  { file: 'out_2', icon: '🔒', title: 'BUNKERDAN HAYDALDI', sub: 'Jamoa qaror qildi. Qaytish yo\'q.', glow: '#e53935', red: true }
];
const WIN = [{ file: 'win', icon: '🏆', title: 'OMON QOLDINGIZ', sub: 'Bunker eshigi yopildi. Siz xavfsizsiz.', glow: '#f5c518' }];

const page = (d) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;font-family:'Inter','DejaVu Sans',sans-serif;
 background:radial-gradient(ellipse at 50% 38%, ${d.glow}33 0%, #141416 48%, #060607 100%);color:#eee;position:relative}
.stripe{position:absolute;left:0;right:0;height:46px;
 background:repeating-linear-gradient(-45deg,#f5c518 0 26px,#111 26px 52px);opacity:.92}
.top{top:0}.bot{bottom:0}
.grid{position:absolute;inset:46px 0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:64px 64px}
.wrap{position:absolute;inset:46px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px}
.icon{font-size:210px;line-height:1.15;filter:drop-shadow(0 0 46px ${d.glow}) drop-shadow(0 0 12px ${d.glow}aa);margin:4px 0 22px}
.tag{font-size:26px;letter-spacing:10px;font-weight:700;color:${d.red ? '#ff6b6b' : '#f5c518'};margin-bottom:0}
h1{font-size:${d.title.length > 18 ? 76 : 92}px;line-height:1.02;font-weight:900;letter-spacing:2px;color:${d.red ? '#ff4d4d' : '#f5c518'};
 text-shadow:0 0 28px ${d.glow}88, 0 4px 0 #000;${d.red ? 'border:6px solid #ff4d4d;padding:8px 34px;transform:rotate(-3deg);border-radius:10px;' : ''}}
p{margin-top:26px;font-size:36px;font-weight:500;color:#cfcfd2;max-width:1000px;line-height:1.25}
</style></head><body>
<div class="stripe top"></div><div class="grid"></div>
<div class="wrap"><div class="tag">${d.tag || 'B U N K E R'}</div><div class="icon">${d.icon}</div><h1>${d.title}</h1><p>${d.sub}</p></div>
<div class="stripe bot"></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const d of [...DISASTERS, ...OUTS, ...WIN]) {
    await p.setContent(page(d));
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, d.file + '.jpg'), type: 'jpeg', quality: 86 });
    console.log('tayyor:', d.file);
  }
  await browser.close();
})();
