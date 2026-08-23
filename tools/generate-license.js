"use strict";
/*
 * generate-license.js — إصدار ترخيص لعميل (للمالك)
 * التشغيل:
 *   node tools/generate-license.js --name "شركة النخبة" --this-machine
 *   node tools/generate-license.js --name "شركة النخبة" --machine XXXX-XXXX [--days 365]
 *
 * الخيارات:
 *   --name         اسم العميل (إلزامي)
 *   --machine      رمز الجهاز كما يظهر في التطبيق (أو)
 *   --this-machine يلتقط بصمة جهازك الحالي تلقائياً
 *   --days         مدة الصلاحية بالأيام (بدونها = ترخيص دائم)
 *   --key          مسار مفتاح خاص بديل (اختياري)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const LicenseCore = require("../js/license-core.js");

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes("--" + name);

const ROOT = path.join(__dirname, "..");
const name = arg("name");
const days = parseInt(arg("days") || "", 10);
const privPath = arg("key") || path.join(ROOT, "license-keys", "private-key.pem");

if (!name) {
  console.error("❌ حدد اسم العميل: --name \"اسم العميل\"");
  process.exit(1);
}
if (!has("machine") && !has("this-machine")) {
  console.error("❌ حدد الجهاز: --machine XXXX-XXXX أو --this-machine");
  process.exit(1);
}
if (!fs.existsSync(privPath)) {
  console.error("❌ لا يوجد مفتاح خاص: " + privPath);
  console.error("   ولّده أولاً: node tools/generate-keys.js");
  process.exit(1);
}

const machine = has("this-machine")
  ? LicenseCore.machineId()
  : String(arg("machine") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

if (!machine || machine.length < 6) {
  console.error("❌ رمز الجهاز غير صالح: " + machine);
  process.exit(1);
}

const issued = new Date().toISOString().slice(0, 10);
let expires = "";
if (days > 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  expires = d.toISOString().slice(0, 10);
}

const payload = {
  machine,
  customer: name,
  issued,
  expires,
  id: crypto.randomBytes(6).toString("hex").toUpperCase()
};

const privateKey = fs.readFileSync(privPath, "utf8");
const key = LicenseCore.makeKey(payload, privateKey);

console.log("==============================================");
console.log("  مفتاح الترخيص — جاهز للإرسال");
console.log("==============================================");
console.log("");
console.log("  العميل        : " + name);
console.log("  رمز الجهاز    : " + LicenseCore.formatMachine(machine));
console.log("  تاريخ الإصدار : " + issued);
console.log("  تاريخ الانتهاء: " + (expires || "دائم"));
console.log("");
console.log("  المفتاح:");
console.log("  ----------------------------------------------");
console.log("  " + key);
console.log("  ----------------------------------------------");
console.log("");
console.log("  أرسل المفتاح للعميل، وليُلصقه في نافذة تفعيل الترخيص.");
console.log("  ملاحظة: هذا المفتاح يعمل على هذا الجهاز فقط.");
