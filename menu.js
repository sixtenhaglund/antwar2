// The main menu is all we've built so far. These buttons just show a message
// for now — we'll wire "Play" up to the actual game next.
const panel = document.getElementById("panel");

document.getElementById("playBtn").addEventListener("click", () => {
  panel.textContent = "The game isn't built yet — this is just the menu. Next up: the battlefield!";
});

document.getElementById("howBtn").addEventListener("click", () => {
  // toggle the how-to text on and off
  if (panel.dataset.showing === "how") {
    panel.textContent = "";
    panel.dataset.showing = "";
  } else {
    panel.innerHTML =
      "Move with <b>WASD</b> · aim with the <b>mouse</b><br>" +
      "Left-click to bite · <b>E</b> for your ant's ability<br>" +
      "Protect your queen and crush the other colonies.";
    panel.dataset.showing = "how";
  }
});
