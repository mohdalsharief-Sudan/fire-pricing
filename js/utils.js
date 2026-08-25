/* ================= أدوات ================= */
function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2); }
function today() { return new Date().toISOString().split("T")[0]; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmt(v) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function money(v) {
  return fmt(v);
}
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function on(id, evt, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}
function onEl(el, evt, fn) {
  if (el) el.addEventListener(evt, fn);
}
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}