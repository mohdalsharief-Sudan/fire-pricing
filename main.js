const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let db = null;
let dbReady = false;
let dbPath = "";

/* المسارات البديلة لقاعدة البيانات (نسخ مثبتة قديمة بأسماء مختلفة) */
function legacyDbCandidates() {
  const userData = app.getPath("userData");
  const parent = path.dirname(userData);
  return [
    path.join(parent, "نظام التسعير الذكي للحماية من الحرائق", "fire-pricing.db"),
    path.join(parent, "Electron", "fire-pricing.db"),
    path.join(parent, "fire-pricing", "fire-pricing.db")
  ].filter(p => p !== dbPath);
}

function initDatabase() {
  try {
    const { createDatabase } = require("./src/db/database.js");
    dbPath = path.join(app.getPath("userData"), "fire-pricing.db");

    /* إن لم توجد القاعدة الأساسية ووجدت قاعدة قديمة في مسار آخر — انسخها تلقائياً */
    if (!fs.existsSync(dbPath)) {
      const legacy = legacyDbCandidates().find(p => fs.existsSync(p));
      if (legacy) {
        try {
          fs.copyFileSync(legacy, dbPath);
          console.log(`[DB] تم استيراد قاعدة البيانات القديمة تلقائياً من: ${legacy}`);
        } catch (e) {
          console.error("[DB] فشل نسخ القاعدة القديمة:", e.message);
        }
      }
    }

    db = createDatabase(dbPath);
    dbReady = true;
    console.log(`[DB] قاعدة البيانات جاهزة: ${dbPath}`);
  } catch (err) {
    // الوضع الاحتياطي: يعمل التطبيق بالطريقة القديمة (localStorage) دون تعطل
    dbReady = false;
    console.error("[DB] تعذر فتح قاعدة البيانات — سيتم العمل بالوضع الاحتياطي:", err.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0f1626",
    icon: path.join(__dirname, "icons", "app.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadFile("index.html");
  win.webContents.on("did-fail-load", (e, code, desc) => {
    if (code === -3) return;
    dialog.showErrorBox("خطأ في التحميل", desc);
  });
  return win;
}

function buildMenu(win) {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";

  const viewSubmenu = [
    { label: "تكبير", role: "zoomIn" },
    { label: "تصغير", role: "zoomOut" },
    { type: "separator" },
    { label: "ملء الشاشة", role: "togglefullscreen" }
  ];

  if (isDev) {
    viewSubmenu.push(
      { type: "separator" },
      { label: "أدوات المطور", role: "toggleDevTools" }
    );
  }

  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "ملف",
      submenu: [
        {
          label: "طباعة عرض السعر",
          accelerator: "CmdOrCtrl+P",
          click: () => win.webContents.print({ silent: false })
        },
        { type: "separator" },
        { label: "إغلاق", role: "quit" }
      ]
    },
    {
      label: "عرض",
      submenu: viewSubmenu
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  initDatabase();
  const win = createWindow();
  buildMenu(win);

  if (dbReady) {
    try {
      const { registerIpc } = require("./src/ipc.js");
      registerIpc(db);
    } catch (err) {
      console.error("[IPC] تعذر تسجيل المعالجات:", err.message);
      dbReady = false;
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      buildMenu(w);
    }
  });
});

app.on("window-all-closed", () => {
  if (db && typeof db.close === "function") {
    try { db.close(); } catch (e) { /* ignore */ }
  }
  if (process.platform !== "darwin") app.quit();
});
