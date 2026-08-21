"use strict";
/*
 * app.js — منطق الواجهة
 * البيانات عبر window.FireAPI (SQLite في التطبيق / localStorage في المتصفح)
 */
const CALC = window.CALC;
const API = window.FireAPI;

const STATUS_LABELS = { draft: "مسودة", sent: "مرسل", accepted: "معتمد", lost: "ملغي" };

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

/* واصفات المشروع في قاعدة البيانات */
let meta = { id: null, quoteNo: "", status: "draft", clientId: null };

let idCounter = 1;
let currentFilter = "all";
let CATALOG = [];          /* كل أصناف الكتالوج (أجهزة + مواد) */
let CATEGORIES = [];       /* الفئات */
let CLIENTS = [];
let autosaveTimer = null;
let editingItemId = null;  /* للكتالوج */
let editingClientId = null;

/* ================= إعدادات الشركة ================= */

const COMPANY_DEFAULTS = {
  name: "شركة مقاولات الحماية من الحرائق",
  slogan: "توريد وتركيب وصيانة أنظمة الإطفاء والإنذار",
  logo: "",               /* data URL للصورة */
  phone: "", email: "", cr: "", address: "",
  terms: "1) يشمل العرض التوريد والتركيب والتشغيل والتدريب وتسليم الشهادات المطلوبة.\n2) الضمان عامان من تاريخ التشغيل النهائي وفق معايير الدفاع المدني.\n3) يتم الحجز على الأجهزة عند التوقيع على الطلبية، ولا تتحمل الشركة أي تغيير في الأسعار بعد الحجز.\n4) أسعار هذا العرض سارية لمدة %DAYS% يوم من تاريخه."
};

let COMPANY = Object.assign({}, COMPANY_DEFAULTS);

async function loadCompany() {
  try {
    const s = await API.settingsGet();
    COMPANY = Object.assign({}, COMPANY_DEFAULTS, s || {});
  } catch (e) { /* القيم الافتراضية */ }
}

async function saveCompany() {
  try { await API.settingsSave(COMPANY); } catch (e) { toast("فشل حفظ الإعدادات: " + e.message); }
}

/* ================= أدوات ================= */

function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function uid() { return idCounter++; }

function num(v) { return CALC.num(v); }
function fmt(n) { return CALC.fmt(n); }
function money(n) { return CALC.money(n, state.project.currency); }

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* ================= الحفظ التلقائي في قاعدة البيانات ================= */

function buildProjectPayload() {
  const c = calcFull();
  return {
    id: meta.id,
    quoteNo: meta.quoteNo,
    clientId: meta.clientId,
    name: state.project.name,
    location: state.project.location,
    date: state.project.date,
    area: num(state.project.area),
    floors: num(state.project.floors),
    currency: state.project.currency,
    vat: num(state.project.vat),
    validity: num(state.project.validity),
    margins: state.margins,
    status: meta.status,
    notes: state.project.notes,
    total: c.grandTotal,
    items: [
      ...state.equipment.map(e => ({
        kind: "equipment", itemId: e.itemId || null, name: e.name, qty: e.qty, unit: "وحدة",
        supply_cost: num(e.supplyCost), install_cost: num(e.installCost)
      })),
      ...state.materials.map(m => ({
        kind: "material", name: m.name, qty: m.qty, unit: m.unit, unit_cost: num(m.unitCost)
      })),
      ...state.labor.map(l => ({
        kind: "labor", name: l.name, workers: l.workers, days: l.days, daily_cost: l.dailyCost
      })),
      ...state.services.map(s => ({
        kind: "service", name: s.name, service_type: s.type, service_value: s.value
      }))
    ]
  };
}

function hasContent() {
  return state.project.name.trim() || state.equipment.length || state.labor.length ||
         state.materials.length || state.services.length;
}

async function doSave(showToast) {
  if (!hasContent()) return;
  try {
    const res = await API.projectsSave(buildProjectPayload());
    if (res && res.id) {
      meta.id = res.id;
      meta.quoteNo = res.quoteNo;
      document.getElementById("projectQuoteNo").value = meta.quoteNo;
      if (showToast) toast(`تم حفظ المشروع — رقم العرض: ${meta.quoteNo}`);
    }
  } catch (e) {
    if (showToast) toast("فشل الحفظ: " + e.message);
  }
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => doSave(false), 800);
}

/* ================= التنقل ================= */

function setTab(tab) {
  document.querySelectorAll(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  const titles = {
    project: "معلومات المشروع", equipment: "الأجهزة والمعدات", labor: "العمالة",
    materials: "المواد", services: "الخدمات الهندسية", margin: "الهوامش والضرائب",
    quote: "عرض السعر النهائي", catalog: "الكتالوج والمكتبة", clients: "العملاء"
  };
  document.getElementById("pageTitle").textContent = titles[tab] || "";
  if (tab === "catalog") renderCatalog();
  if (tab === "clients") renderClients();
  window.scrollTo({ top: 0 });
}

/* ================= الحسابات ================= */

function calcBase() { return CALC.calcBase(state); }
function calcFull() { return CALC.calcFull(state); }
function totalPoints() { return CALC.totalPoints(state); }

/* ================= عرض: الأجهزة ================= */

function renderEquipment() {
  const body = document.getElementById("eqBody");
  body.innerHTML = "";
  state.equipment.forEach((e, i) => {
    const total = e.qty * (num(e.supplyCost) + num(e.installCost));
    const tr = document.createElement("tr");
    if (!num(e.supplyCost) && !num(e.installCost)) tr.classList.add("row-danger");
    tr.dataset.cat = e.system || "alarm";
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
  applyEqFilter();
}

function applyEqFilter() {
  const isAll = currentFilter === "all";
  document.querySelectorAll("#eqBody tr").forEach(tr => {
    tr.style.display = (isAll || tr.dataset.cat === currentFilter) ? "" : "none";
  });
}

/* ================= عرض: العمالة ================= */

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
    (LABOR_ADVICE || []).map(a => `<li>${a}</li>`).join("");
}

/* ================= عرض: المواد ================= */

function renderMaterials() {
  const body = document.getElementById("materialBody");
  body.innerHTML = "";
  state.materials.forEach((m, i) => {
    const total = m.qty * num(m.unitCost);
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
}

/* ================= عرض: الخدمات ================= */

function renderServices() {
  const body = document.getElementById("serviceBody");
  body.innerHTML = "";
  state.services.forEach((s, i) => {
    const c = calcBase();
    const amount = s.type === "pct" ? c.baseCost * (num(s.value) / 100) : num(s.value);
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
}

/* ================= أحداث الجداول (تفويض) ================= */

document.addEventListener("input", e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.id) return;
  const id = parseInt(el.dataset.id);
  const f = el.dataset.f;
  if (el.dataset.tbl) {
    const item = state[el.dataset.tbl].find(x => x.id === id);
    if (item) {
      item[f] = (f === "name" || f === "unit" || f === "type") ? el.value : num(el.value);
      rerenderQuiet(el.dataset.tbl);
    }
  } else {
    const item = state.equipment.find(x => x.id === id);
    if (item) {
      item[f] = f === "name" ? el.value : num(el.value);
      rerenderQuiet("equipment");
    }
  }
  scheduleAutosave();
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
    state.equipment = state.equipment.filter(x => x.id !== parseInt(del.dataset.del));
    renderEquipment();
    scheduleAutosave();
    return;
  }
  const delLab = e.target.closest("[data-del-lab]");
  if (delLab) {
    state.labor = state.labor.filter(x => x.id !== parseInt(delLab.dataset.delLab));
    renderLabor();
    scheduleAutosave();
    return;
  }
  const delMat = e.target.closest("[data-del-mat]");
  if (delMat) {
    state.materials = state.materials.filter(x => x.id !== parseInt(delMat.dataset.delMat));
    renderMaterials();
    scheduleAutosave();
    return;
  }
  const delSvc = e.target.closest("[data-del-svc]");
  if (delSvc) {
    state.services = state.services.filter(x => x.id !== parseInt(delSvc.dataset.delSvc));
    renderServices();
    scheduleAutosave();
    return;
  }
});

/* ================= إضافة بنود ================= */

function addEquipment(name, supply, install, system, itemId) {
  state.equipment.push({
    id: uid(), name: name || "جهاز جديد", system: system || "alarm",
    qty: 1, supplyCost: supply, installCost: install, itemId: itemId || null
  });
  renderEquipment();
  scheduleAutosave();
}

function addMaterial(name, unit, unitCost, itemId) {
  state.materials.push({
    id: uid(), name: name || "مادة جديدة", qty: 1, unit: unit || "م",
    unitCost: unitCost, itemId: itemId || null
  });
  renderMaterials();
  scheduleAutosave();
}

document.getElementById("btnAddEquipment").addEventListener("click", () => {
  addEquipment("", 0, 0, currentFilter === "fighting" ? "fighting" : "alarm");
});

document.getElementById("btnAddLabor").addEventListener("click", () => {
  state.labor.push({ id: uid(), name: "بند عمالة جديد", workers: 1, days: 1, dailyCost: 0 });
  renderLabor();
  scheduleAutosave();
});

document.getElementById("btnAddMaterial").addEventListener("click", () => {
  addMaterial("", "م", 0);
});

document.getElementById("btnAddService").addEventListener("click", () => {
  state.services.push({ id: uid(), name: "خدمة جديدة", value: 0, type: "amount" });
  renderServices();
  scheduleAutosave();
});

/* ================= تقدير الكابلات ================= */

document.getElementById("btnEstimateCables").addEventListener("click", () => {
  const alarmDevices = state.equipment
    .filter(e => (e.system || "alarm") === "alarm")
    .reduce((s, e) => s + num(e.qty), 0);
  if (alarmDevices === 0) {
    toast("لا توجد أجهزة إنذار لتقدير الكابلات لها");
    return;
  }
  const per = CABLE_ESTIMATE_PER_DEVICE || 15;
  const price = CABLE_PRICE_PER_METER || 8;
  const meters = Math.ceil(alarmDevices * per);
  const cost = meters * price;
  state.materials.push({
    id: uid(), name: `تقدير كابلات إنذار (${alarmDevices} جهاز × ${per}م)`,
    qty: meters, unit: "م", unitCost: price
  });
  renderMaterials();
  scheduleAutosave();
  toast(`تمت إضافة ${fmt(meters)} متر كابلات بقيمة ${money(cost)}`);
});

/* ================= مكتبة الأجهزة (من قاعدة البيانات) ================= */

const libModal = document.getElementById("libraryModal");
let libSystem = "alarm";

async function renderLibrary() {
  const list = document.getElementById("libList");
  list.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  const search = document.getElementById("libSearch").value.trim();
  try {
    const items = await API.catalogList({ kind: "equipment", system: libSystem, search, activeOnly: true });
    document.getElementById("libCount").textContent = `أجهزة (${items.length} صنف)`;
    const byCat = {};
    items.forEach(it => {
      (byCat[it.category_name] = byCat[it.category_name] || []).push(it);
    });
    list.innerHTML = "";
    let added = 0;
    Object.keys(byCat).forEach(gName => {
      const header = document.createElement("div");
      header.style.cssText = "font-size:12px;color:var(--accent2);font-weight:700;margin:16px 0 8px;display:flex;align-items:center;gap:8px";
      header.textContent = gName;
      header.appendChild(Object.assign(document.createElement("span"), {
        style: "font-weight:400;color:var(--muted);font-size:11px", textContent: `(${byCat[gName].length})`
      }));
      list.appendChild(header);
      byCat[gName].forEach(it => {
        const div = document.createElement("div");
        div.className = "lib-item";
        const priceText = it.supply_cost > 0 ? money(it.supply_cost) : "سعر حسب العرض";
        div.innerHTML = `
          <div>
            <div class="lib-name">${esc(it.name)} <span class="lib-code">${esc(it.code)}</span></div>
            <div class="lib-meta">تركيب مرجعي: ${it.install_cost > 0 ? money(it.install_cost) : "—"} لكل وحدة</div>
          </div>
          <div class="lib-price">${priceText}</div>`;
        div.addEventListener("click", () => {
          addEquipment(it.name, it.supply_cost, it.install_cost, it.category_system || "alarm", it.id);
          toast(`تمت إضافة: ${it.name}`);
        });
        list.appendChild(div);
        added++;
      });
    });
    if (!added) list.innerHTML = `<p class="hint">لا توجد نتائج</p>`;
  } catch (e) {
    list.innerHTML = `<p class="hint">تعذر تحميل المكتبة: ${esc(e.message)}</p>`;
  }
}

document.getElementById("btnAddFromLibrary").addEventListener("click", () => {
  libModal.classList.add("show");
  renderLibrary();
});
document.getElementById("libraryClose").addEventListener("click", () => libModal.classList.remove("show"));
libModal.addEventListener("click", e => { if (e.target === libModal) libModal.classList.remove("show"); });
document.getElementById("libCategory").addEventListener("change", e => {
  libSystem = e.target.value;
  document.getElementById("libSearch").value = "";
  renderLibrary();
});
document.getElementById("libSearch").addEventListener("input", renderLibrary);

/* ================= مكتبة المواد ================= */

const matLibModal = document.getElementById("materialsLibModal");
let matLibCat = "all";

async function renderMaterialsLibrary() {
  const list = document.getElementById("matLibList");
  list.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  const search = document.getElementById("matLibSearch").value.trim();
  const catId = matLibCat === "all" ? 0 : parseInt(matLibCat);
  try {
    const items = await API.catalogList({ kind: "material", search, categoryId: catId, activeOnly: true });
    document.getElementById("matLibCount").textContent = `مواد (${items.length} صنف)`;
    const byCat = {};
    items.forEach(it => (byCat[it.category_name] = byCat[it.category_name] || []).push(it));
    list.innerHTML = "";
    let added = 0;
    Object.keys(byCat).forEach(gName => {
      const header = document.createElement("div");
      header.style.cssText = "font-size:12px;color:var(--accent2);font-weight:700;margin:16px 0 8px;display:flex;align-items:center;gap:8px";
      header.textContent = gName;
      header.appendChild(Object.assign(document.createElement("span"), {
        style: "font-weight:400;color:var(--muted);font-size:11px", textContent: `(${byCat[gName].length})`
      }));
      list.appendChild(header);
      byCat[gName].forEach(it => {
        const div = document.createElement("div");
        div.className = "lib-item";
        div.innerHTML = `
          <div>
            <div class="lib-name">${esc(it.name)} <span class="lib-code">${esc(it.code)}</span></div>
            <div class="lib-meta">الوحدة: ${esc(it.unit)}</div>
          </div>
          <div class="lib-price">${it.supply_cost > 0 ? money(it.supply_cost) : "—"} / ${esc(it.unit)}</div>`;
        div.addEventListener("click", () => {
          addMaterial(it.name, it.unit, it.supply_cost, it.id);
          toast(`تمت إضافة: ${it.name}`);
        });
        list.appendChild(div);
        added++;
      });
    });
    if (!added) list.innerHTML = `<p class="hint">لا توجد نتائج</p>`;
  } catch (e) {
    list.innerHTML = `<p class="hint">تعذر تحميل المكتبة: ${esc(e.message)}</p>`;
  }
}

document.getElementById("btnAddMaterialFromLibrary").addEventListener("click", () => {
  matLibModal.classList.add("show");
  renderMaterialsLibrary();
});
document.getElementById("materialsLibClose").addEventListener("click", () => matLibModal.classList.remove("show"));
matLibModal.addEventListener("click", e => { if (e.target === matLibModal) matLibModal.classList.remove("show"); });
document.getElementById("matLibSearch").addEventListener("input", renderMaterialsLibrary);
document.getElementById("matLibCategory").addEventListener("change", e => {
  matLibCat = e.target.value;
  renderMaterialsLibrary();
});

/* ================= معلومات المشروع ================= */

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
  document.getElementById("projectStatus").value = meta.status;
  document.getElementById("projectQuoteNo").value = meta.quoteNo;
}

function fillClientSelect() {
  const sel = document.getElementById("projectClientSelect");
  const keep = meta.clientId;
  sel.innerHTML = `<option value="">— بدون عميل —</option>` +
    CLIENTS.map(c => `<option value="${c.id}" ${c.id === keep ? "selected" : ""}>${esc(c.name)}${c.city ? " — " + esc(c.city) : ""}</option>`).join("");
  meta.clientId = keep;
}

function bindProjectInputs() {
  const map = {
    projectName: "name", projectClient: "client", projectLocation: "location",
    projectDate: "date", projectVat: "vat", projectValidity: "validity",
    projectArea: "area", projectFloors: "floors", projectNotes: "notes"
  };
  Object.keys(map).forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      state.project[map[id]] = document.getElementById(id).value;
      updateCurrencyBadge();
      scheduleAutosave();
    });
  });
  document.getElementById("projectCurrency").addEventListener("change", e => {
    state.project.currency = e.target.value;
    updateCurrencyBadge();
    renderAll();
    scheduleAutosave();
  });
  document.getElementById("projectClientSelect").addEventListener("change", e => {
    meta.clientId = e.target.value ? parseInt(e.target.value) : null;
    scheduleAutosave();
  });
  document.getElementById("projectStatus").addEventListener("change", e => {
    meta.status = e.target.value;
    scheduleAutosave();
  });
}

function updateCurrencyBadge() {
  document.getElementById("currencyBadge").textContent =
    `العملة: ${CALC.CURRENCIES[state.project.currency].name}`;
}

/* ================= الهوامش ================= */

function bindMarginInputs() {
  ["overheadPct", "contingencyPct", "profitPct", "discountPct"].forEach(id => {
    document.getElementById(id).addEventListener("input", e => {
      state.margins[id.replace("Pct", "") + "Pct"] = num(e.target.value);
      scheduleAutosave();
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
    <p class="hint" style="margin-top:10px">هامش ربح ${fmt(margin)}% على السعر (وليس على التكلفة). الهامش الحقيقي بعد الضريبة والخصم ${c.grandTotal > 0 ? fmt(c.profit / c.grandTotal * 100) : 0}% من الإجمالي النهائي.</p>`;
}

/* ================= عرض السعر ================= */

function buildQuote() {
  const c = calcFull();
  const p = state.project;
  const cur = CALC.CURRENCIES[p.currency].sym;
  const client = CLIENTS.find(x => x.id === meta.clientId);

  const eqRows = state.equipment.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(e.name)}</td>
      <td>${fmt(e.qty)}</td>
      <td>${e.supplyCost ? fmt(e.supplyCost) : "—"}</td>
      <td>${e.installCost ? fmt(e.installCost) : "—"}</td>
      <td>${fmt(e.qty * (num(e.supplyCost) + num(e.installCost)))}</td>
    </tr>`).join("");

  const materialRows = state.materials.map((m, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(m.name)}</td>
      <td>${fmt(m.qty)} ${esc(m.unit)}</td>
      <td>${fmt(m.unitCost)}</td>
      <td>${fmt(m.qty * num(m.unitCost))}</td>
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
      <td>${fmt(s.type === "pct" ? c.baseCost * (num(s.value) / 100) : num(s.value))}</td>
    </tr>`).join("");

  const empty = `<tr><td colspan="5" style="color:#888;text-align:center">— لا توجد بنود —</td></tr>`;

  const validityDate = new Date();
  validityDate.setDate(validityDate.getDate() + num(p.validity));
  const validityStr = validityDate.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

  const companyBlock = COMPANY.logo
    ? `<img class="q-logo" src="${COMPANY.logo}" alt="${esc(COMPANY.name)}">`
    : `<div style="font-size:30px;color:#0f766e;font-weight:800">${esc((COMPANY.name || "S").charAt(0))}</div>`;

  const companyContact = [COMPANY.phone, COMPANY.email, COMPANY.cr ? "س.ت: " + COMPANY.cr : "", COMPANY.address]
    .filter(Boolean).map(esc).join(" | ");

  const termsText = (COMPANY.terms || "").replace("%DAYS%", fmt(p.validity)).split("\n").filter(Boolean)
    .map(t => `<div>${esc(t)}</div>`).join("");

  return `
  <div class="quote-doc" id="quoteDoc">
    <div class="q-head">
      <div>
        <h2>عرض سعر - أنظمة الحماية من الحرائق</h2>
        <div class="q-meta">
          <div><strong>رقم العرض:</strong> ${esc(meta.quoteNo) || "—"} <span style="margin:0 14px"></span><strong>الحالة:</strong> ${STATUS_LABELS[meta.status] || meta.status}</div>
          <div><strong>المشروع:</strong> ${esc(p.name) || "—"}</div>
          <div><strong>العميل:</strong> ${client ? esc(client.name) + (client.cr_number ? " — س.ت: " + esc(client.cr_number) : "") : esc(p.client) || "—"} <span style="margin:0 14px"></span><strong>الموقع:</strong> ${esc(p.location) || "—"}</div>
          <div><strong>التاريخ:</strong> ${p.date ? new Date(p.date).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }) : "—"} <span style="margin:0 14px"></span><strong>صلاحية العرض:</strong> ${fmt(p.validity)} يوم (حتى ${validityStr})</div>
        </div>
      </div>
      <div style="text-align:center;font-size:13px;color:#555">
        ${companyBlock}
        <div><strong>${esc(COMPANY.name)}</strong></div>
        ${COMPANY.slogan ? `<div style="font-size:11px;color:#777">${esc(COMPANY.slogan)}</div>` : ""}
        ${companyContact ? `<div style="font-size:11px;color:#777;margin-top:4px">${companyContact}</div>` : ""}
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
    ${termsText ? `<div class="q-footer"><strong>شروط عامة:</strong>${termsText}</div>` : ""}
  </div>`;
}

function renderQuote() {
  document.getElementById("quotePreview").innerHTML = buildQuote();
  renderAnalysis();
}

/* ================= التحليل الذكي ================= */

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
    advice.push({ cls: "info", text: `سعر النقطة الواحدة (جهاز إنذار) ≈ ${money(pricePerPoint)} قبل الضريبة. المقارنة المرجعية للنطاق السعري 250-600 ${CALC.CURRENCIES[state.project.currency].sym} حسب النظام (تقليدي/معنون).` });
  }
  if (pricePerM2 > 0) {
    advice.push({ cls: "info", text: `تكلفة المتر المربع من المبنى ≈ ${money(pricePerM2)}. النطاق المرجعي لأنظمة الحماية 15-45 ${CALC.CURRENCIES[state.project.currency].sym}/م² حسب نوع النظام.` });
  }
  if (marginPct < 10) {
    advice.push({ cls: "warn", text: `هامش الربح ${fmt(marginPct)}% أقل من 10% — خذ بعين الاعتبار رفع هامش الربح أو تقليل الخصم، خاصة مع مخاطر تأخر الدفعات.` });
  } else if (marginPct < 15) {
    advice.push({ cls: "warn", text: `هامش الربح ${fmt(marginPct)}% مقبول حدّياً. يُنصح بمراقبة أي تجاوز في التكاليف.` });
  } else if (marginPct < 25) {
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

/* ================= حفظ / استرجاع المشاريع ================= */

async function renderProjectsModal() {
  const list = document.getElementById("projectsList");
  list.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  const search = document.getElementById("projectsSearch").value.trim();
  try {
    const projects = await API.projectsList(search);
    if (!projects.length) {
      list.innerHTML = `<p class="hint">لا توجد مشاريع محفوظة.</p>`;
      return;
    }
    list.innerHTML = "";
    projects.forEach(pr => {
      const div = document.createElement("div");
      div.className = "proj-item";
      const total = pr.total ? CALC.money(pr.total, state.project.currency) : "";
      div.innerHTML = `
        <div>
          <div class="proj-name">${esc(pr.quote_no || "")} — ${esc(pr.name || "مشروع بدون اسم")}</div>
          <div class="proj-meta">${esc(pr.client_name || "—")} | ${esc(pr.date || "")} | <span class="status-badge s-${pr.status}">${STATUS_LABELS[pr.status] || pr.status}</span> ${total ? "| " + total : ""}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" data-open="${pr.id}">فتح</button>
          <button class="btn btn-danger-ghost btn-sm" data-delproj="${pr.id}">حذف</button>
        </div>`;
      list.appendChild(div);
    });
    list.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", async () => {
      await openProject(parseInt(b.dataset.open));
    }));
    list.querySelectorAll("[data-delproj]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("حذف هذا المشروع نهائياً؟")) return;
      await API.projectsDelete(parseInt(b.dataset.delproj));
      toast("تم حذف المشروع");
      renderProjectsModal();
    }));
  } catch (e) {
    list.innerHTML = `<p class="hint">تعذر التحميل: ${esc(e.message)}</p>`;
  }
}

async function openProject(id) {
  try {
    const p = await API.projectsGet(id);
    if (!p) { toast("المشروع غير موجود"); return; }
    state.project = {
      name: p.name || "", client: "", location: p.location || "", date: p.date || today(),
      currency: p.currency || "SAR", vat: num(p.vat) || 15, validity: num(p.validity) || 30,
      area: p.area || "", floors: p.floors || "", notes: p.notes || ""
    };
    state.margins = Object.assign({ overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 }, p.margins || {});
    meta = { id: p.id, quoteNo: p.quote_no || "", status: p.status || "draft", clientId: p.client_id || null };
    state.equipment = (p.items || []).filter(i => i.kind === "equipment").map(i => ({
      id: uid(), name: i.name, qty: i.qty, supplyCost: i.supply_cost, installCost: i.install_cost,
      system: "alarm", itemId: i.item_id
    }));
    state.materials = (p.items || []).filter(i => i.kind === "material").map(i => ({
      id: uid(), name: i.name, qty: i.qty, unit: i.unit, unitCost: i.unit_cost, itemId: i.item_id
    }));
    state.labor = (p.items || []).filter(i => i.kind === "labor").map(i => ({
      id: uid(), name: i.name, workers: i.workers, days: i.days, dailyCost: i.daily_cost
    }));
    state.services = (p.items || []).filter(i => i.kind === "service").map(i => ({
      id: uid(), name: i.name, value: i.service_value, type: i.service_type
    }));
    document.getElementById("projectsModal").classList.remove("show");
    fillClientSelect();
    renderAll();
    setTab("project");
    toast(`تم فتح المشروع ${meta.quoteNo}`);
  } catch (e) {
    toast("فشل الفتح: " + e.message);
  }
}

document.getElementById("btnSaveProject").addEventListener("click", () => doSave(true));

document.getElementById("btnLoadProject").addEventListener("click", () => {
  document.getElementById("projectsModal").classList.add("show");
  renderProjectsModal();
});
document.getElementById("projectsClose").addEventListener("click", () => document.getElementById("projectsModal").classList.remove("show"));
document.getElementById("projectsModal").addEventListener("click", e => {
  if (e.target.id === "projectsModal") e.target.classList.remove("show");
});
document.getElementById("projectsSearch").addEventListener("input", renderProjectsModal);

document.getElementById("btnImportLegacy").addEventListener("click", async () => {
  const legacy = [];
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("firepricing_projects_v1")) {
        try { legacy.push(JSON.parse(localStorage.getItem(k))); } catch (e) { /* ignore */ }
      }
    });
  } catch (e) { /* ignore */ }
  if (!legacy.length) { toast("لا توجد مشاريع قديمة للاستيراد"); return; }
  try {
    const n = await API.projectsImportLegacy(legacy);
    try { legacy.forEach((_, i) => localStorage.removeItem(Object.keys(localStorage).find(k => k.startsWith("firepricing_projects_v1")))); } catch (e) { /* ignore */ }
    toast(`تم استيراد ${n} مشروع من النسخة السابقة`);
    renderProjectsModal();
  } catch (e) {
    toast("فشل الاستيراد: " + e.message);
  }
});

document.getElementById("btnNewProject").addEventListener("click", () => {
  if (state.equipment.length || state.labor.length || state.materials.length || state.services.length || state.project.name.trim()) {
    if (!confirm("سيتم تفريغ بيانات المشروع الحالي. هل تريد المتابعة؟")) return;
  }
  state = {
    project: { name: "", client: "", location: "", date: today(), currency: state.project.currency, vat: 15, validity: 30, area: "", floors: "", notes: "" },
    equipment: [], labor: [], materials: [], services: [],
    margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 }
  };
  meta = { id: null, quoteNo: "", status: "draft", clientId: null };
  renderAll();
  setTab("project");
  toast("تم إنشاء مشروع جديد");
});

/* ================= النسخ الاحتياطي ================= */

document.getElementById("btnBackup").addEventListener("click", async () => {
  try {
    const res = await API.exportBackup();
    if (res && !res.canceled) toast("تم تصدير النسخة الاحتياطية");
  } catch (e) {
    toast("فشل التصدير: " + e.message);
  }
});

/* ================= طباعة / نسخ / تصدير ================= */

document.getElementById("btnPrint").addEventListener("click", () => window.print());

document.getElementById("btnExportExcel").addEventListener("click", async () => {
  const c = calcFull();
  const client = CLIENTS.find(x => x.id === meta.clientId);
  const payload = {
    quoteNo: meta.quoteNo, name: state.project.name, clientName: client ? client.name : state.project.client,
    location: state.project.location, date: state.project.date, validity: state.project.validity,
    statusLabel: STATUS_LABELS[meta.status] || meta.status, currencySymbol: CALC.CURRENCIES[state.project.currency].sym,
    equipment: state.equipment, materials: state.materials, labor: state.labor,
    services: state.services.map(s => Object.assign({}, s, { amount: s.type === "pct" ? c.baseCost * (num(s.value) / 100) : num(s.value) })),
    totals: {
      baseCost: c.baseCost, overhead: c.overhead, contingency: c.contingency, profit: c.profit,
      netPrice: c.netPrice, discount: c.discount, afterDiscount: c.afterDiscount, vat: c.vat,
      grandTotal: c.grandTotal, eqTotal: c.eqSupply + c.eqInstall, materialsTotal: c.materialsCost,
      laborTotal: c.laborCost, servicesTotal: c.servicesAmount
    }
  };
  try {
    const res = await API.exportExcel(payload);
    if (res && !res.canceled) toast("تم تصدير ملف Excel بنجاح");
  } catch (e) {
    toast("فشل التصدير: " + e.message);
  }
});

document.getElementById("btnCopySummary").addEventListener("click", () => {
  const c = calcFull();
  const cur = CALC.CURRENCIES[state.project.currency].sym;
  const lines = [];
  lines.push(`عرض سعر ${meta.quoteNo ? "(" + meta.quoteNo + ")" : ""} - ${state.project.name || "مشروع"}`);
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

/* ================= الكتالوج والمكتبة ================= */

async function refreshCatalog() {
  try {
    const [items, cats] = await Promise.all([API.catalogList({}), API.catalogCategories()]);
    CATALOG = items;
    CATEGORIES = cats;
  } catch (e) {
    toast("تعذر تحميل الكتالوج: " + e.message);
  }
}

async function renderCatalog() {
  const body = document.getElementById("catBody");
  const kind = document.getElementById("catKind").value;
  const system = document.getElementById("catSystem").value;
  const catId = parseInt(document.getElementById("catCategory").value) || 0;
  const search = document.getElementById("catSearch").value.trim();
  body.innerHTML = `<tr><td colspan="8" class="hint">جارٍ التحميل...</td></tr>`;
  try {
    const items = await API.catalogList({ kind, system, categoryId: catId, search, activeOnly: false });
    body.innerHTML = "";
    items.forEach((it, i) => {
      const tr = document.createElement("tr");
      if (!it.is_active) tr.classList.add("row-muted");
      tr.innerHTML = `
        <td><span class="lib-code">${esc(it.code)}</span></td>
        <td>
          <div class="cat-name">${esc(it.name)}</div>
          ${it.brand ? `<div class="cat-sub">${esc(it.brand)}${it.model ? " / " + esc(it.model) : ""}</div>` : ""}
        </td>
        <td>${esc(it.category_name)}</td>
        <td>${esc(it.unit)}</td>
        <td class="num">${it.supply_cost ? money(it.supply_cost) : "—"}</td>
        <td class="num">${it.install_cost ? money(it.install_cost) : "—"}</td>
        <td>${it.is_active ? `<span class="status-badge s-active">نشط</span>` : `<span class="status-badge s-lost">متوقف</span>`}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-hist="${it.id}" title="سجل الأسعار">📈</button>
          <button class="btn btn-secondary btn-sm" data-edit="${it.id}" title="تعديل">✏️</button>
          <button class="btn-danger btn-sm" data-toggle="${it.id}" title="${it.is_active ? "إيقاف" : "تفعيل"}">${it.is_active ? "⏸" : "▶"}</button>
        </td>`;
      body.appendChild(tr);
    });
    if (!items.length) body.innerHTML = `<tr><td colspan="8" class="hint">لا توجد أصناف مطابقة</td></tr>`;
    document.getElementById("catCount").textContent = `إجمالي المعروض: ${items.length} صنف`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="hint">تعذر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

function fillCatCategorySelect(kind) {
  const sel = document.getElementById("catCategory");
  const prev = sel.value;
  let cats = CATEGORIES;
  if (kind !== "all") cats = cats.filter(c => c.kind === kind);
  sel.innerHTML = `<option value="0">كل الفئات</option>` + cats.map(c => `<option value="${c.id}" ${String(c.id) === prev ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

document.getElementById("catKind").addEventListener("change", e => {
  fillCatCategorySelect(e.target.value);
  renderCatalog();
});
document.getElementById("catSystem").addEventListener("change", renderCatalog);
document.getElementById("catCategory").addEventListener("change", renderCatalog);
document.getElementById("catSearch").addEventListener("input", () => {
  clearTimeout(window.__catSearchT);
  window.__catSearchT = setTimeout(renderCatalog, 300);
});
document.getElementById("catBody").addEventListener("click", e => {
  const hist = e.target.closest("[data-hist]");
  if (hist) { openHistory(parseInt(hist.dataset.hist)); return; }
  const edit = e.target.closest("[data-edit]");
  if (edit) { openItemEditor(parseInt(edit.dataset.edit)); return; }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) { toggleItem(parseInt(toggle.dataset.toggle)); }
});

/* --- محرر الصنف --- */

const itemModal = document.getElementById("itemModal");

function openItemEditor(id) {
  editingItemId = id || null;
  document.getElementById("itemModalTitle").textContent = id ? "تعديل صنف" : "إضافة صنف جديد";
  const form = { name: "", name_en: "", code: "", brand: "", model: "", unit: "وحدة", supply_cost: 0, install_cost: 0, supplier: "", notes: "", is_active: 1, category_name: "" };
  if (id) {
    const it = CATALOG.find(x => x.id === id);
    if (it) Object.assign(form, it);
  }
  const kind = id ? (CATALOG.find(x => x.id === id) || {}).category_kind : document.getElementById("catKind").value;
  const cats = CATEGORIES.filter(c => c.kind === (kind === "all" ? "material" : kind));
  document.getElementById("itCategory").innerHTML = cats.map(c =>
    `<option value="${esc(c.name)}" ${c.name === form.category_name ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  document.getElementById("itName").value = form.name;
  document.getElementById("itNameEn").value = form.name_en || "";
  document.getElementById("itCode").value = form.code || "";
  document.getElementById("itBrand").value = form.brand || "";
  document.getElementById("itModel").value = form.model || "";
  document.getElementById("itUnit").value = form.unit || "وحدة";
  document.getElementById("itSupply").value = form.supply_cost || 0;
  document.getElementById("itInstall").value = form.install_cost || 0;
  document.getElementById("itSupplier").value = form.supplier || "";
  document.getElementById("itNotes").value = form.notes || "";
  document.getElementById("itActive").checked = form.is_active !== 0;
  document.getElementById("itCode").disabled = !!id;
  itemModal.classList.add("show");
}

document.getElementById("itemSave").addEventListener("click", async () => {
  const name = document.getElementById("itName").value.trim();
  if (!name) { toast("أدخل اسم الصنف"); return; }
  const categoryName = document.getElementById("itCategory").value;
  const cat = CATEGORIES.find(c => c.name === categoryName);
  const payload = {
    id: editingItemId, category_id: cat ? cat.id : 0, category_name: categoryName,
    category_kind: cat ? cat.kind : "material",
    name, name_en: document.getElementById("itNameEn").value,
    code: document.getElementById("itCode").value,
    brand: document.getElementById("itBrand").value,
    model: document.getElementById("itModel").value,
    unit: document.getElementById("itUnit").value || "وحدة",
    supply_cost: num(document.getElementById("itSupply").value),
    install_cost: num(document.getElementById("itInstall").value),
    supplier: document.getElementById("itSupplier").value,
    notes: document.getElementById("itNotes").value,
    is_active: document.getElementById("itActive").checked ? 1 : 0
  };
  try {
    if (editingItemId) await API.catalogUpdate(payload);
    else await API.catalogAdd(payload);
    toast(editingItemId ? "تم تحديث الصنف" : "تمت إضافة الصنف");
    itemModal.classList.remove("show");
    await refreshCatalog();
    renderCatalog();
  } catch (e) {
    toast("فشل الحفظ: " + e.message);
  }
});

document.getElementById("itemClose").addEventListener("click", () => itemModal.classList.remove("show"));
itemModal.addEventListener("click", e => { if (e.target === itemModal) itemModal.classList.remove("show"); });

document.getElementById("btnAddCatalogItem").addEventListener("click", () => openItemEditor(null));

async function toggleItem(id) {
  const it = CATALOG.find(x => x.id === id);
  if (!it) return;
  await API.catalogUpdate(Object.assign({}, it, { is_active: it.is_active ? 0 : 1 }));
  await refreshCatalog();
  renderCatalog();
}

/* --- سجل الأسعار --- */

const historyModal = document.getElementById("historyModal");

async function openHistory(id) {
  const it = CATALOG.find(x => x.id === id);
  document.getElementById("historyTitle").textContent = `سجل أسعار: ${it ? it.name : ""}`;
  const body = document.getElementById("historyBody");
  body.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  historyModal.classList.add("show");
  try {
    const rows = await API.catalogHistory(id);
    if (!rows.length) {
      body.innerHTML = `<p class="hint">لا يوجد سجل أسعار لهذا الصنف بعد.</p>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <div class="hist-row">
        <div><strong>${money(r.supply_cost)}</strong> توريد ${r.install_cost ? "| تركيب " + money(r.install_cost) : ""}</div>
        <div class="proj-meta">${esc(r.source || "")} — ${esc(r.changed_at || "")}</div>
      </div>`).join("");
  } catch (e) {
    body.innerHTML = `<p class="hint">تعذر التحميل: ${esc(e.message)}</p>`;
  }
}

document.getElementById("historyClose").addEventListener("click", () => historyModal.classList.remove("show"));
historyModal.addEventListener("click", e => { if (e.target === historyModal) historyModal.classList.remove("show"); });

/* --- تحديث أسعار شامل --- */

const bulkModal = document.getElementById("bulkModal");

document.getElementById("btnBulkUpdate").addEventListener("click", () => {
  const kind = document.getElementById("catKind").value;
  document.getElementById("bulkKind").value = kind;
  fillBulkCategories(kind);
  document.getElementById("bulkPct").value = "";
  document.getElementById("bulkNote").value = "";
  bulkModal.classList.add("show");
});

function fillBulkCategories(kind) {
  const sel = document.getElementById("bulkCategory");
  let cats = CATEGORIES;
  if (kind !== "all") cats = cats.filter(c => c.kind === kind);
  sel.innerHTML = `<option value="0">كل الفئات</option>` + cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}

document.getElementById("bulkKind").addEventListener("change", e => fillBulkCategories(e.target.value));

document.getElementById("bulkRun").addEventListener("click", async () => {
  const pct = num(document.getElementById("bulkPct").value);
  if (!pct) { toast("أدخل نسبة التحديث (يمكن أن تكون سالبة)!"); return; }
  const payload = {
    kind: document.getElementById("bulkKind").value,
    categoryId: parseInt(document.getElementById("bulkCategory").value) || 0,
    pct, applyTo: document.getElementById("bulkApplyTo").value,
    note: document.getElementById("bulkNote").value.trim() || `تحديث شامل ${pct > 0 ? "+" : ""}${pct}%`
  };
  try {
    const n = await API.catalogBulkUpdate(payload);
    toast(`تم تحديث أسعار ${n} صنف بنسبة ${pct}% — وسُجل التغيير في سجل الأسعار`);
    bulkModal.classList.remove("show");
    await refreshCatalog();
    renderCatalog();
  } catch (e) {
    toast("فشل التحديث: " + e.message);
  }
});

document.getElementById("bulkClose").addEventListener("click", () => bulkModal.classList.remove("show"));
bulkModal.addEventListener("click", e => { if (e.target === bulkModal) bulkModal.classList.remove("show"); });

/* ================= العملاء ================= */

async function refreshClients() {
  try { CLIENTS = await API.clientsList(""); } catch (e) { CLIENTS = []; }
  fillClientSelect();
}

async function renderClients() {
  const body = document.getElementById("clientBody");
  const search = document.getElementById("clientSearch").value.trim();
  body.innerHTML = `<tr><td colspan="6" class="hint">جارٍ التحميل...</td></tr>`;
  try {
    const list = await API.clientsList(search);
    body.innerHTML = "";
    list.forEach((c, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.phone || "—")}</td>
        <td>${esc(c.city || "—")}</td>
        <td>${esc(c.cr_number || "—")}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-editcl="${c.id}">تعديل</button>
          <button class="btn btn-danger-ghost btn-sm" data-delcl="${c.id}">حذف</button>
        </td>`;
      body.appendChild(tr);
    });
    if (!list.length) body.innerHTML = `<tr><td colspan="6" class="hint">لا يوجد عملاء</td></tr>`;
    document.getElementById("clientCount").textContent = `إجمالي العملاء: ${list.length}`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="hint">تعذر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

document.getElementById("clientSearch").addEventListener("input", () => {
  clearTimeout(window.__clSearchT);
  window.__clSearchT = setTimeout(renderClients, 300);
});

const clientModal = document.getElementById("clientModal");

function openClientEditor(id) {
  editingClientId = id || null;
  document.getElementById("clientModalTitle").textContent = id ? "تعديل عميل" : "إضافة عميل جديد";
  const c = id ? CLIENTS.find(x => x.id === id) : {};
  document.getElementById("cmName").value = (c && c.name) || "";
  document.getElementById("cmPhone").value = (c && c.phone) || "";
  document.getElementById("cmEmail").value = (c && c.email) || "";
  document.getElementById("cmCr").value = (c && c.cr_number) || "";
  document.getElementById("cmCity").value = (c && c.city) || "";
  document.getElementById("cmNotes").value = (c && c.notes) || "";
  clientModal.classList.add("show");
}

document.getElementById("btnAddClient").addEventListener("click", () => openClientEditor(null));

document.getElementById("clientBody").addEventListener("click", e => {
  const edit = e.target.closest("[data-editcl]");
  if (edit) { openClientEditor(parseInt(edit.dataset.editcl)); return; }
  const del = e.target.closest("[data-delcl]");
  if (del) {
    const id = parseInt(del.dataset.delcl);
    if (!confirm("حذف هذا العميل؟")) return;
    API.clientsDelete(id).then(() => { refreshClients(); renderClients(); toast("تم حذف العميل"); });
  }
});

document.getElementById("cmSave").addEventListener("click", async () => {
  const name = document.getElementById("cmName").value.trim();
  if (!name) { toast("أدخل اسم العميل"); return; }
  const payload = {
    id: editingClientId, name,
    phone: document.getElementById("cmPhone").value.trim(),
    email: document.getElementById("cmEmail").value.trim(),
    cr_number: document.getElementById("cmCr").value.trim(),
    city: document.getElementById("cmCity").value.trim(),
    notes: document.getElementById("cmNotes").value.trim()
  };
  try {
    await API.clientsSave(payload);
    toast(editingClientId ? "تم تحديث العميل" : "تمت إضافة العميل");
    clientModal.classList.remove("show");
    await refreshClients();
    renderClients();
  } catch (e) {
    toast("فشل الحفظ: " + e.message);
  }
});

document.getElementById("clientClose").addEventListener("click", () => clientModal.classList.remove("show"));
clientModal.addEventListener("click", e => { if (e.target === clientModal) clientModal.classList.remove("show"); });

/* ================= إعدادات الشركة (النافذة) ================= */

const companyModal = document.getElementById("companyModal");

function openCompanyModal() {
  document.getElementById("cmName").value = COMPANY.name;
  document.getElementById("cmSlogan").value = COMPANY.slogan || "";
  document.getElementById("cmPhone").value = COMPANY.phone || "";
  document.getElementById("cmEmail").value = COMPANY.email || "";
  document.getElementById("cmCr").value = COMPANY.cr || "";
  document.getElementById("cmAddress").value = COMPANY.address || "";
  document.getElementById("cmTerms").value = (COMPANY.terms || "").replace("%DAYS%", "30");
  const preview = document.getElementById("cmLogoPreview");
  if (COMPANY.logo) {
    preview.src = COMPANY.logo;
    preview.style.display = "block";
  } else {
    preview.style.display = "none";
  }
  companyModal.classList.add("show");
}

document.getElementById("btnCompanySettings").addEventListener("click", openCompanyModal);
document.getElementById("companyClose").addEventListener("click", () => companyModal.classList.remove("show"));
companyModal.addEventListener("click", e => { if (e.target === companyModal) companyModal.classList.remove("show"); });

document.getElementById("cmLogoInput").addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("اختر ملف صورة"); return; }
  if (file.size > 300 * 1024) { toast("حجم الصورة كبير — استخدم صورة أقل من 300 كيلوبايت"); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    COMPANY.logo = ev.target.result;
    const preview = document.getElementById("cmLogoPreview");
    preview.src = COMPANY.logo;
    preview.style.display = "block";
  };
  reader.readAsDataURL(file);
});

document.getElementById("cmRemoveLogo").addEventListener("click", () => {
  COMPANY.logo = "";
  document.getElementById("cmLogoPreview").style.display = "none";
  document.getElementById("cmLogoInput").value = "";
});

document.getElementById("companySave").addEventListener("click", async () => {
  COMPANY.name = document.getElementById("cmName").value.trim() || COMPANY_DEFAULTS.name;
  COMPANY.slogan = document.getElementById("cmSlogan").value.trim();
  COMPANY.phone = document.getElementById("cmPhone").value.trim();
  COMPANY.email = document.getElementById("cmEmail").value.trim();
  COMPANY.cr = document.getElementById("cmCr").value.trim();
  COMPANY.address = document.getElementById("cmAddress").value.trim();
  COMPANY.terms = document.getElementById("cmTerms").value.trim() || COMPANY_DEFAULTS.terms;
  await saveCompany();
  toast("تم حفظ إعدادات الشركة");
  companyModal.classList.remove("show");
  renderQuote();
});

/* ================= التهيئة ================= */

function renderAll() {
  fillProjectInputs();
  fillClientSelect();
  renderEquipment();
  renderLabor();
  renderMaterials();
  renderServices();
  renderMarginAdvice();
  renderQuote();
  updateCurrencyBadge();
}

document.querySelectorAll(".nav-item").forEach(a => a.addEventListener("click", () => setTab(a.dataset.tab)));

async function initApp() {
  /* شارة وضع قاعدة البيانات */
  const badge = document.getElementById("dbBadge");
  badge.textContent = API.mode === "sqlite" ? "قاعدة البيانات: SQLite" : "وضع المتصفح (احتياطي)";
  badge.classList.toggle("warn", API.mode !== "sqlite");

  await loadCompany();
  try { CLIENTS = await API.clientsList(""); } catch (e) { CLIENTS = []; }
  await refreshCatalog();

  fillCatCategorySelect("all");
  renderAll();
}

/* واجهة تصحيح (للمطورين والاختبارات) */
window.__fp = { state: () => state, meta: () => meta, CATALOG: () => CATALOG, CLIENTS: () => CLIENTS, COMPANY: () => COMPANY, loadCompany, openCompanyModal };

initApp();
