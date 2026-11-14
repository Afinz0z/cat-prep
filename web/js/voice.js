// Spoken approaches on a question's discussion: up to 90 seconds each,
// recorded in the browser and played back on demand.
import { rpc } from "./db.js";
import { el, busy, showError, fmtDateTime } from "./ui.js";

const MAX_SEC = 90;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function voiceBox(testId, questionId) {
  const host = el("div", { class: "voice" });
  const list = el("div");
  const status = el("p", { class: "status-line", role: "status" });
  const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
  const rec = el("button", { type: "button", class: "btn small" }, "Record a spoken approach");
  let recorder = null;
  let timer = null;

  async function load() {
    try {
      paint(await rpc("cat_voice_list", { p_test_id: testId, p_question_id: questionId }));
    } catch (err) {
      status.textContent = err.message;
    }
  }
  function paint(rows) {
    list.replaceChildren(...rows.map((v) => {
      const play = el("button", { type: "button", class: "btn small" }, `Play ${v.name}, ${v.seconds} s`);
      play.addEventListener("click", () => busy(play, async () => {
        const a = await rpc("cat_voice_get", { p_id: v.id });
        const audio = el("audio", { controls: true, src: `data:${a.mime.split(";")[0]};base64,${a.data}` });
        play.replaceWith(audio);
        audio.play().catch(() => {});
      }));
      const del = v.me ? el("button", { type: "button", class: "btn quiet small" }, "Delete") : null;
      del?.addEventListener("click", () => busy(del, async () => { await rpc("cat_voice_delete", { p_id: v.id }); load(); }));
      return el("div", { class: "row" }, play, el("span", { class: "muted small" }, fmtDateTime(v.at)), del);
    }));
  }
  async function start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = "The microphone is blocked for this site. Allow it in the browser's site settings.";
      return;
    }
    const chunks = [];
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    const began = Date.now();
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      rec.textContent = "Record a spoken approach";
      const seconds = Math.round((Date.now() - began) / 1000);
      if (seconds < 2) { status.textContent = "Too short to keep."; return; }
      status.textContent = "Saving...";
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const data = await toBase64(blob);
        paint(await rpc("cat_voice_post", { p_test_id: testId, p_question_id: questionId, p_mime: blob.type || "audio/webm", p_data: data, p_seconds: seconds }));
        status.textContent = "Saved.";
      } catch (err) {
        showError(err);
        status.textContent = "";
      }
      recorder = null;
    };
    recorder.start();
    timer = setInterval(() => {
      const s = Math.round((Date.now() - began) / 1000);
      rec.textContent = `Stop (${s} of ${MAX_SEC} s)`;
      if (s >= MAX_SEC) recorder?.stop();
    }, 500);
    rec.textContent = "Stop";
  }
  rec.addEventListener("click", () => { if (recorder) recorder.stop(); else start(); });
  host.append(el("h4", {}, "Spoken approaches"), list, canRecord ? el("div", { class: "row" }, rec) : el("p", { class: "muted small" }, "This browser can't record audio."), status);
  load();
  return host;
}
