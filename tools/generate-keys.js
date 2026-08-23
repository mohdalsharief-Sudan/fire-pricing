"use strict";
/*
 * generate-keys.js — توليد زوج مفاتيح الترخيص (للمالك — مرة واحدة)
 * التشغيل:  npm run license:keys   (أو)  node tools/generate-keys.js
 *
 * النتائج:
 *   - license-keys/private-key.pem   ← المفتاح الخاص — احتفظ به سرياً ولا ترفعه أبداً
 *   - js/license-public-key.js       ← المفتاح العام — يُدمج في التطبيق (يُرفع للمستودع)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const KEY_DIR = path.join(ROOT, "license-keys");
const PRIV_PATH = path.join(KEY_DIR, "private-key.pem");
const PUB_JS_PATH = path.join(ROOT, "js", "license-public-key.js");

if (fs.existsSync(PRIV_PATH) && !process.argv.includes("--force")) {
  console.error("⚠️  يوجد مفتاح خاص سابق: " + PRIV_PATH);
  console.error("    - لتوليد مفتاح جديد سيُبطل كل التراخيص الصادرة سابقاً.");
  console.error("    - أضف --force إن كنت متأكداً:  node tools/generate-keys.js --force");
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

fs.mkdirSync(KEY_DIR, { recursive: true });
fs.writeFileSync(PRIV_PATH, privateKey, "utf8");

const js = `"use strict";
/* هذا الملف يُنشأ تلقائياً بأمر: npm run license:keys — لا تعدّله يدوياً */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LICENSE_PUBLIC_KEY = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return ${JSON.stringify(publicKey)};
});
`;
fs.writeFileSync(PUB_JS_PATH, js, "utf8");

console.log("✅ تم توليد مفاتيح الترخيص بنجاح:");
console.log("");
console.log("   🔒 المفتاح الخاص (سري — احتفظ به ولا ترفعه):");
console.log("       " + PRIV_PATH);
console.log("");
console.log("   🔓 المفتاح العام (مدمج في التطبيق):");
console.log("       " + PUB_JS_PATH);
console.log("");
console.log("   الآن أصدر تراخيص لعملائك بالأمر:");
console.log('       node tools/generate-license.js --name "اسم العميل" --this-machine');
console.log("   أو لجهاز معين:");
console.log('       node tools/generate-license.js --name "اسم العميل" --machine XXXX-XXXX');
