// ---- Combat: attacking, dying/respawning, healing at your queen ----

function allAnts() {
  const list = player.hatching ? [] : [player];
  for (const b of bots) if (!b.dead) list.push(b);
  return list;
}

// everything that can be hit: ants + queens + enemy eggs
function combatants() {
  const list = player.hatching ? [] : [player];
  for (const b of bots) if (!b.dead) list.push(b);
  for (const n of nests) if (!n.queen.dead) list.push(n.queen);
  for (const g of eggs) if (!g.dead && !g.isPlayer) list.push(g);   // eggs are destroyable
  for (const L of larvae) if (!L.dead && !L.carried) list.push(L);  // larvae too (2 hits)
  return list;
}

function ownNest(a) { return nests.find(n => n.team === a.team); }

// ---- Carrying: one slot; picking something up drops what you had ----
function dropCarried(carrier) {
  if (!carrier.carrying) return;
  carrier.carrying.carried = false;
  carrier.carrying = null;
}
function pickUp(carrier, item) {
  dropCarried(carrier);   // one thing at a time — drop the previous
  item.carried = true;
  carrier.carrying = item;
}

// Send an ant back to its queen with full health.
function respawn(a) {
  // drop any carried egg where you died (its timer resumes there)
  if (a === player && a.carrying) {
    a.carrying.carried = false;
    a.carrying = null;
  }
  const nest = ownNest(a);
  a.x = nest.x + (Math.random() * 60 - 30);
  a.y = nest.y + 50 + Math.random() * 30;
  a.hp = a.maxHp;
  // clear any AI combat state so it doesn't instantly re-charge
  a.lastSeen = null;
  a.seenTimer = 0;
  a.path = [];
  a.pathIndex = 1;
}

function hurt(t, dmg) {
  if (t.dead) return;
  t.hp -= dmg;
  if (t.hp <= 0) {
    if (t.isQueen) {                     // a queen died → game over
      t.dead = true;
      gameState = (t.team === player.team) ? "lost" : "won";
    } else if (t === player) {
      respawn(player);                   // you pop back at your queen
    } else {
      t.dead = true;                     // a bot dies; its queen lays a fresh egg
      if (t.carrying) { t.carrying.carried = false; t.carrying = null; }   // drop egg
    }
  }
}

// Melee: damage enemy ants / queen / eggs, and neutral beetles, in front of `a`.
function meleeHit(a, dmg) {
  const mx = a.x + Math.cos(a.angle) * a.size * 1.2;
  const my = a.y + Math.sin(a.angle) * a.size * 1.2;
  const reach = a.size * 1.1;
  for (const t of combatants()) {
    if (t === a || t.team === a.team) continue;   // no friendly fire
    if (Math.hypot(mx - t.x, my - t.y) < reach + (t.radius || 6)) {
      spawnBlood(t.x, t.y);
      hurt(t, dmg);
    }
  }
  // beetles are neutral; killing one drops meat to carry home
  for (const bug of beetles) {
    if (bug.dead) continue;
    if (Math.hypot(mx - bug.x, my - bug.y) < reach + bug.radius) {
      spawnBlood(bug.x, bug.y);
      bug.hp -= dmg;
      if (bug.hp <= 0) { bug.dead = true; spawnMeat(bug.x, bug.y); }
    }
  }
}

// Push overlapping ants apart (both move, sharing the overlap).
function resolveAntCollisions() {
  const all = allAnts();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const minDist = a.size * 0.55 + b.size * 0.55;   // body-ish radius
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist && dist > 0.001) {
        const push = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

// Slowly heal when near your own queen (so home ground matters).
function healNearQueen(a) {
  const nest = ownNest(a);
  if (a.hp < a.maxHp && Math.hypot(a.x - nest.x, a.y - nest.y) < 140) {
    a.hp = Math.min(a.maxHp, a.hp + 0.12);
  }
}
