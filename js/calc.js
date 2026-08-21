"use strict";
/*
 * calc.js — محرك الحسابات (نقي، بدون DOM)
 * يعمل في المتصفح (window.CALC) وفي Node (module.exports) للاختبارات.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CALC = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const CURRENCIES = {
    SAR: { sym: "ر.س", name: "ريال سعودي" },
    EGP: { sym: "ج.م", name: "جنيه مصري" },
    AED: { sym: "د.إ", name: "درهم إماراتي" },
    USD: { sym: "$", name: "دولار أمريكي" },
    JOD: { sym: "د.أ", name: "دينار أردني" },
    KWD: { sym: "د.ك", name: "دينار كويتي" },
    QAR: { sym: "ر.ق", name: "ريال قطري" }
  };

  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "0";
    const v = Math.round(n * 100) / 100;
    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function money(n, currency) {
    return `${fmt(n)} ${CURRENCIES[currency || "SAR"].sym}`;
  }

  /* التكلفة الأساسية: توريد + تركيب + عمالة + مواد + خدمات */
  function calcBase(state) {
    const equipment = state.equipment || [];
    const labor = state.labor || [];
    const materials = state.materials || [];
    const services = state.services || [];

    const eqSupply = equipment.reduce((s, e) => s + num(e.qty) * num(e.supplyCost), 0);
    const eqInstall = equipment.reduce((s, e) => s + num(e.qty) * num(e.installCost), 0);
    const laborCost = labor.reduce((s, l) => s + num(l.workers) * num(l.days) * num(l.dailyCost), 0);
    const materialsCost = materials.reduce((s, m) => s + num(m.qty) * num(m.unitCost), 0);

    let servicesFixed = 0;
    let servicesPct = 0;
    services.forEach(se => {
      if (se.type === "pct") servicesPct += num(se.value);
      else servicesFixed += num(se.value);
    });

    const baseBeforeServices = eqSupply + eqInstall + laborCost + materialsCost;
    const servicesAmount = servicesFixed + baseBeforeServices * (servicesPct / 100);
    const baseCost = baseBeforeServices + servicesAmount;

    return {
      eqSupply, eqInstall, laborCost, materialsCost,
      servicesFixed, servicesPct, servicesAmount, baseCost
    };
  }

  /* الحساب الكامل: نفقات + طوارئ + ربح + خصم + ضريبة */
  function calcFull(state) {
    const base = calcBase(state);
    const m = state.margins || {};
    const overhead = base.baseCost * (num(m.overheadPct) / 100);
    const contingency = base.baseCost * (num(m.contingencyPct) / 100);
    const preProfit = base.baseCost + overhead + contingency;
    const profit = preProfit * (num(m.profitPct) / 100);
    const netPrice = preProfit + profit;
    const discount = netPrice * (num(m.discountPct) / 100);
    const afterDiscount = netPrice - discount;
    const vat = afterDiscount * (num(state.project.vat) / 100);
    const grandTotal = afterDiscount + vat;
    return Object.assign({}, base, {
      overhead, contingency, preProfit, profit, netPrice,
      discount, afterDiscount, vat, grandTotal
    });
  }

  /* عدد أجهزة الإنذار (نقاط النظام) */
  function totalPoints(state) {
    return (state.equipment || []).reduce((s, e) => {
      return s + ((e.category === "alarm" || e.system === "alarm") ? num(e.qty) : 0);
    }, 0);
  }

  /* نص رقم العرض: Q-2026-0001 */
  function nextQuoteNo(seq, year) {
    const y = year || new Date().getFullYear();
    return `Q-${y}-${String(seq).padStart(4, "0")}`;
  }

  return { CURRENCIES, num, fmt, money, calcBase, calcFull, totalPoints, nextQuoteNo };
});
