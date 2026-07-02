// ---- AI ants: each belongs to a team and hunts the other team ----
const bots = [];
function spawnBotAt(x, y, team) {
  // roles: attacker (assault), defender (guard queen), hunter (beetles→meat), nurse (eggs)
  const roll = Math.random();
  const role = roll < 0.4 ? "attacker" : roll < 0.6 ? "defender" : roll < 0.8 ? "hunter" : "nurse";
  bots.push({
    x, y,
    size: 14, radius: 6, speed: 2.6,
    angle: 0, team, color: TEAMS[team].color,   // real team color in-game
    walkPhase: 0, moving: false,
    biteAnim: 0, biteCooldown: 0,
    hp: 40, maxHp: 40, dead: false,
    stamina: STAMINA_MAX,
    role, carrying: null, roomTarget: null,
    path: [], pathIndex: 1, pathTimer: Math.floor(Math.random() * 45),   // stagger repaths
    lastSeen: null, seenTimer: 0, sightRange: 300,
    searchTarget: null, searchTimer: 0,
  });
}

// ---- Eggs: queens lay them; they hatch into ants after 5s ----
const eggs = [];
const POP_CAP = 25;         // max ants (+eggs) a queen keeps alive per team
const EGG_TIME = 1200;      // 20 seconds at 60fps
const LAY_INTERVAL = 45;    // how often a queen lays (~0.75s), so they ramp up

function teamCount(team) {
  let c = 0;
  if (player.team === team && !player.hatching) c++;   // the player counts too
  for (const b of bots) if (!b.dead && b.team === team) c++;
  for (const g of eggs) if (!g.dead && g.team === team) c++;
  for (const L of larvae) if (!L.dead && L.team === team) c++;
  return c;
}

function layEgg(nest) {
  eggs.push({
    x: nest.x + (Math.random() * 300 - 150),   // spread over a larger radius
    y: nest.y + (Math.random() * 220 - 60),
    team: nest.team,
    timer: EGG_TIME,
    hp: 15, maxHp: 15,      // 3 bites (5 dmg each) to destroy
    dead: false, carried: false, kind: "egg",
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
    if (g.dead) { eggs.splice(i, 1); continue; }   // destroyed egg
    if (g.carried) continue;                        // timer paused while carried
    if (--g.timer <= 0) {
      spawnLarva(g.x, g.y, g.team, !!g.isPlayer);   // hatches into a larva
      eggs.splice(i, 1);
    }
  }
}

function drawEggs() {
  for (const g of eggs) {
    if (g.dead) continue;
    if (!lit.has(rockKey(cellIndex(g.x), cellIndex(g.y)))) continue;   // fog
    ctx.fillStyle = g.hp < g.maxHp ? "#d8c090" : "#f0e6c8";   // dimmer when cracked
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

function nearestBeetle(e) {
  let best = null, bd = 450;
  for (const b of beetles) { if (b.dead) continue; const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < bd) { best = b; bd = d; } }
  return best;
}
function nearestMeat(e) {
  let best = null, bd = 450;
  for (const m of meats) { if (m.carried) continue; const d = Math.hypot(e.x - m.x, e.y - m.y); if (d < bd) { best = m; bd = d; } }
  return best;
}

// Nearest exposed friendly egg (not carried, not already safe in a room).
function nearestLooseEgg(e) {
  let best = null, bd = 650;
  for (const g of eggs) {
    if (g.dead || g.carried || g.isPlayer || g.team !== e.team) continue;
    if (isRoomCell(cellIndex(g.x), cellIndex(g.y))) continue;   // already safe
    const d = Math.hypot(e.x - g.x, e.y - g.y);
    if (d < bd) { best = g; bd = d; }
  }
  return best;
}

// Where an idle bot heads, by role.
function botIdleBehavior(e) {
  const reached = e.searchTarget && Math.hypot(e.x - e.searchTarget.x, e.y - e.searchTarget.y) < 90;

  if (e.role === "nurse") {
    if (e.carrying) {
      // carry the egg to a safe room, then set it down there
      if (!e.roomTarget) e.roomTarget = findRoom(e.x, e.y) || ownNest(e).queen;
      e.searchTarget = e.roomTarget;
      if (isRoomCell(cellIndex(e.x), cellIndex(e.y)) ||
          Math.hypot(e.x - e.roomTarget.x, e.y - e.roomTarget.y) < 40) {
        e.carrying.carried = false;   // drop it (timer resumes)
        e.carrying = null;
        e.roomTarget = null;
      }
    } else {
      const egg = nearestLooseEgg(e);
      if (egg) {
        e.searchTarget = { x: egg.x, y: egg.y };
        if (Math.hypot(e.x - egg.x, e.y - egg.y) < 24) { egg.carried = true; e.carrying = egg; e.roomTarget = null; }
      } else if (!e.searchTarget || reached || --e.searchTimer <= 0) {
        const h = ownNest(e).queen;      // nothing to do → hover near the queen
        e.searchTarget = { x: h.x + (Math.random() * 120 - 60), y: h.y + (Math.random() * 120 - 60) };
        e.searchTimer = 240;
      }
    }
  } else if (e.role === "hunter") {
    if (e.carrying && e.carrying.kind === "meat") {
      // bring meat home and drop it in the food pile
      const h = ownNest(e).queen;
      e.searchTarget = { x: h.x, y: h.y };
      if (Math.hypot(e.x - h.x, e.y - h.y) < 120) {
        ownNest(e).food += MEAT_VALUE;
        removeMeat(e.carrying);
        e.carrying = null;
      }
    } else {
      const m = nearestMeat(e);
      if (m) {
        e.searchTarget = { x: m.x, y: m.y };
        if (Math.hypot(e.x - m.x, e.y - m.y) < 22) pickUp(e, m);
      } else {
        const bug = nearestBeetle(e);
        if (bug) {
          e.searchTarget = { x: bug.x, y: bug.y };
          if (Math.hypot(e.x - bug.x, e.y - bug.y) < 30) {   // bite the beetle
            e.angle = Math.atan2(bug.y - e.y, bug.x - e.x);
            if (e.biteAnim <= 0 && e.biteCooldown <= 0) { e.biteAnim = BITE_TIME; e.biteCooldown = BITE_TIME + 10; }
          }
        } else if (!e.searchTarget || reached || --e.searchTimer <= 0) {
          e.searchTarget = { x: 200 + Math.random() * (WORLD - 400), y: 200 + Math.random() * (WORLD - 400) };
          e.searchTimer = 300;
        }
      }
    }
  } else if (e.role === "attacker") {
    // head for the enemy nest — everyone converging naturally forms a group
    if (!e.searchTarget || reached || --e.searchTimer <= 0) {
      const foe = nests.find(n => n.team !== e.team);
      e.searchTarget = { x: foe.x + (Math.random() * 300 - 150), y: foe.y + (Math.random() * 300 - 150) };
      e.searchTimer = 300;
    }
  } else {   // defender: patrol around its own queen
    if (!e.searchTarget || reached || --e.searchTimer <= 0) {
      const h = ownNest(e).queen;
      e.searchTarget = { x: h.x + (Math.random() * 180 - 90), y: h.y + (Math.random() * 180 - 90) };
      e.searchTimer = 300;
    }
  }
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

  // Chase the last-seen enemy. Otherwise act by role (attack / defend / nurse).
  const chasing = e.seenTimer > 0 && e.lastSeen;
  if (!chasing) botIdleBehavior(e);
  const goal = chasing ? e.lastSeen : e.searchTarget;

  // sprint while chasing (drains stamina; recovers while not)
  const sprinting = chasing && e.stamina > 0;
  if (sprinting) e.stamina = Math.max(0, e.stamina - STAMINA_DRAIN);
  else e.stamina = Math.min(STAMINA_MAX, e.stamina + STAMINA_REGEN);
  const spd = sprinting ? e.speed * SPRINT_MULT : e.speed;

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
      e.x += (dx / d) * spd;
      e.y += (dy / d) * spd;
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
      e.x += (dx / d) * spd;
      e.y += (dy / d) * spd;
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

  // a carried item rides in the mouth
  if (e.carrying) {
    e.carrying.x = e.x + Math.cos(e.angle) * e.size * 1.1;
    e.carrying.y = e.y + Math.sin(e.angle) * e.size * 1.1;
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
