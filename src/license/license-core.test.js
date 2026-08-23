"use strict";
/* اختبارات نظام الترخيص */
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const LC = require("../../js/license-core.js");

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  return { publicKey, privateKey };
}

test("توليد مفتاح ترخيص صالح والتحقق منه", async () => {
  const kp = keypair();
  const payload = { machine: "ABCD1234", customer: "شركة النخبة", issued: "2026-08-22", expires: "", id: "X1" };
  const key = LC.makeKey(payload, kp.privateKey);
  const res = await LC.verifyKey(key, "ABCD1234", kp.publicKey);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.payload.customer, "شركة النخبة");
  assert.strictEqual(res.payload.expires, "");
});

test("مفتاح مربوط بجهاز آخر مرفوض", async () => {
  const kp = keypair();
  const key = LC.makeKey({ machine: "DEVICE-AAA", customer: "عميل", issued: "2026-08-22", expires: "" }, kp.privateKey);
  const res = await LC.verifyKey(key, "DEVICE-BBB", kp.publicKey);
  assert.strictEqual(res.valid, false);
  assert.ok(res.reason.includes("جهاز آخر"));
});

test("مفتاح منتهي الصلاحية مرفوض", async () => {
  const kp = keypair();
  const key = LC.makeKey({ machine: "DEV", customer: "عميل", issued: "2020-01-01", expires: "2020-01-02" }, kp.privateKey);
  const res = await LC.verifyKey(key, "DEV", kp.publicKey);
  assert.strictEqual(res.valid, false);
  assert.ok(res.reason.includes("انتهت"));
});

test("تعديل أي حرف في المفتاح يُفشل التحقق", async () => {
  const kp = keypair();
  const key = LC.makeKey({ machine: "DEV", customer: "عميل", issued: "2026-08-22", expires: "" }, kp.privateKey);
  // نغيّر حرفاً في جزء الحمولة
  const parts = key.split(".");
  const tamperedPayload = parts[0].slice(0, -2) + (parts[0].endsWith("AA") ? "BB" : "AA") + parts[0].slice(-1);
  const tampered = tamperedPayload + "." + parts[1];
  const res = await LC.verifyKey(tampered, "DEV", kp.publicKey);
  assert.strictEqual(res.valid, false);
});

test("المفتاح يقبل التنسيق بالشرطات والمسافات", async () => {
  const kp = keypair();
  const key = LC.makeKey({ machine: "DEV", customer: "عميل", issued: "2026-08-22", expires: "" }, kp.privateKey);
  const spaced = key.replace(/(.{10})/g, "$1-").replace(/-$/, "") + "   ";
  const res = await LC.verifyKey(spaced, "DEV", kp.publicKey);
  assert.strictEqual(res.valid, true);
});

test("بصمة الجهاز ثابتة ومتطابقة", () => {
  const a = LC.machineId();
  const b = LC.machineId();
  assert.strictEqual(a, b);
  assert.ok(a.length >= 8);
});

test("ترخيص بمفتاح عام آخر (مزور) مرفوض", async () => {
  const kp1 = keypair();
  const kp2 = keypair();
  const key = LC.makeKey({ machine: "DEV", customer: "عميل", issued: "2026-08-22", expires: "" }, kp1.privateKey);
  const res = await LC.verifyKey(key, "DEV", kp2.publicKey);
  assert.strictEqual(res.valid, false);
});
