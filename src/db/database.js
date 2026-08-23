"use strict";
/*
 * database.js — طبقة قاعدة البيانات SQLite
 * تعمل داخل عملية Electron الرئيسية (main process) وتُستدعى عبر IPC.
 * للاختبار يمكن تمرير ":memory:" كمسار.
 */
const path = require("path");
const fs = require("fs");

let Database = null;
try {
  Database = require("better-sqlite3");
} catch (e) {
  Database = null;
}

const SCHEMA_VERSION = 3;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id),
  kind TEXT NOT NULL CHECK (kind IN ('equipment','material')),
  system TEXT DEFAULT '',                 -- alarm / fighting / '' للمواد
  name TEXT NOT NULL,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  unit TEXT DEFAULT 'وحدة',
  supply_cost REAL DEFAULT 0,
  install_cost REAL DEFAULT 0,
  currency TEXT DEFAULT 'SAR',
  supplier TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  supply_cost REAL DEFAULT 0,
  install_cost REAL DEFAULT 0,
  currency TEXT DEFAULT 'SAR',
  source TEXT DEFAULT 'يدوي',
  changed_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  cr_number TEXT DEFAULT '',
  city TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT UNIQUE,
  client_id INTEGER REFERENCES clients(id),
  name TEXT DEFAULT '',
  location TEXT DEFAULT '',
  date TEXT DEFAULT '',
  area REAL DEFAULT 0,
  floors INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'SAR',
  vat REAL DEFAULT 15,
  validity INTEGER DEFAULT 30,
  margins TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  total REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS project_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  kind TEXT NOT NULL CHECK (kind IN ('equipment','material','labor','service')),
  name TEXT DEFAULT '',
  qty REAL DEFAULT 0,
  unit TEXT DEFAULT '',
  supply_cost REAL DEFAULT 0,
  install_cost REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  workers INTEGER DEFAULT 0,
  days INTEGER DEFAULT 0,
  daily_cost REAL DEFAULT 0,
  service_type TEXT DEFAULT 'amount',
  service_value REAL DEFAULT 0,
  sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_cat ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active);
CREATE INDEX IF NOT EXISTS idx_ph_item ON price_history(item_id);
CREATE INDEX IF NOT EXISTS idx_pi_project ON project_items(project_id);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
);
`;

const SCHEMA_V3 = `
ALTER TABLE project_items ADD COLUMN system TEXT DEFAULT '';
`;

/* ==================== فتح القاعدة وتهيئتها ==================== */

function createDatabase(dbPath) {
  if (!Database) {
    const err = new Error("better-sqlite3 غير متوفر — تأكد من تثبيت الاعتماديات (npm install)");
    err.code = "DB_UNAVAILABLE";
    throw err;
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);
  seedIfEmpty(db);
  return makeApi(db);
}

function migrate(db) {
  const v = db.pragma("user_version", { simple: true });
  if (v < 1) {
    db.exec(SCHEMA_V1);
    db.pragma("user_version = 1");
  }
  if (v < 2) {
    db.exec(SCHEMA_V2);
    db.prepare("INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}')").run();
    db.pragma("user_version = 2");
  }
  if (v < 3) {
    try { db.exec(SCHEMA_V3); } catch (e) { /* العمود قد يكون موجوداً */ }
    db.pragma("user_version = 3");
  }
}

/* ==================== البذر (الكتالوج الافتراضي) ==================== */

function seedIfEmpty(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM items").get().c;
  if (count > 0) return;

  const seedsDir = path.join(__dirname, "seed");
  const load = (file) => JSON.parse(fs.readFileSync(path.join(seedsDir, file), "utf8"));
  const insertCat = db.prepare("INSERT INTO categories (parent_id, kind, system, name, sort) VALUES (?,?,?,?,?)");
  const insertItem = db.prepare(`
    INSERT INTO items (category_id, code, name, name_en, brand, model, unit,
                       supply_cost, install_cost, currency, supplier, is_active, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`);

  const tx = db.transaction(() => {
    ["equipment.json", "materials.json"].forEach(file => {
      const data = load(file);
      data.categories.forEach((cat, ci) => {
        const catRes = insertCat.run(null, data.kind, cat.system || "", cat.name, ci);
        const catId = catRes.lastInsertRowid;
        (cat.items || []).forEach(it => {
          insertItem.run(
            catId,
            it.code || "",
            it.name,
            it.name_en || "",
            it.brand || "",
            it.model || "",
            it.unit || "وحدة",
            it.supply_cost || 0,
            it.install_cost || 0,
            "SAR",
            it.supplier || "",
            it.notes || ""
          );
        });
      });
    });
  });
  tx();
}

/* ==================== الاستعلامات ==================== */

function makeApi(db) {
  const R = (fn) => fn; // واجهة بسيطة

  /* ---------- الكتالوج ---------- */

  function listCatalog({ kind = "all", system = "all", search = "", categoryId = 0, activeOnly = true } = {}) {
    const where = [];
    const params = [];
    if (kind !== "all") { where.push("i.category_id IN (SELECT id FROM categories WHERE kind=?)"); params.push(kind); }
    if (system !== "all") { where.push("i.category_id IN (SELECT id FROM categories WHERE system=?)"); params.push(system); }
    if (activeOnly) { where.push("i.is_active=1"); }
    if (categoryId > 0) { where.push("i.category_id=?"); params.push(categoryId); }
    if (search && search.trim()) {
      where.push("(i.name LIKE ? OR i.name_en LIKE ? OR i.code LIKE ? OR i.brand LIKE ?)");
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }
    const sql = `
      SELECT i.*, c.name AS category_name, c.kind AS category_kind, c.system AS category_system
      FROM items i JOIN categories c ON c.id = i.category_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.sort, i.name`;
    return db.prepare(sql).all(...params);
  }

  function listCategories() {
    return db.prepare("SELECT * FROM categories ORDER BY kind, system, sort").all();
  }

  function getItem(id) {
    return db.prepare(`
      SELECT i.*, c.name AS category_name, c.kind AS category_kind, c.system AS category_system
      FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id=?`).get(id);
  }

  function addItem(data) {
    const code = (data.code && data.code.trim()) || autoCode(db, data);
    const res = db.prepare(`
      INSERT INTO items (category_id, code, name, name_en, brand, model, unit,
                         supply_cost, install_cost, currency, supplier, is_active, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      data.category_id, code, data.name, data.name_en || "", data.brand || "", data.model || "",
      data.unit || "وحدة", data.supply_cost || 0, data.install_cost || 0,
      data.currency || "SAR", data.supplier || "", data.is_active === 0 ? 0 : 1, data.notes || ""
    );
    recordPrice(db, res.lastInsertRowid, data.supply_cost || 0, data.install_cost || 0, "إضافة صنف");
    return getItem(res.lastInsertRowid);
  }

  function autoCode(db, data) {
    const cat = db.prepare("SELECT kind, system FROM categories WHERE id=?").get(data.category_id);
    const prefix = cat && cat.system === "fighting" ? "FGT" : cat && cat.kind === "equipment" ? "ALM" : "MAT";
    const n = db.prepare("SELECT COUNT(*) AS c FROM items WHERE code LIKE ?").get(prefix + "-%").c;
    return `${prefix}-${String(n + 1).padStart(3, "0")}`;
  }

  function updateItem(id, data, source) {
    const old = getItem(id);
    if (!old) throw new Error("الصنف غير موجود");
    db.prepare(`
      UPDATE items SET category_id=?, code=?, name=?, name_en=?, brand=?, model=?, unit=?,
        supply_cost=?, install_cost=?, currency=?, supplier=?, is_active=?, notes=?,
        updated_at=datetime('now','localtime')
      WHERE id=?`).run(
      data.category_id, data.code || old.code, data.name, data.name_en || "", data.brand || "",
      data.model || "", data.unit || "وحدة", data.supply_cost || 0, data.install_cost || 0,
      data.currency || "SAR", data.supplier || "", data.is_active === 0 ? 0 : 1, data.notes || "",
      id
    );
    // تسجيل تغير السعر في السجل عند اختلافه عن السابق
    if (num(data.supply_cost) !== num(old.supply_cost) || num(data.install_cost) !== num(old.install_cost)) {
      recordPrice(db, id, data.supply_cost || 0, data.install_cost || 0, source || "تعديل يدوي");
    }
    return getItem(id);
  }

  function recordPrice(db, itemId, supply, install, source) {
    db.prepare("INSERT INTO price_history (item_id, supply_cost, install_cost, source) VALUES (?,?,?,?)")
      .run(itemId, supply, install, source || "يدوي");
  }

  function getPriceHistory(itemId) {
    return db.prepare("SELECT * FROM price_history WHERE item_id=? ORDER BY changed_at DESC, id DESC").all(itemId);
  }

  function bulkUpdatePrices({ categoryId = 0, kind = "all", pct = 0, applyTo = "both", note = "" } = {}) {
    if (!pct) throw new Error("أدخل نسبة التحديث");
    const where = [];
    const params = [];
    if (categoryId > 0) { where.push("category_id=?"); params.push(categoryId); }
    if (kind !== "all") { where.push("category_id IN (SELECT id FROM categories WHERE kind=?)"); params.push(kind); }
    where.push("is_active=1");
    const items = db.prepare(`SELECT * FROM items WHERE ${where.join(" AND ")}`).all(...params);
    const factor = 1 + (pct / 100);
    const round2 = (n) => Math.round(n * factor * 100) / 100;
    const upd = db.prepare("UPDATE items SET supply_cost=?, install_cost=?, updated_at=datetime('now','localtime') WHERE id=?");
    const rec = db.prepare("INSERT INTO price_history (item_id, supply_cost, install_cost, source) VALUES (?,?,?,?)");
    const tx = db.transaction(() => {
      items.forEach(it => {
        const ns = (applyTo === "install") ? it.supply_cost : round2(it.supply_cost);
        const ni = (applyTo === "supply") ? it.install_cost : round2(it.install_cost);
        upd.run(ns, ni, it.id);
        rec.run(it.id, ns, ni, note || `تحديث شامل ${pct > 0 ? "+" : ""}${pct}%`);
      });
    });
    tx();
    return items.length;
  }

  /* ---------- العملاء ---------- */

  function listClients(search = "") {
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      return db.prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? OR city LIKE ? ORDER BY name").all(s, s, s);
    }
    return db.prepare("SELECT * FROM clients ORDER BY name").all();
  }

  function saveClient(data) {
    if (data.id) {
      db.prepare(`
        UPDATE clients SET name=?, phone=?, email=?, cr_number=?, city=?, notes=?
        WHERE id=?`).run(data.name, data.phone || "", data.email || "", data.cr_number || "",
        data.city || "", data.notes || "", data.id);
      return db.prepare("SELECT * FROM clients WHERE id=?").get(data.id);
    }
    const res = db.prepare(`
      INSERT INTO clients (name, phone, email, cr_number, city, notes) VALUES (?,?,?,?,?,?)`)
      .run(data.name, data.phone || "", data.email || "", data.cr_number || "", data.city || "", data.notes || "");
    return db.prepare("SELECT * FROM clients WHERE id=?").get(res.lastInsertRowid);
  }

  function deleteClient(id) {
    db.prepare("UPDATE projects SET client_id=NULL WHERE client_id=?").run(id);
    db.prepare("DELETE FROM clients WHERE id=?").run(id);
    return true;
  }

  /* ---------- المشاريع ---------- */

  function nextQuoteNo(db) {
  const y = new Date().getFullYear();
  const prefix = `Q-${y}-`;

  const row = db.prepare(`
    SELECT quote_no
    FROM projects
    WHERE quote_no LIKE ?
    ORDER BY CAST(SUBSTR(quote_no, ?) AS INTEGER) DESC
    LIMIT 1
  `).get(`${prefix}%`, prefix.length + 1);

  const lastSeq = row && row.quote_no
    ? parseInt(String(row.quote_no).slice(prefix.length), 10)
    : 0;

  const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

  function saveProject(p) {
    const itemSql = db.prepare(`
      INSERT INTO project_items (project_id, item_id, kind, name, qty, unit, supply_cost, install_cost,
                                 unit_cost, workers, days, daily_cost, service_type, service_value, sort, system)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertProject = db.prepare(`
      INSERT INTO projects (quote_no, client_id, name, location, date, area, floors, currency,
                            vat, validity, margins, status, total, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    let id = p.id || 0;
    const tx = db.transaction(() => {
      if (id) {
        db.prepare(`
          UPDATE projects SET client_id=?, name=?, location=?, date=?, area=?, floors=?, currency=?,
            vat=?, validity=?, margins=?, status=?, total=?, notes=?, updated_at=datetime('now','localtime')
          WHERE id=?`).run(
          p.clientId || null, p.name || "", p.location || "", p.date || "", p.area || 0, p.floors || 0,
          p.currency || "SAR", p.vat || 0, p.validity || 30, JSON.stringify(p.margins || {}),
          p.status || "draft", p.total || 0, p.notes || "", id
        );
        db.prepare("DELETE FROM project_items WHERE project_id=?").run(id);
      } else {
        const qn = p.quoteNo || nextQuoteNo(db);
        const res = insertProject.run(
          qn, p.clientId || null, p.name || "", p.location || "", p.date || "", p.area || 0, p.floors || 0,
          p.currency || "SAR", p.vat || 0, p.validity || 30, JSON.stringify(p.margins || {}),
          p.status || "draft", p.total || 0, p.notes || ""
        );
        id = res.lastInsertRowid;
      }
      (p.items || []).forEach((it, i) => {
        itemSql.run(id, it.itemId || null, it.kind, it.name || "", it.qty || 0, it.unit || "",
          it.supply_cost || 0, it.install_cost || 0, it.unit_cost || 0, it.workers || 0,
          it.days || 0, it.daily_cost || 0, it.service_type || "amount", it.service_value || 0, i, it.system || "");
      });
    });
    tx();
    const saved = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    return { id: saved.id, quoteNo: saved.quote_no };
  }

  function listProjects(search = "") {
    const sql = `
      SELECT pr.id, pr.quote_no, pr.name, pr.date, pr.status, pr.total, pr.updated_at,
             cl.name AS client_name, cl.city AS client_city
      FROM projects pr LEFT JOIN clients cl ON cl.id = pr.client_id
      ${search && search.trim() ? "WHERE pr.name LIKE ? OR pr.quote_no LIKE ? OR cl.name LIKE ?" : ""}
      ORDER BY pr.updated_at DESC, pr.id DESC`;
    const s = `%${search.trim()}%`;
    return db.prepare(sql).all(...(search && search.trim() ? [s, s, s] : []));
  }

  function getProject(id) {
    const p = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!p) return null;
    const items = db.prepare("SELECT * FROM project_items WHERE project_id=? ORDER BY sort").all(id);
    return {
      id: p.id, quoteNo: p.quote_no, clientId: p.client_id, name: p.name, location: p.location,
      date: p.date, area: p.area, floors: p.floors, currency: p.currency, vat: p.vat,
      validity: p.validity, margins: safeJson(p.margins), status: p.status, total: p.total,
      notes: p.notes, created_at: p.created_at, updated_at: p.updated_at,
      client: p.client_id ? db.prepare("SELECT * FROM clients WHERE id=?").get(p.client_id) : null,
      items
    };
  }

  function deleteProject(id) {
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    return true;
  }

  function importLegacy(projects) {
    let imported = 0;
    const tx = db.transaction(() => {
      projects.forEach(lp => {
        const p = lp.project || {};
        const items = [];
        (lp.equipment || []).forEach(e => items.push({
          kind: "equipment", name: e.name, qty: e.qty, unit: "وحدة",
          supply_cost: e.supplyCost, install_cost: e.installCost
        }));
        (lp.materials || []).forEach(m => items.push({
          kind: "material", name: m.name, qty: m.qty, unit: m.unit, unit_cost: m.unitCost
        }));
        (lp.labor || []).forEach(l => items.push({
          kind: "labor", name: l.name, workers: l.workers, days: l.days, daily_cost: l.dailyCost
        }));
        (lp.services || []).forEach(s => items.push({
          kind: "service", name: s.name, service_type: s.type, service_value: s.value
        }));
        const margins = lp.margins || { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 };
        saveProject({
          clientId: null, name: p.name || "مشروع مستورد", location: p.location || "",
          date: p.date || "", area: p.area || 0, floors: p.floors || 0,
          currency: p.currency || "SAR", vat: p.vat || 15, validity: p.validity || 30,
          margins, status: "draft", total: 0, notes: (p.notes ? p.notes + " | " : "") + "مستورد من النسخة السابقة",
          items
        });
        imported++;
      });
    });
    tx();
    return imported;
  }

  /* ==================== استيراد من قاعدة بيانات قديمة (ملف SQLite) ==================== */

  function importFromLegacyDb(oldPath) {
    if (!Database) return { error: "better-sqlite3 غير متوفر", clients: 0, projects: 0 };
    let old;
    try {
      old = new Database(oldPath, { readonly: true, fileMustExist: true });
    } catch (e) {
      return { error: "تعذر فتح القاعدة القديمة: " + e.message, clients: 0, projects: 0 };
    }
    try {
      const hasClients = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'").get();
      const hasProjects = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
      let clientsImported = 0, projectsImported = 0;

      const tx = db.transaction(() => {
        if (hasClients) {
          const clients = old.prepare("SELECT * FROM clients").all();
          const ins = db.prepare("INSERT INTO clients (name, phone, email, cr_number, city, notes) VALUES (?,?,?,?,?,?)");
          clients.forEach(c => {
            const dup = db.prepare("SELECT id FROM clients WHERE name=? COLLATE NOCASE").get(c.name);
            if (!dup) { ins.run(c.name, c.phone || "", c.email || "", c.cr_number || "", c.city || "", c.notes || ""); clientsImported++; }
          });
        }
        if (hasProjects) {
          const projects = old.prepare("SELECT * FROM projects").all();
          projects.forEach(p => {
            const dup = db.prepare("SELECT id FROM projects WHERE quote_no=?").get(p.quote_no);
            if (dup) return;
            const items = old.prepare("SELECT * FROM project_items WHERE project_id=? ORDER BY sort").all(p.id);
            const mapped = items.map(i => ({
              kind: i.kind, name: i.name, qty: i.qty, unit: i.unit,
              supply_cost: i.supply_cost, install_cost: i.install_cost,
              unit_cost: i.unit_cost, workers: i.workers, days: i.days,
              daily_cost: i.daily_cost, service_type: i.service_type, service_value: i.service_value,
              system: i.system || ""
            }));
            saveProject({
              quoteNo: p.quote_no, clientId: null, name: p.name || "", location: p.location || "",
              date: p.date || "", area: p.area || 0, floors: p.floors || 0,
              currency: p.currency || "SAR", vat: p.vat || 0, validity: p.validity || 30,
              margins: safeJson(p.margins), status: p.status || "draft",
              total: p.total || 0, notes: (p.notes || "") + (p.notes ? " | " : "") + "مستورد من قاعدة قديمة",
              items: mapped
            });
            projectsImported++;
          });
        }
      });
      tx();
      old.close();
      return { clients: clientsImported, projects: projectsImported };
    } catch (e) {
      try { old.close(); } catch (x) { /* ignore */ }
      return { error: e.message, clients: 0, projects: 0 };
    }
  }

  /* ==================== استيراد من ملف JSON احتياطي ==================== */

  function importFromJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: "الملف ليس JSON صالحاً: " + e.message, clients: 0, projects: 0 }; }

    // تنسيق 1: تصدير قاعدة كامل SQLite {version:2, projects, project_items, clients}
    if (Array.isArray(data.projects) && Array.isArray(data.project_items)) {
      let clientsImported = 0, projectsImported = 0;
      const tx = db.transaction(() => {
        (data.clients || []).forEach(c => {
          const dup = db.prepare("SELECT id FROM clients WHERE name=? COLLATE NOCASE").get(c.name);
          if (!dup) {
            db.prepare("INSERT INTO clients (name, phone, email, cr_number, city, notes) VALUES (?,?,?,?,?,?)")
              .run(c.name, c.phone || "", c.email || "", c.cr_number || "", c.city || "", c.notes || "");
            clientsImported++;
          }
        });
        data.projects.forEach(p => {
          const dup = db.prepare("SELECT id FROM projects WHERE quote_no=?").get(p.quote_no);
          if (dup) return;
          const items = data.project_items.filter(i => i.project_id === p.id).map(i => ({
            kind: i.kind, name: i.name, qty: i.qty, unit: i.unit,
            supply_cost: i.supply_cost, install_cost: i.install_cost,
            unit_cost: i.unit_cost, workers: i.workers, days: i.days,
            daily_cost: i.daily_cost, service_type: i.service_type, service_value: i.service_value,
            system: i.system || ""
          }));
          saveProject({
            quoteNo: p.quote_no, clientId: null, name: p.name || "", location: p.location || "",
            date: p.date || "", area: p.area || 0, floors: p.floors || 0,
            currency: p.currency || "SAR", vat: p.vat || 0, validity: p.validity || 30,
            margins: safeJson(p.margins), status: p.status || "draft",
            total: p.total || 0, notes: p.notes || "",
            items
          });
          projectsImported++;
        });
      });
      tx();
      return { clients: clientsImported, projects: projectsImported };
    }

    // تنسيق 2: تصدير وضع المتصفح {projects: [{quoteNo, name, items...}]}
    if (Array.isArray(data.projects)) {
      let projectsImported = 0;
      const tx = db.transaction(() => {
        data.projects.forEach(p => {
          const dup = db.prepare("SELECT id FROM projects WHERE quote_no=?").get(p.quoteNo);
          if (dup) return;
          const items = (p.items || []).map(it => ({
            kind: it.kind, name: it.name, qty: it.qty, unit: it.unit,
            supply_cost: it.supply_cost, install_cost: it.install_cost,
            unit_cost: it.unit_cost, workers: it.workers, days: it.days,
            daily_cost: it.daily_cost, service_type: it.service_type, service_value: it.service_value,
            system: it.system || ""
          }));
          saveProject({
            quoteNo: p.quoteNo, clientId: null, name: p.name || "", location: p.location || "",
            date: p.date || "", area: p.area || 0, floors: p.floors || 0,
            currency: p.currency || "SAR", vat: p.vat || 0, validity: p.validity || 30,
            margins: p.margins || {}, status: p.status || "draft",
            total: p.total || 0, notes: p.notes || "",
            items
          });
          projectsImported++;
        });
      });
      tx();
      return { clients: 0, projects: projectsImported };
    }

    // تنسيق 3: مشروع قديم واحد {project, equipment, materials, labor, services, margins}
    if (data.project) {
      const n = importLegacy([data]);
      return { clients: 0, projects: n };
    }

    return { error: "لا يمكن التعرف على محتوى الملف", clients: 0, projects: 0 };
  }

  /* ---------- إعدادات الشركة ---------- */

  function getSettings() {
    const row = db.prepare("SELECT data FROM settings WHERE id=1").get();
    try { return JSON.parse(row ? row.data : "{}"); } catch (e) { return {}; }
  }

  function saveSettings(data) {
  const current = getSettings();
  const merged = Object.assign({}, current, data || {});

  db.prepare(`
    INSERT INTO settings (id, data) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data
  `).run(JSON.stringify(merged));

  return merged;
}

  /* ---------- النسخ الاحتياطي والتصدير ---------- */

  function exportJson() {
    const dump = (t) => db.prepare(`SELECT * FROM ${t}`).all();
    return JSON.stringify({
      exported_at: new Date().toISOString(),
      version: 2,
      categories: dump("categories"),
      items: dump("items"),
      price_history: dump("price_history"),
      clients: dump("clients"),
      projects: dump("projects"),
      project_items: dump("project_items")
    }, null, 2);
  }

  function close() {
    try { db.close(); } catch (e) { /* ignore */ }
  }

  function safeJson(s) {
    try { return JSON.parse(s); } catch (e) { return {}; }
  }

  function num(n) { const v = parseFloat(n); return isNaN(v) ? 0 : v; }

  return {
    listCatalog, listCategories, getItem, addItem, updateItem,
    getPriceHistory, bulkUpdatePrices,
    listClients, saveClient, deleteClient,
    saveProject, listProjects, getProject, deleteProject, importLegacy,
    importFromLegacyDb, importFromJson,
    getSettings, saveSettings,
    exportJson, close,
    raw: db
  };
}

module.exports = { createDatabase, SCHEMA_VERSION };
