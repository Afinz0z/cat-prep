// Runs before the page draws, so it never flashes the wrong theme or text size.
// A plain script (not a module) so it blocks rendering for the few lines it needs.
try {
  var d = new Date();
  var m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; // minutes into the day in India
  var t = JSON.parse(localStorage.getItem("cat-theme"));
  if (t === "sunset") t = m >= 1080 || m < 390 ? "dark" : "light";
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  if (JSON.parse(localStorage.getItem("cat-warm")) === true && (m >= 1260 || m < 360)) document.documentElement.classList.add("warm");
  var z = JSON.parse(localStorage.getItem("cat-text"));
  if (z && z !== 100) document.documentElement.style.fontSize = z + "%";
} catch (e) {
  /* storage blocked: defaults apply */
}
