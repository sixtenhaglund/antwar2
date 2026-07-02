// ---- Beetles: neutral bugs that wander caves; kill them for food ----
const beetles = [];

function spawnBeetle(x, y) {
  beetles.push({
    x, y, team: "beetle",
    angle: Math.random() * Math.PI * 2,
    size: 13, radius: 8,
    hp: 12, maxHp: 12, dead: false,
    moveTimer: 0, walkPhase: 0,
  });
}

function updateBeetles() {
  for (let i = beetles.length - 1; i >= 0; i--) {
    const b = beetles[i];
    if (b.dead) { beetles.splice(i, 1); continue; }

    // wander: pick a new direction now and then
    if (--b.moveTimer <= 0) {
      b.angle = Math.random() * Math.PI * 2;
      b.moveTimer = 60 + Math.random() * 100;
    }
    // step forward if it's open; turn away from rock
    const nx = b.x + Math.cos(b.angle) * 0.9;
    const ny = b.y + Math.sin(b.angle) * 0.9;
    if (!rockGrid.has(rockKey(cellIndex(nx), cellIndex(ny)))) {
      b.x = nx; b.y = ny;
      b.walkPhase += 0.3;
    } else {
      b.angle += 1.7;   // bumped a wall, turn
      b.moveTimer = 20;
    }
  }
}

function drawBeetles() {
  for (const b of beetles) {
    if (!lit.has(rockKey(cellIndex(b.x), cellIndex(b.y)))) continue;   // fog
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    // little legs
    ctx.strokeStyle = "#20200f";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    const wob = Math.sin(b.walkPhase) * 2;
    for (const ox of [-4, 0, 4]) {
      ctx.beginPath();
      ctx.moveTo(ox, -4); ctx.lineTo(ox + wob, -8);
      ctx.moveTo(ox,  4); ctx.lineTo(ox - wob,  8);
      ctx.stroke();
    }
    // dark shiny shell
    ctx.fillStyle = "#403a1e";
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#28240f";
    ctx.beginPath();
    ctx.arc(8, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // hp bar when hurt
    if (b.hp < b.maxHp) {
      const w = 22, bx = b.x - w / 2, by = b.y - 16;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx, by, w, 3);
      ctx.fillStyle = "#c8d04a"; ctx.fillRect(bx, by, w * (b.hp / b.maxHp), 3);
    }
  }
}
