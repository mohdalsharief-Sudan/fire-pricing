"use strict";
/* اختبار سيناريو الخدمات الهندسية بالضبط كما يفعل المستخدم */
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
window.confirm = () => true;
window.print = () => {};
window.scrollTo = () => {};
process.on("unhandledRejection", (err) => { console.log("UNHANDLED:", err && err.stack || err); process.exit(1); });

const src = ["js/data.js", "js/calc.js", "js/api.js", "js/app.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
window.eval(src);

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "✅" : "❌"), name); cond ? pass++ : fail++; };

setTimeout(async () => {
  try {
    /* ===== السيناريو: مشروع جديد + خدمة بمبلغ ثابت ===== */
    console.log("--- سيناريو 1: مشروع جديد + خدمة مبلغ ثابت 300 ---");
    window.__fp.state().project.name = "مشروع الخدمات";
    // إضافة خدمة من الزر (محاكاة نقرة المستخدم)
    window.document.getElementById("btnAddService").click();
    const svc = window.__fp.state().services[0];
    ok("الخدمة أُضيفت للجدول", window.document.querySelectorAll("#serviceBody tr").length === 1);
    // كتابة الاسم
    const nameInput = window.document.querySelector('#serviceBody input[data-f="name"]');
    nameInput.value = "تصميم وإشراف";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    // كتابة القيمة 300
    const valInput = window.document.querySelector('#serviceBody input[data-f="value"]');
    valInput.focus();
    valInput.value = "300";
    valInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    ok("القيمة حُفظت في الحالة", window.__fp.state().services[0].value === 300);
    ok("التركيز باقٍ بعد الكتابة", window.document.activeElement === valInput);
    // الإجمالي في الصف
    const rowTotal = window.document.querySelector('#serviceBody tr td.num').textContent;
    ok("إجمالي صف الخدمة = 300: " + rowTotal, rowTotal.includes("300"));
    const tableTotal = window.document.getElementById("serviceTotal").textContent;
    ok("إجمالي الجدول = 300: " + tableTotal, tableTotal.includes("300"));
    // عرض السعر
    window.renderQuote();
    const q1 = window.document.getElementById("quotePreview").innerHTML;
    ok("قسم الخدمات موجود في العرض", q1.includes("الخدمات الهندسية"));
    ok("الخدمة باسمها في العرض", q1.includes("تصميم وإشراف"));
    ok("قيمة الخدمة في ملخص العرض (300 أو أكثر)", /الخدمات الهندسية والتشغيلية: <strong>[1-9]/.test(q1));

    /* ===== السيناريو 2: حفظ وفتح المشروع — هل تبقى الخدمة؟ ===== */
    console.log("--- سيناريو 2: حفظ ثم فتح ---");
    await window.doSave(true);
    const projects = await window.FireAPI.projectsList("");
    await window.openProject(projects[0].id);
    ok("الخدمة استرجعت بعد الفتح", window.__fp.state().services.length === 1);
    ok("قيمة الخدمة بعد الفتح = 300", window.__fp.state().services[0].value === 300);
    window.renderQuote();
    const q2 = window.document.getElementById("quotePreview").innerHTML;
    ok("الخدمة في عرض السعر بعد الفتح", q2.includes("تصميم وإشراف"));
    ok("قيمة الخدمة في الملخص بعد الفتح", /الخدمات الهندسية والتشغيلية: <strong>[1-9]/.test(q2));

    /* ===== السيناريو 3: خدمة نسبة % بدون بنود ===== */
    console.log("--- سيناريو 3: خدمة نسبة % بدون بنود (الحالة المحيرة) ---");
    window.document.getElementById("btnNewProject").click();
    window.document.getElementById("btnAddService").click();
    const svc2 = window.__fp.state().services[0];
    svc2.type = "pct";
    svc2.value = 5;
    window.renderServices();
    window.renderQuote();
    const q3 = window.document.getElementById("quotePreview").innerHTML;
    ok("خدمة نسبة % بلا بنود = صفر (طبيعة الحساب)", /الخدمات الهندسية والتشغيلية: <strong>0/.test(q3) || !q3.includes("الخدمات الهندسية والتشغيلية"));
    console.log("   ملاحظة: النسبة تُحسب من التكلفة الأساسية — بلا بنود = صفر. هذا سلوك صحيح رياضياً.");

    /* ===== السيناريو 4: خدمة نسبة % مع بنود ===== */
    console.log("--- سيناريو 4: خدمة نسبة % مع بنود أجهزة ---");
    window.__fp.state().equipment.push({ id: window.uid(), name: "كاشف دخان", qty: 10, supplyCost: 120, installCost: 55, system: "alarm" });
    window.renderAll();
    window.renderQuote();
    const q4 = window.document.getElementById("quotePreview").innerHTML;
    ok("خدمة 5% مع أجهزة = قيمة غير صفرية", /الخدمات الهندسية والتشغيلية: <strong>[1-9]/.test(q4));

    console.log("===== النتيجة:", pass, "نجاح /", fail, "فشل =====");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("خطأ فادح:", e.stack || e.message);
    process.exit(1);
  }
}, 400);
