"use strict";
/*
 * ipc.js — معالجات الاتصال بين الواجهة وقاعدة البيانات (IPC)
 * كل قناة تُرجع { ok: true, data } أو { ok: false, error }
 */
const { ipcMain, dialog, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");

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
  handle("catalog:update", (p) => db.updateItem(p.id, p));
  handle("catalog:history", (p) => db.getPriceHistory(p.id));
  handle("catalog:bulkUpdate", (p) => db.bulkUpdatePrices(p || {}));

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
