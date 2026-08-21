"use strict";
/*
 * api.js — طبقة الوصول للبيانات
 * - في تطبيق سطح المكتب (Electron): تستخدم SQLite عبر window.fireApi
 * - في المتصفح: تستخدم localStorage (وضع احتياطي) مع نفس الواجهة
 * كل الدوال تعيد Promise
 */
window.FireAPI = (function () {
  const electronMode = !!(window.fireApi && typeof window.fireApi.catalog_list === "function");

  /* ============ وضع Electron (SQLite عبر IPC) ============ */
  if (electronMode) {
    const call = (name, payload) => window.fireApi[name](payload).then(res => {
      if (res && res.ok) return res.data;
      throw new Error((res && res.error) || "خطأ غير معروف");
    });
    return {
      mode: "sqlite",
      catalogList: (p) => call("catalog_list", p),
      catalogCategories: () => call("catalog_categories"),
      catalogGet: (id) => call("catalog_get", { id }),
      catalogAdd: (p) => call("catalog_add", p),
      catalogUpdate: (p) => call("catalog_update", p),
      catalogHistory: (id) => call("catalog_history", { id }),
      catalogBulkUpdate: (p) => call("catalog_bulkUpdate", p),
      clientsList: (search) => call("clients_list", { search }),
      clientsSave: (p) => call("clients_save", p),
      clientsDelete: (id) => call("clients_delete", { id }),
      projectsSave: (p) => call("projects_save", p),
      projectsList: (search) => call("projects_list", { search }),
      projectsGet: (id) => call("projects_get", { id }),
      projectsDelete: (id) => call("projects_delete", { id }),
      projectsImportLegacy: (projects) => call("projects_importLegacy", { projects }),
      exportBackup: () => call("db_exportJson"),
      exportExcel: (p) => call("project_exportExcel", p),
      settingsGet: () => call("settings_get"),
      settingsSave: (p) => call("settings_save", p),
      openDataFolder: () => call("db_openDataFolder"),
      scanLegacy: () => call("db_scanLegacy"),
      importFromPath: (p) => call("db_importFromPath", p),
      importJsonFile: () => call("db_importJsonFile")
    };
  }

  /* ============ وضع المتصفح (localStorage) ============ */
  const K_CAT = "fp_catalog_v2";
  const K_CLI = "fp_clients_v2";
  const K_PROJ = "fp_projects_v2";
  const K_PH = "fp_pricehistory_v2";
  const K_SET = "fp_settings_v2";

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  };

  function seedCatalog() {
    const items = [];
    let seq = 1;
    const libs = [
      { groups: EQUIPMENT_LIBRARY.alarm.groups, kind: "equipment", system: "alarm", prefix: "ALM" },
      { groups: EQUIPMENT_LIBRARY.fighting.groups, kind: "equipment", system: "fighting", prefix: "FGT" },
      { groups: MATERIALS_LIBRARY.groups, kind: "material", system: "", prefix: "MAT" }
    ];
    libs.forEach(({ groups, kind, system, prefix }) => {
      if (!groups) return;
      Object.keys(groups).forEach(gName => {
        groups[gName].forEach(it => {
          items.push({
            id: seq, category_id: 0, category_name: gName, category_kind: kind, category_system: system,
            code: `${prefix}-${String(seq++).padStart(3, "0")}`,
            name: it.name, name_en: "", brand: "", model: "",
            unit: it.unit || "وحدة", supply_cost: it.supply || 0, install_cost: it.install || 0,
            currency: "SAR", supplier: "", is_active: 1, notes: ""
          });
        });
      });
    });
    ls.set(K_CAT, items);
    return items;
  }

  function catalog() {
    let items = ls.get(K_CAT);
    if (!items || !items.length) items = seedCatalog();
    return items;
  }

  function filterItems(p) {
    p = p || {};
    let items = catalog();
    if (p.kind && p.kind !== "all") items = items.filter(i => i.category_kind === p.kind);
    if (p.system && p.system !== "all") items = items.filter(i => i.category_system === p.system);
    if (p.categoryId > 0) items = items.filter(i => i.category_id === p.categoryId);
    if (p.activeOnly !== false) items = items.filter(i => i.is_active);
    if (p.search && p.search.trim()) {
      const s = p.search.trim();
      items = items.filter(i => (i.name || "").includes(s) || (i.name_en || "").includes(s) || (i.code || "").includes(s) || (i.brand || "").includes(s));
    }
    return items;
  }

  const delay = (v) => Promise.resolve(v);

  return {
    mode: "local",
    catalogList: (p) => delay(filterItems(p)),
    catalogCategories: () => {
      const seen = {};
      catalog().forEach(i => {
        if (!seen[i.category_name]) seen[i.category_name] = { id: i.category_id || Object.keys(seen).length + 1, name: i.category_name, kind: i.category_kind, system: i.category_system };
      });
      return delay(Object.values(seen));
    },
    catalogGet: (id) => delay(catalog().find(i => i.id === id) || null),
    catalogAdd: (p) => {
      const items = catalog();
      const id = items.length ? Math.max(...items.map(i => i.id)) + 1 : 1;
      const it = {
        id, category_id: 0, category_name: p.category_name || "غير مصنف", category_kind: p.category_kind || "material",
        category_system: p.system || "", code: p.code || `MAT-${String(id).padStart(3, "0")}`,
        name: p.name, name_en: p.name_en || "", brand: p.brand || "", model: p.model || "",
        unit: p.unit || "وحدة", supply_cost: p.supply_cost || 0, install_cost: p.install_cost || 0,
        currency: "SAR", supplier: p.supplier || "", is_active: 1, notes: p.notes || ""
      };
      items.push(it);
      ls.set(K_CAT, items);
      recordPh(it.id, it.supply_cost, it.install_cost, "إضافة صنف");
      return delay(it);
    },
    catalogUpdate: (p) => {
      const items = catalog();
      const idx = items.findIndex(i => i.id === p.id);
      if (idx < 0) throw new Error("الصنف غير موجود");
      const old = items[idx];
      const merged = Object.assign({}, old, p);
      const changed = old.supply_cost !== merged.supply_cost || old.install_cost !== merged.install_cost;
      items[idx] = merged;
      ls.set(K_CAT, items);
      if (changed) recordPh(merged.id, merged.supply_cost, merged.install_cost, "تعديل يدوي");
      return delay(merged);
    },
    catalogHistory: (id) => {
      const map = ls.get(K_PH) || {};
      return delay((map[id] || []).slice().reverse());
    },
    catalogBulkUpdate: (p) => {
      const items = filterItems({ kind: p.kind || "all", categoryId: p.categoryId || 0 });
      const factor = 1 + ((p.pct || 0) / 100);
      const r2 = (n) => Math.round(n * factor * 100) / 100;
      const all = catalog();
      let count = 0;
      items.forEach(it => {
        const target = all.find(x => x.id === it.id);
        if (!target) return;
        if (p.applyTo !== "install") target.supply_cost = r2(target.supply_cost);
        if (p.applyTo !== "supply") target.install_cost = r2(target.install_cost);
        recordPh(target.id, target.supply_cost, target.install_cost, p.note || `تحديث شامل ${p.pct > 0 ? "+" : ""}${p.pct}%`);
        count++;
      });
      ls.set(K_CAT, all);
      return delay(count);
    },
    clientsList: (search) => {
      let list = ls.get(K_CLI) || [];
      if (search && search.trim()) list = list.filter(c => (c.name || "").includes(search) || (c.phone || "").includes(search));
      return delay(list);
    },
    clientsSave: (p) => {
      const list = ls.get(K_CLI) || [];
      if (p.id) {
        const idx = list.findIndex(c => c.id === p.id);
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], p);
      } else {
        p.id = list.length ? Math.max(...list.map(c => c.id)) + 1 : 1;
        list.push(p);
      }
      ls.set(K_CLI, list);
      return delay(p);
    },
    clientsDelete: (id) => {
      ls.set(K_CLI, (ls.get(K_CLI) || []).filter(c => c.id !== id));
      return delay(true);
    },
    projectsSave: (p) => {
      const list = ls.get(K_PROJ) || [];
      if (p.id) {
        const idx = list.findIndex(x => x.id === p.id);
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], p, { updated_at: new Date().toISOString() });
      } else {
        const year = new Date().getFullYear();
        const seq = list.filter(x => (x.quoteNo || "").startsWith(`Q-${year}-`)).length + 1;
        p.id = list.length ? Math.max(...list.map(x => x.id)) + 1 : 1;
        p.quoteNo = `Q-${year}-${String(seq).padStart(4, "0")}`;
        p.created_at = new Date().toISOString();
        p.updated_at = p.created_at;
        list.push(p);
      }
      ls.set(K_PROJ, list);
      return delay({ id: p.id, quoteNo: p.quoteNo });
    },
    projectsList: (search) => {
      let list = ls.get(K_PROJ) || [];
      if (search && search.trim()) {
        const s = search.trim();
        list = list.filter(x => (x.name || "").includes(s) || (x.quoteNo || "").includes(s));
      }
      return delay(list.slice().sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).map(x => ({
        id: x.id, quote_no: x.quoteNo, name: x.name, date: x.date, status: x.status,
        total: x.total, updated_at: x.updated_at, client_name: x.clientName || ""
      })));
    },
    projectsGet: (id) => {
      const x = (ls.get(K_PROJ) || []).find(p => p.id === id);
      if (!x) return delay(null);
      const items = (x.items || []).map(it => {
        const base = { id: it.id, project_id: id, item_id: it.itemId || null, kind: it.kind, name: it.name, qty: it.qty, unit: it.unit, sort: it.sort || 0 };
        if (it.kind === "equipment") return Object.assign(base, { supply_cost: it.supply_cost, install_cost: it.install_cost });
        if (it.kind === "material") return Object.assign(base, { unit_cost: it.unit_cost });
        if (it.kind === "labor") return Object.assign(base, { workers: it.workers, days: it.days, daily_cost: it.daily_cost });
        return Object.assign(base, { service_type: it.service_type, service_value: it.service_value });
      });
      return delay(Object.assign({}, x, {
        quote_no: x.quoteNo, client_id: x.clientId, margins: x.margins || {},
        client: x.clientName ? { name: x.clientName, city: x.clientCity } : null, items
      }));
    },
    projectsDelete: (id) => {
      ls.set(K_PROJ, (ls.get(K_PROJ) || []).filter(x => x.id !== id));
      return delay(true);
    },
    projectsImportLegacy: (projects) => {
      const list = ls.get(K_PROJ) || [];
      projects.forEach(lp => {
        const p = lp.project || {};
        const items = [
          ...(lp.equipment || []).map(e => ({ kind: "equipment", name: e.name, qty: e.qty, supply_cost: e.supplyCost, install_cost: e.installCost })),
          ...(lp.materials || []).map(m => ({ kind: "material", name: m.name, qty: m.qty, unit: m.unit, unit_cost: m.unitCost })),
          ...(lp.labor || []).map(l => ({ kind: "labor", name: l.name, workers: l.workers, days: l.days, daily_cost: l.dailyCost })),
          ...(lp.services || []).map(s => ({ kind: "service", name: s.name, service_type: s.type, service_value: s.value }))
        ];
        const year = new Date().getFullYear();
        const seq = list.filter(x => (x.quoteNo || "").startsWith(`Q-${year}-`)).length + 1;
        list.push({
          id: list.length ? Math.max(...list.map(x => x.id)) + 1 : 1,
          quoteNo: `Q-${year}-${String(seq).padStart(4, "0")}`,
          name: p.name || "مشروع مستورد", location: p.location || "", date: p.date || "",
          area: p.area || 0, floors: p.floors || 0, currency: p.currency || "SAR",
          vat: p.vat || 15, validity: p.validity || 30, margins: lp.margins || {},
          status: "draft", total: 0, notes: (p.notes ? p.notes + " | " : "") + "مستورد من النسخة السابقة",
          items, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        });
      });
      ls.set(K_PROJ, list);
      return delay(projects.length);
    },
    settingsGet: () => delay(ls.get(K_SET) || {}),
    settingsSave: (p) => { ls.set(K_SET, p || {}); return delay(p || {}); },
    openDataFolder: () => delay({ current: "وضع المتصفح" }),
    scanLegacy: () => delay({ current: "", found: [] }),
    importFromPath: () => delay({ error: "متاح فقط في وضع سطح المكتب", clients: 0, projects: 0 }),
    importJsonFile: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      return new Promise(resolve => {
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) { resolve({ canceled: true }); return; }
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const data = JSON.parse(reader.result);
              let projects = [];
              let clients = [];
              if (Array.isArray(data.projects)) {
                projects = data.projects;
                clients = data.clients || [];
              } else if (data.project) {
                projects = [data];
              } else {
                resolve({ canceled: false, result: { error: "لا يمكن التعرف على محتوى الملف", clients: 0, projects: 0 } });
                return;
              }
              // حفظ العملاء
              for (const c of clients) { if (c && c.name) await window.FireAPI.clientsSave(c); }
              // حفظ المشاريع
              let imported = 0;
              for (const p of projects) {
                const year = new Date().getFullYear();
                const list = ls.get(K_PROJ) || [];
                const qn = p.quoteNo || p.quote_no || `Q-${year}-${String(list.length + 1).padStart(4, "0")}`;
                if (list.some(x => x.quoteNo === qn)) continue;
                const items = (p.items || []).map(it => ({
                  kind: it.kind, name: it.name, qty: it.qty, unit: it.unit,
                  supply_cost: it.supply_cost, install_cost: it.install_cost,
                  unit_cost: it.unit_cost, workers: it.workers, days: it.days,
                  daily_cost: it.daily_cost, service_type: it.service_type, service_value: it.service_value,
                  system: it.system || ""
                }));
                await window.FireAPI.projectsSave({
                  id: null, quoteNo: qn, clientId: null, clientName: p.clientName || "",
                  name: p.name || "مشروع مستورد", location: p.location || "", date: p.date || "",
                  area: p.area || 0, floors: p.floors || 0, currency: p.currency || "SAR",
                  vat: p.vat || 15, validity: p.validity || 30, margins: p.margins || {},
                  status: p.status || "draft", total: p.total || 0, notes: p.notes || "", items
                });
                imported++;
              }
              resolve({ canceled: false, result: { clients: clients.length, projects: imported } });
            } catch (e) {
              resolve({ canceled: false, result: { error: e.message, clients: 0, projects: 0 } });
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    },
    exportBackup: () => {
      const data = JSON.stringify({
        exported_at: new Date().toISOString(), version: 2, mode: "local",
        catalog: catalog(), clients: ls.get(K_CLI) || [], projects: ls.get(K_PROJ) || []
      }, null, 2);
      downloadFile(data, `fire-pricing-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
      return delay({ canceled: false });
    },
    exportExcel: (p) => {
      // في المتصفح: تصدير CSV مفصول بفاصلة منقوطة (متوافق مع Excel العربي)
      const rows = [];
      rows.push(["عرض سعر", p.name || ""]);
      rows.push(["رقم العرض", p.quoteNo || "—"]);
      rows.push(["العميل", p.clientName || "—"]);
      rows.push(["الموقع", p.location || "—"]);
      rows.push(["التاريخ", p.date || "—"]);
      rows.push([]);
      (p.equipment || []).forEach((e, i) => rows.push([`جهاز ${i + 1}`, e.name, "كمية: " + e.qty, "توريد: " + e.supplyCost, "تركيب: " + e.installCost, "إجمالي: " + (e.qty * (e.supplyCost + e.installCost))]));
      rows.push([]);
      (p.materials || []).forEach((m, i) => rows.push([`مادة ${i + 1}`, m.name, "كمية: " + m.qty + " " + m.unit, "تكلفة: " + m.unitCost, "", "إجمالي: " + (m.qty * m.unitCost)]));
      rows.push([]);
      (p.labor || []).forEach((l, i) => rows.push([`عمالة ${i + 1}`, l.name, l.workers + " × " + l.days + " يوم", "يومية: " + l.dailyCost, "", "إجمالي: " + (l.workers * l.days * l.dailyCost)]));
      rows.push([]);
      (p.services || []).forEach((s, i) => rows.push([`خدمة ${i + 1}`, s.name, s.value, s.type === "pct" ? "نسبة" : "مبلغ", "", "إجمالي: " + s.amount]));
      rows.push([]);
      const t = p.totals || {};
      rows.push(["التكلفة الأساسية", t.baseCost]);
      rows.push(["النفقات العامة", t.overhead]);
      rows.push(["هامش الطوارئ", t.contingency]);
      rows.push(["هامش الربح", t.profit]);
      rows.push(["السعر قبل الضريبة", t.netPrice]);
      if (t.discount) rows.push(["الخصم", "-" + t.discount]);
      if (t.vat) rows.push(["ضريبة القيمة المضافة", t.vat]);
      rows.push(["الإجمالي النهائي", t.grandTotal]);
      const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      downloadFile(csv, `quote-${(p.quoteNo || "draft").replace(/\//g, "-")}.csv`, "text/csv;charset=utf-8");
      return delay({ canceled: false });
    }
  };

  function recordPh(itemId, supply, install, source) {
    const map = ls.get(K_PH) || {};
    (map[itemId] = map[itemId] || []).push({
      id: Date.now(), item_id: itemId, supply_cost: supply, install_cost: install,
      source, changed_at: new Date().toLocaleString("ar-EG")
    });
    ls.set(K_PH, map);
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
})();
