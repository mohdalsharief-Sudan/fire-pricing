"use strict";
/*
 * license-core.js — نواة الترخيص (توقيع RSA + تحقق)
 * الترميز: base32 (أحرف آمنة A-Z 2-7 بلا شرطات) — يمكن تنظيف المفتاح من أي فواصل بأمان
 * تعمل في Node (أدوات المالك + عملية التطبيق الرئيسية) وفي المتصفح (وضع احتياطي)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LicenseCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const isNode = typeof module === "object" && module.exports;
  const nodeCrypto = isNode ? require("crypto") : null;

  /* ---------- ترميز base32 (RFC 4648 بلا padding) ---------- */
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function b32Encode(bytes) {
    let bits = 0, value = 0, out = "";
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += B32[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }

  function b32Decode(str) {
    let bits = 0, value = 0;
    const out = [];
    const clean = String(str).toUpperCase();
    for (let i = 0; i < clean.length; i++) {
      const idx = B32.indexOf(clean[i]);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Uint8Array.from(out);
  }

  function encodeBytes(buf) {
    return b32Encode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  }

  /* تمثيل JSON ثابت الترتيب — يضمن تطابق التوقيع */
  function canonical(obj) {
    const keys = Object.keys(obj || {}).sort();
    const o = {};
    keys.forEach(k => { o[k] = obj[k]; });
    return JSON.stringify(o);
  }

  /* ---------- بصمة الجهاز ---------- */
  function machineId() {
    if (isNode) {
      const os = require("os");
      let mac = "";
      try {
        const ifs = os.networkInterfaces();
        Object.keys(ifs).sort().some(k => {
          const list = (ifs[k] || []).filter(i => !i.internal && i.mac && i.mac !== "00:00:00:00:00:00");
          if (list.length) { mac = list[0].mac; return true; }
          return false;
        });
      } catch (e) { /* ignore */ }
      const src = [os.hostname(), os.platform(), os.arch(), mac, ((os.cpus()[0] || {}).model || "")].join("|");
      return nodeCrypto.createHash("sha256").update(src).digest("hex").slice(0, 24).toUpperCase();
    }
    /* وضع المتصفح */
    const parts = [
      navigator.userAgent || "",
      navigator.language || "",
      (screen && (screen.width + "x" + screen.height)) || "",
      (Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || ""
    ];
    let token = "";
    try { token = localStorage.getItem("fp_machine_token") || ""; } catch (e) { /* ignore */ }
    if (!token) {
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem("fp_machine_token", token); } catch (e) { /* ignore */ }
    }
    parts.push(token);
    let h = 5381;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return ("00000000" + h.toString(16).toUpperCase()).slice(-8) + "-" + token.slice(0, 12).toUpperCase();
  }

  function formatMachine(id) {
    return String(id || "").toUpperCase().replace(/(.{4})/g, "$1-").replace(/-$/, "");
  }

  /* ---------- التوقيع (للمالك فقط — Node) ---------- */
  function makeKey(payloadObj, privateKeyPem) {
    if (!isNode) throw new Error("توليد المفاتيح متاح فقط في أدوات المالك");
    const data = canonical(payloadObj);
    const payload = encodeBytes(Buffer.from(data, "utf8"));
    const signer = nodeCrypto.createSign("RSA-SHA256");
    signer.update(data);
    signer.end();
    const sig = signer.sign(privateKeyPem).toString("base64");
    return payload + "." + b32Encode(Buffer.from(sig, "base64"));
  }

  /* ---------- قراءة المفتاح (يقبل أي فواصل بأمان — base32 بلا شرطات) ---------- */
  function parseKey(key) {
    const clean = String(key || "").replace(/[^A-Z2-7.]/gi, "");
    const parts = clean.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { payload: parts[0], signature: parts[1] };
  }

  function checkPayload(payload, machine) {
    if (!payload || typeof payload !== "object") return { valid: false, reason: "مفتاح تالف" };
    if (payload.machine && String(payload.machine).toUpperCase() !== String(machine).toUpperCase())
      return { valid: false, reason: "هذا الترخيص مخصص لجهاز آخر" };
    if (payload.expires) {
      const exp = new Date(payload.expires + "T23:59:59");
      if (isNaN(exp.getTime()) || exp < new Date())
        return { valid: false, reason: "انتهت صلاحية الترخيص" };
    }
    return { valid: true, payload };
  }

  /* ---------- التحقق (يعمل في Node والمتصفح) ---------- */
  async function verifyKey(key, machine, publicKeyPem) {
    const parsed = parseKey(key);
    if (!parsed) return { valid: false, reason: "صيغة مفتاح الترخيص غير صحيحة" };

    if (isNode) {
      try {
        const payloadJson = Buffer.from(b32Decode(parsed.payload)).toString("utf8");
        const payload = JSON.parse(payloadJson);
        const sigBuf = Buffer.from(b32Decode(parsed.signature));
        const okSig = nodeCrypto.verify(
          "RSA-SHA256",
          Buffer.from(canonical(payload), "utf8"),
          publicKeyPem,
          sigBuf
        );
        if (!okSig) return { valid: false, reason: "مفتاح الترخيص غير صالح" };
        return checkPayload(payload, machine);
      } catch (e) {
        return { valid: false, reason: "مفتاح تالف" + (e && e.message ? " (" + e.message + ")" : "") };
      }
    }

    /* المتصفح — WebCrypto */
    try {
      const webCrypto = (typeof crypto !== "undefined" && crypto)
        || (typeof self !== "undefined" && self.crypto)
        || (typeof window !== "undefined" && window.crypto);
      if (!webCrypto || !webCrypto.subtle) return { valid: false, reason: "بيئة التحقق غير مدعومة في هذا المتصفح" };
      const payloadJson = new TextDecoder().decode(b32Decode(parsed.payload));
      const payload = JSON.parse(payloadJson);
      const pem = String(publicKeyPem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
      const pub = await webCrypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const okSig = await webCrypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pub,
        b32Decode(parsed.signature),
        new TextEncoder().encode(canonical(payload))
      );
      if (!okSig) return { valid: false, reason: "مفتاح الترخيص غير صالح" };
      return checkPayload(payload, machine);
    } catch (e) {
      return { valid: false, reason: "مفتاح تالف" + (e && e.message ? " (" + e.message + ")" : "") };
    }
  }

  return { machineId, formatMachine, makeKey, parseKey, verifyKey, canonical };
});
