"use strict";
/* اختبارات محلل CSV */
const { test } = require("node:test");
const assert = require("node:assert");
const { parseCsvText, detectDelimiter } = require("./csv.js");

test("CSV بفاصلة منقوطة عربية (Excel العربي)", () => {
  const csv = "الاسم;السعر;الوحدة\nكاشف دخان تقليدي;120;حبة\nطفاية 6 كجم;85;حبة";
  const rows = parseCsvText(csv);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[0], ["الاسم", "السعر", "الوحدة"]);
  assert.deepStrictEqual(rows[1], ["كاشف دخان تقليدي", "120", "حبة"]);
});

test("CSV بفواصل عادية", () => {
  const rows = parseCsvText("name,price\nDetector,120");
  assert.deepStrictEqual(rows[1], ["Detector", "120"]);
});

test("يدعم BOM وأسطر فارغة واقتباسات", () => {
  const csv = "\uFEFFالاسم;السعر\n\"كاشف, دخان\";\"150\"\n\nطفاية;85";
  const rows = parseCsvText(csv);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1][0], "كاشف, دخان");
  assert.strictEqual(rows[2][0], "طفاية");
});

test("كشف محدد الفصل تلقائياً", () => {
  assert.strictEqual(detectDelimiter("a;b;c"), ";");
  assert.strictEqual(detectDelimiter("a,b,c"), ",");
});

test("قيم فارغة ومسافات تُنظف", () => {
  const rows = parseCsvText("a;b\n 1 ; 2 ");
  assert.deepStrictEqual(rows[1], ["1", "2"]);
});
