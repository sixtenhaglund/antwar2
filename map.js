// ---- The map: nests, breakable rock grid, pathfinding, collision, rendering ----

// A Red nest (yours) and a Blue nest on opposite sides.
const nests = [
  { team: "red",  color: "#d0453f", x: 300,         y: WORLD / 2 },
  { team: "blue", color: "#4f8fe0", x: WORLD - 300, y: WORLD / 2 },
];
for (const n of nests) {
  n.queen = { x: n.x, y: n.y, size: 26, radius: 22, color: n.color,
              team: n.team, hp: 150, maxHp: 150, isQueen: true, dead: false };
  n.food = 0;   // food pile at the nest
}

const caves = [];   // centers of the small random caves (filled by placeRocks)

// ---- Breakable rocks on a grid (dig through them) ----
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

  // carve a handful of small random caves (open rooms in the rock)
  caves.length = 0;
  for (let c = 0; c < 14; c++) {
    const cx = 250 + Math.random() * (WORLD - 500);
    const cy = 250 + Math.random() * (WORLD - 500);
    let nearNest = false;
    for (const n of nests) if (Math.hypot(cx - n.x, cy - n.y) < 320) nearNest = true;
    if (nearNest) continue;
    const rad = 45 + Math.random() * 45;
    for (const r of rocks) {
      if (r.border || r.broken) continue;
      if (Math.hypot(r.x - cx, r.y - cy) < rad) {
        r.broken = true;
        rockGrid.delete(rockKey(r.i, r.j));
      }
    }
    caves.push({ x: cx, y: cy });
  }
}
placeRocks();

// Which grid cell is a world position in?
function cellIndex(v) { return Math.round((v - ROCK_STEP / 2) / ROCK_STEP); }

// A "room" cell has a fully-open 3x3 around it (an open area >= 3x3).
function isRoomCell(i, j) {
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++)
      if (rockGrid.has(rockKey(i + di, j + dj))) return false;
  return true;
}

// Find the nearest room cell to (x,y), spiralling outward. Returns {x,y} or null.
function findRoom(x, y) {
  const si = cellIndex(x), sj = cellIndex(y);
  for (let rad = 0; rad <= 16; rad++) {
    for (let di = -rad; di <= rad; di++) {
      for (let dj = -rad; dj <= rad; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;   // only the ring
        if (isRoomCell(si + di, sj + dj)) {
          return { x: ROCK_STEP / 2 + (si + di) * ROCK_STEP, y: ROCK_STEP / 2 + (sj + dj) * ROCK_STEP };
        }
      }
    }
  }
  return null;
}

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
// Every cell is passable, but ROCK cells cost more (they have to be dug), so a
// bot prefers existing tunnels and only digs when that's genuinely shorter.
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

// ---- Map rendering ----
function drawGround() {
  const halfW = canvas.width / 2 / zoom, halfH = canvas.height / 2 / zoom;
  const left = player.x - halfW - 30, right = player.x + halfW + 30;
  const top = player.y - halfH - 30, bottom = player.y + halfH + 30;
  const spacing = 60;
  ctx.fillStyle = "#3a2a16";
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
    ctx.fillStyle = r.border ? "#6f665c" : "#7a5c33";   // stone wall vs dirt wall
    ctx.fillRect(r.x - s, r.y - s, s * 2, s * 2);
    ctx.strokeStyle = r.border ? "#413a32" : "#553f22";
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

    // queen hp bar
    const q = n.queen;
    const w = 64, bx = q.x - w / 2, by = q.y - 46;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, w, 5);
    ctx.fillStyle = "#5ad25a";
    ctx.fillRect(bx, by, w * Math.max(0, q.hp / q.maxHp), 5);

    ctx.fillStyle = n.color;
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.team.toUpperCase() + (n.team === player.team ? " (you)" : ""), n.x, n.y - 58);

    // food pile: a little heap of green morsels + a count
    const pile = Math.min(30, n.food);
    for (let k = 0; k < pile; k++) {
      const px = n.x + 60 + (k % 6) * 6;
      const py = n.y + 40 - Math.floor(k / 6) * 6;
      ctx.fillStyle = "#9ad84a";
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#9ad84a";
    ctx.font = "12px monospace";
    ctx.fillText("food " + n.food, n.x + 78, n.y + 62);
  }
}
