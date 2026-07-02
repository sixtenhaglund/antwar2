// ---- Combat: attacking, dying/respawning, healing at your queen ----

function allAnts() { return [player, ...bots]; }

function ownNest(a) { return nests.find(n => n.team === a.team); }

// Send an ant back to its queen with full health.
function respawn(a) {
  const nest = ownNest(a);
  a.x = nest.x + (Math.random() * 60 - 30);
  a.y = nest.y + 50 + Math.random() * 30;
  a.hp = a.maxHp;
  // clear any AI combat state so it doesn't instantly re-charge
  a.lastSeen = null;
  a.seenTimer = 0;
  a.path = [];
  a.pathIndex = 1;
  a.retreating = false;
}

function hurt(t, dmg) {
  t.hp -= dmg;
  if (t.hp <= 0) respawn(t);
}

// Melee: damage enemy ants right in front of `a`'s mouth.
function meleeHit(a, dmg) {
  const mx = a.x + Math.cos(a.angle) * a.size * 1.2;
  const my = a.y + Math.sin(a.angle) * a.size * 1.2;
  const reach = a.size * 1.1;
  for (const t of allAnts()) {
    if (t === a || t.team === a.team) continue;   // no friendly fire
    if (Math.hypot(mx - t.x, my - t.y) < reach + t.radius) hurt(t, dmg);
  }
}

// Slowly heal when near your own queen (makes retreating worthwhile).
function healNearQueen(a) {
  const nest = ownNest(a);
  if (a.hp < a.maxHp && Math.hypot(a.x - nest.x, a.y - nest.y) < 140) {
    a.hp = Math.min(a.maxHp, a.hp + 0.12);
  }
}
