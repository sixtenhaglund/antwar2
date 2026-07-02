// ---- Fog of war + shared team vision (blocky per-tile, on the rock grid) ----
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const discovered = new Set();   // cells the player has ever seen
let lit = new Set();            // cells lit right now (recomputed each frame)

// Flood-fill light from one source through OPEN space (rock blocks it), out to
// the vision range. Walls bordering the lit space are lit too.
function floodLight(src) {
  const si = cellIndex(src.x), sj = cellIndex(src.y);
  const queue = [[si, sj]];
  const seen = new Set([rockKey(si, sj)]);
  let head = 0;
  while (head < queue.length) {
    const [i, j] = queue[head++];
    const cx = ROCK_STEP / 2 + i * ROCK_STEP, cy = ROCK_STEP / 2 + j * ROCK_STEP;
    if (Math.hypot(cx - src.x, cy - src.y) > VISION) continue;
    lit.add(rockKey(i, j));                       // this open cell is lit
    for (const [di, dj] of NEIGHBORS) {           // light the walls around it
      const nk = rockKey(i + di, j + dj);
      if (rockGrid.has(nk)) lit.add(nk);
    }
    for (const [di, dj] of ORTHO) {               // spread through open neighbours
      const ni = i + di, nj = j + dj, nk = rockKey(ni, nj);
      if (rockGrid.has(nk) || seen.has(nk)) continue;
      seen.add(nk);
      queue.push([ni, nj]);
    }
  }
}

// Shared vision: light from you AND every ally, so you see through their eyes.
function computeLit() {
  lit = new Set();
  floodLight(player);
  for (const b of bots) {
    if (b.team === player.team) floodLight(b);
  }
  // remember everything the whole team can see (fills the minimap, even far away)
  for (const key of lit) discovered.add(key);
}

function drawFog() {
  const halfW = canvas.width / 2 / zoom, halfH = canvas.height / 2 / zoom;
  const i0 = cellIndex(player.x - halfW - ROCK_STEP), i1 = cellIndex(player.x + halfW + ROCK_STEP);
  const j0 = cellIndex(player.y - halfH - ROCK_STEP), j1 = cellIndex(player.y + halfH + ROCK_STEP);
  const s = ROCK_STEP;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const key = rockKey(i, j);
      if (lit.has(key)) { discovered.add(key); continue; }   // lit now → no fog
      const cx = ROCK_STEP / 2 + i * ROCK_STEP;
      const cy = ROCK_STEP / 2 + j * ROCK_STEP;
      // dim if we've been here before, pitch black if never seen
      ctx.fillStyle = discovered.has(key) ? "rgba(0,0,0,0.62)" : "#000000";
      ctx.fillRect(cx - s / 2 - 0.5, cy - s / 2 - 0.5, s + 1, s + 1);
    }
  }
}
