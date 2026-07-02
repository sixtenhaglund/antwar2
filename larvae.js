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
  larvae.push({ x, y, team, growth: 0, dead: false, wiggle: Math.random() * Math.PI * 2 });
}

// all growing larvae of a team (including the player if it's a larva)
function larvaeOf(team) {
  const list = [];
  for (const L of larvae) if (!L.dead && L.team === team) list.push(L);
  if (player.isLarva && player.team === team) list.push(player);
  return list;
}

function updateLarvae() {
  // Each queen feeds its least-grown larva from the food pile (the "queen feeds
  // a larva, it grows into an ant" cycle — food comes from beetle meat).
  for (const n of nests) {
    if (n.food <= 0) continue;
    const list = larvaeOf(n.team);
    if (!list.length) continue;
    let low = list[0];
    for (const L of list) if (L.growth < low.growth) low = L;
    low.growth += GROW_RATE;
    n.food = Math.max(0, n.food - FEED_COST);
    if (low.growth >= GROW_MAX) {
      if (low === player) player.isLarva = false;         // you become a full ant
      else { low.dead = true; spawnBotAt(low.x, low.y, low.team); }
    }
  }
  for (let i = larvae.length - 1; i >= 0; i--) {
    if (larvae[i].dead) { larvae.splice(i, 1); continue; }
    larvae[i].wiggle += 0.12;
  }
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
