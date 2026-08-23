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
  const added = db.addItem({
    category_id: cat.id,
    name: "كاشف تجريبي",
    supply_cost: 150,
    install_cost: 60,
    unit: "حبة"
  });

  assert.ok(added.code.startsWith("ALM-"));
  assert.strictEqual(db.getPriceHistory(added.id).length, 1);

  db.updateItem(added.id, Object.assign({}, added, { supply_cost: 165 }));
  assert.strictEqual(db.getPriceHistory(added.id).length, 2);
});

test("تحديث أسعار شامل: نسب الزيادة والتسجيل", () => {
  const db = freshDb();
  const before = db.listCatalog({ kind: "material", activeOnly: false });
  const n = db.bulkUpdatePrices({
    kind: "material",
    pct: 10,
    applyTo: "supply",
    note: "ارتفاع السوق"
  });

  assert.strictEqual(n, 57);

  const after = db.listCatalog({ kind: "material", activeOnly: false });

  before.forEach((b, i) => {
    assert.ok(Math.abs(after[i].supply_cost - Math.round(b.supply_cost * 1.1 * 100) / 100) < 1e-9);
    assert.strictEqual(after[i].install_cost, b.install_cost);
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
  const year = new Date().getFullYear();
  const cl = db.saveClient({ name: "عميل تجريبي" });

  const p1 = db.saveProject({
    name: "مبنى تجاري",
    clientId: cl.id,
    currency: "SAR",
    vat: 15,
    margins: { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 },
    status: "sent",
    total: 12345.67,
    items: [
      { kind: "equipment", name: "كاشف دخان", qty: 10, supply_cost: 120, install_cost: 55 },
      { kind: "material", name: "كابل", qty: 100, unit: "م", unit_cost: 8 },
      { kind: "labor", name: "فني", workers: 2, days: 3, daily_cost: 150 },
      { kind: "service", name: "اختبار", service_type: "amount", service_value: 500 }
    ]
  });

  assert.strictEqual(p1.quoteNo, `Q-${year}-0001`);

  const p2 = db.saveProject({ name: "مشروع ثانٍ", items: [] });
  assert.strictEqual(p2.quoteNo, `Q-${year}-0002`);

  const loaded = db.getProject(p1.id);
  assert.strictEqual(loaded.name, "مبنى تجاري");
  assert.strictEqual(loaded.items.length, 4);
  assert.strictEqual(loaded.client.name, "عميل تجريبي");
  assert.strictEqual(loaded.status, "sent");

  const upd = db.saveProject(Object.assign({}, {
    name: "مبنى تجاري معدل",
    clientId: cl.id,
    currency: "SAR",
    vat: 15,
    margins: {},
    status: "accepted",
    total: 999,
    items: []
  }, { id: p1.id }));

  assert.strictEqual(upd.quoteNo, `Q-${year}-0001`);
  assert.strictEqual(db.getProject(p1.id).name, "مبنى تجاري معدل");

  db.deleteProject(p1.id);
  assert.strictEqual(db.getProject(p1.id), null);

  const p3 = db.saveProject({ name: "مشروع ثالث", items: [] });
  assert.strictEqual(p3.quoteNo, `Q-${year}-0003`);
  assert.strictEqual(db.listProjects().length, 2);
});

test("إعدادات الشركة: حفظ واسترجاع ودمج تحديث جزئي", () => {
  const db = freshDb();

  assert.deepStrictEqual(db.getSettings(), {});

  db.saveSettings({
    name: "شركة النخبة",
    phone: "0555",
    logo: "data:image/png;base64,abc",
    terms: "شروط"
  });

  const s = db.getSettings();
  assert.strictEqual(s.name, "شركة النخبة");
  assert.strictEqual(s.phone, "0555");
  assert.ok(s.logo.startsWith("data:image"));

  db.saveSettings({ name: "شركة النخبة المحدودة" });

  const merged = db.getSettings();
  assert.strictEqual(merged.name, "شركة النخبة المحدودة");
  assert.strictEqual(merged.phone, "0555");
  assert.ok(merged.logo.startsWith("data:image"));
  assert.strictEqual(merged.terms, "شروط");
});

test("استيراد من قاعدة SQLite قديمة (ملف) يحافظ على الأرقام والبنود", () => {
  const sqlite = require("better-sqlite3");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  const tmp = path.join(os.tmpdir(), "fp-olddb-" + Date.now() + ".db");
  const src = fs.readFileSync(path.join(__dirname, "database.js"), "utf8");
  const v1 = src.match(/const SCHEMA_V1 = `([\s\S]*?)`;/)[1];
  const v2 = src.match(/const SCHEMA_V2 = `([\s\S]*?)`;/)[1];

  let old = new sqlite(tmp);
  old.exec(v1);
  old.exec(v2);
  old.pragma("user_version = 3");

  old.prepare("INSERT INTO clients (name, city) VALUES (?,?)").run("عميل قديم", "جدة");
  const cid = old.prepare("SELECT id FROM clients").get().id;

  old.prepare(`
    INSERT INTO projects (quote_no, client_id, name, currency, vat, margins, status)
    VALUES (?,?,?,?,?,?,?)
  `).run("Q-2025-0007", cid, "مشروع قديم", "SAR", 15, "{}", "draft");

  const pid = old.prepare("SELECT id FROM projects").get().id;

  old.prepare(`
    INSERT INTO project_items (project_id, kind, name, qty, supply_cost, install_cost)
    VALUES (?,?,?,?,?,?)
  `).run(pid, "equipment", "مضخة قديمة", 1, 5000, 500);

  old.prepare(`
    INSERT INTO project_items (project_id, kind, name, qty, unit_cost)
    VALUES (?,?,?,?,?)
  `).run(pid, "material", "كابل قديم", 50, 8);

  old.prepare(`
    INSERT INTO project_items (project_id, kind, name, service_value, service_type)
    VALUES (?,?,?,?,?)
  `).run(pid, "service", "خدمة قديمة", 300, "amount");

  old.close();

  const db = freshDb();
  const res = db.importFromLegacyDb(tmp);

  assert.strictEqual(res.projects, 1);
  assert.strictEqual(res.clients, 1);
  assert.ok(res.error === undefined);

  const res2 = db.importFromLegacyDb(tmp);
  assert.strictEqual(res2.projects, 0);

  const list = db.listProjects();
  assert.strictEqual(list.length, 1);

  const p = db.getProject(list[0].id);
  assert.strictEqual(p.quoteNo, "Q-2025-0007");
  assert.strictEqual(p.items.length, 3);

  const eq = p.items.find(i => i.kind === "equipment");
  assert.strictEqual(eq.name, "مضخة قديمة");
  assert.strictEqual(eq.supply_cost, 5000);

  fs.unlinkSync(tmp);
});