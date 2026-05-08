/**
 * PharmEasy Medicine Scraper
 *
 * Fetches medicine data (name, company, price, MRP, description, image) from
 * PharmEasy's public search API and imports it into the local MediRush API.
 *
 * Usage:
 *   pnpm tsx ./src/scrape-pharmeasy.ts              # import all categories
 *   pnpm tsx ./src/scrape-pharmeasy.ts --dry-run    # preview without saving
 *   pnpm tsx ./src/scrape-pharmeasy.ts vitamins     # filter to matching categories
 *
 * Requires the API server to be running (pnpm dev in api-server).
 */

import { setTimeout as sleep } from "timers/promises";

// ─── Config ──────────────────────────────────────────────────────────────────

const LOCAL_API = "http://localhost:3002";
const PE_BASE = "https://pharmeasy.in";

const OWNER_EMAIL = "owner@medirush.com";
const OWNER_PASS = "owner123";

const MAX_PER_TERM = 8;   // max medicines to import per search term
const ITEM_DELAY_MS = 150; // delay between API POSTs (be polite to local server)
const TERM_DELAY_MS = 700; // delay between PharmEasy searches

// ─── Search terms → category IDs ─────────────────────────────────────────────

const SEARCHES: { term: string; catId: string; label: string }[] = [
  { term: "paracetamol dolo crocin",        catId: "cat_cold_care",       label: "Fever & Pain" },
  { term: "vitamin c tablet limcee",        catId: "cat_vitamins",        label: "Vitamins" },
  { term: "antacid omeprazole pantoprazole",catId: "cat_acidity",         label: "Acidity Relief" },
  { term: "cetirizine antihistamine",       catId: "cat_allergy",         label: "Allergy" },
  { term: "metformin glimepiride diabetes", catId: "cat_diabetes",        label: "Diabetes Care" },
  { term: "azithromycin amoxicillin antibiotic", catId: "cat_antibiotics", label: "Antibiotics" },
  { term: "calcium supplement shelcal d3", catId: "cat_calcium",         label: "Calcium Supplement" },
  { term: "ibuprofen diclofenac pain relief",catId: "cat_pain_relief",   label: "Pain Relief" },
  { term: "cough syrup benadryl honitus",  catId: "cat_cold_cough",      label: "Cold & Cough" },
  { term: "eye drops lubricant visine",    catId: "cat_eye_ear",         label: "Eye & Ear Care" },
  { term: "himalaya herbal liv52 dabur",   catId: "cat_ayurvedic",       label: "Ayurvedic" },
  { term: "ors hydration electral",        catId: "cat_hydration",       label: "Hydration" },
  { term: "antiseptic dettol savlon",      catId: "cat_first_aid",       label: "First Aid" },
  { term: "skin lotion calamine betadine", catId: "cat_skin_care",       label: "Skin Care" },
  { term: "multivitamin revital supradyn", catId: "cat_multivitamins",   label: "Multivitamins" },
  { term: "digestive enzyme syrup",        catId: "cat_digestive",       label: "Digestive Care" },
  { term: "atenolol amlodipine blood pressure", catId: "cat_heart_bp",  label: "Heart & BP" },
  { term: "baby powder care rash cream",   catId: "cat_baby_care",       label: "Baby Care" },
  { term: "salbutamol inhaler respiratory",catId: "cat_respiratory",     label: "Respiratory" },
  { term: "thyroxine thyroid eltroxin",    catId: "cat_thyroid",         label: "Thyroid Care" },
  { term: "melatonin sleep aid neurology", catId: "cat_neuro_sleep",     label: "Neurology & Sleep" },
  { term: "health drink horlicks boost",   catId: "cat_health_drinks",   label: "Health Drinks" },
  { term: "feminine hygiene whisper stayfree", catId: "cat_feminine_care", label: "Feminine Care" },
  { term: "glucometer bp monitor device",  catId: "cat_medical_devices", label: "Medical Devices" },
];

// ─── Browser-like headers to avoid bot detection ─────────────────────────────

const PE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-IN,en;q=0.9",
  Referer: "https://pharmeasy.in/",
  Origin: "https://pharmeasy.in",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedMedicine {
  name: string;
  price: number;
  mrp?: number;
  company?: string;
  categoryId: string;
  imageUrl: string;
  description: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const res = await fetch(`${LOCAL_API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: OWNER_EMAIL, password: OWNER_PASS }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Login failed (${res.status}): ${msg}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

// ─── PharmEasy fetch ─────────────────────────────────────────────────────────

async function searchPharmEasy(term: string): Promise<unknown[]> {
  const url = `${PE_BASE}/api/search/search?q=${encodeURIComponent(term)}&limit=15`;
  const res = await fetch(url, { headers: PE_HEADERS });
  if (!res.ok) throw new Error(`PharmEasy ${res.status}: ${res.statusText}`);
  const json = (await res.json()) as Record<string, unknown>;

  const products = (json?.data as Record<string, unknown>)?.products;
  return Array.isArray(products) ? products : [];
}

// ─── Parse a PharmEasy item ───────────────────────────────────────────────────

function parseMedicine(item: Record<string, unknown>, catId: string): ParsedMedicine | null {
  // Only import actual medicine products (entityType 2), skip lab tests etc.
  if (item.entityType !== 2) return null;
  if (!(item.productAvailabilityFlags as Record<string, unknown>)?.isAvailable) return null;

  const name = ((item.name as string) || "").trim();
  if (name.length < 3) return null;

  const mrp = parseFloat((item.mrpDecimal as string) || "0");
  if (!mrp || mrp <= 0) return null;

  // Price = MRP minus 10% discount
  const price = parseFloat((mrp * 0.9).toFixed(2));

  const company = ((item.manufacturer as string) || "").trim();

  const rawImg = ((item.image as string) || "").trim();
  const imageUrl = rawImg.startsWith("http") ? rawImg : generatePlaceholder(name);

  const packInfo = ((item.subtitleText as string) || "").trim();
  const description = `${name}${company ? ` by ${company}` : ""}${packInfo ? ` (${packInfo})` : ""}. Pharmacy verified medicine available for quick delivery.`;

  return {
    name,
    price,
    mrp,
    company: company || undefined,
    categoryId: catId,
    imageUrl,
    description: description.slice(0, 500),
  };
}

// ─── SVG placeholder when no image available ─────────────────────────────────

function generatePlaceholder(name: string): string {
  const letter = (name.charAt(0) || "M").toUpperCase();
  const hue = (letter.charCodeAt(0) * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},60%,50%)"/><text x="100" y="120" font-size="90" text-anchor="middle" fill="white" font-family="Arial,sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ─── Create medicine via local API ───────────────────────────────────────────

async function createMedicine(token: string, med: ParsedMedicine): Promise<"created" | "exists" | "failed"> {
  const res = await fetch(`${LOCAL_API}/api/medicines`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(med),
  });

  if (res.status === 201) return "created";
  if (res.status === 409) return "exists";

  const msg = await res.text();
  throw new Error(`${res.status}: ${msg}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filters = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

  console.log("\n=== PharmEasy → MediRush Medicine Importer ===");
  if (dryRun) console.log("Mode: DRY RUN (no data will be saved)");
  console.log(`API: ${LOCAL_API}\n`);

  // Login
  let token = "";
  if (!dryRun) {
    process.stdout.write("Logging in as owner... ");
    try {
      token = await login();
      console.log("OK\n");
    } catch (e) {
      console.error(`FAILED\n${(e as Error).message}`);
      console.error("\nIs the API server running? Try: pnpm dev (in api-server)");
      process.exit(1);
    }
  }

  const searches =
    filters.length > 0
      ? SEARCHES.filter((s) =>
          filters.some(
            (f) =>
              s.catId.includes(f) ||
              s.label.toLowerCase().includes(f) ||
              s.term.toLowerCase().includes(f)
          )
        )
      : SEARCHES;

  let created = 0, exists = 0, failed = 0, noData = 0;

  for (const { term, catId, label } of searches) {
    console.log(`[${label}] Searching: "${term}"`);

    let items: unknown[];
    try {
      items = await searchPharmEasy(term);
    } catch (e) {
      console.log(`  ⚠ Search error: ${(e as Error).message}`);
      await sleep(1500);
      continue;
    }

    if (items.length === 0) {
      console.log("  — No results from PharmEasy");
      noData++;
      await sleep(TERM_DELAY_MS);
      continue;
    }

    console.log(`  Found ${items.length} results`);

    for (const item of items.slice(0, MAX_PER_TERM)) {
      const med = parseMedicine(item as Record<string, unknown>, catId);
      if (!med) continue;

      if (dryRun) {
        console.log(`  [preview] ${med.name} (${med.company ?? "—"}) ₹${med.price}${med.mrp ? ` / MRP ₹${med.mrp}` : ""}`);
        created++;
        continue;
      }

      try {
        const result = await createMedicine(token, med);
        if (result === "created") {
          console.log(`  + ${med.name} — ₹${med.price}`);
          created++;
        } else {
          console.log(`  ~ Already exists: ${med.name}`);
          exists++;
        }
      } catch (e) {
        console.log(`  ✗ Failed "${med.name}": ${(e as Error).message}`);
        failed++;
      }

      await sleep(ITEM_DELAY_MS);
    }

    await sleep(TERM_DELAY_MS);
  }

  console.log("\n=== Summary ===");
  if (dryRun) {
    console.log(`Would import: ${created} medicines across ${searches.length} categories`);
  } else {
    console.log(`Created : ${created}`);
    console.log(`Skipped : ${exists} (already in DB)`);
    console.log(`Failed  : ${failed}`);
    if (noData > 0) console.log(`No data : ${noData} searches returned nothing`);
  }
}

main().catch((e) => {
  console.error("Fatal:", (e as Error).message);
  process.exit(1);
});
