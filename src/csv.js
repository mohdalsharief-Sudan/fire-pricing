"use strict";
/*
 * csv.js — محلل ملفات CSV (يدعم العربية وBOM والفاصلة المنقوطة)
 */
function detectDelimiter(line) {
  const delims = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  delims.forEach(d => {
    const count = (line.match(new RegExp("\\" + d, "g")) || []).length;
    if (count > bestCount) { bestCount = count; best = d; }
  });
  return best;
}

function splitLine(line, delim) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function parseCsvText(text) {
  const t = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = t.split("\n").filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  return lines.map(l => splitLine(l, delim));
}

module.exports = { parseCsvText, detectDelimiter, splitLine };
