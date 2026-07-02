// ---- The two teams ----
const TEAMS = {
  red:  { color: "#d0453f" },
  blue: { color: "#4f8fe0" },
};

// "You" — the ant you control.
const player = {
  x: 0, y: 0,
  size: 14,
  radius: 6,          // small circle for ant-vs-ant collision
  speed: 3,
  angle: 0,
  team: "red",
  color: TEAMS.red.color,
  walkPhase: 0,       // drives the leg swing
  moving: false,
  biteAnim: 0,        // counts down during a bite
  biteCooldown: 0,
};

// ---- Curved, spiky mandibles (jaws) ----
// bite = 0 (open) .. 1 (shut).
function drawMandibles(frontX, k, bite) {
  ctx.fillStyle = "#d8cba8";
  const rootY = 1.5 * k;
  const rot = -0.35 + bite * 0.5;   // hinge angle: open → shut
  const jaw = () => {
    const hw = 0.9 * k;             // half-width at the base
    ctx.beginPath();
    ctx.moveTo(0, -hw);
    ctx.quadraticCurveTo(2.8 * k, -0.2 * k - hw, 4.2 * k, 1.0 * k);  // outer edge → point
    ctx.quadraticCurveTo(2.8 * k, -0.2 * k + hw, 0, hw);            // inner edge → base
    ctx.closePath();
    ctx.fill();
  };
  ctx.save(); ctx.translate(frontX, -rootY); ctx.rotate(rot); jaw(); ctx.restore();
  ctx.save(); ctx.translate(frontX,  rootY); ctx.scale(1, -1); ctx.rotate(rot); jaw(); ctx.restore();
}

// ---- Draw an ant: legs, three body segments, jaws (facing +x) ----
function drawAnt(a) {
  const c = a.color;
  const k = a.size / 10;

  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle || 0);

  // legs (swing while moving)
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(1, 1.3 * k);
  ctx.lineCap = "round";
  const pairs = [-3, 0, 3];
  for (let i = 0; i < pairs.length; i++) {
    const off = pairs[i];
    const swing = a.moving ? Math.sin(a.walkPhase + i * 2) * 1.3 * k : 0;
    ctx.beginPath();
    ctx.moveTo(off * k, -2 * k); ctx.lineTo((off - 2) * k + swing, -6 * k);
    ctx.moveTo(off * k,  2 * k); ctx.lineTo((off - 2) * k - swing,  6 * k);
    ctx.stroke();
  }

  // bite in three phases: wind up (head back), charge (head forward + jaws
  // shut), recover (head back to rest, jaws reopen).
  let lunge = 0, bite = 0;
  if (a.biteAnim > 0) {
    const p = 1 - a.biteAnim / BITE_TIME;         // 0 → 1 over the whole bite
    if (p < 0.35) {                                // wind-up: pull the head back
      lunge = -1.2 * (p / 0.35);
    } else if (p < 0.6) {                          // charge: shoot forward + snap shut
      const t = (p - 0.35) / 0.25;
      lunge = -1.2 + t * 2.6;                      // -1.2 → +1.4
      bite = t;
    } else {                                       // recover: ease back, jaws reopen
      const t = (p - 0.6) / 0.4;
      lunge = 1.4 - t * 1.4;                       // +1.4 → 0
      bite = 1 - t;
    }
  }

  // body: three ellipses (head, thorax, abdomen); only the head lunges
  ctx.fillStyle = c;
  for (const seg of [[6, 3, 1], [0, 4, 0], [-7, 5, 0]]) {
    ctx.beginPath();
    ctx.ellipse((seg[0] + lunge * seg[2]) * k, 0, seg[1] * k, seg[1] * 0.8 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMandibles((8 + lunge) * k, k * 0.6, bite);

  ctx.restore();
}

// ---- Draw a queen: bigger body, a crown, on a nest mound ----
function drawQueen(q) {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.arc(q.x, q.y, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(q.x, q.y);
  const k = q.size / 13;

  ctx.strokeStyle = q.color;
  ctx.lineWidth = Math.max(1.2, 1.6 * k);
  ctx.lineCap = "round";
  for (const off of [-4, 0, 4]) {
    ctx.beginPath();
    ctx.moveTo(off * k, -3 * k); ctx.lineTo((off - 2) * k, -9 * k);
    ctx.moveTo(off * k,  3 * k); ctx.lineTo((off - 2) * k,  9 * k);
    ctx.stroke();
  }
  ctx.fillStyle = q.color;
  for (const seg of [[10, 5], [0, 7], [-12, 9]]) {
    ctx.beginPath();
    ctx.ellipse(seg[0] * k, 0, seg[1] * k, seg[1] * 0.8 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // little gold crown dot
  ctx.fillStyle = "#ffd21a";
  ctx.beginPath();
  ctx.arc(10 * k, 0, 2 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
