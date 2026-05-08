/**
 * One-off script: inserts Dolo 650mg directly into the Neon database.
 * Run: pnpm tsx ./src/add-one-medicine.ts
 */

import { pool } from "@workspace/db";
import { randomUUID } from "crypto";

async function fetchDolo() {
  const res = await fetch(
    "https://pharmeasy.in/api/search/search?q=dolo+650mg&limit=15",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://pharmeasy.in/",
      },
    }
  );
  const json = (await res.json()) as Record<string, unknown>;
  const products = ((json?.data as Record<string, unknown>)?.products ?? []) as Record<string, unknown>[];

  return products.find(
    (p) =>
      p.entityType === 2 &&
      typeof p.name === "string" &&
      (p.name as string).toLowerCase().includes("dolo 650") &&
      ((p.productAvailabilityFlags as Record<string, unknown>)?.isAvailable) === true
  );
}

async function main() {
  console.log("Fetching Dolo 650mg from PharmEasy...");
  const item = await fetchDolo();
  if (!item) throw new Error("Dolo 650mg not found in PharmEasy results");

  const name = (item.name as string).trim();
  const company = ((item.manufacturer as string) || "MICRO LABS").trim();
  const mrp = parseFloat(item.mrpDecimal as string);
  const price = parseFloat((mrp * 0.9).toFixed(2));
  const imageUrl = (item.image as string) || "";
  const packInfo = (item.subtitleText as string) || "Strip Of 15 Tablets";
  const description = `${name} by ${company} (${packInfo}). Pharmacy verified medicine available for quick delivery.`;

  console.log(`\nInserting:`);
  console.log(`  Name    : ${name}`);
  console.log(`  Company : ${company}`);
  console.log(`  MRP     : ₹${mrp}`);
  console.log(`  Price   : ₹${price} (10% off)`);
  console.log(`  Category: Fever & Pain`);

  const id = `med_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  await pool.query(
    `INSERT INTO medirush_medicines (id, name, price, mrp, company, stock, category_id, image_url, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, name, price, mrp, company, null, "cat_cold_care", imageUrl, description]
  );

  console.log(`\nDone! Medicine added with id: ${id}`);
  await pool.end();
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
