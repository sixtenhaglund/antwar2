// ---- Core: canvas, camera, menu, player update, draw loop, minimap ----

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

// ---- Game state: menu until you press Play ----
let gameState = "menu";
let fPrev = false;   // for edge-detecting the F key (pick up / place egg)

function startGame() {
  player.team = "red";
  player.color = TEAMS[player.team].color;   // real team color in-game
  player.hp = player.maxHp;
  player.hatching = true;                     // you hatch from an egg too
  player.isLarva = false; player.growth = 0;
  player.stamina = player.maxStamina;
  player.carrying = null;
  player.x = nests[0].x;
  player.y = nests[0].y + 60;
  // reset queens; they lay the ants over time (nobody pre-spawns)
  bots.length = 0;
  eggs.length = 0;
  larvae.length = 0;
  meats.length = 0;
  for (const n of nests) {
    n.queen.hp = n.queen.maxHp;
    n.queen.dead = false;
    n.layTimer = LAY_INTERVAL;
    n.food = 0;
  }
  // each colony starts with one AI ant at its queen (the first ant)
  for (const n of nests) spawnBotAt(n.x + 40, n.y + 40, n.team);
  // lay your egg at the nest; the rest the queens produce over time
  eggs.push({ x: player.x, y: player.y, team: "red", timer: 180, isPlayer: true, dead: false, carried: false, kind: "egg" });
  // beetles in the random caves
  beetles.length = 0;
  for (const c of caves) {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) spawnBeetle(c.x + (Math.random() * 50 - 25), c.y + (Math.random() * 50 - 25));
  }
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

  // ---- Player control (frozen while you're still an egg) ----
  if (!player.hatching) {
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

  // larvae move slower and can't sprint; grown ants can
  const baseSpeed = player.isLarva ? LARVA_SPEED : player.speed;
  if (player.exhaust > 0) player.exhaust--;                 // can't run while recovering
  const canSprint = !player.isLarva && player.exhaust <= 0 && player.stamina > 0;
  const wantSprint = canSprint && keys["shift"] &&
    (keys["w"] || keys["s"] || keys["arrowup"] || keys["arrowdown"]);
  if (wantSprint) {
    player.stamina -= STAMINA_DRAIN;
    if (player.stamina <= 0) { player.stamina = 0; player.exhaust = EXHAUST_TIME; }   // burned out
  } else {
    player.stamina = Math.min(player.maxStamina, player.stamina + STAMINA_REGEN);
  }
  const pSpd = wantSprint ? baseSpeed * SPRINT_MULT : baseSpeed;

  // W drives toward the cursor; S backs away from it.
  const fx = Math.cos(player.angle), fy = Math.sin(player.angle);   // toward cursor
  const sx = player.x, sy = player.y;
  if (keys["w"] || keys["arrowup"])   { player.x += fx * pSpd; player.y += fy * pSpd; }
  if (keys["s"] || keys["arrowdown"]) { player.x -= fx * pSpd; player.y -= fy * pSpd; }

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

  // bite (dig / attack) — not while your mouth is full
  if (mouse.down && !player.carrying && player.biteAnim <= 0 && player.biteCooldown <= 0) {
    player.biteAnim = BITE_TIME;
    player.biteCooldown = BITE_TIME + 28;   // longer gap between bites
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
    meleeHit(player, ATTACK_DMG);        // and hit any enemy in front
  }
  if (player.biteAnim > 0) player.biteAnim--;
  if (player.biteCooldown > 0) player.biteCooldown--;
  healNearQueen(player);                 // heal when back at your nest

  // F: drop what you carry, or pick up the nearest egg / meat
  if (keys["f"] && !fPrev) {
    if (player.carrying) {
      dropCarried(player);
    } else {
      let best = null, bd = 34;
      for (const g of eggs) {
        if (g.dead || g.carried || g.isPlayer) continue;
        const d = Math.hypot(g.x - player.x, g.y - player.y);
        if (d < bd) { best = g; bd = d; }
      }
      for (const m of meats) {
        if (m.carried) continue;
        const d = Math.hypot(m.x - player.x, m.y - player.y);
        if (d < bd) { best = m; bd = d; }
      }
      for (const L of larvae) {
        if (L.dead || L.carried || L.team !== player.team) continue;
        const d = Math.hypot(L.x - player.x, L.y - player.y);
        if (d < bd) { best = L; bd = d; }
      }
      if (best) pickUp(player, best);
    }
  }
  // carrying meat next to a friendly larva feeds it (grows it faster)
  if (player.carrying && player.carrying.kind === "meat") {
    for (const L of larvae) {
      if (L.dead || L.team !== player.team) continue;
      if (Math.hypot(player.x - L.x, player.y - L.y) < 26) {
        L.growth = Math.min(GROW_MAX, L.growth + 40);
        removeMeat(player.carrying);
        player.carrying = null;
        break;
      }
    }
  }
  // carried item rides in your mouth
  if (player.carrying) {
    player.carrying.x = player.x + Math.cos(player.angle) * player.size * 1.1;
    player.carrying.y = player.y + Math.sin(player.angle) * player.size * 1.1;
  }
  }   // end player control
  fPrev = keys["f"];

  // eggs: queens lay & hatch reinforcements
  updateEggs();
  // clear out dead bots
  for (let i = bots.length - 1; i >= 0; i--) if (bots[i].dead) bots.splice(i, 1);

  // AI ants (both teams)
  for (const b of bots) updateBot(b);

  // ants push each other apart
  resolveAntCollisions();

  // beetles, larvae growing into ants, blood particles
  updateBeetles();
  updateLarvae();
  updateParticles();
}

// ---- Minimap (screen-space overview in the corner) ----
function drawMinimap() {
  const size = 280, margin = 12;
  const mx = margin, my = canvas.height - size - margin;   // bottom-left
  const scale = size / WORLD;
  const toX = (x) => mx + x * scale;
  const toY = (y) => my + y * scale;

  // panel
  ctx.fillStyle = "rgba(10,7,3,0.8)";
  ctx.fillRect(mx, my, size, size);
  ctx.strokeStyle = "#5a3a1e";
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, my, size, size);

  // explored terrain — like the game's fog: bright where currently visible,
  // dim where only remembered. floor vs wall get different shades.
  const cell = Math.max(1, ROCK_STEP * scale);
  for (const key of discovered) {
    const c = key.split(",");
    const cx = ROCK_STEP / 2 + (+c[0]) * ROCK_STEP;
    const cy = ROCK_STEP / 2 + (+c[1]) * ROCK_STEP;
    const wall = rockGrid.has(key);
    const litNow = lit.has(key);
    ctx.fillStyle = wall
      ? (litNow ? "#8a6a3c" : "#4a3826")
      : (litNow ? "#4a3820" : "#241a10");
    ctx.fillRect(toX(cx) - cell / 2, toY(cy) - cell / 2, cell, cell);
  }

  // nests (friend green / foe red on the minimap)
  for (const n of nests) {
    ctx.fillStyle = n.team === player.team ? FRIEND_COLOR : FOE_COLOR;
    ctx.beginPath();
    ctx.arc(toX(n.x), toY(n.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ants: your team always; enemies only if you can currently see them
  for (const b of bots) {
    if (b.team !== player.team && !lit.has(rockKey(cellIndex(b.x), cellIndex(b.y)))) continue;
    ctx.fillStyle = b.team === player.team ? FRIEND_COLOR : FOE_COLOR;
    ctx.beginPath();
    ctx.arc(toX(b.x), toY(b.y), 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // you (white)
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(toX(player.x), toY(player.y), 3, 0, Math.PI * 2);
  ctx.fill();
}

// ---- Draw ----
function draw() {
  ctx.fillStyle = "#2a1d10";   // tunnel floor (ground)
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (gameState === "menu") return;

  computeLit();   // what the player can currently see

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-player.x, -player.y);

  drawGround();
  drawRocks();
  drawNests();
  drawBeetles();
  drawMeats();
  drawLarvae();
  drawEggs();
  drawBots();
  if (!player.hatching) {
    if (player.isLarva) drawLarvaShape(player.x, player.y, player.walkPhase, player.growth / GROW_MAX);
    else drawAnt(player);
  }
  drawParticles();   // blood on top

  drawFog();   // hide everything the player can't see (rock blocks vision)

  if (!player.hatching) {
    // white ring so you can spot yourself (drawn on top of the fog)
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.size + 5, 0, Math.PI * 2);
    ctx.stroke();

    // your hp bar
    const w = player.size * 2.4, bx = player.x - w / 2, by = player.y - player.size - 16;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, w, 4);
    ctx.fillStyle = "#5ad25a";
    ctx.fillRect(bx, by, w * (player.hp / player.maxHp), 4);
  }

  ctx.restore();

  drawMinimap();   // screen-fixed overview (after the camera reset)

  // stamina bar (bottom center)
  if (!player.hatching) {
    const w = 200, h = 8;
    const x = canvas.width / 2 - w / 2, y = canvas.height - 26;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = player.exhaust > 0 ? "#d05a3a" : "#e8c84a";   // red while exhausted
    ctx.fillRect(x, y, w * (player.stamina / player.maxStamina), h);
    ctx.fillStyle = "#e8dcc0"; ctx.font = "10px monospace"; ctx.textAlign = "right";
    ctx.fillText(player.exhaust > 0 ? "TIRED" : "STAMINA", x - 6, y + h);
  }

  // win / lose banner
  if (gameState === "won" || gameState === "lost") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = gameState === "won" ? "#4fd04f" : "#d0453f";
    ctx.font = "bold 64px monospace";
    ctx.fillText(gameState === "won" ? "YOU WIN!" : "YOU LOSE", canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = "#e8dcc0";
    ctx.font = "18px monospace";
    ctx.fillText("refresh the page to play again", canvas.width / 2, canvas.height / 2 + 48);
  }
}

// ---- Loop ----
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
