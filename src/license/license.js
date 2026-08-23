"use strict";
/*
 * license.js — إدارة الترخيص في التطبيق
 * الحالة: licensed (مرخص) / trial (تجريبي) / locked (مقفل)
 * تُخزَّن بيانات الترخيص داخل جدول settings في قاعدة البيانات
 */
const { machineId, verifyKey } = require("../../js/license-core.js");
const PUBLIC_KEY = require("../../js/license-public-key.js");

const TRIAL_DAYS = 30;

function trialState(db, settings, mid) {
  let start = settings.trial_start;
  if (!start) {
    start = new Date().toISOString().slice(0, 10);
    db.saveSettings(Object.assign({}, settings, { trial_start: start }));
  }
  const used = Math.floor((Date.now() - new Date(start + "T00:00:00").getTime()) / 86400000);
  const remaining = TRIAL_DAYS - used;
  if (remaining > 0) return { state: "trial", remaining: Math.max(remaining, 0), machine: mid };
  return { state: "locked", machine: mid };
}

async function status(db) {
  const settings = db.getSettings();
  const mid = machineId();
  const stored = settings.license;
  if (stored && stored.key) {
    const res = await verifyKey(stored.key, mid, PUBLIC_KEY);
    if (res.valid) {
      return {
        state: "licensed",
        customer: res.payload.customer || "",
        expires: res.payload.expires || "",
        machine: mid
      };
    }
  }
  return trialState(db, settings, mid);
}

async function activate(db, key) {
  const mid = machineId();
  const res = await verifyKey(key, mid, PUBLIC_KEY);
  if (!res.valid) return { ok: false, error: res.reason };
  const settings = db.getSettings();
  db.saveSettings(Object.assign({}, settings, {
    license: { key, activated_at: new Date().toISOString() }
  }));
  return { ok: true, customer: res.payload.customer || "", expires: res.payload.expires || "" };
}

module.exports = { status, activate, TRIAL_DAYS };
