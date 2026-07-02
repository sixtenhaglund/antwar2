// ---- AI ants: each belongs to a team and hunts the other team ----
const bots = [];
function spawnBot(nest, team) {
  bots.push({
    x: nest.x + (Math.random() * 80 - 40),
    y: nest.y + 50 + Math.random() * 40,
    size: 14, radius: 6, speed: 2.6,
    angle: 0, team, color: TEAMS[team].color,   // real team color in-game
    walkPhase: 0, moving: false,
    biteAnim: 0, biteCooldown: 0,
    hp: 40, maxHp: 40,
    path: [], pathIndex: 1, pathTimer: Math.floor(Math.random() * 45),   // stagger repaths
    lastSeen: null, seenTimer: 0, sightRange: 300,
    searchTarget: null, searchTimer: 0,
  });
}

function cellCenter(c) {
  return { x: ROCK_STEP / 2 + c.i * ROCK_STEP, y: ROCK_STEP / 2 + c.j * ROCK_STEP };
}

// Best enemy this bot can see: prefer the weakest, then the nearest — so a
// group focus-fires low-HP targets to finish them off.
function pickTarget(e) {
  let best = null, bestScore = Infinity;
  for (const t of [player, ...bots]) {
    if (t === e || t.team === e.team) continue;   // skip self and allies
    const d = Math.hypot(e.x - t.x, e.y - t.y);
    if (d < e.sightRange && hasLineOfSight(e.x, e.y, t.x, t.y)) {
      const score = t.hp + d * 0.3;               // low HP + close = best
      if (score < bestScore) { best = t; bestScore = score; }
    }
  }
  return best;
}

function updateBot(e) {
  // Detection: remember where it last saw an enemy.
  const target = pickTarget(e);
  if (target) {
    e.lastSeen = { x: target.x, y: target.y };
    e.seenTimer = 240;
  } else if (e.seenTimer > 0) {
    e.seenTimer--;
  }

  // Chase the last-seen enemy; otherwise push toward the ENEMY nest (with some
  // spread) so the team advances to the front line instead of wandering.
  const chasing = e.seenTimer > 0 && e.lastSeen;
  if (!chasing) {
    const reached = e.searchTarget && Math.hypot(e.x - e.searchTarget.x, e.y - e.searchTarget.y) < 90;
    if (!e.searchTarget || reached || --e.searchTimer <= 0) {
      const foeNest = nests.find(n => n.team !== e.team);
      e.searchTarget = { x: foeNest.x + (Math.random() * 400 - 200), y: foeNest.y + (Math.random() * 400 - 200) };
      e.searchTimer = 300;
    }
  }
  const goal = chasing ? e.lastSeen : e.searchTarget;

  // re-plan often while chasing (beeline), less often otherwise
  if (--e.pathTimer <= 0) {
    e.pathTimer = chasing ? 8 : 45;
    e.path = findPath(cellIndex(e.x), cellIndex(e.y), cellIndex(goal.x), cellIndex(goal.y)) || [];
    e.pathIndex = 1;
  }

  e.moving = false;
  if (e.path && e.pathIndex < e.path.length) {
    const cell = e.path[e.pathIndex];
    const c = cellCenter(cell);
    if (rockGrid.has(rockKey(cell.i, cell.j))) {   // dig the next cell if it's rock
      if (e.biteAnim <= 0 && e.biteCooldown <= 0) { e.biteAnim = BITE_TIME; e.biteCooldown = BITE_TIME + 4; }
      if (e.biteAnim === 10) digAt(cell.i, cell.j, 4);
    }
    const dx = c.x - e.x, dy = c.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > 3) {
      const t = Math.atan2(dy, dx);
      let diff = t - e.angle;
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      e.angle += diff * 0.2;
      e.x += (dx / d) * e.speed;
      e.y += (dy / d) * e.speed;
      e.moving = true;
    } else {
      e.pathIndex++;
    }
  }

  // bite a nearby enemy — face it and snap
  if (target && Math.hypot(e.x - target.x, e.y - target.y) < 34) {
    const t = Math.atan2(target.y - e.y, target.x - e.x);
    let diff = t - e.angle;
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    e.angle += diff * 0.3;
    if (e.biteAnim <= 0 && e.biteCooldown <= 0) { e.biteAnim = BITE_TIME; e.biteCooldown = BITE_TIME + 10; }
  }
  if (e.biteAnim === 10) meleeHit(e, ATTACK_DMG);   // a bite that lands hurts enemies
  healNearQueen(e);

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

function drawBots() {
  for (const e of bots) {
    if (!lit.has(rockKey(cellIndex(e.x), cellIndex(e.y)))) continue;   // outside your vision
    drawAnt(e);
    const w = e.size * 2.4;
    const bx = e.x - w / 2, by = e.y - e.size - 14;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, w, 4);
    ctx.fillStyle = "#5ad25a";
    ctx.fillRect(bx, by, w * (e.hp / e.maxHp), 4);
  }
}
