"use strict";
/* اختبار: فصل عرض العميل عن التقرير الداخلي + الحماية */
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
  settings_save: (p) => Promise.resolve({ ok: true, data: db.saveSettings(p) })
};

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.fireApi = dbApi;
window.confirm = () => false;   /* محاكاة إلغاء التأكيد */
window.print = () => { window.__printed = true; };
window.scrollTo = () => {};
process.on("unhandledRejection", (err) => { console.log("UNHANDLED:", err && err.stack || err); process.exit(1); });

const src = ["js/data.js", "js/calc.js", "js/api.js", "js/app.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
window.eval(src);

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "✅" : "❌"), name); cond ? pass++ : fail++; };

setTimeout(async () => {
  try {
    // مشروع ببنود
    window.__fp.state().project.name = "مشروع الوضعين";
    window.__fp.state().equipment.push({ id: window.uid(), name: "كاشف دخان", qty: 10, supplyCost: 120, installCost: 55, system: "alarm" });
    window.renderAll();

    /* 1) الافتراضي بعد فتح التطبيق = عرض العميل */
    ok("الوضع الافتراضي = عرض العميل", window.__fp.quoteMode() === "client");

    /* 2) عرض العميل لا يحتوي التكاليف */
    window.renderQuote();
    let q = window.document.getElementById("quotePreview").innerHTML;
    ok("عرض العميل: لا هامش ربح", !q.includes("هامش الربح"));
    ok("عرض العميل: لا تكلفة أساسية", !q.includes("التكلفة الأساسية"));
    ok("عرض العميل: لا شريط تحذير داخلي", !q.includes("internal-warning"));
    ok("عرض العميل: فيه إجمالي نهائي", q.includes("الإجمالي النهائي"));

    /* 3) التقرير الداخلي يحتوي التكاليف + شريط التحذير */
    window.document.getElementById("btnQuoteInternal").click();
    q = window.document.getElementById("quotePreview").innerHTML;
    ok("التقرير الداخلي: فيه هامش الربح", q.includes("هامش الربح"));
    ok("التقرير الداخلي: فيه التكلفة الأساسية", q.includes("التكلفة الأساسية"));
    ok("التقرير الداخلي: فيه شريط التحذير الأحمر", q.includes("internal-warning"));

    /* 4) الرجوع لعرض العميل */
    window.document.getElementById("btnQuoteClient").click();
    q = window.document.getElementById("quotePreview").innerHTML;
    ok("الرجوع لعرض العميل يعمل", !q.includes("هامش الربح"));

    /* 5) فتح مشروع يعيد الوضع لعرض العميل دائماً */
    await window.doSave(true);
    const projects = await window.FireAPI.projectsList("");
    window.document.getElementById("btnQuoteInternal").click();
    ok("تحولنا للتقرير الداخلي", window.__fp.quoteMode() === "internal");
    await window.openProject(projects[0].id);
    ok("بعد فتح المشروع: عاد الوضع لعرض العميل", window.__fp.quoteMode() === "client");

    /* 6) مشروع جديد يعيد الوضع لعرض العميل */
    window.document.getElementById("btnQuoteInternal").click();
    window.confirm = () => true;   /* موافقة على تفريغ المشروع */
    window.document.getElementById("btnNewProject").click();
    ok("بعد مشروع جديد: عاد الوضع لعرض العميل", window.__fp.quoteMode() === "client");

    /* 7) الطباعة من التقرير الداخلي: تحذير + (إلغاء = يطبع كما هو) */
    window.document.getElementById("btnQuoteInternal").click();
    window.confirm = () => false;   /* إلغاء → طباعة التقرير الداخلي كما هو */
    window.__printed = false;
    window.document.getElementById("btnPrint").click();
    ok("الطباعة في الوضع الداخلي (بعد إلغاء التحذير) تطبع", window.__printed === true);

    /* 8) موافقة → ينتقل لعرض العميل ثم يطبع */
    window.document.getElementById("btnQuoteInternal").click();
    window.confirm = () => true;    /* موافقة → تحويل لعرض العميل */
    window.__printed = false;
    window.document.getElementById("btnPrint").click();
    await new Promise(r => setTimeout(r, 300));
    ok("الموافقة تنتقل لعرض العميل وتطبع", window.__printed === true && window.__fp.quoteMode() === "client");

    console.log("===== النتيجة:", pass, "نجاح /", fail, "فشل =====");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("خطأ فادح:", e.stack || e.message);
    process.exit(1);
  }
}, 400);
