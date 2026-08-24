/* ================= حفظ / استرجاع المشاريع ================= */

async function renderProjectsModal() {
  const list = document.getElementById("projectsList");
  list.innerHTML = `<p class="hint">جارٍ التحميل...</p>`;
  const search = document.getElementById("projectsSearch").value.trim();
  try {
    const projects = await API.projectsList(search);
    if (!projects.length) {
      list.innerHTML = `<p class="hint">لا توجد مشاريع محفوظة.</p>`;
      return;
    }
    list.innerHTML = "";
    projects.forEach(pr => {
      const div = document.createElement("div");
      div.className = "proj-item";
      const total = pr.total ? CALC.money(pr.total, state.project.currency) : "";
      div.innerHTML = `
        <div>
          <div class="proj-name">${esc(pr.quote_no || "")} — ${esc(pr.name || "مشروع بدون اسم")}</div>
          <div class="proj-meta">${esc(pr.client_name || "—")} | ${esc(pr.date || "")} | <span class="status-badge s-${pr.status}">${STATUS_LABELS[pr.status] || pr.status}</span> ${total ? "| " + total : ""}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" data-open="${pr.id}">فتح</button>
          <button class="btn btn-danger-ghost btn-sm" data-delproj="${pr.id}">حذف</button>
        </div>`;
      list.appendChild(div);
    });
    list.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", async () => {
      await openProject(parseInt(b.dataset.open));
    }));
    list.querySelectorAll("[data-delproj]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("حذف هذا المشروع نهائياً؟")) return;
      await API.projectsDelete(parseInt(b.dataset.delproj));
      toast("تم حذف المشروع");
      renderProjectsModal();
    }));
  } catch (e) {
    list.innerHTML = `<p class="hint">تعذر التحميل: ${esc(e.message)}</p>`;
  }
}

async function openProject(id) {
  try {
    if (!id) { alert("معرّف المشروع غير صالح"); return; }

    const p = await API.projectsGet(id);
    if (!p) { alert("المشروع غير موجود أو محذوف"); return; }

    const totalItems = (p.items || []).length;
    const hasName = (p.name || "").trim() !== "";
    if (!totalItems && !hasName) {
      if (!confirm("هذا المشروع محفوظ بدون بيانات (اسم أو بنود).\n\nقد يكون حُفظ في نسخة قديمة لا تحفظ البيانات بشكل صحيح.\n\nهل تريد فتحه كما هو؟")) return;
    }

    const projectClientId = p.clientId ?? p.client_id ?? null;
    const projectQuoteNo = p.quoteNo || p.quote_no || "";
    const linkedClient =
      p.client ||
      CLIENTS.find(x => x.id === projectClientId) ||
      null;

    state.project = {
      name: p.name || "",
      client: linkedClient ? linkedClient.name : (p.clientName || p.client_name || ""),
      location: p.location || "",
      date: p.date || today(),
      currency: p.currency || "SAR",
      vat: num(p.vat) || 15,
      validity: num(p.validity) || 30,
      area: p.area || "",
      floors: p.floors || "",
      notes: p.notes || ""
    };

    state.margins = Object.assign(
      { overheadPct: 8, contingencyPct: 5, profitPct: 15, discountPct: 0 },
      p.margins || {}
    );

    meta = {
      id: p.id,
      quoteNo: projectQuoteNo,
      status: p.status || "draft",
      clientId: projectClientId
    };

    state.equipment = (p.items || [])
      .filter(i => i.kind === "equipment")
      .map(i => ({
        id: uid(),
        name: i.name,
        qty: i.qty,
        supplyCost: i.supply_cost,
        installCost: i.install_cost,
        system: i.system || "alarm",
        itemId: i.item_id ?? i.itemId ?? null
      }));

    state.materials = (p.items || [])
      .filter(i => i.kind === "material")
      .map(i => ({
        id: uid(),
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        unitCost: i.unit_cost,
        itemId: i.item_id ?? i.itemId ?? null
      }));

    state.labor = (p.items || [])
      .filter(i => i.kind === "labor")
      .map(i => ({
        id: uid(),
        name: i.name,
        workers: i.workers,
        days: i.days,
        dailyCost: i.daily_cost
      }));

    state.services = (p.items || [])
      .filter(i => i.kind === "service")
      .map(i => ({
        id: uid(),
        name: i.name,
        value: i.service_value,
        type: i.service_type
      }));

    document.getElementById("projectsModal")?.classList.remove("show");
    fillClientSelect();
    quoteMode = "client";
    renderAll();
    setTab("project");
    toast(`تم فتح المشروع ${meta.quoteNo || ""}`.trim());
  } catch (e) {
    toast("فشل الفتح: " + e.message);
  }
}
