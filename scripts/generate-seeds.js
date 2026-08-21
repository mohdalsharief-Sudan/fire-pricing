"use strict";
/*
 * generate-seeds.js — يولّد ملفات البذور (seed JSON) من js/data.js
 * التشغيل: npm run seed
 * المخرجات: src/db/seed/equipment.json + materials.json
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "js", "data.js");
const OUT_DIR = path.join(__dirname, "..", "src", "db", "seed");

const src = fs.readFileSync(DATA_FILE, "utf8") +
  "\n;globalThis.__lib = { EQUIPMENT_LIBRARY, MATERIALS_LIBRARY };";
eval(src);

const { EQUIPMENT_LIBRARY, MATERIALS_LIBRARY } = globalThis.__lib;

function buildKind(lib, kind, prefix) {
  const categories = [];
  let seq = 1;
  Object.keys(lib.groups).forEach((gName, ci) => {
    const items = lib.groups[gName].map(it => ({
      code: `${prefix}-${String(seq++).padStart(3, "0")}`,
      name: it.name,
      unit: it.unit || "وحدة",
      supply_cost: it.supply || 0,
      install_cost: it.install || 0
    }));
    categories.push({ name: gName, items });
  });
  return { kind, categories };
}

const equipment = {
  kind: "equipment",
  categories: [
    ...buildKind(EQUIPMENT_LIBRARY.alarm, "equipment", "ALM").categories.map(c => ({ ...c, system: "alarm" })),
    ...buildKind(EQUIPMENT_LIBRARY.fighting, "equipment", "FGT").categories.map(c => ({ ...c, system: "fighting" }))
  ]
};

const materials = buildKind(MATERIALS_LIBRARY, "material", "MAT");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "equipment.json"), JSON.stringify(equipment, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "materials.json"), JSON.stringify(materials, null, 2), "utf8");

const count = (o) => o.categories.reduce((s, c) => s + c.items.length, 0);
console.log(`✅ تم توليد البذور:
  equipment.json: ${equipment.categories.length} فئة / ${count(equipment)} صنفاً
  materials.json: ${materials.categories.length} فئة / ${count(materials)} صنفاً`);
