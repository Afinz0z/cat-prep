// A basic on-screen calculator like the one in the CAT interface.
import { el } from "./ui.js";

const LAYOUT = [
  ["MC", "MR", "MS", "M+", "M-"],
  ["←", "C", "CE", "±", "√"],
  ["7", "8", "9", "/", "%"],
  ["4", "5", "6", "*", "1/x"],
  ["1", "2", "3", "-", "="],
  ["0", ".", "+"],
];

export function createCalculator(host) {
  let display = "0";
  let acc = null;
  let op = null;
  let fresh = true;
  let memory = 0;
  let error = false;

  const screenEl = el("output", { class: "calc-display", "aria-live": "polite" }, "0");
  const memEl = el("span", { class: "calc-mem" }, "");
  const head = el("div", { class: "calc-head" }, el("span", {}, "Calculator"), memEl,
    el("button", { type: "button", class: "calc-close", "aria-label": "Close calculator", onclick: () => close() }, "Close"));
  const grid = el("div", { class: "calc-grid" });
  for (const row of LAYOUT) {
    for (const keyLabel of row) {
      grid.append(el("button", {
        type: "button",
        class: `calc-key${keyLabel === "=" ? " calc-eq" : ""}${keyLabel === "0" ? " calc-zero" : ""}`,
        onclick: () => press(keyLabel),
      }, keyLabel));
    }
  }
  host.replaceChildren(head, screenEl, grid);

  function fmt(x) {
    if (!Number.isFinite(x)) return null;
    return String(Number(x.toPrecision(12)));
  }

  function show(value) {
    if (value === null) {
      error = true;
      display = "0";
      screenEl.textContent = "Error";
      return;
    }
    display = value;
    screenEl.textContent = value;
    memEl.textContent = memory ? "M" : "";
  }

  function apply(a, b, operator) {
    switch (operator) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b === 0 ? NaN : a / b;
      default: return b;
    }
  }

  function press(k) {
    if (error && k !== "C") {
      error = false;
      acc = null;
      op = null;
      fresh = true;
    }
    const v = Number(display);
    if (/^\d$/.test(k)) {
      show(fresh || display === "0" ? k : display + k);
      fresh = false;
    } else if (k === ".") {
      if (fresh) show("0.");
      else if (!display.includes(".")) show(display + ".");
      fresh = false;
    } else if ("+-*/".includes(k)) {
      if (op && !fresh) {
        acc = apply(acc, v, op);
        show(fmt(acc));
      } else if (!op) {
        acc = v;
      }
      op = k;
      fresh = true;
    } else if (k === "=") {
      if (op !== null && acc !== null) {
        show(fmt(apply(acc, v, op)));
        acc = null;
        op = null;
        fresh = true;
      }
    } else if (k === "C") {
      error = false;
      acc = null;
      op = null;
      fresh = true;
      show("0");
    } else if (k === "CE") {
      fresh = true;
      show("0");
    } else if (k === "←") {
      if (!fresh) show(display.length > 1 ? display.slice(0, -1) : "0");
    } else if (k === "±") {
      show(display.startsWith("-") ? display.slice(1) : display === "0" ? "0" : `-${display}`);
    } else if (k === "√") {
      show(v < 0 ? null : fmt(Math.sqrt(v)));
      fresh = true;
    } else if (k === "%") {
      show(fmt(op && acc !== null ? (acc * v) / 100 : v / 100));
      fresh = true;
    } else if (k === "1/x") {
      show(v === 0 ? null : fmt(1 / v));
      fresh = true;
    } else if (k === "MC") {
      memory = 0;
      show(display);
    } else if (k === "MR") {
      show(fmt(memory));
      fresh = true;
    } else if (k === "MS") {
      memory = v;
      show(display);
      fresh = true;
    } else if (k === "M+") {
      memory += v;
      show(display);
      fresh = true;
    } else if (k === "M-") {
      memory -= v;
      show(display);
      fresh = true;
    }
  }

  // Drag by the title bar.
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev) => {
      host.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - dx))}px`;
      host.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
      host.style.right = "auto";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  function open() {
    host.hidden = false;
  }
  function close() {
    host.hidden = true;
  }
  return { open, close, toggle: () => (host.hidden ? open() : close()), isOpen: () => !host.hidden };
}
