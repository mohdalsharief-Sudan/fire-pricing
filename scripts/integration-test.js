"use strict";
/* اختبار تكاملي: وضع SQLite كامل — يحاكي preload بقاعدة حقيقية */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { createDatabase } = require("../src/db/database.js");

const db = createDatabase(":memory:");
const dbApi = {
  catalog_list: (p) => Promise.resolve({ ok: true, data: db.listCatalog(p || {}) }),
  catalog_categories: () => Promise.resolve({ ok: true, data: db.listCategories() }),
  catalog_add: (p) => Promise.resolve({ ok: true, data: db.addItem(p) }),
  catalog_update: (p) => Promise.resolve({ ok: true, data: db.updateItem(p.id, p) }),
  catalog_history: (p) => Promise.resolve({ ok: true, data: db.getPriceHistory(p.id) }),
  catalog_bulkUpdate: (p) => Promise.resolve({ ok: true, data: db.bulkUpdatePrices(p || {}) }),
  clients_list: (p) => Promise.resolve({ ok: true, data: db.listClients((p && p.search) || "") }),
  clients_save: (p) => Promise.resolve({ ok: true, data: db.saveClient(p) }),
  clients_delete: (p) => Promise.resolve({ ok: true, data: db.deleteClient(p.id) }),
  projects_save: (p) => Promise.resolve({ ok: true, data: db.saveProject(p) }),
  projects_list: (p) => Promise.resolve({ ok: true, data: db.listProjects((p && p.search) || "") }),
  projects_get: (p) => Promise.resolve({ ok: true, data: db.getProject(p.id) }),
  projects_delete: (p) => Promise.resolve({ ok: true, data: db.deleteProject(p.id) }),
  projects_importLegacy: (p) => Promise.resolve({ ok: true, data: db.importLegacy(p.projects || []) }),
  settings_get: () => Promise.resolve({ ok: true, data: db.getSettings() }),
  settings_save: (p) => Promise.resolve({ ok: true, data: db.saveSettings(p) }),
};

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.fireApi = dbApi;
window.confirm = () => true;
window.print = () => {};
window.scrollTo = () => {};
process.on("unhandledRejection", (err) => { console.log("UNHANDLED:", err && err.stack || err); process.exit(1); });

const src = ["js/data.js", "js/calc.js", "js/api.js", "js/app.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
window.eval(src);

let pass = 0, fail = 0;
const ok = (name, cond) => {
  console.log((cond ? "✅" : "❌"), name);
  cond ? pass++ : fail++;
};

setTimeout(async () => {
  try {
    console.log("--- وضع التخزين:", window.FireAPI.mode, "---");

    const all = await window.FireAPI.catalogList({ kind: "equipment", system: "all", activeOnly: true });
    ok("مكتبة الأجهزة تعرض الكل (253)", all.length === 253);

    const smoke = all.find(i => i.name.includes("كاشف دخان تقليدي"));
    const pump = all.find(i => i.name.includes("طفاية بودرة جافة 6 كجم"));
    window.addEquipment(smoke.name, smoke.supply_cost, smoke.install_cost, smoke.category_system, smoke.id);
    window.addEquipment(pump.name, pump.supply_cost, pump.install_cost, pump.category_system, pump.id);
    const mats = await window.FireAPI.catalogList({ kind: "material", activeOnly: true });
    ok("مكتبة المواد (57)", mats.length === 57);
    window.addMaterial(mats[0].name, mats[0].unit, mats[0].supply_cost, mats[0].id);
    window.__fp.state().labor.push({ id: window.uid(), name: "فني تركيب", workers: 2, days: 5, dailyCost: 150 });
    window.__fp.state().services.push({ id: window.uid(), name: "اختبار وتشغيل", value: 5, type: "pct" });
    window.__fp.state().project.name = "مبنى تجاري - اختبار فتح المشروع";
    window.renderAll();

    /* 1) كتابة الأرقام يدوياً دون فقدان التركيز */
    const laborInput = window.document.querySelector('#laborBody input[data-f="dailyCost"]');
    if (!laborInput) throw new Error("حقل العمالة غير موجود");
    laborInput.focus();
    laborInput.value = "250";
    laborInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    ok("حقل العمالة ما زال مركّزاً بعد الكتابة", window.document.activeElement === laborInput);
    const laborTotal = window.document.getElementById("laborTotal").textContent;
    ok("إجمالي العمالة 2,500", laborTotal.includes("2,500"));

    const eqQty = window.document.querySelector('#eqBody input[data-f="qty"]');
    eqQty.value = "10";
    eqQty.dispatchEvent(new window.Event("input", { bubbles: true }));
    ok("كتابة كمية الجهاز يدوياً (10)", window.__fp.state().equipment[0].qty === 10);

    const svcInput = window.document.querySelector('#serviceBody input[data-f="value"]');
    svcInput.value = "5";
    svcInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    const svcTotal = window.document.getElementById("serviceTotal").textContent;
    ok("إجمالي الخدمات غير صفري: " + svcTotal, !/0\.00/.test(svcTotal));

    /* 2) الحفظ والترقيم */
    await window.doSave(true);
    const qno = window.document.getElementById("projectQuoteNo").value;
    ok("تم الحفظ برقم: " + qno, qno.startsWith("Q-"));

    /* 3) فتح المشروع المحفوظ (المشكلة الحرجة) */
    const projects = await window.FireAPI.projectsList("");
    ok("المشروع يظهر في القائمة", projects.length >= 1);
    await window.openProject(projects[0].id);
    ok("تم فتح المشروع والاسم محفوظ", window.__fp.state().project.name === "مبنى تجاري - اختبار فتح المشروع");
    ok("البنود استرجعت (2 جهاز + 1 مادة)", window.__fp.state().equipment.length === 2 && window.__fp.state().materials.length === 1);
    ok("نظام البند (إطفاء) محفوظ", window.__fp.state().equipment[1].system === "fighting");
    ok("العمالة استرجعت (250 يومية)", window.__fp.state().labor[0].dailyCost === 250);
    ok("الخدمة استرجعت", window.__fp.state().services[0].value === 5);
    ok("المودال أُغلق", !window.document.getElementById("projectsModal").classList.contains("show"));

    /* 4) عرض العميل */
    window.renderQuote();
    const q = window.document.getElementById("quotePreview").innerHTML;
    ok("عرض العميل لا يحتوي هامش الربح", !q.includes("هامش الربح"));
    ok("عرض العميل لا يحتوي التكلفة الأساسية", !q.includes("التكلفة الأساسية"));
    ok("عرض العميل يحتوي الإجمالي النهائي", q.includes("الإجمالي النهائي"));
    ok("عرض العميل فيه أسعار بيع", q.includes("سعر البيع/وحدة"));

    /* 5) التقرير الداخلي */
    window.document.getElementById("btnQuoteInternal").click();
    const qi = window.document.getElementById("quotePreview").innerHTML;
    ok("التقرير الداخلي فيه هامش الربح", qi.includes("هامش الربح"));
    ok("التقرير الداخلي فيه التكلفة الأساسية", qi.includes("التكلفة الأساسية"));
    window.document.getElementById("btnQuoteClient").click();

    /* 6) العميل اليدوي يُضاف للسجل تلقائياً */
    const nameField = window.document.getElementById("projectClient");
    nameField.value = "شركة الأمان التجارية";
    window.__fp.state().project.client = "شركة الأمان التجارية";
    nameField.dispatchEvent(new window.Event("blur", { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const clients = await window.FireAPI.clientsList("");
    ok("العميل المكتوب أُضيف للسجل تلقائياً", clients.some(c => c.name === "شركة الأمان التجارية"));

    console.log("===== النتيجة:", pass, "نجاح /", fail, "فشل =====");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("خطأ فادح:", e.stack || e.message);
    process.exit(1);
  }
}, 400);
