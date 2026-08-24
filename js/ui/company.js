/* ================= متغيرات ودوال الشركة ================= */
const COMPANY_DEFAULTS = {
  name: "اسم شركتك",
  slogan: "توريد وتركيب وصيانة أنظمة الإطفاء والإنذار",
  phone: "",
  email: "",
  cr: "",
  address: "",
  terms: "1- صلاحية العرض %DAYS% يوماً من تاريخه.\n2- يلتزم الطرف الأول بتوريد مواد مطابقة لمواصفات الدفاع المدني.",
  logo: ""
};

let COMPANY = Object.assign({}, COMPANY_DEFAULTS);

async function loadCompany() {
  try {
    const s = await API.settingsGet();
    COMPANY = Object.assign({}, COMPANY_DEFAULTS, s || {});
  } catch (e) {
    console.error("Failed to load company:", e);
  }
}

async function saveCompany() {
  try {
    await API.settingsSave(COMPANY);
  } catch (e) {
    console.error("Failed to save company:", e);
  }
}

/* ================= إعدادات الشركة (النافذة) ================= */
function openCompanyModal() {
  const modal = document.getElementById("companyModal");
  if (modal) modal.classList.add("show");

  const name = document.getElementById("companyName");
  const slogan = document.getElementById("companySlogan");
  const phone = document.getElementById("companyPhone");
  const email = document.getElementById("companyEmail");
  const cr = document.getElementById("companyCr");
  const address = document.getElementById("companyAddress");
  const terms = document.getElementById("companyTerms");
  const preview = document.getElementById("companyLogoPreview");

  if (name) name.value = COMPANY.name || "";
  if (slogan) slogan.value = COMPANY.slogan || "";
  if (phone) phone.value = COMPANY.phone || "";
  if (email) email.value = COMPANY.email || "";
  if (cr) cr.value = COMPANY.cr || "";
  if (address) address.value = COMPANY.address || "";
  if (terms) terms.value = (COMPANY.terms || "").replace("%DAYS%", "30");

  if (preview) {
    if (COMPANY.logo) {
      preview.src = COMPANY.logo;
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  }
}
// ربط زر إعدادات الشركة
const btnCompany = document.getElementById("btnCompanySettings");
if (btnCompany) {
  btnCompany.addEventListener("click", openCompanyModal);
}
// هذه الدالة المساعدة يجب أن تكون متوفرة (موجودة أصلاً في app.js وتعمل بشكل عام)
// on("btnCompanySettings", ...)