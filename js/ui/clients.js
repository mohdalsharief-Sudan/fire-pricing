/* ================= العملاء ================= */

async function refreshClients() {
  try { CLIENTS = await API.clientsList(""); } catch (e) { CLIENTS = []; }
  fillClientSelect();
}

async function renderClients() {
  const body = document.getElementById("clientBody");
  const search = document.getElementById("clientSearch").value.trim();
  body.innerHTML = `<tr><td colspan="6" class="hint">جارٍ التحميل...</td></tr>`;
  try {
    const list = await API.clientsList(search);
    body.innerHTML = "";
    list.forEach((c, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.phone || "—")}</td>
        <td>${esc(c.city || "—")}</td>
        <td>${esc(c.cr_number || "—")}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-editcl="${c.id}">تعديل</button>
          <button class="btn btn-danger-ghost btn-sm" data-delcl="${c.id}">حذف</button>
        </td>`;
      body.appendChild(tr);
    });
    if (!list.length) body.innerHTML = `<tr><td colspan="6" class="hint">لا يوجد عملاء</td></tr>`;
    document.getElementById("clientCount").textContent = `إجمالي العملاء: ${list.length}`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="hint">تعذر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

on("clientSearch", "input", () => {
  clearTimeout(window.__clSearchT);
  window.__clSearchT = setTimeout(renderClients, 300);
});

const clientModal = document.getElementById("clientModal");

function openClientEditor(id) {
  editingClientId = id || null;
  document.getElementById("clientModalTitle").textContent = id ? "تعديل عميل" : "إضافة عميل جديد";
  const c = id ? CLIENTS.find(x => x.id === id) : {};
  document.getElementById("cmName").value = (c && c.name) || "";
  document.getElementById("cmPhone").value = (c && c.phone) || "";
  document.getElementById("cmEmail").value = (c && c.email) || "";
  document.getElementById("cmCr").value = (c && c.cr_number) || "";
  document.getElementById("cmCity").value = (c && c.city) || "";
  document.getElementById("cmNotes").value = (c && c.notes) || "";
  clientModal.classList.add("show");
}

on("btnAddClient", "click", () => openClientEditor(null));

on("clientBody", "click", e => {
  const edit = e.target.closest("[data-editcl]");
  if (edit) { openClientEditor(parseInt(edit.dataset.editcl)); return; }
  const del = e.target.closest("[data-delcl]");
  if (del) {
    const id = parseInt(del.dataset.delcl);
    if (!confirm("حذف هذا العميل؟")) return;
    API.clientsDelete(id).then(() => { refreshClients(); renderClients(); toast("تم حذف العميل"); });
  }
});

on("cmSave", "click", async () => {
  const name = document.getElementById("cmName").value.trim();
  if (!name) { toast("أدخل اسم العميل"); return; }
  const payload = {
    id: editingClientId, name,
    phone: document.getElementById("cmPhone").value.trim(),
    email: document.getElementById("cmEmail").value.trim(),
    cr_number: document.getElementById("cmCr").value.trim(),
    city: document.getElementById("cmCity").value.trim(),
    notes: document.getElementById("cmNotes").value.trim()
  };
  try {
    await API.clientsSave(payload);
    toast(editingClientId ? "تم تحديث العميل" : "تمت إضافة العميل");
    clientModal.classList.remove("show");
    await refreshClients();
    renderClients();
  } catch (e) {
    toast("فشل الحفظ: " + e.message);
  }
});

on("clientClose", "click", () => clientModal.classList.remove("show"));
clientModal.addEventListener("click", e => { if (e.target === clientModal) clientModal.classList.remove("show"); });

