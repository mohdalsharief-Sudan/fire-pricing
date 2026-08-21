"use strict";
/* اختبارات محرك الحسابات */
const { test } = require("node:test");
const assert = require("node:assert");
const CALC = require("../../js/calc.js");

function sampleState() {
  return {
    project: { vat: 15, currency: "SAR" },
    margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 },
    equipment: [
      { qty: 10, supplyCost: 120, installCost: 55, category: "alarm" },
      { qty: 4, supplyCost: 65, installCost: 45, category: "alarm" }
    ],
    labor: [{ workers: 2, days: 5, dailyCost: 150 }],
    materials: [{ qty: 100, unitCost: 8 }],
    services: [{ type: "pct", value: 5 }, { type: "amount", value: 300 }]
  };
}

test("calcBase: يحسب التوريد والتركيب والعمالة والمواد والخدمات", () => {
  const c = CALC.calcBase(sampleState());
  assert.strictEqual(c.eqSupply, 1200 + 260);            // 1460
  assert.strictEqual(c.eqInstall, 550 + 180);            // 730
  assert.strictEqual(c.laborCost, 1500);
  assert.strictEqual(c.materialsCost, 800);
  assert.strictEqual(c.servicesFixed, 300);
  assert.strictEqual(c.servicesPct, 5);
  // baseBefore = 1460+730+1500+800 = 4490 → خدمات = 300 + 224.5 = 524.5
  assert.strictEqual(c.servicesAmount, 524.5);
  assert.strictEqual(c.baseCost, 4490 + 524.5);          // 5014.5
});

test("calcFull: تسلسل النفقات والطوارئ والربح والضريبة", () => {
  const c = CALC.calcFull(sampleState());
  const base = 5014.5;
  assert.ok(Math.abs(c.overhead - base * 0.08) < 1e-9);       // 401.16
  assert.ok(Math.abs(c.contingency - base * 0.05) < 1e-9);    // 250.725
  const preProfit = base + c.overhead + c.contingency;
  assert.ok(Math.abs(c.preProfit - preProfit) < 1e-9);
  assert.ok(Math.abs(c.profit - preProfit * 0.15) < 1e-9);
  assert.ok(Math.abs(c.netPrice - preProfit * 1.15) < 1e-9);
  assert.strictEqual(c.discount, 0);
  assert.ok(Math.abs(c.afterDiscount - c.netPrice) < 1e-9);
  assert.ok(Math.abs(c.vat - c.netPrice * 0.15) < 1e-9);
  assert.ok(Math.abs(c.grandTotal - c.netPrice * 1.15) < 1e-9);
});

test("calcFull: خصم وضريبة صفرية", () => {
  const s = sampleState();
  s.margins.discountPct = 10;
  s.project.vat = 0;
  const c = CALC.calcFull(s);
  assert.ok(Math.abs(c.discount - c.netPrice * 0.1) < 1e-9);
  assert.strictEqual(c.vat, 0);
  assert.ok(Math.abs(c.grandTotal - c.afterDiscount) < 1e-9);
});

test("totalPoints: يحسب أجهزة الإنذار فقط", () => {
  const s = sampleState();
  s.equipment.push({ qty: 3, supplyCost: 10, installCost: 5, system: "fighting" });
  assert.strictEqual(CALC.totalPoints(s), 14); // 10 + 4 إنذار (fighting مستبعد)
});

test("nextQuoteNo: تنسيق الترقيم", () => {
  assert.strictEqual(CALC.nextQuoteNo(1, 2026), "Q-2026-0001");
  assert.strictEqual(CALC.nextQuoteNo(123, 2026), "Q-2026-0123");
});

test("fmt/num: تنسيق الأرقام", () => {
  assert.strictEqual(CALC.fmt(1234.567), "1,234.57");
  assert.strictEqual(CALC.fmt("abc"), "0");
  assert.strictEqual(CALC.num("15.5"), 15.5);
  assert.strictEqual(CALC.num("x"), 0);
});
