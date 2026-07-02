// ---- Larvae: eggs hatch into these; fed by the colony, they grow into ants ----
const larvae = [];

function spawnLarva(x, y, team, isPlayer) {
  if (isPlayer) {
    // the player becomes a controllable larva until it's grown
    player.hatching = false;
    player.isLarva = true;
    player.growth = 0;
    player.x = x; player.y = y;
    player.hp = player.maxHp;
    return;
  }
  larvae.push({ x, y, team, growth: 0, dead: false, carried: false, kind: "larva", wiggle: Math.random() * Math.PI * 2 });
}

function updateLarvae() {
  // everyone grows slowly on their own (the player only grows this way, so the
  // first grown ant is always an AI, not you)
  for (const L of larvae) if (!L.dead && !L.carried) L.growth += PASSIVE_GROW;
  if (player.isLarva) player.growth += PASSIVE_GROW;

  // each queen feeds its least-grown AI larva extra from the food pile
  for (const n of nests) {
    if (n.food <= 0) continue;
    let low = null;
    for (const L of larvae) {
      if (L.dead || L.carried || L.team !== n.team) continue;
      if (!low || L.growth < low.growth) low = L;
    }
    if (!low) continue;
    low.growth += GROW_RATE;
    n.food = Math.max(0, n.food - FEED_COST);
  }

  // grown larvae become ants; you become a full ant when grown
  for (let i = larvae.length - 1; i >= 0; i--) {
    const L = larvae[i];
    if (L.dead) { larvae.splice(i, 1); continue; }
    if (L.growth >= GROW_MAX && !L.carried) {
      spawnBotAt(L.x, L.y, L.team);
      larvae.splice(i, 1);
      continue;
    }
    L.wiggle += 0.12;
  }
  if (player.isLarva && player.growth >= GROW_MAX) player.isLarva = false;
}

// a pale wriggling grub that fattens up as it grows
function drawLarvaShape(x, y, wiggle, grow) {
  const s = 4 + grow * 4.5;
  ctx.fillStyle = "#f0e2c0";
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * s * 0.55;
    ctx.beginPath();
    ctx.arc(off, Math.sin(wiggle + i) * 1.5, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // growth bar
  const w = 20, bx = x - w / 2, by = y - s - 8;
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx, by, w, 3);
  ctx.fillStyle = "#c8d04a"; ctx.fillRect(bx, by, w * grow, 3);
}

function drawLarvae() {
  for (const L of larvae) {
    if (!lit.has(rockKey(cellIndex(L.x), cellIndex(L.y)))) continue;
    drawLarvaShape(L.x, L.y, L.wiggle, L.growth / GROW_MAX);
  }
}
