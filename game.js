const BITE_TIME = 20;   // how long one bite animation lasts

// ---- Canvas ----
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// ---- Zoom with the scroll wheel ----
let zoom = 1;
window.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;   // up = in, down = out
  zoom = Math.max(0.4, Math.min(3, zoom * factor));
}, { passive: false });

// ---- The map: a square world with a Red nest (yours) and a Blue nest ----
const WORLD = 2000;
const nests = [
  { team: "red",  color: "#d0453f", x: 300,         y: WORLD / 2 },
  { team: "blue", color: "#4f8fe0", x: WORLD - 300, y: WORLD / 2 },
];
for (const n of nests) {
  n.queen = { x: n.x, y: n.y, size: 26, radius: 22, color: n.color };
}

// ---- Breakable rocks fill the map on a grid (dig through them) ----
const ROCK_STEP = 52;   // grid cell size
const ROCK_SIZE = 26;   // rock half-size (so tiles touch edge to edge)
const rocks = [];
const rockGrid = new Map();   // "i,j" -> rock, for fast lookup while digging
function rockKey(i, j) { return i + "," + j; }

function placeRocks() {
  rocks.length = 0;
  rockGrid.clear();
  for (let i = 0; ROCK_STEP / 2 + i * ROCK_STEP < WORLD; i++) {
    for (let j = 0; ROCK_STEP / 2 + j * ROCK_STEP < WORLD; j++) {
      const x = ROCK_STEP / 2 + i * ROCK_STEP;
      const y = ROCK_STEP / 2 + j * ROCK_STEP;
      let clear = false;
      for (const n of nests) {
        if (Math.hypot(x - n.x, y - n.y) < 200) clear = true;   // clear plaza around nests
      }
      if (clear) continue;
      const r = { x, y, i, j, size: ROCK_SIZE, hp: 8, maxHp: 8, broken: false };
      rocks.push(r);
      rockGrid.set(rockKey(i, j), r);
    }
  }
}
placeRocks();

// Which grid cell is a world position in?
function cellIndex(v) { return Math.round((v - ROCK_STEP / 2) / ROCK_STEP); }

// Damage the rock in grid cell (i,j); smash it at 0 HP.
function digAt(i, j, amount) {
  const r = rockGrid.get(rockKey(i, j));
  if (r && !r.broken) {
    r.hp -= amount;
    if (r.hp <= 0) {
      r.broken = true;
      rockGrid.delete(rockKey(i, j));
    }
  }
}

// ---- Collision helpers ----
// Push circle `a` out of another circle `b`.
function keepApart(a, b) {
  const minDist = a.radius + b.radius;
  const dx = a.x - b.x, dy = a.y - b.y;
  const dist = Math.hypot(dx, dy);
  if (dist < minDist && dist > 0) {
    a.x = b.x + (dx / dist) * minDist;
    a.y = b.y + (dy / dist) * minDist;
  }
}
// Push circle `a` (radius rad) out of the square rock `r`.
function keepOutOfRock(a, r, rad) {
  const s = r.size;
  const nx = Math.max(r.x - s, Math.min(a.x, r.x + s));
  const ny = Math.max(r.y - s, Math.min(a.y, r.y + s));
  const dx = a.x - nx, dy = a.y - ny;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    const pen = [a.x - (r.x - s), (r.x + s) - a.x, a.y - (r.y - s), (r.y + s) - a.y];
    const min = Math.min(...pen);
    if (min === pen[0]) a.x = r.x - s - rad;
    else if (min === pen[1]) a.x = r.x + s + rad;
    else if (min === pen[2]) a.y = r.y - s - rad;
    else a.y = r.y + s + rad;
  } else if (dist < rad) {
    const push = rad - dist;
    a.x += (dx / dist) * push;
    a.y += (dy / dist) * push;
  }
}

// ---- Game state: menu until you press Play ----
let gameState = "menu";

function startGame() {
  player.team = "red";
  player.color = nests[0].color;
  player.x = nests[0].x;
  player.y = nests[0].y + 60;
  document.getElementById("menu").style.display = "none";
  document.getElementById("hud").style.display = "block";
  gameState = "playing";
}

// ---- Menu buttons ----
document.getElementById("playBtn").addEventListener("click", startGame);
const panel = document.getElementById("panel");
document.getElementById("howBtn").addEventListener("click", () => {
  if (panel.dataset.showing === "how") {
    panel.textContent = "";
    panel.dataset.showing = "";
  } else {
    panel.innerHTML =
      "Move with <b>WASD</b> — your ant faces the way it walks.<br>" +
      "Left-click to bite &amp; dig through the rock.";
    panel.dataset.showing = "how";
  }
});

// ---- Update ----
function update() {
  if (gameState !== "playing") return;

  // build a movement direction from the keys
  const sx = player.x, sy = player.y;
  let mvx = 0, mvy = 0;
  if (keys["w"] || keys["arrowup"])    mvy -= 1;
  if (keys["s"] || keys["arrowdown"])  mvy += 1;
  if (keys["a"] || keys["arrowleft"])  mvx -= 1;
  if (keys["d"] || keys["arrowright"]) mvx += 1;
  if (mvx !== 0 || mvy !== 0) {
    const len = Math.hypot(mvx, mvy);          // normalize so diagonals aren't faster
    player.x += (mvx / len) * player.speed;
    player.y += (mvy / len) * player.speed;

    // glide toward the walk direction instead of snapping
    const target = Math.atan2(mvy, mvx);
    let diff = target - player.angle;
    while (diff >  Math.PI) diff -= 2 * Math.PI;  // take the shorter way around
    while (diff < -Math.PI) diff += 2 * Math.PI;
    player.angle += diff * 0.2;                 // 0.2 = how fast it turns
  }

  // collide with queens and rocks, then stay in the world
  for (const n of nests) keepApart(player, n.queen);
  const bodyR = player.size * 0.85;
  for (const r of rocks) {
    if (r.broken) continue;
    if (Math.abs(r.x - player.x) > 90 || Math.abs(r.y - player.y) > 90) continue;
    keepOutOfRock(player, r, bodyR);
  }
  const m = player.radius;
  player.x = Math.max(m, Math.min(WORLD - m, player.x));
  player.y = Math.max(m, Math.min(WORLD - m, player.y));

  // walk animation
  player.moving = (player.x !== sx || player.y !== sy);
  if (player.moving) player.walkPhase += 0.35;

  // bite (dig)
  if (mouse.down && player.biteAnim <= 0 && player.biteCooldown <= 0) {
    player.biteAnim = BITE_TIME;
    player.biteCooldown = BITE_TIME + 6;
  }
  if (player.biteAnim === 10) {   // the bite lands mid-animation
    // which cell am I in, and which way am I facing? (rounds to one of 8 dirs)
    const ai = cellIndex(player.x), aj = cellIndex(player.y);
    const dx = Math.round(Math.cos(player.angle));   // -1, 0, or 1
    const dy = Math.round(Math.sin(player.angle));
    if (dx !== 0 && dy !== 0) {
      // diagonal: dig the two side blocks first; only once both are gone
      // do we start on the block in the corner ahead.
      const sideA = rockGrid.get(rockKey(ai + dx, aj));
      const sideB = rockGrid.get(rockKey(ai, aj + dy));
      if (sideA || sideB) {
        digAt(ai + dx, aj, 4);
        digAt(ai, aj + dy, 4);
      } else {
        digAt(ai + dx, aj + dy, 4);
      }
    } else {
      digAt(ai + dx, aj + dy, 4);        // straight ahead: just the one block
    }
  }
  if (player.biteAnim > 0) player.biteAnim--;
  if (player.biteCooldown > 0) player.biteCooldown--;
}

// ---- Drawing ----
function drawGround() {
  const halfW = canvas.width / 2 / zoom, halfH = canvas.height / 2 / zoom;
  const left = player.x - halfW - 30, right = player.x + halfW + 30;
  const top = player.y - halfH - 30, bottom = player.y + halfH + 30;
  const spacing = 60;
  ctx.fillStyle = "#2a2011";
  const startX = Math.floor(left / spacing) * spacing;
  const startY = Math.floor(top / spacing) * spacing;
  for (let x = startX; x < right; x += spacing) {
    for (let y = startY; y < bottom; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRocks() {
  const halfW = canvas.width / 2 / zoom, halfH = canvas.height / 2 / zoom;
  const left = player.x - halfW - 30, right = player.x + halfW + 30;
  const top = player.y - halfH - 30, bottom = player.y + halfH + 30;
  for (const r of rocks) {
    if (r.broken) continue;
    if (r.x < left || r.x > right || r.y < top || r.y > bottom) continue;
    const s = r.size;
    ctx.fillStyle = "#6b6b70";
    ctx.fillRect(r.x - s, r.y - s, s * 2, s * 2);
    ctx.strokeStyle = "#3f3f45";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - s, r.y - s, s * 2, s * 2);
    if (r.hp < r.maxHp) {   // damage bar once hit
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(r.x - s, r.y - s - 6, s * 2, 3);
      ctx.fillStyle = "#d0d0d0";
      ctx.fillRect(r.x - s, r.y - s - 6, s * 2 * (r.hp / r.maxHp), 3);
    }
  }
}

function drawNests() {
  for (const n of nests) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawQueen(n.queen);

    ctx.fillStyle = n.color;
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.team.toUpperCase() + (n.team === player.team ? " (you)" : ""), n.x, n.y - 52);
  }
}

function draw() {
  ctx.fillStyle = "#1a1207";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (gameState !== "playing") return;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-player.x, -player.y);

  drawGround();
  ctx.strokeStyle = "#4a3820";
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, WORLD, WORLD);
  drawRocks();
  drawNests();
  drawAnt(player);
  // white ring so you can spot yourself
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.size + 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// ---- Loop ----
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
