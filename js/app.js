"use strict";

const CURRENCIES = {
  SAR: { sym: "ر.س", name: "ريال سعودي" },
  EGP: { sym: "ج.م", name: "جنيه مصري" },
  AED: { sym: "د.إ", name: "درهم إماراتي" },
  USD: { sym: "$", name: "دولار أمريكي" },
  JOD: { sym: "د.أ", name: "دينار أردني" },
  KWD: { sym: "د.ك", name: "دينار كويتي" },
  QAR: { sym: "ر.ق", name: "ريال قطري" }
};

const STORAGE_KEY = "firepricing_projects_v1";

let state = {
  project: {
    name: "", client: "", location: "", date: today(), currency: "SAR",
    vat: 15, validity: 30, area: "", floors: "", notes: ""
  },
  equipment: [],
  labor: [],
  materials: [],
  services: [],
  margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 }
};

let idCounter = 1;
let currentFilter = "all";

/* ================= Utilities ================= */

function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function uid() { return idCounter++; }

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function money(n) {
  return `${fmt(n)} ${CURRENCIES[state.project.currency].sym}`;
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = Object.assign({}, state, saved);
      idCounter = 1000;
    }
  } catch (e) { /* ignore */ }
}

/* ================= Navigation ================= */

function setTab(tab) {
  document.querySelectorAll(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  const titles = {
    project: "معلومات المشروع", equipment: "الأجهزة والمعدات", labor: "العمالة",
    materials: "المواد", services: "الخدمات الهندسية", margin: "الهوامش والضرائب",
    quote: "عرض السعر النهائي"
  };
  document.getElementById("pageTitle").textContent = titles[tab] || "";
  window.scrollTo({ top: 0 });
}

/* ================= Calculations ================= */

function calcBase() {
  const eqSupply = state.equipment.reduce((s, e) => s + e.qty * e.supplyCost, 0);
  const eqInstall = state.equipment.reduce((s, e) => s + e.qty * e.installCost, 0);
  const laborCost = state.labor.reduce((s, l) => s + l.workers * l.days * l.dailyCost, 0);
  const materialsCost = state.materials.reduce((s, m) => s + m.qty * m.unitCost, 0);

  let servicesFixed = 0;
  let servicesPct = 0;
  state.services.forEach(se => {
    if (se.type === "pct") servicesPct += se.value;
    else servicesFixed += se.value;
  });

  const baseBeforeServices = eqSupply + eqInstall + laborCost + materialsCost;
  const servicesAmount = servicesFixed + baseBeforeServices * (servicesPct / 100);
  const baseCost = baseBeforeServices + servicesAmount;

  return {
    eqSupply, eqInstall, laborCost, materialsCost,
    servicesFixed, servicesPct, servicesAmount, baseCost
  };
}

function calcFull() {
  const base = calcBase();
  const m = state.margins;
  const overhead = base.baseCost * (m.overheadPct / 100);
  const contingency = base.baseCost * (m.contingencyPct / 100);
  const preProfit = base.baseCost + overhead + contingency;
  const profit = preProfit * (m.profitPct / 100);
  const netPrice = preProfit + profit;
  const discount = netPrice * (m.discountPct / 100);
  const afterDiscount = netPrice - discount;
  const vat = afterDiscount * (num(state.project.vat) / 100);
  const grandTotal = afterDiscount + vat;
  return Object.assign({}, base, {
    overhead, contingency, preProfit, profit, netPrice,
    discount, afterDiscount, vat, grandTotal
  });
}

function totalPoints() {
  return state.equipment.reduce((s, e) => {
    const cat = e.category || "alarm";
    return s + (cat === "alarm" ? e.qty : 0);
  }, 0);
}

/* ================= Rendering: Equipment ================= */

function renderEquipment() {
  const body = document.getElementById("eqBody");
  body.innerHTML = "";
  state.equipment.forEach((e, i) => {
    const total = e.qty * (e.supplyCost + e.installCost);
    const tr = document.createElement("tr");
    if (!e.supplyCost && !e.installCost) tr.classList.add("row-danger");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-id="${e.id}" data-f="name" value="${esc(e.name)}"></td>
      <td><input type="number" class="w-80" data-id="${e.id}" data-f="qty" value="${e.qty}" min="0"></td>
      <td><input type="number" class="w-100" data-id="${e.id}" data-f="supplyCost" value="${e.supplyCost}" min="0"></td>
      <td><input type="number" class="w-100" data-id="${e.id}" data-f="installCost" value="${e.installCost}" min="0"></td>
      <td class="num">${money(total)}</td>
      <td><button class="btn-danger" data-del="${e.id}" title="حذف">&times;</button></td>`;
    body.appendChild(tr);
  });
  const c = calcBase();
  document.getElementById("eqTotal").textContent =
    `إجمالي التوريد: ${money(c.eqSupply)} | إجمالي التركيب: ${money(c.eqInstall)} | الإجمالي: ${money(c.eqSupply + c.eqInstall)}`;
  updateAllTotals();
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ================= Rendering: Labor ================= */

function renderLabor() {
  const body = document.getElementById("laborBody");
  body.innerHTML = "";
  state.labor.forEach((l, i) => {
    const total = l.workers * l.days * l.dailyCost;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-id="${l.id}" data-f="name" data-tbl="labor" value="${esc(l.name)}"></td>
      <td><input type="number" class="w-80" data-id="${l.id}" data-f="workers" data-tbl="labor" value="${l.workers}" min="0"></td>
      <td><input type="number" class="w-80" data-id="${l.id}" data-f="days" data-tbl="labor" value="${l.days}" min="0"></td>
      <td><input type="number" class="w-100" data-id="${l.id}" data-f="dailyCost" data-tbl="labor" value="${l.dailyCost}" min="0"></td>
      <td class="num">${money(total)}</td>
      <td><button class="btn-danger" data-del-lab="${l.id}" title="حذف">&times;</button></td>`;
    body.appendChild(tr);
  });
  const c = calcBase();
  document.getElementById("laborTotal").textContent = `إجمالي العمالة: ${money(c.laborCost)}`;
  document.getElementById("laborAdviceList").innerHTML =
    LABOR_ADVICE.map(a => `<li>${a}</li>`).join("");
  updateAllTotals();
}

/* ================= Rendering: Materials ================= */

function renderMaterials() {
  const body = document.getElementById("materialBody");
  body.innerHTML = "";
  state.materials.forEach((m, i) => {
    const total = m.qty * m.unitCost;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-id="${m.id}" data-f="name" data-tbl="material" value="${esc(m.name)}"></td>
      <td><input type="number" class="w-80" data-id="${m.id}" data-f="qty" data-tbl="material" value="${m.qty}" min="0"></td>
      <td><input type="text" class="w-80" data-id="${m.id}" data-f="unit" data-tbl="material" value="${esc(m.unit)}"></td>
      <td><input type="number" class="w-100" data-id="${m.id}" data-f="unitCost" data-tbl="material" value="${m.unitCost}" min="0"></td>
      <td class="num">${money(total)}</td>
      <td><button class="btn-danger" data-del-mat="${m.id}" title="حذف">&times;</button></td>`;
    body.appendChild(tr);
  });
  const c = calcBase();
  document.getElementById("materialTotal").textContent = `إجمالي المواد: ${money(c.materialsCost)}`;
  updateAllTotals();
}

/* ================= Rendering: Services ================= */

function renderServices() {
  const body = document.getElementById("serviceBody");
  body.innerHTML = "";
  state.services.forEach((s, i) => {
    const c = calcBase();
    const amount = s.type === "pct" ? c.baseCost * (s.value / 100) : s.value;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><input type="text" data-id="${s.id}" data-f="name" data-tbl="service" value="${esc(s.name)}"></td>
      <td><input type="number" class="w-100" data-id="${s.id}" data-f="value" data-tbl="service" value="${s.value}" min="0"></td>
      <td>
        <select data-id="${s.id}" data-f="type" data-tbl="service">
          <option value="amount" ${s.type === "amount" ? "selected" : ""}>مبلغ ثابت</option>
          <option value="pct" ${s.type === "pct" ? "selected" : ""}>نسبة من التكلفة</option>
        </select>
      </td>
      <td class="num">${money(amount)}</td>
      <td><button class="btn-danger" data-del-svc="${s.id}" title="حذف">&times;</button></td>`;
    body.appendChild(tr);
  });
  const c = calcBase();
  document.getElementById("serviceTotal").textContent =
    `إجمالي الخدمات: ${money(c.servicesAmount)} ${c.servicesPct ? `(منها ${fmt(c.servicesPct)}% كنسبة)` : ""}`;
  updateAllTotals();
}

/* ================= Event delegation for tables ================= */

document.addEventListener("input", e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.id) return;
  const id = parseInt(el.dataset.id);
  const f = el.dataset.f;
  if (el.dataset.tbl) {
    const item = state[el.dataset.tbl].find(x => x.id === id);
    if (item) {
      item[f] = f === "name" || f === "unit" ? el.value : num(el.value);
      rerenderQuiet(el.dataset.tbl);
    }
  } else {
    const item = state.equipment.find(x => x.id === id);
    if (item) {
      item[f] = f === "name" ? el.value : num(el.value);
      rerenderQuiet("equipment");
    }
  }
  saveLocal();
});

function rerenderQuiet(tbl) {
  if (tbl === "equipment") renderEquipment();
  else if (tbl === "labor") renderLabor();
  else if (tbl === "material") renderMaterials();
  else if (tbl === "service") renderServices();
}

document.addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = parseInt(del.dataset.del);
    state.equipment = state.equipment.filter(x => x.id !== id);
    renderEquipment();
    saveLocal();
    return;
  }
  const delLab = e.target.closest("[data-del-lab]");
  if (delLab) {
    state.labor = state.labor.filter(x => x.id !== parseInt(delLab.dataset.delLab));
    renderLabor();
    saveLocal();
    return;
  }
  const delMat = e.target.closest("[data-del-mat]");
  if (delMat) {
    state.materials = state.materials.filter(x => x.id !== parseInt(delMat.dataset.delMat));
    renderMaterials();
    saveLocal();
    return;
  }
  const delSvc = e.target.closest("[data-del-svc]");
  if (delSvc) {
    state.services = state.services.filter(x => x.id !== parseInt(delSvc.dataset.delSvc));
    renderServices();
    saveLocal();
    return;
  }
});

/* ================= Add items ================= */

function addEquipment(name = "", supply = 0, install = 0, category = "alarm") {
  state.equipment.push({
    id: uid(), name: name || "جهاز جديد", category,
    qty: 1, supplyCost: supply, installCost: install
  });
  renderEquipment();
  saveLocal();
}

document.getElementById("btnAddEquipment").addEventListener("click", () => {
  addEquipment("", 0, 0, currentFilter === "fighting" ? "fighting" : "alarm");
});

document.getElementById("btnAddLabor").addEventListener("click", () => {
  state.labor.push({ id: uid(), name: "بند عمالة جديد", workers: 1, days: 1, dailyCost: 0 });
  renderLabor();
  saveLocal();
});

document.getElementById("btnAddMaterial").addEventListener("click", () => {
  state.materials.push({ id: uid(), name: "مادة جديدة", qty: 1, unit: "م", unitCost: 0 });
  renderMaterials();
  saveLocal();
});

document.getElementById("btnAddService").addEventListener("click", () => {
  state.services.push({ id: uid(), name: "خدمة جديدة", value: 0, type: "amount" });
  renderServices();
  saveLocal();
});

/* ================= Cable estimator ================= */

document.getElementById("btnEstimateCables").addEventListener("click", () => {
  const alarmDevices = state.equipment
    .filter(e => e.category === "alarm")
    .reduce((s, e) => s + e.qty, 0);
  if (alarmDevices === 0) {
    toast("لا توجد أجهزة إنذار لتقدير الكابلات لها");
    return;
  }
  const meters = Math.ceil(alarmDevices * CABLE_ESTIMATE_PER_DEVICE);
  const cost = meters * CABLE_PRICE_PER_METER;
  state.materials.push({
    id: uid(), name: `تقدير كابلات إنذار (${alarmDevices} جهاز × ${CABLE_ESTIMATE_PER_DEVICE}م)`,
    qty: meters, unit: "م", unitCost: CABLE_PRICE_PER_METER
  });
  renderMaterials();
  saveLocal();
  toast(`تمت إضافة ${fmt(meters)} متر كابلات بقيمة ${money(cost)}`);
});

/* ================= Library modal ================= */

const libModal = document.getElementById("libraryModal");
let libCategory = "alarm";

function renderLibrary() {
  const list = document.getElementById("libList");
  list.innerHTML = "";
  const search = document.getElementById("libSearch").value.trim().toLowerCase();
  const cat = EQUIPMENT_LIBRARY[libCategory];
  const totalItems = Object.keys(cat.groups).reduce((s, g) => s + cat.groups[g].length, 0);
  document.getElementById("libCount").textContent = `${cat.name} (${totalItems} صنف)`;
  let added = 0;
  Object.keys(cat.groups).forEach(gName => {
    const items = cat.groups[gName].filter(it =>
      !search || it.name.toLowerCase().includes(search));
    if (!items.length) return;
    const header = document.createElement("div");
    header.style.cssText = "font-size:12px;color:var(--accent2);font-weight:700;margin:16px 0 8px;display:flex;align-items:center;gap:8px";
    header.textContent = gName;
    header.appendChild(Object.assign(document.createElement("span"), { style: "font-weight:400;color:var(--muted);font-size:11px", textContent: `(${items.length})` }));
    list.appendChild(header);
    items.forEach(it => {
      const div = document.createElement("div");
      div.className = "lib-item";
      const priceText = it.supply > 0 ? money(it.supply) : "سعر حسب العرض";
      div.innerHTML = `
        <div>
          <div class="lib-name">${esc(it.name)}</div>
          <div class="lib-meta">تركيب مرجعي: ${it.install > 0 ? money(it.install) : "—"} لكل وحدة</div>
        </div>
        <div class="lib-price">${priceText}</div>`;
      div.addEventListener("click", () => {
        addEquipment(it.name, it.supply, it.install, libCategory);
        toast(`تمت إضافة: ${it.name}`);
      });
      list.appendChild(div);
      added++;
    });
  });
  if (!added) list.innerHTML = `<p class="hint">لا توجد نتائج</p>`;
}

document.getElementById("btnAddFromLibrary").addEventListener("click", () => {
  libModal.classList.add("show");
  renderLibrary();
});
document.getElementById("libraryClose").addEventListener("click", () => libModal.classList.remove("show"));
libModal.addEventListener("click", e => { if (e.target === libModal) libModal.classList.remove("show"); });
document.getElementById("libCategory").addEventListener("change", e => {
  libCategory = e.target.value;
  document.getElementById("libSearch").value = "";
  renderLibrary();
});
document.getElementById("libSearch").addEventListener("input", renderLibrary);

/* ================= Project info sync ================= */

function bindProjectInputs() {
  const map = {
    projectName: "name", projectClient: "client", projectLocation: "location",
    projectDate: "date", projectVat: "vat", projectValidity: "validity",
    projectArea: "area", projectFloors: "floors", projectNotes: "notes"
  };
  Object.keys(map).forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      const f = map[id];
      state.project[f] = (f === "vat" || f === "validity" || f === "area" || f === "floors")
        ? el.value : el.value;
      saveLocal();
      updateCurrencyBadge();
    });
  });
  document.getElementById("projectCurrency").addEventListener("change", e => {
    state.project.currency = e.target.value;
    saveLocal();
    updateCurrencyBadge();
    renderAll();
  });
}

function updateCurrencyBadge() {
  document.getElementById("currencyBadge").textContent =
    `العملة: ${CURRENCIES[state.project.currency].name}`;
}

/* ================= Margin inputs ================= */

function bindMarginInputs() {
  ["overheadPct", "contingencyPct", "profitPct", "discountPct"].forEach(id => {
    document.getElementById(id).addEventListener("input", e => {
      state.margins[id.replace("Pct", "") + "Pct"] = num(e.target.value);
      saveLocal();
      renderMarginAdvice();
    });
  });
}

function renderMarginAdvice() {
  const c = calcFull();
  const margin = c.netPrice > 0 ? (c.profit / c.netPrice) * 100 : 0;
  const box = document.getElementById("marginAdvice");
  box.innerHTML = `
    <h3>ملخص الهوامش</h3>
    <div class="grid-3" style="margin-top:10px">
      <div class="analysis-card accent"><div class="a-label">التكلفة الأساسية</div><div class="a-value">${money(c.baseCost)}</div></div>
      <div class="analysis-card accent"><div class="a-label">السعر قبل الضريبة (صافي)</div><div class="a-value">${money(c.netPrice)}</div></div>
      <div class="analysis-card ${margin < 10 ? "bad" : margin < 15 ? "warn" : "good"}"><div class="a-label">هامش الربح الفعلي</div><div class="a-value">${fmt(margin)}%</div></div>
    </div>
    <p class="hint" style="margin-top:10px">هامش ربح ${fmt(margin)}% على السعر (وليس على التكلفة). الهامش الحقيقي بعد الضريبة والخصم ${fmt(c.profit / c.grandTotal * 100)}% من الإجمالي النهائي.</p>`;
}

/* ================= Quote generation ================= */

function buildQuote() {
  const c = calcFull();
  const p = state.project;
  const cur = CURRENCIES[p.currency].sym;

  const eqRows = state.equipment.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(e.name)}</td>
      <td>${fmt(e.qty)}</td>
      <td>${e.supplyCost ? fmt(e.supplyCost) : "—"}</td>
      <td>${e.installCost ? fmt(e.installCost) : "—"}</td>
      <td>${fmt(e.qty * (e.supplyCost + e.installCost))}</td>
    </tr>`).join("");

  const materialRows = state.materials.map((m, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(m.name)}</td>
      <td>${fmt(m.qty)} ${esc(m.unit)}</td>
      <td>${fmt(m.unitCost)}</td>
      <td>${fmt(m.qty * m.unitCost)}</td>
    </tr>`).join("");

  const laborRows = state.labor.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(l.name)}</td>
      <td>${l.workers} × ${l.days} يوم</td>
      <td>${fmt(l.dailyCost)}</td>
      <td>${fmt(l.workers * l.days * l.dailyCost)}</td>
    </tr>`).join("");

  const serviceRows = state.services.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td>${s.type === "pct" ? fmt(s.value) + "%" : fmt(s.value)}</td>
      <td>${s.type === "pct" ? "نسبة من التكلفة" : "مبلغ ثابت"}</td>
      <td>${fmt(s.type === "pct" ? c.baseCost * (s.value / 100) : s.value)}</td>
    </tr>`).join("");

  const empty = `<tr><td colspan="5" style="color:#888;text-align:center">— لا توجد بنود —</td></tr>`;

  const validityDate = new Date();
  validityDate.setDate(validityDate.getDate() + num(p.validity));
  const validityStr = validityDate.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

  return `
  <div class="quote-doc" id="quoteDoc">
    <div class="q-head">
      <div>
        <h2>عرض سعر - أنظمة الحماية من الحرائق</h2>
        <div class="q-meta">
          <div><strong>المشروع:</strong> ${esc(p.name) || "—"}</div>
          <div><strong>العميل:</strong> ${esc(p.client) || "—"} <span style="margin:0 14px"></span><strong>الموقع:</strong> ${esc(p.location) || "—"}</div>
          <div><strong>التاريخ:</strong> ${p.date ? new Date(p.date).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }) : "—"} <span style="margin:0 14px"></span><strong>صلاحية العرض:</strong> ${fmt(p.validity)} يوم (حتى ${validityStr})</div>
        </div>
      </div>
      <div style="text-align:center;font-size:13px;color:#555">
        <div style="font-size:30px;color:#0f766e">S</div>
        <div><strong>شركة مقاولات الحماية من الحرائق</strong></div>
      </div>
    </div>

    <h3 style="color:#0f766e;font-size:14px;margin-top:14px">1) الأجهزة والمعدات الموردة</h3>
    <table>
      <thead><tr><th>م</th><th>البند</th><th>الكمية</th><th>توريد/وحدة</th><th>تركيب/وحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${eqRows || empty}</tbody>
      <tr><td colspan="5" style="text-align:left"><strong>إجمالي الأجهزة (توريد + تركيب)</strong></td><td><strong>${fmt(c.eqSupply + c.eqInstall)}</strong></td></tr>
    </table>

    ${materialRows ? `
    <h3 style="color:#0f766e;font-size:14px;margin-top:14px">2) المواد والمستهلكات</h3>
    <table>
      <thead><tr><th>م</th><th>المادة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${materialRows}</tbody>
      <tr><td colspan="4" style="text-align:left"><strong>إجمالي المواد</strong></td><td><strong>${fmt(c.materialsCost)}</strong></td></tr>
    </table>` : ""}

    ${laborRows ? `
    <h3 style="color:#0f766e;font-size:14px;margin-top:14px">3) تكاليف العمالة</h3>
    <table>
      <thead><tr><th>م</th><th>البند</th><th>عدد × أيام</th><th>التكلفة اليومية</th><th>الإجمالي</th></tr></thead>
      <tbody>${laborRows}</tbody>
      <tr><td colspan="4" style="text-align:left"><strong>إجمالي العمالة</strong></td><td><strong>${fmt(c.laborCost)}</strong></td></tr>
    </table>` : ""}

    ${serviceRows ? `
    <h3 style="color:#0f766e;font-size:14px;margin-top:14px">4) الخدمات الهندسية والتشغيلية</h3>
    <table>
      <thead><tr><th>م</th><th>الخدمة</th><th>القيمة</th><th>النوع</th><th>الإجمالي</th></tr></thead>
      <tbody>${serviceRows}</tbody>
      <tr><td colspan="4" style="text-align:left"><strong>إجمالي الخدمات</strong></td><td><strong>${fmt(c.servicesAmount)}</strong></td></tr>
    </table>` : ""}

    <h3 style="color:#0f766e;font-size:14px;margin-top:14px">5) ملخص التكاليف والأسعار</h3>
    <div class="q-sum">
      <div>التكلفة الأساسية للمشروع: <strong>${fmt(c.baseCost)} ${cur}</strong></div>
      <div>النفقات العامة (${fmt(state.margins.overheadPct)}%): ${fmt(c.overhead)} ${cur}</div>
      <div>هامش الطوارئ (${fmt(state.margins.contingencyPct)}%): ${fmt(c.contingency)} ${cur}</div>
      <div>هامش الربح (${fmt(state.margins.profitPct)}%): ${fmt(c.profit)} ${cur}</div>
      <div>السعر قبل الضريبة: <strong>${fmt(c.netPrice)} ${cur}</strong></div>
      ${state.margins.discountPct > 0 ? `<div>الخصم التجاري (${fmt(state.margins.discountPct)}%): -${fmt(c.discount)} ${cur}</div>
      <div>السعر بعد الخصم: ${fmt(c.afterDiscount)} ${cur}</div>` : ""}
      ${num(p.vat) > 0 ? `<div>ضريبة القيمة المضافة (${fmt(p.vat)}%): ${fmt(c.vat)} ${cur}</div>` : ""}
      <div class="grand">الإجمالي النهائي: ${fmt(c.grandTotal)} ${cur}</div>
    </div>

    ${p.notes ? `<div class="q-footer"><strong>ملاحظات وشروط:</strong><br>${esc(p.notes)}</div>` : ""}
    <div class="q-footer">
      <div><strong>شروط عامة:</strong></div>
      <div>1) يشمل العرض التوريد والتركيب والتشغيل والتدريب وتسليم الشهادات المطلوبة.</div>
      <div>2) الضمان عامان من تاريخ التشغيل النهائي وفق معايير الدفاع المدني.</div>
      <div>3) يتم الحجز على الأجهزة عند التوقيع على الطلبية، ولا تتحمل الشركة أي تغيير في الأسعار بعد الحجز.</div>
      <div>4) أسعار هذا العرض سارية لمدة ${fmt(p.validity)} يوم من تاريخه.</div>
    </div>
  </div>`;
}

function renderQuote() {
  document.getElementById("quotePreview").innerHTML = buildQuote();
  renderAnalysis();
}

/* ================= Analysis ================= */

function renderAnalysis() {
  const c = calcFull();
  const pts = totalPoints();
  const panel = document.getElementById("analysisPanel");

  const marginPct = c.netPrice > 0 ? (c.profit / c.netPrice) * 100 : 0;
  const pricePerPoint = pts > 0 ? c.netPrice / pts : 0;
  const pricePerM2 = num(state.project.area) > 0 ? c.netPrice / num(state.project.area) : 0;
  const installRatio = c.eqSupply > 0 ? (c.eqInstall / c.eqSupply) * 100 : 0;
  const laborRatio = c.baseCost > 0 ? (c.laborCost / c.baseCost) * 100 : 0;

  const advice = [];
  if (pts > 0 && pricePerPoint > 0) {
    advice.push({ cls: "info", text: `سعر النقطة الواحدة (جهاز إنذار) ≈ ${money(pricePerPoint)} قبل الضريبة. المقارنة المرجعية للنطاق السعري 250-600 ${CURRENCIES[state.project.currency].sym} حسب النظام (تقليدي/معنون).` });
  }
  if (pricePerM2 > 0) {
    advice.push({ cls: "info", text: `تكلفة المتر المربع من المبنى ≈ ${money(pricePerM2)}. النطاق المرجعي لأنظمة الحماية 15-45 ${CURRENCIES[state.project.currency].sym}/م² حسب نوع النظام.` });
  }
  if (marginPct < 10) {
    advice.push({ cls: "warn", text: `هامش الربح ${fmt(marginPct)}% أقل من 10% — خذ بعين الاعتبار رفع هامش الربح أو تقليل الخصم، خاصة مع مخاطر تأخر الدفعات.` });
  } else if (marginPct < 15) {
    advice.push({ cls: "warn", text: `هامش الربح ${fmt(marginPct)}% مقبول حدّياً. يُنصح بمراقبة أي تجاوز في التكاليف.` });
  } else if (marginPct >= 15 && marginPct < 25) {
    advice.push({ cls: "good", text: `هامش الربح ${fmt(marginPct)}% جيد ومناسب لهذا النوع من الأعمال.` });
  } else {
    advice.push({ cls: "good", text: `هامش الربح ${fmt(marginPct)}% ممتاز. تأكد من أن السعر ما زال تنافسياً في السوق.` });
  }
  if (installRatio > 0 && installRatio < 15) {
    advice.push({ cls: "warn", text: `تكلفة التركيب ${fmt(installRatio)}% من تكلفة التوريد منخفضة جداً — تحقق من أنك غطيت العمالة الفعلية.` });
  } else if (installRatio >= 15 && installRatio <= 45) {
    advice.push({ cls: "info", text: `تكلفة التركيب ${fmt(installRatio)}% من التوريد ضمن النطاق الطبيعي (15-45%).` });
  }
  if (laborRatio < 10) {
    advice.push({ cls: "warn", text: `العمالة المباشرة تمثل ${fmt(laborRatio)}% فقط من التكلفة — تأكد من احتساب جميع ساعات العمل الحقيقية.` });
  }
  if (c.discount > 0) {
    advice.push({ cls: "warn", text: `الخصم ${money(c.discount)} سيخفض صافي ربحك بنفس القيمة. احسبه على سعر البيع وليس على التكلفة.` });
  }
  if (!advice.length) {
    advice.push({ cls: "info", text: "أضف بنوداً للمشروع للحصول على تحليل ذكي." });
  }

  panel.innerHTML = `
    <div class="analysis-grid">
      <div class="analysis-card accent"><div class="a-label">التكلفة الإجمالية</div><div class="a-value">${money(c.baseCost)}</div></div>
      <div class="analysis-card ${marginPct < 10 ? "bad" : marginPct < 15 ? "warn" : "good"}"><div class="a-label">صافي الربح</div><div class="a-value">${money(c.profit)}</div></div>
      <div class="analysis-card ${marginPct < 10 ? "bad" : marginPct < 15 ? "warn" : "good"}"><div class="a-label">هامش الربح على السعر</div><div class="a-value">${fmt(marginPct)}%</div></div>
      ${pts > 0 ? `<div class="analysis-card"><div class="a-label">سعر النقطة (جهاز)</div><div class="a-value">${money(pricePerPoint)}</div></div>` : ""}
      ${pricePerM2 > 0 ? `<div class="analysis-card"><div class="a-label">السعر لكل م²</div><div class="a-value">${money(pricePerM2)}</div></div>` : ""}
      <div class="analysis-card accent"><div class="a-label">الإجمالي النهائي (شامل الضريبة)</div><div class="a-value">${money(c.grandTotal)}</div></div>
    </div>
    <ul class="advice-list" style="margin-top:14px">${advice.map(a => `<li class="${a.cls}">${a.text}</li>`).join("")}</ul>`;
}

/* ================= Save / Load / New ================= */

function snapshot() { return JSON.parse(JSON.stringify(state)); }

function listSavedProjects() {
  const list = document.getElementById("projectsList");
  list.innerHTML = "";
  let keys = [];
  try { keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_KEY)); } catch (e) {}
  if (!keys.length) {
    list.innerHTML = `<p class="hint">لا توجد مشاريع محفوظة.</p>`;
    return;
  }
  keys.sort().reverse().forEach(k => {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(k)); } catch (e) {}
    if (!data) return;
    const div = document.createElement("div");
    div.className = "proj-item";
    const total = data.project ? "" : "";
    div.innerHTML = `
      <div>
        <div class="proj-name">${esc(data.project.name || "مشروع بدون اسم")}</div>
        <div class="proj-meta">${esc(data.project.client || "—")} | ${esc(data.project.date || "")} | ${k.replace(STORAGE_KEY + "_", "")}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-load="${k}">فتح</button>`;
    div.querySelector("[data-load]").addEventListener("click", () => {
      state = data;
      idCounter = 1000;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      document.getElementById("projectsModal").classList.remove("show");
      renderAll();
      setTab("project");
      toast("تم فتح المشروع");
    });
    list.appendChild(div);
  });
}

document.getElementById("btnSaveProject").addEventListener("click", () => {
  const name = (state.project.name || "مشروع").trim();
  const key = `${STORAGE_KEY}_${Date.now()}`;
  try { localStorage.setItem(key, JSON.stringify(state)); toast(`تم حفظ المشروع "${name}"`); } catch (e) { toast("فشل الحفظ"); }
});

document.getElementById("btnLoadProject").addEventListener("click", () => {
  document.getElementById("projectsModal").classList.add("show");
  listSavedProjects();
});
document.getElementById("projectsClose").addEventListener("click", () => document.getElementById("projectsModal").classList.remove("show"));
document.getElementById("projectsModal").addEventListener("click", e => { if (e.target.id === "projectsModal") e.target.classList.remove("show"); });

document.getElementById("btnNewProject").addEventListener("click", () => {
  if (state.equipment.length || state.labor.length || state.materials.length || state.services.length) {
    if (!confirm("سيتم تفريغ بيانات المشروع الحالي. هل تريد المتابعة؟")) return;
  }
  state = {
    project: { name: "", client: "", location: "", date: today(), currency: state.project.currency, vat: 15, validity: 30, area: "", floors: "", notes: "" },
    equipment: [], labor: [], materials: [], services: [],
    margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 }
  };
  saveLocal();
  renderAll();
  setTab("project");
  toast("تم إنشاء مشروع جديد");
});

/* ================= Print / Copy ================= */

document.getElementById("btnPrint").addEventListener("click", () => window.print());

document.getElementById("btnCopySummary").addEventListener("click", () => {
  const c = calcFull();
  const cur = CURRENCIES[state.project.currency].sym;
  const lines = [];
  lines.push(`عرض سعر - ${state.project.name || "مشروع"}`);
  lines.push(`العميل: ${state.project.client || "—"} | الموقع: ${state.project.location || "—"}`);
  lines.push(`التكلفة الأساسية: ${fmt(c.baseCost)} ${cur}`);
  lines.push(`النفقات العامة (${fmt(state.margins.overheadPct)}%): ${fmt(c.overhead)} ${cur}`);
  lines.push(`هامش الطوارئ (${fmt(state.margins.contingencyPct)}%): ${fmt(c.contingency)} ${cur}`);
  lines.push(`هامش الربح (${fmt(state.margins.profitPct)}%): ${fmt(c.profit)} ${cur}`);
  lines.push(`السعر قبل الضريبة: ${fmt(c.netPrice)} ${cur}`);
  if (state.margins.discountPct > 0) lines.push(`الخصم (${fmt(state.margins.discountPct)}%): -${fmt(c.discount)} ${cur}`);
  if (num(state.project.vat) > 0) lines.push(`ضريبة القيمة المضافة (${fmt(state.project.vat)}%): ${fmt(c.vat)} ${cur}`);
  lines.push(`الإجمالي النهائي: ${fmt(c.grandTotal)} ${cur}`);
  navigator.clipboard.writeText(lines.join("\n")).then(
    () => toast("تم نسخ الملخص"),
    () => toast("تعذر النسخ")
  );
});

/* ================= Filters ================= */

document.getElementById("eqCategoryFilter").addEventListener("change", e => {
  currentFilter = e.target.value;
  const isAll = currentFilter === "all";
  document.querySelectorAll("#eqBody tr").forEach(tr => {
    const name = tr.querySelector("input[data-f=name]");
    const cat = state.equipment.find(x => x.id === parseInt(name.dataset.id));
    tr.style.display = (isAll || (cat && cat.category === currentFilter)) ? "" : "none";
  });
});

/* ================= Update all totals ================= */

function updateAllTotals() {
  const c = calcFull();
  const net = c.netPrice || 0;
  document.querySelectorAll(".nav-item").forEach(() => {});
}

/* ================= Init ================= */

function fillProjectInputs() {
  document.getElementById("projectName").value = state.project.name;
  document.getElementById("projectClient").value = state.project.client;
  document.getElementById("projectLocation").value = state.project.location;
  document.getElementById("projectDate").value = state.project.date;
  document.getElementById("projectCurrency").value = state.project.currency;
  document.getElementById("projectVat").value = state.project.vat;
  document.getElementById("projectValidity").value = state.project.validity;
  document.getElementById("projectArea").value = state.project.area;
  document.getElementById("projectFloors").value = state.project.floors;
  document.getElementById("projectNotes").value = state.project.notes;

  document.getElementById("overheadPct").value = state.margins.overheadPct;
  document.getElementById("contingencyPct").value = state.margins.contingencyPct;
  document.getElementById("profitPct").value = state.margins.profitPct;
  document.getElementById("discountPct").value = state.margins.discountPct;
}

function renderAll() {
  fillProjectInputs();
  renderEquipment();
  renderLabor();
  renderMaterials();
  renderServices();
  renderMarginAdvice();
  renderQuote();
  updateCurrencyBadge();
}

document.querySelectorAll(".nav-item").forEach(a => a.addEventListener("click", () => setTab(a.dataset.tab)));

loadLocal();
bindProjectInputs();
bindMarginInputs();
renderAll();
