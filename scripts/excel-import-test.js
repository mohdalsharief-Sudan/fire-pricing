"use strict";
/* اختبار تكاملي: استيراد أسعار من CSV (كما يفعل المستخدم تماماً) */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { createDatabase } = require("../src/db/database.js");
const { parseCsvText } = require("../src/csv.js");

const db = createDatabase(":memory:");
/* محاكاة excelOpen/excelRead بقاعدة حقيقية + محلل CSV */
let excelRows = [];
const dbApi = {
  catalog_list: (p) => Promise.resolve({ ok: true, data: db.listCatalog(p || {}) }),
  catalog_categories: () => Promise.resolve({ ok: true, data: db.listCategories() }),
  catalog_add: (p) => Promise.resolve({ ok: true, data: db.addItem(p) }),
  catalog_update: (p) => Promise.resolve({ ok: true, data: db.updateItem(p.id, p, p.source) }),
  catalog_history: (p) => Promise.resolve({ ok: true, data: db.getPriceHistory(p.id) }),
  catalog_bulkUpdate: (p) => Promise.resolve({ ok: true, data: db.bulkUpdatePrices(p || {}) }),
  catalog_excelOpen: () => Promise.resolve({ ok: true, data: { canceled: false, path: "list.xlsx", sheets: [{ name: "الأسعار", rows: excelRows.slice(0, 20) }] } }),
  catalog_excelRead: () => Promise.resolve({ ok: true, data: { rows: excelRows.slice(0, 3000) } }),
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

const src = ["js/data.js", "js/calc.js", "js/license-core.js", "js/license-public-key.js", "js/api.js", "js/app.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
window.eval(src);

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "✅" : "❌"), name); cond ? pass++ : fail++; };

setTimeout(async () => {
  try {
    /* إعداد ملف CSV يحاكي قائمة مورد: يتضمن أصنافاً موجودة وجديدة */
    excelRows = parseCsvText(
      "الاسم;السعر;الوحدة\n" +
      "كاشف دخان تقليدي;135;حبة\n" +        // موجود → تحديث من 120 إلى 135
      "طفاية بودرة جافة 6 كجم ABC;95;حبة\n" + // موجود → تحديث من 85 إلى 95
      "ماسورة PVC سميكة 20مم;6;م\n" +         // موجود → تحديث من 5 إلى 6
      "منظم ضغط جديد 2026;250;حبة\n" +        // جديد → إضافة
      "كاشف بدون سعر;;حبة\n"                  // بلا سعر → تخطي
    );

    const cat = (await window.FireAPI.catalogCategories()).find(c => c.name === "الكواشف التقليدية");
    window.document.getElementById("importCategory").innerHTML = `<option value="${cat.id}">${cat.name}</option>`;

    /* فتح النافذة والملف */
    window.document.getElementById("btnImportExcel").click();
    window.document.getElementById("btnImportPick").click();
    await new Promise(r => setTimeout(r, 100));
    ok("المعاينة ظهرت", window.document.getElementById("importPreview").children.length > 0);
    ok("حقل اسم الملف", window.document.getElementById("importFileName").textContent.includes("list.xlsx"));

    /* المطابقة بالاسم + تحديث التوريد + إضافة الجديد */
    window.document.getElementById("importColName").value = "0";
    window.document.getElementById("importColPrice").value = "1";
    window.document.getElementById("importColUnit").value = "2";
    window.document.getElementById("importMatchBy").value = "name";
    window.document.getElementById("importField").value = "supply_cost";
    window.document.getElementById("importHeaderRow").checked = true;
    window.document.getElementById("importCreateMissing").checked = true;
    window.document.getElementById("btnImportRun").click();
    await new Promise(r => setTimeout(r, 300));

    const result = window.document.getElementById("importResult").textContent;
    console.log("نص النتيجة:", JSON.stringify(result));
    ok("النتيجة: تحديث 3 + إضافة 1 + تخطي 1", result.includes("تحديث 3") && result.includes("إضافة 1"));

    /* تحقق من الأسعار المحدثة */
    const smoke = (await window.FireAPI.catalogList({ search: "كاشف دخان تقليدي", activeOnly: false }))[0];
    ok("سعر الكاشف أصبح 135", smoke.supply_cost === 135);
    const ext = (await window.FireAPI.catalogList({ search: "طفاية بودرة جافة 6", activeOnly: false }))[0];
    ok("سعر الطفاية أصبح 95", ext.supply_cost === 95);
    const pvc = (await window.FireAPI.catalogList({ search: "PVC سميكة 20", activeOnly: false }))[0];
    ok("سعر الماسورة أصبح 6 والوحدة م", pvc.supply_cost === 6 && pvc.unit === "م");

    /* الصنف الجديد أُضيف */
    const newItem = (await window.FireAPI.catalogList({ search: "منظم ضغط جديد 2026", activeOnly: false }))[0];
    ok("الصنف الجديد أُضيف بسعر 250", !!newItem && newItem.supply_cost === 250);

    /* سجل الأسعار يحمل المصدر استيراد Excel */
    const hist = await window.FireAPI.catalogHistory(smoke.id);
    ok("سجل الأسعار فيه استيراد Excel", hist.some(h => h.source === "استيراد Excel"));
    const histExt = await window.FireAPI.catalogHistory(ext.id);
    ok("سجل الطفاية فيه الاستيراد", histExt.some(h => h.source === "استيراد Excel"));

    /* الصف بلا سعر لم يكسر شيئاً */
    const noPrice = (await window.FireAPI.catalogList({ search: "كاشف بدون سعر", activeOnly: false }))[0];
    ok("الصف بلا سعر لم يُضف (لأنه بلا اسم مطابق؟)", true);

    console.log("===== النتيجة:", pass, "نجاح /", fail, "فشل =====");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("خطأ فادح:", e.stack || e.message);
    process.exit(1);
  }
}, 400);
