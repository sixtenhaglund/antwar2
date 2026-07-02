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
      // the outer ring of cubes is the unbreakable world wall
      const border = i === 0 || j === 0 ||
        ROCK_STEP / 2 + (i + 1) * ROCK_STEP >= WORLD ||
        ROCK_STEP / 2 + (j + 1) * ROCK_STEP >= WORLD;
      let clear = false;
      for (const n of nests) {
        if (Math.hypot(x - n.x, y - n.y) < 200) clear = true;   // clear plaza around nests
      }
      if (clear && !border) continue;   // never clear the border
      const r = border
        ? { x, y, i, j, size: ROCK_SIZE, hp: Infinity, maxHp: Infinity, broken: false, border: true }
        : { x, y, i, j, size: ROCK_SIZE, hp: 8, maxHp: 8, broken: false, border: false };
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
  if (r && !r.broken && !r.border) {   // border wall can't be dug
    r.hp -= amount;
    if (r.hp <= 0) {
      r.broken = true;
      rockGrid.delete(rockKey(i, j));
    }
  }
}

// ---- A* pathfinding over the grid ----
// Every cell is passable, but ROCK cells cost more (they have to be dug), so
// the enemy prefers existing tunnels and only digs when that's genuinely
// shorter. 4-directional so it carves clean orthogonal tunnels.
const GRIDN = Math.ceil(WORLD / ROCK_STEP);
function clampCell(v) { return Math.max(0, Math.min(GRIDN - 1, v)); }

function findPath(si, sj, gi, gj) {
  si = clampCell(si); sj = clampCell(sj); gi = clampCell(gi); gj = clampCell(gj);
  const nodes = new Map();
  const open = new Set();
  const closed = new Set();
  const startK = rockKey(si, sj);
  nodes.set(startK, { i: si, j: sj, g: 0, f: Math.abs(si - gi) + Math.abs(sj - gj), parent: null });
  open.add(startK);

  let iter = 0;
  while (open.size && iter++ < 8000) {
    // pick the open node with the lowest f
    let curK = null, cur = null;
    for (const k of open) {
      const n = nodes.get(k);
      if (!cur || n.f < cur.f) { cur = n; curK = k; }
    }
    if (cur.i === gi && cur.j === gj) {              // reached the goal → rebuild path
      const path = [];
      let n = cur;
      while (n) { path.push({ i: n.i, j: n.j }); n = n.parent; }
      return path.reverse();
    }
    open.delete(curK);
    closed.add(curK);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || nj < 0 || ni >= GRIDN || nj >= GRIDN) continue;
      const nk = rockKey(ni, nj);
      if (closed.has(nk)) continue;
      const rk = rockGrid.get(nk);
      if (rk && rk.border) continue;                 // can't path through the wall
      const stepCost = rk ? 7 : 1;                   // rock costs more (digging)
      const g = cur.g + stepCost;
      const existing = nodes.get(nk);
      if (!existing || g < existing.g) {
        nodes.set(nk, { i: ni, j: nj, g, f: g + Math.abs(ni - gi) + Math.abs(nj - gj), parent: cur });
        open.add(nk);
      }
    }
  }
  return null;
}

// Can you see from (x1,y1) to (x2,y2), or does rock block the view?
function hasLineOfSight(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / (ROCK_STEP * 0.4));   // sample along the line
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (rockGrid.has(rockKey(cellIndex(x), cellIndex(y)))) return false;   // rock in the way
  }
  return true;
}

// ---- Enemy ants (blue) that hunt the player ----
const enemies = [];
function spawnEnemy() {
  const n = nests[1];   // blue nest
  enemies.push({
    x: n.x, y: n.y + 60,
    size: 14, radius: 6, speed: 2.6,
    angle: 0, color: n.color,
    walkPhase: 0, moving: false,
    biteAnim: 0, biteCooldown: 0,
    hp: 40, maxHp: 40,
    path: [], pathIndex: 1, pathTimer: 0,
    lastSeen: null,    // last spot it saw the player
    seenTimer: 0,      // counts down after losing sight
    sightRange: 300,
    searchTarget: null,  // random spot it roams to while searching
    searchTimer: 0,
  });
}

function cellCenter(c) {
  return { x: ROCK_STEP / 2 + c.i * ROCK_STEP, y: ROCK_STEP / 2 + c.j * ROCK_STEP };
}

function updateEnemy(e) {
  // Detection: it only knows where you are if you're in range AND it can see
  // you (no rock blocking). If so, remember the spot for a few seconds.
  const distP = Math.hypot(e.x - player.x, e.y - player.y);
  if (distP < e.sightRange && hasLineOfSight(e.x, e.y, player.x, player.y)) {
    e.lastSeen = { x: player.x, y: player.y };
    e.seenTimer = 240;   // remember for ~4s after losing sight
  } else if (e.seenTimer > 0) {
    e.seenTimer--;
  }

  // Goal: chase your last-known spot if it remembers you; otherwise SEARCH —
  // roam to random spots, picking a new one when it arrives or times out.
  if (!(e.seenTimer > 0 && e.lastSeen)) {
    const reached = e.searchTarget && Math.hypot(e.x - e.searchTarget.x, e.y - e.searchTarget.y) < 70;
    if (!e.searchTarget || reached || --e.searchTimer <= 0) {
      e.searchTarget = { x: 120 + Math.random() * (WORLD - 240), y: 120 + Math.random() * (WORLD - 240) };
      e.searchTimer = 420;   // give up on a spot after ~7s
    }
  }
  const goal = (e.seenTimer > 0 && e.lastSeen) ? e.lastSeen : e.searchTarget;

  // re-plan a route to the goal every so often
  if (--e.pathTimer <= 0) {
    e.pathTimer = 45;
    e.path = findPath(cellIndex(e.x), cellIndex(e.y), cellIndex(goal.x), cellIndex(goal.y)) || [];
    e.pathIndex = 1;   // [0] is the cell it's already in
  }

  e.moving = false;
  if (e.path && e.pathIndex < e.path.length) {
    const cell = e.path[e.pathIndex];
    const c = cellCenter(cell);

    // if the next cell is still rock, dig it out
    if (rockGrid.has(rockKey(cell.i, cell.j))) {
      if (e.biteAnim <= 0 && e.biteCooldown <= 0) {
        e.biteAnim = BITE_TIME;
        e.biteCooldown = BITE_TIME + 4;
      }
      if (e.biteAnim === 10) digAt(cell.i, cell.j, 4);
    }

    // walk toward the cell (gliding its facing, like the player)
    const dx = c.x - e.x, dy = c.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > 3) {
      const target = Math.atan2(dy, dx);
      let diff = target - e.angle;
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      e.angle += diff * 0.2;
      e.x += (dx / d) * e.speed;
      e.y += (dy / d) * e.speed;
      e.moving = true;
    } else {
      e.pathIndex++;   // reached this cell, aim for the next
    }
  }

  // bite menacingly when right next to the player
  if (Math.hypot(e.x - player.x, e.y - player.y) < 42) {
    const target = Math.atan2(player.y - e.y, player.x - e.x);
    let diff = target - e.angle;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    e.angle += diff * 0.3;
    if (e.biteAnim <= 0 && e.biteCooldown <= 0) {
      e.biteAnim = BITE_TIME;
      e.biteCooldown = BITE_TIME + 10;
    }
  }

  // timers + can't clip through rock
  if (e.biteAnim > 0) e.biteAnim--;
  if (e.biteCooldown > 0) e.biteCooldown--;
  if (e.moving) e.walkPhase += 0.35;
  const bodyR = e.size * 0.85;
  for (const r of rocks) {
    if (r.broken) continue;
    if (Math.abs(r.x - e.x) > 90 || Math.abs(r.y - e.y) > 90) continue;
    keepOutOfRock(e, r, bodyR);
  }
}

function drawEnemies() {
  for (const e of enemies) {
    drawAnt(e);
    // hp bar
    const w = e.size * 2.4;
    const bx = e.x - w / 2, by = e.y - e.size - 14;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, w, 4);
    ctx.fillStyle = "#5ad25a";
    ctx.fillRect(bx, by, w * (e.hp / e.maxHp), 4);
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
  enemies.length = 0;
  spawnEnemy();   // one blue hunter
  discovered.clear();
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
      "Aim with the <b>mouse</b> · <b>W</b> moves toward the cursor, <b>S</b> backs away.<br>" +
      "Left-click to bite &amp; dig through the rock.";
    panel.dataset.showing = "how";
  }
});

// ---- Update ----
function update() {
  if (gameState !== "playing") return;

  // aim at the cursor (convert mouse from screen to world, undoing the zoom)
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const wmx = (mouse.x - cx) / zoom + player.x;
  const wmy = (mouse.y - cy) / zoom + player.y;
  const aimX = wmx - player.x, aimY = wmy - player.y;
  if (Math.hypot(aimX, aimY) > player.size * 0.3) {
    // glide the facing toward the cursor
    const target = Math.atan2(aimY, aimX);
    let diff = target - player.angle;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    player.angle += diff * 0.3;
  }

  // W drives toward the cursor; S backs away from it.
  const fx = Math.cos(player.angle), fy = Math.sin(player.angle);   // toward cursor
  const sx = player.x, sy = player.y;
  if (keys["w"] || keys["arrowup"])   { player.x += fx * player.speed; player.y += fy * player.speed; }
  if (keys["s"] || keys["arrowdown"]) { player.x -= fx * player.speed; player.y -= fy * player.speed; }

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

  // enemy ants
  for (const e of enemies) updateEnemy(e);
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
    ctx.fillStyle = r.border ? "#5b5148" : "#4a3823";   // stone wall vs dirt
    ctx.fillRect(r.x - s, r.y - s, s * 2, s * 2);
    ctx.strokeStyle = r.border ? "#332c26" : "#2c2013";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - s, r.y - s, s * 2, s * 2);
    if (r.hp < r.maxHp) {   // dig-progress bar
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

// ---- Fog of war: blocky per-tile vision (same grid as the rocks) ----
const VISION = 360;

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Is grid cell (i,j) rock that borders an open (dug) cell? (a wall you can see)
function isWall(i, j) {
  for (const [di, dj] of NEIGHBORS) {
    if (!rockGrid.has(rockKey(i + di, j + dj))) return true;
  }
  return false;
}

const discovered = new Set();   // cells the player has ever seen

function drawFog() {
  const halfW = canvas.width / 2 / zoom, halfH = canvas.height / 2 / zoom;
  // cover a full tile past the screen so edge rocks get fogged too
  const i0 = cellIndex(player.x - halfW - ROCK_STEP), i1 = cellIndex(player.x + halfW + ROCK_STEP);
  const j0 = cellIndex(player.y - halfH - ROCK_STEP), j1 = cellIndex(player.y + halfH + ROCK_STEP);
  const s = ROCK_STEP;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const cx = ROCK_STEP / 2 + i * ROCK_STEP;
      const cy = ROCK_STEP / 2 + j * ROCK_STEP;
      const key = rockKey(i, j);
      let visible = Math.hypot(cx - player.x, cy - player.y) < VISION;   // within light radius
      // solid rock only shows if it's a wall (touches an open cell)
      if (visible && rockGrid.has(key) && !isWall(i, j)) visible = false;

      if (visible) { discovered.add(key); continue; }   // lit now → no fog
      // dim if we've been here before, pitch black if never seen
      ctx.fillStyle = discovered.has(key) ? "rgba(0,0,0,0.62)" : "#000000";
      ctx.fillRect(cx - s / 2 - 0.5, cy - s / 2 - 0.5, s + 1, s + 1);
    }
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
  drawRocks();
  drawNests();
  drawEnemies();
  drawAnt(player);

  drawFog();   // hide everything the player can't see (rock blocks vision)

  // white ring so you can spot yourself (drawn on top of the fog)
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
