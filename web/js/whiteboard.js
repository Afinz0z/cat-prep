// A shared whiteboard for a DILR set or a co-solve: everyone on the board sees
// each stroke within a couple of seconds. Points are stored from 0 to 1 so the
// drawing fits any screen.
import { rpc } from "./db.js";
import { el, busy, showError } from "./ui.js";

const COLORS = { ink: "--ink", blue: "--exam-ink", amber: "--marigold", red: "--bad" };

export function openBoard(board, title) {
  const dialog = el("dialog", { class: "dialog board-dialog", "aria-label": title });
  const canvas = el("canvas", { class: "board-canvas", "aria-label": "Drawing area. Draw with a finger, pen or mouse." });
  let color = "ink";
  let strokes = [];
  let lastId = 0;
  let drawing = null;
  let poll = null;
  const status = el("span", { class: "muted small", role: "status" });

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000";
  const ctx = canvas.getContext("2d");
  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function line(s) {
    const r = canvas.getBoundingClientRect();
    const pts = s.points || [];
    if (!pts.length) return;
    ctx.strokeStyle = css(COLORS[s.color] || COLORS.ink);
    ctx.lineWidth = s.width || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * r.width, pts[0][1] * r.height);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * r.width, y * r.height);
    if (pts.length === 1) ctx.lineTo(pts[0][0] * r.width + 0.1, pts[0][1] * r.height);
    ctx.stroke();
  }
  function redraw() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    for (const s of strokes) line(s);
    if (drawing) line(drawing);
  }
  function take(rows) {
    for (const row of rows) {
      lastId = Math.max(lastId, row.id);
      if (row.data.clear) strokes = [];
      else strokes.push(row.data);
    }
    if (rows.length) redraw();
  }
  async function pull() {
    try {
      take(await rpc("cat_strokes", { p_board: board, p_after: lastId }));
      status.textContent = "";
    } catch (err) {
      status.textContent = err.message;
    }
  }
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000];
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = { color, width: color === "ink" ? 2 : 3, points: [point(e)] };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = point(e);
    const last = drawing.points.at(-1);
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.003) return;
    drawing.points.push(p);
    if (drawing.points.length > 900) drawing.points = drawing.points.filter((_, i) => i % 2 === 0);
    redraw();
  });
  const finish = async () => {
    if (!drawing) return;
    const s = drawing;
    drawing = null;
    strokes.push(s);
    redraw();
    try {
      const { id } = await rpc("cat_stroke_add", { p_board: board, p_data: s });
      lastId = Math.max(lastId, id);
    } catch (err) {
      showError(err);
    }
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  const swatches = Object.keys(COLORS).map((c) => {
    const b = el("button", { type: "button", class: `btn small swatch sw-${c}`, "aria-pressed": String(c === color) }, c === "ink" ? "Pen" : c[0].toUpperCase() + c.slice(1));
    b.addEventListener("click", () => {
      color = c;
      for (const x of swatches) x.setAttribute("aria-pressed", String(x === b));
    });
    return b;
  });
  const clear = el("button", { type: "button", class: "btn small quiet" }, "Clear for everyone");
  clear.addEventListener("click", () => busy(clear, async () => {
    await rpc("cat_stroke_add", { p_board: board, p_data: { clear: true } });
    strokes = [];
    redraw();
    await pull();
  }));
  const close = el("button", { type: "button", class: "btn primary" }, "Close");
  close.addEventListener("click", () => dialog.close());
  dialog.append(
    el("div", { class: "page-head" }, el("h2", {}, title), status),
    el("div", { class: "row" }, swatches, clear),
    canvas,
    el("p", { class: "muted small" }, "Everyone who opens this board sees the same drawing. Keep answers off it until the others have finished."),
    el("div", { class: "dialog-actions" }, close));
  dialog.addEventListener("close", () => {
    clearInterval(poll);
    window.removeEventListener("resize", size);
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  size();
  window.addEventListener("resize", size);
  pull();
  poll = setInterval(() => { if (!document.hidden) pull(); }, 2500);
}
