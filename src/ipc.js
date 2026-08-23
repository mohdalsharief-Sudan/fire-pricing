"use strict";
/*
 * ipc.js — معالجات الاتصال بين الواجهة وقاعدة البيانات (IPC)
 * كل قناة تُرجع { ok: true, data } أو { ok: false, error }
 */
const { ipcMain, dialog, BrowserWindow, app, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { parseCsvText } = require("./csv.js");

const MAX_IMPORT_ROWS = 3000;
const PREVIEW_ROWS = 20;

/* تطبيع قيم الخلايا إلى أنواع أساسية قابلة للاستنساخ عبر IPC
   (exceljs يُرجع كائنات معقدة: تواريخ، روابط، richText، صيغ...) */
function normalizeCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : "";
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.text !== undefined && v.text !== null) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map(p => (p && p.text) || "").join("");
    if (v.error !== undefined) return String(v.error);
    if (v.hyperlink) return String(v.text != null ? v.text : v.hyperlink);
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return String(v);
}

function normalizeRow(row) {
  return (row || []).map(normalizeCell);
}

function ok(data) { return { ok: true, data }; }
function bad(err) { return { ok: false, error: String((err && err.message) || err) }; }

function registerIpc(db) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return ok(fn(payload, event));
      } catch (err) {
        console.error(`[IPC] ${channel} فشل:`, err);
        return bad(err);
      }
    });
  };

  /* ---------- الكتالوج ---------- */
  handle("catalog:list", (p) => db.listCatalog(p || {}));
  handle("catalog:categories", () => db.listCategories());
  handle("catalog:get", (p) => db.getItem(p.id));
  handle("catalog:add", (p) => db.addItem(p));
  handle("catalog:update", (p) => db.updateItem(p.id, p, p.source));
  handle("catalog:history", (p) => db.getPriceHistory(p.id));
  handle("catalog:bulkUpdate", (p) => db.bulkUpdatePrices(p || {}));

  /* ---------- استيراد أسعار من Excel / CSV ---------- */
  handle("catalog:excelOpen", async (p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: "اختر ملف الأسعار (Excel أو CSV)",
      filters: [{ name: "ملفات الأسعار", extensions: ["xlsx", "csv"] }],
      properties: ["openFile"]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const filePath = res.filePaths[0];
    try {
      if (path.extname(filePath).toLowerCase() === ".csv") {
        const rows = parseCsvText(fs.readFileSync(filePath, "utf8"));
        return { canceled: false, path: filePath, sheets: [{ name: "CSV", rows: rows.slice(0, PREVIEW_ROWS).map(normalizeRow) }] };
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const sheets = [];
      wb.worksheets.forEach(ws => {
        const rows = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          rows.push(normalizeRow(row.values.slice(1)));
          if (rows.length >= PREVIEW_ROWS) return;
        });
        sheets.push({ name: ws.name, rows: rows.slice(0, PREVIEW_ROWS) });
      });
      return { canceled: false, path: filePath, sheets };
    } catch (e) {
      return { canceled: false, error: "تعذر قراءة الملف: " + e.message, sheets: [] };
    }
  });

  handle("catalog:excelRead", async (p) => {
    try {
      const filePath = p.path;
      if (!filePath || !fs.existsSync(filePath)) return { rows: [] };
      if (path.extname(filePath).toLowerCase() === ".csv") {
        return { rows: parseCsvText(fs.readFileSync(filePath, "utf8")).slice(0, MAX_IMPORT_ROWS).map(normalizeRow) };
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[p.sheet || 0];
      if (!ws) return { rows: [] };
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        rows.push(normalizeRow(row.values.slice(1)));
        if (rows.length >= MAX_IMPORT_ROWS) return;
      });
      return { rows: rows.slice(0, MAX_IMPORT_ROWS) };
    } catch (e) {
      return { rows: [], error: e.message };
    }
  });

  /* ---------- العملاء ---------- */
  handle("clients:list", (p) => db.listClients((p && p.search) || ""));
  handle("clients:save", (p) => db.saveClient(p));
  handle("clients:delete", (p) => db.deleteClient(p.id));

  /* ---------- المشاريع ---------- */
  handle("projects:save", (p) => db.saveProject(p));
  handle("projects:list", (p) => db.listProjects((p && p.search) || ""));
  handle("projects:get", (p) => db.getProject(p.id));
  handle("projects:delete", (p) => db.deleteProject(p.id));
  handle("projects:importLegacy", (p) => db.importLegacy(p.projects || []));

  /* ---------- إعدادات الشركة ---------- */
  handle("settings:get", () => db.getSettings());
  handle("settings:save", (p) => db.saveSettings(p));

  /* ---------- استيراد واسترداد البيانات القديمة ---------- */
  handle("db:openDataFolder", () => {
    shell.openPath(app.getPath("userData"));
    return true;
  });

  handle("db:scanLegacy", () => {
    const userData = app.getPath("userData");
    const parent = path.dirname(userData);
    const names = [
      path.basename(userData),
      "نظام التسعير الذكي للحماية من الحرائق",
      "Electron",
      "fire-pricing"
    ];
    const found = [];
    names.forEach(n => {
      const p = path.join(parent, n, "fire-pricing.db");
      if (fs.existsSync(p)) {
        found.push({ path: p, name: n, isCurrent: p === path.join(userData, "fire-pricing.db") });
      }
    });
    return { current: path.join(userData, "fire-pricing.db"), found };
  });

  handle("db:importFromPath", (p) => db.importFromLegacyDb(p.path));

  handle("db:importJsonFile", async (p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: "اختر ملف النسخة الاحتياطية (JSON)",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const text = fs.readFileSync(res.filePaths[0], "utf8");
    return { canceled: false, result: db.importFromJson(text) };
  });

  /* ---------- النسخ الاحتياطي ---------- */
  handle("db:exportJson", async (p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: "حفظ النسخة الاحتياطية",
      defaultPath: `fire-pricing-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, db.exportJson(), "utf8");
    return { canceled: false, filePath: res.filePath };
  });

  /* ---------- تصدير Excel لعرض السعر ---------- */
  handle("project:exportExcel", async (p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: "حفظ عرض السعر Excel",
      defaultPath: `quote-${(p.quoteNo || "draft").replace(/\//g, "-")}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };

    const wb = new ExcelJS.Workbook();
    wb.creator = "نظام التسعير الذكي للحماية من الحرائق";
    wb.views = [{ rightToLeft: true }];

    const headStyle = { font: { bold: true, size: 12, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } }, alignment: { vertical: "middle", horizontal: "center" } };
    const sumStyle = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9F2F0" } } };
    const titleStyle = { font: { bold: true, size: 16, color: { argb: "FF0F766E" } }, alignment: { horizontal: "center" } };

    const addSheet = (name, headers, rows) => {
      const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
      ws.columns = headers.map(h => ({ header: h, width: h.length > 6 ? 34 : 16 }));
      ws.getRow(1).eachCell(c => { c.style = headStyle; });
      rows.forEach(r => ws.addRow(r));
      ws.getRow(1).height = 22;
      return ws;
    };

    const cur = (p.currencySymbol || "ر.س");
    const money = (n) => `${Math.round((n || 0) * 100) / 100} ${cur}`;

    // ورقة معلومات العرض
    const info = wb.addWorksheet("معلومات العرض", { views: [{ rightToLeft: true }] });
    info.columns = [{ width: 30 }, { width: 60 }];
    [["عرض سعر", ""], ["رقم العرض", p.quoteNo || "—"], ["المشروع", p.name || "—"],
     ["العميل", p.clientName || "—"], ["الموقع", p.location || "—"],
     ["التاريخ", p.date || "—"], ["صلاحية العرض", p.validity ? p.validity + " يوم" : "—"],
     ["الحالة", p.statusLabel || "—"], ["", ""]].forEach((r, i) => {
      const row = info.addRow(r);
      if (i === 0) row.getCell(1).style = titleStyle;
      else row.getCell(1).style = { font: { bold: true } };
    });

    // الأجهزة
    if ((p.equipment || []).length) {
      const ws = addSheet("الأجهزة والمعدات", ["م", "الجهاز", "الكمية", "توريد/وحدة", "تركيب/وحدة", "الإجمالي"],
        (p.equipment || []).map((e, i) => [i + 1, e.name, e.qty, e.supplyCost, e.installCost, e.qty * (e.supplyCost + e.installCost)]));
      ws.addRow(["", "إجمالي الأجهزة", "", "", "", p.totals ? p.totals.eqTotal : ""]).eachCell(c => c.style = sumStyle);
    }

    // المواد
    if ((p.materials || []).length) {
      const ws = addSheet("المواد", ["م", "المادة", "الكمية", "الوحدة", "تكلفة الوحدة", "الإجمالي"],
        (p.materials || []).map((m, i) => [i + 1, m.name, m.qty, m.unit, m.unitCost, m.qty * m.unitCost]));
      ws.addRow(["", "إجمالي المواد", "", "", "", p.totals ? p.totals.materialsTotal : ""]).eachCell(c => c.style = sumStyle);
    }

    // العمالة
    if ((p.labor || []).length) {
      const ws = addSheet("العمالة", ["م", "البند", "عدد العمال", "أيام", "التكلفة اليومية", "الإجمالي"],
        (p.labor || []).map((l, i) => [i + 1, l.name, l.workers, l.days, l.dailyCost, l.workers * l.days * l.dailyCost]));
      ws.addRow(["", "إجمالي العمالة", "", "", "", p.totals ? p.totals.laborTotal : ""]).eachCell(c => c.style = sumStyle);
    }

    // الخدمات
    if ((p.services || []).length) {
      const ws = addSheet("الخدمات", ["م", "الخدمة", "القيمة", "النوع", "الإجمالي"],
        (p.services || []).map((s, i) => [i + 1, s.name, s.value, s.type === "pct" ? "نسبة" : "مبلغ ثابت", s.amount]));
      ws.addRow(["", "إجمالي الخدمات", "", "", p.totals ? p.totals.servicesTotal : ""]).eachCell(c => c.style = sumStyle);
    }

    // ملخص الأسعار
    const sum = wb.addWorksheet("ملخص الأسعار", { views: [{ rightToLeft: true }] });
    sum.columns = [{ width: 40 }, { width: 25 }];
    const t = p.totals || {};
    [
      ["التكلفة الأساسية", money(t.baseCost)], ["النفقات العامة", money(t.overhead)],
      ["هامش الطوارئ", money(t.contingency)], ["هامش الربح", money(t.profit)],
      ["السعر قبل الضريبة", money(t.netPrice)],
      ...(t.discount ? [["الخصم التجاري", "-" + money(t.discount)], ["السعر بعد الخصم", money(t.afterDiscount)]] : []),
      ...(t.vat ? [["ضريبة القيمة المضافة", money(t.vat)]] : []),
      ["الإجمالي النهائي", money(t.grandTotal)]
    ].forEach((r, i, arr) => {
      const row = sum.addRow(r);
      row.getCell(1).style = { font: { bold: i === arr.length - 1 || i === 0 } };
      if (i === arr.length - 1) row.eachCell(c => { c.style = { font: { bold: true, size: 13, color: { argb: "FF0F766E" } } }; });
    });

    await wb.xlsx.writeFile(res.filePath);
    return { canceled: false, filePath: res.filePath };
  });

  return db;
}

module.exports = { registerIpc };
