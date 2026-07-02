// ---- AI ants: each belongs to a team and hunts the other team ----
const bots = [];
function spawnBotAt(x, y, team) {
  bots.push({
    x, y,
    size: 14, radius: 6, speed: 2.6,
    angle: 0, team, color: TEAMS[team].color,   // real team color in-game
    walkPhase: 0, moving: false,
    biteAnim: 0, biteCooldown: 0,
    hp: 40, maxHp: 40, dead: false,
    path: [], pathIndex: 1, pathTimer: Math.floor(Math.random() * 45),   // stagger repaths
    lastSeen: null, seenTimer: 0, sightRange: 300,
    searchTarget: null, searchTimer: 0,
  });
}

// ---- Eggs: queens lay them; they hatch into ants after 5s ----
const eggs = [];
const POP_CAP = 25;         // max ants (+eggs) a queen keeps alive per team
const EGG_TIME = 300;       // 5 seconds at 60fps
const LAY_INTERVAL = 45;    // how often a queen lays (~0.75s), so they ramp up

function teamCount(team) {
  let c = 0;
  if (player.team === team && !player.hatching) c++;   // the player counts too
  for (const b of bots) if (!b.dead && b.team === team) c++;
  for (const g of eggs) if (g.team === team) c++;       // includes the player egg
  return c;
}

function layEgg(nest) {
  eggs.push({
    x: nest.x + (Math.random() * 80 - 40),
    y: nest.y + 55 + Math.random() * 35,
    team: nest.team,
    timer: EGG_TIME,
  });
}

function updateEggs() {
  // queens lay to keep their team up to the cap
  for (const n of nests) {
    n.layTimer = (n.layTimer || 0) - 1;
    if (n.layTimer <= 0) {
      n.layTimer = LAY_INTERVAL;
      if (teamCount(n.team) < POP_CAP) layEgg(n);
    }
  }
  // hatch eggs whose timer ran out
  for (let i = eggs.length - 1; i >= 0; i--) {
    const g = eggs[i];
    if (--g.timer <= 0) {
      if (g.isPlayer) {                  // the player's egg hatches into you
        player.hatching = false;
        player.x = g.x; player.y = g.y;
        player.hp = player.maxHp;
      } else {
        spawnBotAt(g.x, g.y, g.team);
      }
      eggs.splice(i, 1);
    }
  }
}

function drawEggs() {
  for (const g of eggs) {
    if (!lit.has(rockKey(cellIndex(g.x), cellIndex(g.y)))) continue;   // fog
    ctx.fillStyle = "#f0e6c8";   // pale egg
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 4.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function cellCenter(c) {
  return { x: ROCK_STEP / 2 + c.i * ROCK_STEP, y: ROCK_STEP / 2 + c.j * ROCK_STEP };
}

// Best enemy this bot can see: prefer the weakest, then the nearest — so a
// group focus-fires low-HP targets to finish them off.
function pickTarget(e) {
  let best = null, bestScore = Infinity;
  for (const t of [player, ...bots]) {
    if (t === e || t.team === e.team || t.dead || t.hatching) continue;   // skip self/allies/dead/egg
    const d = Math.hypot(e.x - t.x, e.y - t.y);
    if (d < e.sightRange && hasLineOfSight(e.x, e.y, t.x, t.y)) {
      const score = t.hp + d * 0.3;               // low HP + close = best
      if (score < bestScore) { best = t; bestScore = score; }
    }
  }
  // the enemy queen is the objective — attack her when she's in view
  for (const n of nests) {
    const q = n.queen;
    if (q.team === e.team || q.dead) continue;
    const d = Math.hypot(e.x - q.x, e.y - q.y);
    if (d < e.sightRange && hasLineOfSight(e.x, e.y, q.x, q.y)) {
      const score = 30 + d * 0.3;                 // like a modest target
      if (score < bestScore) { best = q; bestScore = score; }
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

  // Chase the last-seen enemy. With nothing to do, either MINE (dig toward a
  // random spot) or GO HOME to guard the queen — picked when a new goal is due.
  const chasing = e.seenTimer > 0 && e.lastSeen;
  if (!chasing) {
    const reached = e.searchTarget && Math.hypot(e.x - e.searchTarget.x, e.y - e.searchTarget.y) < 90;
    if (!e.searchTarget || reached || --e.searchTimer <= 0) {
      if (Math.random() < 0.5) {
        // mine: carve a tunnel toward a random spot
        e.searchTarget = { x: 120 + Math.random() * (WORLD - 240), y: 120 + Math.random() * (WORLD - 240) };
      } else {
        // guard: head back near the queen
        const home = ownNest(e).queen;
        e.searchTarget = { x: home.x + (Math.random() * 120 - 60), y: home.y + (Math.random() * 120 - 60) };
      }
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
  if (target) {
    // charge straight at the visible enemy (line of sight is already clear),
    // so it keeps pressing in instead of stopping when the path cell ends.
    const dx = target.x - e.x, dy = target.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const ta = Math.atan2(dy, dx);
      let diff = ta - e.angle;
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      e.angle += diff * 0.25;
      e.x += (dx / d) * e.speed;
      e.y += (dy / d) * e.speed;
      e.moving = true;
    }
  } else if (e.path && e.pathIndex < e.path.length) {
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
    if (e.dead) continue;
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
