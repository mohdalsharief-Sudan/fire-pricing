"use strict";
/* اختبار دورة حياة الترخيص الكاملة (محاكاة وضع Electron) */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { createDatabase } = require("../src/db/database.js");
const license = require("../src/license/license.js");
const LC = require("../js/license-core.js");

/* قاعدة حقيقية + المفتاح الخاص الحقيقي (كما يستخدمه المالك) */
const db = createDatabase(":memory:");
const privPath = path.join(__dirname, "..", "license-keys", "private-key.pem");
if (!fs.existsSync(privPath)) {
  console.log("لا يوجد مفتاح خاص — جارٍ توليده (npm run license:keys)...");
  require("../tools/generate-keys.js");
}
const privateKey = fs.readFileSync(privPath, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "✅" : "❌"), name); cond ? pass++ : fail++; };

(async () => {
  try {
    /* 1) بدون ترخيص → تجريبية */
    let st = await license.status(db);
    ok("بدون ترخيص: حالة تجريبية", st.state === "trial");
    ok("التجربة فيها أيام متبقية", st.remaining > 0 && st.remaining <= 30);

    /* 2) بصمة الجهاز ظاهرة */
    ok("بصمة الجهاز موجودة", !!st.machine && st.machine.length >= 8);
    console.log("   بصمة هذا الجهاز:", LC.formatMachine(st.machine));

    /* 3) تفعيل بمفتاح صحيح مربوط بهذا الجهاز */
    const payload = { machine: st.machine, customer: "شركة النخبة", issued: "2026-08-22", expires: "" };
    const goodKey = LC.makeKey(payload, privateKey);
    const act = await license.activate(db, goodKey);
    ok("تفعيل المفتاح الصحيح ينجح", act.ok === true && act.customer === "شركة النخبة");

    st = await license.status(db);
    ok("بعد التفعيل: الحالة مرخّص", st.state === "licensed");
    ok("اسم العميل في الترخيص", st.customer === "شركة النخبة");

    /* 4) مفتاح لجهاز آخر مرفوض ولا يُحفظ */
    const otherKey = LC.makeKey({ machine: "OTHER-XXX", customer: "مزور", issued: "2026-08-22", expires: "" }, privateKey);
    const bad = await license.activate(db, otherKey);
    ok("مفتاح جهاز آخر مرفوض", bad.ok === false);

    /* 5) مفتاح منتهي الصلاحية مرفوض */
    const expiredKey = LC.makeKey({ machine: st.machine, customer: "قديم", issued: "2020-01-01", expires: "2020-01-02" }, privateKey);
    const ex = await license.activate(db, expiredKey);
    ok("مفتاح منتهي الصلاحية مرفوض", ex.ok === false);

    /* 6) تفعيل بصيغة مزعزعة (شرطات ومسافات) يعمل */
    const messy = goodKey.replace(/(.{8})/g, "$1-").replace(/-$/, "") + "   ";
    const act2 = await license.activate(db, messy);
    ok("التفعيل يقبل المفتاح بالشرطات والمسافات", act2.ok === true);

    /* 7) ترخيص دائم (بدون expires) يعمل */
    const permKey = LC.makeKey({ machine: st.machine, customer: "دائم", issued: "2026-08-22", expires: "" }, privateKey);
    const act3 = await license.activate(db, permKey);
    ok("الترخيص الدائم يعمل", act3.ok === true);

    /* 8) محاكاة الواجهة: نافذة التفعيل موجودة في HTML */
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    ok("نافذة التفعيل في الواجهة", html.includes("licenseModal") && html.includes("btnLicenseActivate"));
    ok("شارة الترخيص في الواجهة", html.includes("licenseBadge"));

    console.log("===== النتيجة:", pass, "نجاح /", fail, "فشل =====");
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log("خطأ فادح:", e.stack || e.message);
    process.exit(1);
  }
})();
