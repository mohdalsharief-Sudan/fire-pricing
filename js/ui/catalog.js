/* ================= الكتالوج والمكتبة ================= */

async function refreshCatalog() {
  try {
    const [items, cats] = await Promise.all([API.catalogList({}), API.catalogCategories()]);
    CATALOG = items;
    CATEGORIES = cats;
  } catch (e) {
    toast("تعذر تحميل الكتالوج: " + e.message);
  }
}

async function renderCatalog() {
  const body = document.getElementById("catBody");
  const kind = document.getElementById("catKind").value;
  const system = document.getElementById("catSystem").value;
  const catId = parseInt(document.getElementById("catCategory").value) || 0;
  const search = document.getElementById("catSearch").value.trim();
  body.innerHTML = `<tr><td colspan="8" class="hint">جارٍ التحميل...</td></tr>`;
  try {
    const items = await API.catalogList({ kind, system, categoryId: catId, search, activeOnly: false });
    body.innerHTML = "";
    items.forEach((it, i) => {
      const tr = document.createElement("tr");
      if (!it.is_active) tr.classList.add("row-muted");
      tr.innerHTML = `
        <td><span class="lib-code">${esc(it.code)}</span></td>
        <td>
          <div class="cat-name">${esc(it.name)}</div>
          ${it.brand ? `<div class="cat-sub">${esc(it.brand)}${it.model ? " / " + esc(it.model) : ""}</div>` : ""}
        </td>
        <td>${esc(it.category_name)}</td>
        <td>${esc(it.unit)}</td>
        <td class="num">${it.supply_cost ? money(it.supply_cost) : "—"}</td>
        <td class="num">${it.install_cost ? money(it.install_cost) : "—"}</td>
        <td>${it.is_active ? `<span class="status-badge s-active">نشط</span>` : `<span class="status-badge s-lost">متوقف</span>`}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-hist="${it.id}" title="سجل الأسعار">📈</button>
          <button class="btn btn-secondary btn-sm" data-edit="${it.id}" title="تعديل">✏️</button>
          <button class="btn-danger btn-sm" data-toggle="${it.id}" title="${it.is_active ? "إيقاف" : "تفعيل"}">${it.is_active ? "⏸" : "▶"}</button>
        </td>`;
      body.appendChild(tr);
    });
    if (!items.length) body.innerHTML = `<tr><td colspan="8" class="hint">لا توجد أصناف مطابقة</td></tr>`;
    document.getElementById("catCount").textContent = `إجمالي المعروض: ${items.length} صنف`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="hint">تعذر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

function fillCatCategorySelect(kind) {
  const sel = document.getElementById("catCategory");
  const prev = sel.value;
  let cats = CATEGORIES;
  if (kind !== "all") cats = cats.filter(c => c.kind === kind);
  sel.innerHTML = `<option value="0">كل الفئات</option>` + cats.map(c => `<option value="${c.id}" ${String(c.id) === prev ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

on("catKind", "change", e => {
  fillCatCategorySelect(e.target.value);
  renderCatalog();
});
on("catSystem", "change", renderCatalog);
on("catCategory", "change", renderCatalog);
on("catSearch", "input", () => {
  clearTimeout(window.__catSearchT);
  window.__catSearchT = setTimeout(renderCatalog, 300);
});
on("catBody", "click", e => {
  const hist = e.target.closest("[data-hist]");
  if (hist) { openHistory(parseInt(hist.dataset.hist)); return; }
  const edit = e.target.closest("[data-edit]");
  if (edit) { openItemEditor(parseInt(edit.dataset.edit)); return; }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) { toggleItem(parseInt(toggle.dataset.toggle)); }
});

/* --- محرر الصنف --- */

const itemModal = document.getElementById("itemModal");

function openItemEditor(id) {
  editingItemId = id || null;
  document.getElementById("itemModalTitle").textContent = id ? "تعديل صنف" : "إضافة صنف جديد";
  const form = { name: "", name_en: "", code: "", brand: "", model: "", unit: "وحدة", supply_cost: 0, install_cost: 0, supplier: "", notes: "", is_active: 1, category_name: "" };
  if (id) {
    const it = CATALOG.find(x => x.id === id);
    if (it) Object.assign(form, it);
  }
  const kind = id ? (CATALOG.find(x => x.id === id) || {}).category_kind : document.getElementById("catKind").value;
  const cats = CATEGORIES.filter(c => c.kind === (kind === "all" ? "material" : kind));
  document.getElementById("itCategory").innerHTML = cats.map(c =>
    `<option value="${esc(c.name)}" ${c.name === form.category_name ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  document.getElementById("itName").value = form.name;
  document.getElementById("itNameEn").value = form.name_en || "";
  document.getElementById("itCode").value = form.code || "";
  document.getElementById("itBrand").value = form.brand || "";
  document.getElementById("itModel").value = form.model || "";
  document.getElementById("itUnit").value = form.unit || "وحدة";
  document.getElementById("itSupply").value = form.supply_cost || 0;
  document.getElementById("itInstall").value = form.install_cost || 0;
  document.getElementById("itSupplier").value = form.supplier || "";
  document.getElementById("itNotes").value = form.notes || "";
  document.getElementById("itActive").checked = form.is_active !== 0;
  document.getElementById("itCode").disabled = !!id;
  itemModal.classList.add("show");
}

on("itemSave", "click", async () => {
  const name = document.getElementById("itName").value.trim();
  if (!name) { toast("أدخل اسم الصنف"); return; }
  const categoryName = document.getElementById("itCategory").value;
  const cat = CATEGORIES.find(c => c.name === categoryName);
  const payload = {
    id: editingItemId, category_id: cat ? cat.id : 0, category_name: categoryName,
    category_kind: cat ? cat.kind : "material",
    name, name_en: document.getElementById("itNameEn").value,
    code: document.getElementById("itCode").value,
    brand: document.getElementById("itBrand").value,
    model: document.getElementById("itModel").value,
    unit: document.getElementById("itUnit").value || "وحدة",
    supply_cost: num(document.getElementById("itSupply").value),
    install_cost: num(document.getElementById("itInstall").value),
    supplier: document.getElementById("itSupplier").value,
    notes: document.getElementById("itNotes").value,
    is_active: document.getElementById("itActive").checked ? 1 : 0
  };
  try {
    if (editingItemId) await API.catalogUpdate(payload);
    else await API.catalogAdd(payload);
    toast(editingItemId ? "تم تحديث الصنف" : "تمت إضافة الصنف");
    itemModal.classList.remove("show");
    await refreshCatalog();
    renderCatalog();
  } catch (e) {
    toast("فشل الحفظ: " + e.message);
  }
});

on("itemClose", "click", () => itemModal.classList.remove("show"));
itemModal.addEventListener("click", e => { if (e.target === itemModal) itemModal.classList.remove("show"); });

on("btnAddCatalogItem", "click", () => openItemEditor(null));

async function toggleItem(id) {
  const it = CATALOG.find(x => x.id === id);
  if (!it) return;
  await API.catalogUpdate(Object.assign({}, it, { is_active: it.is_active ? 0 : 1 }));
  await refreshCatalog();
  renderCatalog();
}

/* --- سجل الأسعار --- */

const historyModal = document.getElementById("historyModal");

async function openHistory(id) {
  const it = CATALOG.find(x => x.id === id);
  document.getElementById("historyTitle").textContent = `سجل أسعار: ${it ? it.name : ""}`;
  const body = document.getElementById("historyBody");
  body.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  historyModal.classList.add("show");
  try {
    const rows = await API.catalogHistory(id);
    if (!rows.length) {
      body.innerHTML = `<p class="hint">لا يوجد سجل أسعار لهذا الصنف بعد.</p>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <div class="hist-row">
        <div><strong>${money(r.supply_cost)}</strong> توريد ${r.install_cost ? "| تركيب " + money(r.install_cost) : ""}</div>
        <div class="proj-meta">${esc(r.source || "")} — ${esc(r.changed_at || "")}</div>
      </div>`).join("");
  } catch (e) {
    body.innerHTML = `<p class="hint">تعذر التحميل: ${esc(e.message)}</p>`;
  }
}

on("historyClose", "click", () => historyModal.classList.remove("show"));
historyModal.addEventListener("click", e => { if (e.target === historyModal) historyModal.classList.remove("show"); });

/* --- تحديث أسعار شامل --- */

const bulkModal = document.getElementById("bulkModal");

on("btnBulkUpdate", "click", () => {
  const kind = document.getElementById("catKind").value;
  document.getElementById("bulkKind").value = kind;
  fillBulkCategories(kind);
  document.getElementById("bulkPct").value = "";
  document.getElementById("bulkNote").value = "";
  bulkModal.classList.add("show");
});

function fillBulkCategories(kind) {
  const sel = document.getElementById("bulkCategory");
  let cats = CATEGORIES;
  if (kind !== "all") cats = cats.filter(c => c.kind === kind);
  sel.innerHTML = `<option value="0">كل الفئات</option>` + cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}

on("bulkKind", "change", e => fillBulkCategories(e.target.value));

on("bulkRun", "click", async () => {
  const pct = num(document.getElementById("bulkPct").value);
  if (!pct) { toast("أدخل نسبة التحديث (يمكن أن تكون سالبة)!"); return; }
  const payload = {
    kind: document.getElementById("bulkKind").value,
    categoryId: parseInt(document.getElementById("bulkCategory").value) || 0,
    pct, applyTo: document.getElementById("bulkApplyTo").value,
    note: document.getElementById("bulkNote").value.trim() || `تحديث شامل ${pct > 0 ? "+" : ""}${pct}%`
  };
  try {
    const n = await API.catalogBulkUpdate(payload);
    toast(`تم تحديث أسعار ${n} صنف بنسبة ${pct}% — وسُجل التغيير في سجل الأسعار`);
    bulkModal.classList.remove("show");
    await refreshCatalog();
    renderCatalog();
  } catch (e) {
    toast("فشل التحديث: " + e.message);
  }
});

on("bulkClose", "click", () => bulkModal.classList.remove("show"));
bulkModal.addEventListener("click", e => { if (e.target === bulkModal) bulkModal.classList.remove("show"); });

/* ================= استيراد أسعار من Excel / CSV ================= */

let importState = { path: "", sheets: [], sheet: 0, rows: [], headerRow: [] };

function openImportModal() {
  importState = { path: "", sheets: [], sheet: 0, rows: [], headerRow: [] };
  document.getElementById("importFileName").textContent = "";
  document.getElementById("importError").style.display = "none";
  document.getElementById("importError").textContent = "";
  document.getElementById("importMapping").style.display = "none";
  document.getElementById("importResult").innerHTML = "";
  document.getElementById("importProgress").textContent = "";
  document.getElementById("importModal").classList.add("show");
}

function importError(msg) {
  const el = document.getElementById("importError");
  el.textContent = msg;
  el.style.display = "block";
}

function fillImportColumns() {
  const header = importState.headerRow;
  const n = header.length;
  const opt = (label, i) => `<option value="${i}">${esc(String(label || "")) || "عمود " + (i + 1)}</option>`;
  const emptyOpt = '<option value="-1">— لا شيء —</option>';
  const nameOpts = header.map((h, i) => opt(h, i)).join("");
  const otherOpts = emptyOpt + header.map((h, i) => opt(h, i)).join("");
  document.getElementById("importColName").innerHTML = nameOpts;
  document.getElementById("importColPrice").innerHTML = nameOpts;
  document.getElementById("importColUnit").innerHTML = otherOpts;
  document.getElementById("importColCode").innerHTML = otherOpts;
  /* افتراضيات ذكية: السعر غالباً العمود رقم 2 */
  if (n >= 2) document.getElementById("importColPrice").value = "1";
}

function renderImportPreview() {
  const body = document.getElementById("importPreview");
  const rows = importState.sheets[importState.sheet] ? importState.sheets[importState.sheet].rows : [];
  body.innerHTML = "";
  rows.slice(0, 8).forEach((r, ri) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" style="font-size:12px;font-family:Consolas,monospace;direction:ltr;text-align:left">${esc(r.join(" | "))}</td>`;
    body.appendChild(tr);
  });
  if (!rows.length) body.innerHTML = `<tr><td colspan="6" class="hint">لا توجد صفوف</td></tr>`;
}

function fillImportCategories() {
  const sel = document.getElementById("importCategory");
  const mats = CATEGORIES.filter(c => c.kind === "material");
  const eqs = CATEGORIES.filter(c => c.kind === "equipment");
  sel.innerHTML =
    (mats.length ? mats.map(c => `<option value="${c.id}">${esc(c.name)} (مواد)</option>`).join("") : "") +
    (eqs.length ? eqs.map(c => `<option value="${c.id}">${esc(c.name)} (أجهزة)</option>`).join("") : "");
}

on("btnImportExcel", "click", () => {
  openImportModal();
  fillImportCategories();
});

on("btnImportPick", "click", async () => {
  try {
    const res = await API.excelOpen();
    if (!res) return;
    if (res.error) { importError(res.error); return; }
    if (res.canceled || !res.sheets || !res.sheets.length) return;
    importState.path = res.path || "";
    importState.sheets = res.sheets;
    importState.sheet = 0;
    document.getElementById("importFileName").textContent = importState.path;
    document.getElementById("importError").style.display = "none";
    const sel = document.getElementById("importSheet");
    if (res.sheets.length > 1) {
      sel.innerHTML = res.sheets.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join("");
      document.getElementById("importSheetRow").style.display = "";
    } else {
      document.getElementById("importSheetRow").style.display = "none";
    }
    importState.headerRow = res.sheets[0].rows[0] || [];
    fillImportColumns();
    renderImportPreview();
    document.getElementById("importMapping").style.display = "";
  } catch (e) {
    importError(e.message);
  }
});

on("importSheet", "change", e => {
  importState.sheet = parseInt(e.target.value) || 0;
  const rows = importState.sheets[importState.sheet] ? importState.sheets[importState.sheet].rows : [];
  importState.headerRow = rows[0] || [];
  fillImportColumns();
  renderImportPreview();
});

on("importHeaderRow", "change", () => {
  /* إعادة بناء الأعمدة حسب الصف الأول */
  const rows = importState.sheets[importState.sheet] ? importState.sheets[importState.sheet].rows : [];
  const header = document.getElementById("importHeaderRow").checked ? (rows[0] || []) : [];
  importState.headerRow = header;
  fillImportColumns();
  renderImportPreview();
});

on("btnImportRun", "click", async () => {
  const nameCol = parseInt(document.getElementById("importColName").value);
  const priceCol = parseInt(document.getElementById("importColPrice").value);
  if (isNaN(nameCol) || nameCol < 0 || isNaN(priceCol) || priceCol < 0) {
    importError("حدد عمود الاسم وعمود السعر أولاً");
    return;
  }
  const unitCol = parseInt(document.getElementById("importColUnit").value);
  const codeCol = parseInt(document.getElementById("importColCode").value);
  const field = document.getElementById("importField").value;
  const matchBy = document.getElementById("importMatchBy").value;
  const createMissing = document.getElementById("importCreateMissing").checked;
  const categoryId = parseInt(document.getElementById("importCategory").value) || 0;
  const skipHeader = document.getElementById("importHeaderRow").checked;

  document.getElementById("importProgress").textContent = "جارٍ قراءة الملف...";
  try {
    const read = await API.excelRead(importState.path ? { path: importState.path, sheet: importState.sheet } : {});
    const rows = read.rows || [];
    if (!rows.length) { importError("الملف لا يحتوي صفوفاً"); return; }
    const start = skipHeader ? 1 : 0;
    const catalog = await API.catalogList({ activeOnly: false });
    const byName = {};
    const byCode = {};
    const byNorm = {};
    catalog.forEach(it => {
      byName[String(it.name || "").trim().toLowerCase()] = it;
      if (it.code) byCode[String(it.code).trim().toLowerCase()] = it;
      byNorm[normName(it.name)] = it;
    });

    /* مطابقة ذكية: تنظيف الاسم من الإنجليزي والأقواس قبل المقارنة */
    function normName(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function findMatch(name, codeVal) {
      const keyName = String(name || "").trim().toLowerCase();
      const keyCode = String(codeVal || "").trim().toLowerCase();
      if (matchBy === "code") {
        if (byCode[keyCode]) return byCode[keyCode];
        if (byName[keyName]) return byName[keyName];
      } else {
        if (byName[keyName]) return byName[keyName];
        if (byCode[keyCode]) return byCode[keyCode];
      }
      const norm = normName(name);
      if (norm.length >= 4 && byNorm[norm]) return byNorm[norm];
      if (norm.length >= 4) {
        const found = catalog.find(it => {
          const itNorm = normName(it.name);
          return itNorm.includes(norm) || norm.includes(itNorm);
        });
        if (found) return found;
      }
      return null;
    }

    let updated = 0, added = 0, skipped = 0;
    const total = rows.length - start;
    let i = 0;
    document.getElementById("importProgress").textContent = "جارٍ التحديث...";
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const name = String(row[nameCol] == null ? "" : row[nameCol]).trim();
      const price = parseFloat(String(row[priceCol] == null ? "" : row[priceCol]).replace(/[^\d.\-]/g, ""));
      i++;
      if (i % 100 === 0) document.getElementById("importProgress").textContent = `جارٍ التحديث... ${i}/${total}`;
      if (!name) { skipped++; continue; }
      const codeVal = codeCol >= 0 && row[codeCol] != null ? String(row[codeCol]).trim() : "";
      const item = findMatch(name, codeVal);
      if (item) {
        if (!isNaN(price) && price >= 0) {
          const patch = { id: item.id, name: item.name, category_id: item.category_id, code: item.code, unit: item.unit, supply_cost: item.supply_cost, install_cost: item.install_cost, is_active: item.is_active, source: "استيراد Excel" };
          if (unitCol >= 0 && row[unitCol] != null && String(row[unitCol]).trim()) patch.unit = String(row[unitCol]).trim();
          patch[field] = price;
          await API.catalogUpdate(patch);
          updated++;
        } else skipped++;
      } else if (createMissing && categoryId && !isNaN(price) && price >= 0) {
        const unit = (unitCol >= 0 && row[unitCol] != null) ? String(row[unitCol]).trim() : "وحدة";
        const payload = {
          category_id: categoryId,
          category_name: (CATEGORIES.find(c => c.id === categoryId) || {}).name || "غير مصنف",
          name,
          code: codeVal || "",
          unit: unit || "وحدة",
          supply_cost: (field === "supply_cost" && !isNaN(price)) ? price : 0,
          install_cost: (field === "install_cost" && !isNaN(price)) ? price : 0
        };
        const created = await API.catalogAdd(payload);
        byName[name.toLowerCase()] = created;
        if (created.code) byCode[String(created.code).toLowerCase()] = created;
        byNorm[normName(name)] = created;
        added++;
      } else skipped++;
    }
    document.getElementById("importProgress").textContent = "";
    document.getElementById("importResult").innerHTML = `
      <div class="import-summary">
        <span class="s-good">✅ تم تحديث ${updated} صنفاً</span>
        <span class="s-new">➕ تمت إضافة ${added} صنفاً جديداً</span>
        <span class="s-skip">⏭️ تم تخطي ${skipped} صفاً</span>
      </div>
      <p class="hint">كل تغيير سُجل في سجل الأسعار بمصدر "استيراد Excel".</p>`;
    await refreshCatalog();
    renderCatalog();
    toast(`اكتمل الاستيراد: تحديث ${updated} + إضافة ${added}`);
  } catch (e) {
    document.getElementById("importProgress").textContent = "";
    importError("فشل الاستيراد: " + e.message);
  }
});

on("importClose", "click", () => document.getElementById("importModal").classList.remove("show"));
on("importModal", "click", e => { if (e.target && e.target.id === "importModal") e.target.classList.remove("show"); });

