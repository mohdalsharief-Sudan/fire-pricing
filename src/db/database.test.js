"use strict";
/* اختبارات قاعدة البيانات (في الذاكرة) */
const { test } = require("node:test");
const assert = require("node:assert");
const { createDatabase } = require("./database.js");

function freshDb() {
  return createDatabase(":memory:");
}

test("البذر: يحتوي على 310 أصناف (253 جهاز + 57 مادة)", () => {
  const db = freshDb();
  const all = db.listCatalog({ activeOnly: false });
  assert.strictEqual(all.length, 310);
  assert.strictEqual(db.listCatalog({ kind: "equipment", activeOnly: false }).length, 253);
  assert.strictEqual(db.listCatalog({ kind: "material", activeOnly: false }).length, 57);
});

test("البحث في الكتالوج بالاسم والكود", () => {
  const db = freshDb();
  assert.ok(db.listCatalog({ search: "كاشف دخان" }).length >= 5);
  assert.ok(db.listCatalog({ search: "ALM-001" }).length === 1);
});

test("إضافة صنف: كود تلقائي + سجل أسعار", () => {
  const db = freshDb();
  const cat = db.listCategories().find(c => c.name === "الكواشف التقليدية");
  const added = db.addItem({ category_id: cat.id, name: "كاشف تجريبي", supply_cost: 150, install_cost: 60, unit: "حبة" });
  assert.ok(added.code.startsWith("ALM-"));
  assert.strictEqual(db.getPriceHistory(added.id).length, 1);
  // تعديل السعر يضيف سجلاً
  db.updateItem(added.id, Object.assign({}, added, { supply_cost: 165 }));
  assert.strictEqual(db.getPriceHistory(added.id).length, 2);
});

test("تحديث أسعار شامل: نسب الزيادة والتسجيل", () => {
  const db = freshDb();
  const before = db.listCatalog({ kind: "material", activeOnly: false });
  const n = db.bulkUpdatePrices({ kind: "material", pct: 10, applyTo: "supply", note: "ارتفاع السوق" });
  assert.strictEqual(n, 57);
  const after = db.listCatalog({ kind: "material", activeOnly: false });
  // كل صنف: السعر الجديد = القديم × 1.1 (التوريد فقط)
  before.forEach((b, i) => {
    assert.ok(Math.abs(after[i].supply_cost - Math.round(b.supply_cost * 1.1 * 100) / 100) < 1e-9);
    assert.strictEqual(after[i].install_cost, b.install_cost); // التركيب لم يتغير
    assert.ok(db.getPriceHistory(after[i].id).length >= 1);
  });
});

test("العملاء: إضافة وتعديل وحذف", () => {
  const db = freshDb();
  const c = db.saveClient({ name: "شركة النخبة", phone: "0555", city: "الرياض" });
  assert.ok(c.id > 0);
  assert.strictEqual(db.listClients().length, 1);
  db.saveClient(Object.assign({}, c, { name: "شركة النخبة للتقنية" }));
  assert.strictEqual(db.listClients()[0].name, "شركة النخبة للتقنية");
  db.deleteClient(c.id);
  assert.strictEqual(db.listClients().length, 0);
});

test("المشاريع: ترقيم تلقائي وحفظ واسترجاع وحذف", () => {
  const db = freshDb();
  const cl = db.saveClient({ name: "عميل تجريبي" });
  const p1 = db.saveProject({
    name: "مبنى تجاري", clientId: cl.id, currency: "SAR", vat: 15,
    margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 },
    status: "sent", total: 12345.67,
    items: [
      { kind: "equipment", name: "كاشف دخان", qty: 10, supply_cost: 120, install_cost: 55 },
      { kind: "material", name: "كابل", qty: 100, unit: "م", unit_cost: 8 },
      { kind: "labor", name: "فني", workers: 2, days: 3, daily_cost: 150 },
      { kind: "service", name: "اختبار", service_type: "amount", service_value: 500 }
    ]
  });
  assert.strictEqual(p1.quoteNo, "Q-2026-0001");
  const p2 = db.saveProject({ name: "مشروع ثانٍ", items: [] });
  assert.strictEqual(p2.quoteNo, "Q-2026-0002");

  const loaded = db.getProject(p1.id);
  assert.strictEqual(loaded.name, "مبنى تجاري");
  assert.strictEqual(loaded.items.length, 4);
  assert.strictEqual(loaded.client.name, "عميل تجريبي");
  assert.strictEqual(loaded.status, "sent");

  // تعديل: نفس المعرّف لا ينشئ رقماً جديداً
  const upd = db.saveProject(Object.assign({}, {
    name: "مبنى تجاري معدل", clientId: cl.id, currency: "SAR", vat: 15,
    margins: {}, status: "accepted", total: 999, items: []
  }, { id: p1.id }));
  assert.strictEqual(upd.quoteNo, "Q-2026-0001");
  assert.strictEqual(db.getProject(p1.id).name, "مبنى تجاري معدل");

  // حذف يزيل البنود المرتبطة (CASCADE)
  db.deleteProject(p1.id);
  assert.strictEqual(db.getProject(p1.id), null);
  assert.strictEqual(db.listProjects().length, 1);
});

test("استيراد مشاريع النسخة القديمة", () => {
  const db = freshDb();
  const n = db.importLegacy([{
    project: { name: "مشروع قديم", vat: 15 },
    equipment: [{ name: "جهاز", qty: 2, supplyCost: 100, installCost: 50 }],
    materials: [{ name: "مادة", qty: 5, unit: "م", unitCost: 10 }],
    labor: [{ name: "عمالة", workers: 1, days: 2, dailyCost: 100 }],
    services: [{ name: "خدمة", type: "amount", value: 200 }]
  }]);
  assert.strictEqual(n, 1);
  const list = db.listProjects();
  assert.strictEqual(list.length, 1);
  const p = db.getProject(list[0].id);
  assert.strictEqual(p.items.length, 4);
  assert.ok(p.notes.includes("مستورد"));
});

test("تصدير JSON يحتوي كل الجداول", () => {
  const db = freshDb();
  db.saveClient({ name: "عميل" });
  db.saveProject({ name: "مشروع", items: [{ kind: "equipment", name: "جهاز", qty: 1, supply_cost: 10, install_cost: 5 }] });
  const dump = JSON.parse(db.exportJson());
  assert.strictEqual(dump.version, 2);
  assert.ok(dump.items.length >= 310);
  assert.strictEqual(dump.clients.length, 1);
  assert.strictEqual(dump.projects.length, 1);
});

test("إعدادات الشركة: حفظ واسترجاع", () => {
  const db = freshDb();
  assert.deepStrictEqual(db.getSettings(), {});
  db.saveSettings({ name: "شركة النخبة", phone: "0555", logo: "data:image/png;base64,abc", terms: "شروط" });
  const s = db.getSettings();
  assert.strictEqual(s.name, "شركة النخبة");
  assert.strictEqual(s.phone, "0555");
  assert.ok(s.logo.startsWith("data:image"));
  // تحديث جزئي يحل محل الكل
  db.saveSettings({ name: "شركة النخبة المحدودة" });
  assert.strictEqual(db.getSettings().name, "شركة النخبة المحدودة");
  assert.strictEqual(db.getSettings().phone, undefined);
});

test("الترقية من v1 إلى v2 تحافظ على البيانات", () => {
  const sqlite = require("better-sqlite3");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const tmp = path.join(os.tmpdir(), "fp-upgrade-test-" + Date.now() + ".db");
  // بناء قاعدة v1 حقيقية (بدون جدول settings)
  const src = fs.readFileSync(path.join(__dirname, "database.js"), "utf8");
  const m = src.match(/const SCHEMA_V1 = `([\s\S]*?)`;/);
  const s = new sqlite(tmp);
  s.exec(m[1]);
  s.pragma("user_version = 1");
  s.close();
  const db = createDatabase(tmp);
  assert.strictEqual(db.raw.pragma("user_version", { simple: true }), 2);
  assert.deepStrictEqual(db.getSettings(), {});
  db.saveSettings({ name: "بعد الترقية" });
  assert.strictEqual(db.getSettings().name, "بعد الترقية");
  assert.strictEqual(db.listCatalog({}).length, 310);
  db.close();
  fs.unlinkSync(tmp);
});
