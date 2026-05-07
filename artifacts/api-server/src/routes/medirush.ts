import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, pool, cartItemsTable, categoriesTable, medicinesTable, ordersTable, prescriptionsTable, usersTable, savedAddressesTable } from "@workspace/db";
import { AddCartItemBody, CreateCategoryBody, CreateMedicineBody, CreateOrderBody, DeleteCategoryParams, DeleteMedicineParams, ListMedicinesQueryParams, LoginBody, RemoveCartItemParams, SignupBody, UpdateCartItemBody, UpdateCartItemParams, UpdateMedicineBody, UpdateMedicineParams, UploadPrescriptionBody } from "@workspace/api-zod";
import crypto from "node:crypto";

const router = Router();
const tokenSecret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "medirush-development-secret";

type Role = "user" | "owner";
type MedicineRow = typeof medicinesTable.$inferSelect;
type CategoryRow = typeof categoriesTable.$inferSelect;

type CartLine = {
  medicine: ReturnType<typeof serializeMedicine>;
  quantity: number;
};

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function hashPassword(password: string) {
  return crypto.scryptSync(password, tokenSecret, 64).toString("hex");
}

function verifyPassword(password: string, hash: string) {
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(password, tokenSecret, 64));
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signToken(payload: { id: string; role: Role }) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }));
  const signature = crypto.createHmac("sha256", tokenSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function readToken(req: Request) {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const [header, body, signature] = value.slice(7).split(".");
  if (!header || !body || !signature) return null;
  const expected = crypto.createHmac("sha256", tokenSecret).update(`${header}.${body}`).digest("base64url");
  if (expected !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { id: string; role: Role; exp: number };
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function requireUser(req: Request, res: Response): string | null {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }
  return token.id;
}

function requireOwner(req: Request, res: Response) {
  const token = readToken(req);
  if (!token || token.role !== "owner") {
    res.status(403).json({ message: "Owner access required" });
    return false;
  }
  return true;
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    location: user.location,
    role: user.role as Role,
  };
}

function serializeMedicine(medicine: MedicineRow, categories: CategoryRow[]) {
  const category = categories.find((item) => item.id === medicine.categoryId);
  return {
    id: medicine.id,
    name: medicine.name,
    price: medicine.price,
    mrp: medicine.mrp ?? undefined,
    company: medicine.company ?? undefined,
    stock: (medicine as any).stock ?? undefined,
    categoryId: medicine.categoryId,
    categoryName: category?.name ?? "General",
    imageUrl: medicine.imageUrl,
    description: medicine.description,
  };
}

function svgDataUrl(label: string, color: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='320' viewBox='0 0 420 320'><rect width='420' height='320' rx='42' fill='${color}'/><circle cx='330' cy='70' r='70' fill='rgba(255,255,255,.22)'/><rect x='70' y='92' width='92' height='136' rx='24' fill='white'/><rect x='92' y='70' width='48' height='180' rx='20' fill='white'/><text x='210' y='250' text-anchor='middle' font-size='32' font-family='Arial' font-weight='700' fill='white'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS medirush_users (
      id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, location TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_medicines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price DOUBLE PRECISION NOT NULL,
      category_id TEXT NOT NULL, image_url TEXT NOT NULL, description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE medirush_medicines ADD COLUMN IF NOT EXISTS mrp DOUBLE PRECISION;
    ALTER TABLE medirush_medicines ADD COLUMN IF NOT EXISTS company TEXT;
    CREATE TABLE IF NOT EXISTS medirush_cart_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, medicine_id TEXT NOT NULL,
      quantity INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_prescriptions (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL, image_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, items JSONB NOT NULL,
      total DOUBLE PRECISION NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL,
      eta_minutes INTEGER NOT NULL, prescription_id TEXT, delivery_address TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE medirush_orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
    ALTER TABLE medirush_orders ADD COLUMN IF NOT EXISTS rating INTEGER;
    ALTER TABLE medirush_medicines ADD COLUMN IF NOT EXISTS stock INTEGER;
    CREATE TABLE IF NOT EXISTS medirush_saved_addresses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
      address TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    INSERT INTO medirush_settings (key, value) VALUES ('hide_oos', 'false') ON CONFLICT (key) DO NOTHING;
    CREATE TABLE IF NOT EXISTS medirush_tests (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price DOUBLE PRECISION NOT NULL,
      description TEXT, preparation TEXT, turnaround_time TEXT NOT NULL DEFAULT '24 hrs',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS medirush_test_bookings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      user_phone TEXT NOT NULL, tests JSONB NOT NULL, total DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL, time_slot TEXT NOT NULL, collection_type TEXT NOT NULL,
      address TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureSeedData() {
  const categories = await db.select().from(categoriesTable).limit(1);
  if (categories.length > 0) return;

  const painReliefId = "cat_pain_relief";
  const coldCareId = "cat_cold_care";
  const vitaminsId = "cat_vitamins";
  const firstAidId = "cat_first_aid";

  await db.insert(categoriesTable).values([
    { id: painReliefId, name: "Pain Relief" },
    { id: coldCareId, name: "Cold & Fever" },
    { id: vitaminsId, name: "Vitamins" },
    { id: firstAidId, name: "First Aid" },
  ]);

  await db.insert(medicinesTable).values([
    { id: "med_para_500", name: "Paracetamol 500mg", price: 28, categoryId: coldCareId, imageUrl: svgDataUrl("Paracetamol", "%2300C853"), description: "Fast fever and mild pain relief tablets." },
    { id: "med_cough_syrup", name: "Cough Relief Syrup", price: 115, categoryId: coldCareId, imageUrl: svgDataUrl("Cough Syrup", "%23009944"), description: "Soothing syrup for dry and wet cough support." },
    { id: "med_vitamin_c", name: "Vitamin C Chewables", price: 180, categoryId: vitaminsId, imageUrl: svgDataUrl("Vitamin C", "%23FFB300"), description: "Daily immunity support with citrus flavor." },
    { id: "med_bandage", name: "Sterile Bandage Pack", price: 75, categoryId: firstAidId, imageUrl: svgDataUrl("Bandage", "%2300825E"), description: "Breathable wound dressing for quick first aid." },
    { id: "med_pain_gel", name: "Pain Relief Gel", price: 145, categoryId: painReliefId, imageUrl: svgDataUrl("Pain Gel", "%23006B3F"), description: "Topical gel for muscle and joint discomfort." },
    { id: "med_ors", name: "ORS Sachets", price: 40, categoryId: firstAidId, imageUrl: svgDataUrl("ORS", "%23F4511E"), description: "Electrolyte hydration sachets for quick recovery." },
  ]);

  await db.insert(usersTable).values([
    { id: "owner_demo", fullName: "Medirush Owner", phone: "9999999999", email: "owner@medirush.com", passwordHash: hashPassword("owner123"), location: "Central Pharmacy Hub", role: "owner" },
    { id: "user_demo", fullName: "Demo Customer", phone: "8888888888", email: "user@medirush.com", passwordHash: hashPassword("user123"), location: "MG Road, Bengaluru", role: "user" },
  ]);
}

async function ensureOtcProducts() {
  const cats: Record<string, string> = {
    "Hydration":         "cat_hydration",
    "Calcium Supplement":"cat_calcium",
    "Vitamins":          "cat_vitamins",
    "Digestive Care":    "cat_digestive",
    "Pain Relief":       "cat_pain_relief",
    "Fever & Pain":      "cat_cold_care",
    "Multivitamins":     "cat_multivitamins",
    "Acidity Relief":    "cat_acidity",
    "First Aid":         "cat_first_aid",
    "Personal Hygiene":  "cat_personal_hygiene",
    "Cold & Cough":      "cat_cold_cough",
    "Skin Care":         "cat_skin_care",
    "Ayurvedic":         "cat_ayurvedic",
    "Diabetes Care":     "cat_diabetes",
    "Allergy":           "cat_allergy",
    "Antibiotics":       "cat_antibiotics",
    "Eye & Ear Care":    "cat_eye_ear",
    "Baby Care":         "cat_baby_care",
    "Respiratory":       "cat_respiratory",
    "Heart & BP":        "cat_heart_bp",
    "Women's Health":    "cat_womens_health",
    "Vertigo & Nausea":  "cat_vertigo",
    "Neurology & Sleep": "cat_neuro_sleep",
  };
  for (const [name, catId] of Object.entries(cats)) {
    await pool.query(`INSERT INTO medirush_categories (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [catId, name]);
  }

  const otc = [
    { id: "med_electral_ors",    name: "Electral ORS",              company: "FDC Limited",                    catId: "cat_hydration",        mrp: 22,  price: 19.80, desc: "Oral rehydration salts for quick hydration and electrolyte replenishment." },
    { id: "med_shelcal_500",     name: "Shelcal 500",               company: "Torrent Pharmaceuticals",        catId: "cat_calcium",          mrp: 135, price: 121.50, desc: "Calcium carbonate 500mg supplement for bone health and calcium deficiency." },
    { id: "med_limcee_500",      name: "Limcee 500",                company: "Abbott India",                   catId: "cat_vitamins",         mrp: 32,  price: 28.80, desc: "Vitamin C 500mg chewable tablets for immunity and antioxidant support." },
    { id: "med_digene_gel",      name: "Digene Gel",                company: "Abbott India",                   catId: "cat_digestive",        mrp: 138, price: 124.20, desc: "Antacid gel for fast relief from acidity, gas, and indigestion." },
    { id: "med_volini_spray",    name: "Volini Spray",              company: "Sun Pharmaceutical Industries",  catId: "cat_pain_relief",      mrp: 240, price: 216.00, desc: "Topical pain relief spray for muscle pain, sprains, and joint stiffness." },
    { id: "med_crocin_advance",  name: "Crocin Advance",            company: "Haleon India",                   catId: "cat_cold_care",        mrp: 20,  price: 18.00, desc: "Paracetamol 500mg tablet for fast relief from fever and mild to moderate pain." },
    { id: "med_revital_h",       name: "Revital H",                 company: "Sun Pharmaceutical Industries",  catId: "cat_multivitamins",    mrp: 120, price: 108.00, desc: "Daily multivitamin with ginseng for energy, stamina, and overall vitality." },
    { id: "med_eno_regular",     name: "ENO",                       company: "Haleon India",                   catId: "cat_acidity",          mrp: 10,  price: 9.00,  desc: "Fast-acting antacid powder for instant relief from acidity and heartburn." },
    { id: "med_dettol_liquid",   name: "Dettol Antiseptic Liquid",  company: "Reckitt",                        catId: "cat_first_aid",        mrp: 75,  price: 67.50, desc: "Multipurpose antiseptic liquid for cuts, wounds, and surface disinfection." },
    { id: "med_whisper_ultra",   name: "Whisper Ultra",             company: "Procter & Gamble",               catId: "cat_personal_hygiene", mrp: 50,   price: 45.00,  desc: "Ultra-thin sanitary pads with soft cover for maximum comfort and protection." },

    // Cold & Cough
    { id: "med_vicks_vaporub",   name: "Vicks VapoRub",             company: "Procter & Gamble",               catId: "cat_cold_cough",       mrp: 95,   price: 85.50,  desc: "Mentholated topical ointment for relief from cold, cough, and blocked nose." },
    { id: "med_benadryl_syrup",  name: "Benadryl Cough Syrup",      company: "Johnson & Johnson",              catId: "cat_cold_cough",       mrp: 115,  price: 103.50, desc: "Effective cough suppressant syrup for dry and irritating cough." },
    { id: "med_sinarest",        name: "Sinarest Tablet",           company: "Centaur Pharmaceuticals",        catId: "cat_cold_cough",       mrp: 28,   price: 25.20,  desc: "Decongestant tablet for relief from cold, sinusitis, and nasal congestion." },

    // Skin Care
    { id: "med_lacto_calamine",  name: "Lacto Calamine Lotion",     company: "Piramal Healthcare",             catId: "cat_skin_care",        mrp: 110,  price: 99.00,  desc: "Skin balancing lotion that controls oiliness, reduces pores and soothes skin." },
    { id: "med_betadine",        name: "Betadine Solution",         company: "Win-Medicare",                   catId: "cat_skin_care",        mrp: 85,   price: 76.50,  desc: "Povidone iodine antiseptic solution for wound cleaning and infection prevention." },
    { id: "med_burnol",          name: "Burnol Cream",              company: "Dr. Morepen",                    catId: "cat_skin_care",        mrp: 55,   price: 49.50,  desc: "Antiseptic cream for first aid treatment of minor burns and scalds." },
    { id: "med_boroplus",        name: "Boroplus Antiseptic Cream", company: "Emami Limited",                  catId: "cat_skin_care",        mrp: 42,   price: 37.80,  desc: "Antiseptic cream with neem and tulsi for skin protection and winter care." },

    // Ayurvedic
    { id: "med_liv52",           name: "Liv 52 DS",                 company: "Himalaya Drug Company",          catId: "cat_ayurvedic",        mrp: 120,  price: 108.00, desc: "Herbal liver supplement that supports liver function and protects against damage." },
    { id: "med_pudin_hara",      name: "Pudin Hara Liquid",         company: "Dabur India",                    catId: "cat_ayurvedic",        mrp: 30,   price: 27.00,  desc: "Natural peppermint formulation for instant relief from gas and stomach pain." },
    { id: "med_zandu_balm",      name: "Zandu Balm",                company: "Emami Limited",                  catId: "cat_ayurvedic",        mrp: 48,   price: 43.20,  desc: "Ayurvedic pain relief balm with saffron for headache, cold, and body pain." },

    // Diabetes Care
    { id: "med_glucon_d",        name: "Glucon-D Orange",           company: "Heinz India",                    catId: "cat_diabetes",         mrp: 78,   price: 70.20,  desc: "Glucose powder with vitamins for instant energy replenishment." },
    { id: "med_onetouch_strips",  name: "OneTouch Select Strips",   company: "Johnson & Johnson",              catId: "cat_diabetes",         mrp: 650,  price: 585.00, desc: "Blood glucose test strips compatible with OneTouch Select glucometer (25 strips)." },

    // Allergy
    { id: "med_cetirizine",      name: "Cetrizine 10mg",            company: "GSK India",                      catId: "cat_allergy",          mrp: 18,   price: 16.20,  desc: "Antihistamine tablet for relief from allergic rhinitis, urticaria, and skin rashes." },
    { id: "med_avil_25",         name: "Avil 25mg Tablet",          company: "Sanofi India",                   catId: "cat_allergy",          mrp: 22,   price: 19.80,  desc: "Pheniramine maleate antihistamine for allergic reactions, itching, and hay fever." },

    // Vitamins / supplements
    { id: "med_neurobion_forte",  name: "Neurobion Forte",          company: "Merck India",                    catId: "cat_vitamins",         mrp: 35,   price: 31.50,  desc: "B-complex vitamin supplement for nerve health and energy metabolism." },
    { id: "med_evion_400",        name: "Evion 400 Capsule",        company: "Merck India",                    catId: "cat_vitamins",         mrp: 68,   price: 61.20,  desc: "Vitamin E 400 IU capsule for skin health, immunity, and antioxidant support." },
    { id: "med_becosules",        name: "Becosules Capsule",        company: "Pfizer India",                   catId: "cat_multivitamins",    mrp: 65,   price: 58.50,  desc: "B-complex with Vitamin C for energy, metabolism, and healthy skin and hair." },

    // Eye & Ear
    { id: "med_otrivin",          name: "Otrivin Nasal Spray",      company: "Novartis India",                 catId: "cat_eye_ear",          mrp: 105,  price: 94.50,  desc: "Xylometazoline nasal spray for fast relief from nasal congestion and stuffy nose." },

    // Baby Care
    { id: "med_gripe_water",      name: "Woodward's Gripe Water",   company: "Reckitt",                        catId: "cat_baby_care",        mrp: 58,   price: 52.20,  desc: "Classic gripe water remedy for infant colic, gas, and stomach discomfort." },
    { id: "med_johnsons_powder",  name: "Johnson's Baby Powder",    company: "Kenvue",                         catId: "cat_baby_care",        mrp: 95,   price: 85.50,  desc: "Gentle talc-free baby powder to keep skin soft, dry, and rash-free." },

    // ── Cipla Medicines ───────────────────────────────────
    // Antibiotics
    { id: "med_ciplox_500",      name: "Ciplox 500mg",              company: "Cipla",  catId: "cat_antibiotics",  mrp: 95,   price: 85.50,  desc: "Ciprofloxacin antibiotic for urinary tract, respiratory, and skin infections." },
    { id: "med_azithral_500",    name: "Azithral 500mg",            company: "Cipla",  catId: "cat_antibiotics",  mrp: 85,   price: 76.50,  desc: "Azithromycin antibiotic for throat, ear, chest, and skin infections." },
    { id: "med_clavam_625",      name: "Clavam 625mg",              company: "Cipla",  catId: "cat_antibiotics",  mrp: 185,  price: 166.50, desc: "Amoxicillin + Clavulanate broad-spectrum antibiotic tablet." },
    // Respiratory
    { id: "med_asthalin_inhaler",name: "Asthalin Inhaler",          company: "Cipla",  catId: "cat_respiratory",  mrp: 120,  price: 108.00, desc: "Salbutamol inhaler for quick relief from asthma and bronchospasm." },
    { id: "med_budecort_inhaler",name: "Budecort 200 Inhaler",      company: "Cipla",  catId: "cat_respiratory",  mrp: 310,  price: 279.00, desc: "Budesonide inhaler for long-term asthma and COPD management." },
    { id: "med_seroflo_inhaler", name: "Seroflo 250 Inhaler",       company: "Cipla",  catId: "cat_respiratory",  mrp: 485,  price: 436.50, desc: "Fluticasone + Salmeterol combination inhaler for asthma control." },
    { id: "med_foracort_inhaler",name: "Foracort 200 Inhaler",      company: "Cipla",  catId: "cat_respiratory",  mrp: 445,  price: 400.50, desc: "Budesonide + Formoterol inhaler for asthma and COPD." },
    { id: "med_duolin_inhaler",  name: "Duolin Inhaler",            company: "Cipla",  catId: "cat_respiratory",  mrp: 175,  price: 157.50, desc: "Levosalbutamol + Ipratropium inhaler for bronchospasm relief." },
    // Cold & Allergy
    { id: "med_cetzine_10",      name: "Cetzine 10mg",              company: "Cipla",  catId: "cat_allergy",      mrp: 18,   price: 16.20,  desc: "Cetirizine antihistamine for allergic rhinitis, urticaria, and itching." },
    { id: "med_nasivion_drops",  name: "Nasivion 0.05% Nasal Drops",company: "Cipla",  catId: "cat_cold_cough",   mrp: 55,   price: 49.50,  desc: "Oxymetazoline nasal drops for fast relief from nasal congestion." },
    // Acidity & Stomach
    { id: "med_omez_20",         name: "Omez 20mg",                 company: "Cipla",  catId: "cat_acidity",      mrp: 65,   price: 58.50,  desc: "Omeprazole capsule for acidity, GERD, and peptic ulcer treatment." },
    { id: "med_pantocid_40",     name: "Pantocid 40mg",             company: "Cipla",  catId: "cat_acidity",      mrp: 72,   price: 64.80,  desc: "Pantoprazole tablet for acid reflux, gastric ulcer, and heartburn." },
    { id: "med_neksium_40",      name: "Neksium 40mg",              company: "Cipla",  catId: "cat_acidity",      mrp: 185,  price: 166.50, desc: "Esomeprazole tablet for severe acid reflux and erosive esophagitis." },
    // Pain & Fever
    { id: "med_ibugesic_plus",   name: "Ibugesic Plus Tablet",      company: "Cipla",  catId: "cat_cold_care",    mrp: 32,   price: 28.80,  desc: "Ibuprofen + Paracetamol combination for fever, pain, and inflammation." },
    { id: "med_nimulid_100",     name: "Nimulid 100mg",             company: "Cipla",  catId: "cat_pain_relief",  mrp: 28,   price: 25.20,  desc: "Nimesulide anti-inflammatory tablet for pain, fever, and arthritis." },
    // Skin
    { id: "med_candid_cream",    name: "Candid Cream",              company: "Cipla",  catId: "cat_skin_care",    mrp: 55,   price: 49.50,  desc: "Clotrimazole antifungal cream for ringworm, athlete's foot, and skin infections." },
    { id: "med_betnovate_c",     name: "Betnovate C Cream",         company: "Cipla",  catId: "cat_skin_care",    mrp: 62,   price: 55.80,  desc: "Betamethasone + Clioquinol cream for eczema, psoriasis, and fungal skin infections." },
    // Heart & BP
    { id: "med_stamlo_5",        name: "Stamlo 5mg",                company: "Cipla",  catId: "cat_heart_bp",     mrp: 42,   price: 37.80,  desc: "Amlodipine calcium channel blocker for hypertension and angina." },
    { id: "med_cilacar_10",      name: "Cilacar 10mg",              company: "Cipla",  catId: "cat_heart_bp",     mrp: 88,   price: 79.20,  desc: "Cilnidipine for high blood pressure with better tolerability." },
    // Diabetes
    { id: "med_glycomet_500",    name: "Glycomet 500mg",            company: "Cipla",  catId: "cat_diabetes",     mrp: 28,   price: 25.20,  desc: "Metformin tablet for type 2 diabetes blood sugar management." },
    { id: "med_glucobay_25",     name: "Glucobay 25mg",             company: "Cipla",  catId: "cat_diabetes",     mrp: 55,   price: 49.50,  desc: "Acarbose tablet to control post-meal blood sugar spikes in diabetes." },

    // ── Sun Pharma Medicines ──────────────────────────────
    { id: "med_sompraz_40_inj",  name: "Sompraz 40 Injection",      company: "Sun Pharma", catId: "cat_acidity",       mrp: 106.88, price: 96.19,   desc: "Pantoprazole injection for acid-related disorders, GERD, and gastric ulcers." },
    { id: "med_pregabalin_75",   name: "Sun Pregabalin 75 Tablet",  company: "Sun Pharma", catId: "cat_pain_relief",   mrp: 109.00, price: 98.10,   desc: "Pregabalin for neuropathic pain, diabetic nerve pain, and fibromyalgia." },
    { id: "med_famocid_20",      name: "Famocid 20 Tablet",         company: "Sun Pharma", catId: "cat_acidity",       mrp: 6.05,   price: 5.45,    desc: "Famotidine H2-blocker for acidity, heartburn, and peptic ulcers." },
    { id: "med_susten_vag_gel",  name: "Susten Vaginal Gel",        company: "Sun Pharma", catId: "cat_womens_health", mrp: 171.56, price: 154.40,  desc: "Progesterone vaginal gel for luteal phase support and pregnancy maintenance." },
    { id: "med_volibo_r",        name: "Volibo R 0.3/1 Tablet",     company: "Sun Pharma", catId: "cat_diabetes",      mrp: 177.19, price: 159.47,  desc: "Voglibose + Metformin combination to control post-meal blood sugar in type 2 diabetes." },
    { id: "med_parkitidin",      name: "Parkitidin Tablet",         company: "Sun Pharma", catId: "cat_neuro_sleep",   mrp: 164.06, price: 147.65,  desc: "Trihexyphenidyl for Parkinson's disease and drug-induced movement disorders." },
    { id: "med_brinzotim",       name: "Brinzotim Eye Drops",       company: "Sun Pharma", catId: "cat_eye_ear",       mrp: 383.44, price: 345.10,  desc: "Brinzolamide + Timolol eye drops to reduce intraocular pressure in glaucoma." },
    { id: "med_silverex_gel",    name: "Silverex Ionic Gel",        company: "Sun Pharma", catId: "cat_skin_care",     mrp: 0,      price: 0,       desc: "Silver nitrate ionic gel for wound healing, burns, and skin infections." },
    { id: "med_sonata_lr",       name: "Sonata LR Capsule",         company: "Sun Pharma", catId: "cat_neuro_sleep",   mrp: 396.50, price: 356.85,  desc: "Zaleplon modified-release capsule for short-term treatment of insomnia." },
    { id: "med_exel_m_cream",    name: "Exel M Cream",              company: "Sun Pharma", catId: "cat_skin_care",     mrp: 139.00, price: 125.10,  desc: "Mometasone topical corticosteroid cream for eczema, psoriasis, and dermatitis." },
    { id: "med_prolomet_r25",    name: "Prolomet R 25 Tablet",      company: "Sun Pharma", catId: "cat_heart_bp",      mrp: 224.00, price: 201.60,  desc: "Metoprolol succinate extended-release for hypertension, angina, and heart failure." },
    { id: "med_anaboom_shampoo", name: "Anaboom Shampoo",           company: "Sun Pharma", catId: "cat_personal_hygiene", mrp: 455.00, price: 409.50, desc: "Ketoconazole + Zinc shampoo for dandruff, seborrheic dermatitis, and hair fall." },
    { id: "med_anaboom_serum",   name: "Anaboom Hair Serum",        company: "Sun Pharma", catId: "cat_personal_hygiene", mrp: 1390.00, price: 1251.00, desc: "Redensyl + Anagain hair growth serum to reduce hair fall and stimulate regrowth." },
    { id: "med_renotin_caps",    name: "Renotin Capsules",          company: "Sun Pharma", catId: "cat_vitamins",      mrp: 918.00, price: 826.20,  desc: "Nephroprotective supplement with alpha-ketoacids for chronic kidney disease management." },
    { id: "med_dapefy_5",        name: "Dapefy 5 Tablet",           company: "Sun Pharma", catId: "cat_diabetes",      mrp: 163.00, price: 146.70,  desc: "Dapagliflozin SGLT2 inhibitor to lower blood sugar and reduce cardiovascular risk in type 2 diabetes." },

    // ── Micro Labs Medicines ──────────────────────────────
    // Fever & Pain (Dolo range)
    { id: "med_dolo_650",        name: "Dolo 650 Tablet",           company: "Micro Labs", catId: "cat_cold_care",     mrp: 33.76,  price: 30.38,  desc: "Paracetamol 650mg for fast relief from fever and mild to moderate pain." },
    { id: "med_dolo_500",        name: "Dolo 500 Tablet",           company: "Micro Labs", catId: "cat_cold_care",     mrp: 14.95,  price: 13.46,  desc: "Paracetamol 500mg tablet for fever, headache, and body pain." },
    { id: "med_dolo_extraa",     name: "Dolo Extraa Tablet",        company: "Micro Labs", catId: "cat_cold_care",     mrp: 47.20,  price: 42.48,  desc: "Paracetamol extended formulation for prolonged fever and pain relief." },
    { id: "med_dolo_cold",       name: "Dolo Cold Tablet",          company: "Micro Labs", catId: "cat_cold_cough",    mrp: 40.00,  price: 36.00,  desc: "Paracetamol + Phenylephrine combination for cold, nasal congestion, and fever." },
    { id: "med_dolo_spray_35",   name: "Dolo Spray 35gm",           company: "Micro Labs", catId: "cat_pain_relief",   mrp: 91.00,  price: 81.90,  desc: "Diclofenac topical spray for localized muscle and joint pain relief." },
    { id: "med_dolo_spray_55",   name: "Dolo Spray 55gm",           company: "Micro Labs", catId: "cat_pain_relief",   mrp: 150.00, price: 135.00, desc: "Diclofenac topical spray 55gm for extended relief from muscle and joint pain." },
    // Cold & Cough
    { id: "med_dolokoff_60",     name: "Dolokoff DX Syrup 60ml",    company: "Micro Labs", catId: "cat_cold_cough",    mrp: 49.50,  price: 44.55,  desc: "Dextromethorphan + Phenylephrine syrup for dry cough and nasal congestion." },
    { id: "med_dolokoff_100",    name: "Dolokoff DX Syrup 100ml",   company: "Micro Labs", catId: "cat_cold_cough",    mrp: 82.55,  price: 74.30,  desc: "Dextromethorphan + Phenylephrine syrup 100ml for cough and cold relief." },
    // Digestive
    { id: "med_cyclop",          name: "Cyclop Tablet",             company: "Micro Labs", catId: "cat_digestive",     mrp: 40.95,  price: 36.86,  desc: "Cyclopentolate antispasmodic for abdominal cramps, IBS, and stomach pain." },
    // Antibiotics
    { id: "med_microdox_lbx",    name: "Microdox LBX Capsule",      company: "Micro Labs", catId: "cat_antibiotics",   mrp: 97.00,  price: 87.30,  desc: "Doxycycline + Lactobacillus capsule for bacterial infections with gut protection." },
    { id: "med_micropod_200",    name: "Micropod 200 DT",           company: "Micro Labs", catId: "cat_antibiotics",   mrp: 89.00,  price: 80.10,  desc: "Cefpodoxime 200mg dispersible tablet for respiratory, urinary, and skin infections." },
    // Pain Relief
    { id: "med_rapid_hot_gel",   name: "Rapid Hot Gel",             company: "Micro Labs", catId: "cat_pain_relief",   mrp: 109.20, price: 98.28,  desc: "Diclofenac + Methyl salicylate warming gel for muscle pain, sprains, and stiffness." },
    // Vitamins & Supplements
    { id: "med_biovital",        name: "BioVital Capsule",          company: "Micro Labs", catId: "cat_multivitamins", mrp: 237.00, price: 213.30, desc: "Comprehensive multivitamin and mineral capsule for energy, immunity, and overall vitality." },
    { id: "med_meconerv_forte",  name: "Meconerv Forte",            company: "Micro Labs", catId: "cat_vitamins",      mrp: 90.00,  price: 81.00,  desc: "Methylcobalamin + B-vitamins for nerve repair, neuropathy, and vitamin B12 deficiency." },
    { id: "med_oxidon",          name: "Oxidon Capsule",            company: "Micro Labs", catId: "cat_vitamins",      mrp: 32.00,  price: 28.80,  desc: "Antioxidant supplement with vitamins C, E, and zinc for cellular protection." },
    { id: "med_oxidon_plus",     name: "Oxidon Plus Capsule",       company: "Micro Labs", catId: "cat_vitamins",      mrp: 138.75, price: 124.88, desc: "Advanced antioxidant formula with lycopene, selenium, and mixed carotenoids." },
    { id: "med_melcovit",        name: "Melcovit Capsule",          company: "Micro Labs", catId: "cat_vitamins",      mrp: 100.00, price: 90.00,  desc: "Methylcobalamin + Folic acid + B6 for nerve health and homocysteine management." },
    { id: "med_melcovit_gold",   name: "Melcovit Gold",             company: "Micro Labs", catId: "cat_vitamins",      mrp: 125.00, price: 112.50, desc: "Premium methylcobalamin + alpha lipoic acid combination for diabetic neuropathy." },
    { id: "med_bc300",           name: "BC-300 Capsule",            company: "Micro Labs", catId: "cat_vitamins",      mrp: 35.80,  price: 32.22,  desc: "Vitamin B-complex capsule for energy metabolism and nervous system support." },
    { id: "med_irex_12",         name: "Irex-12 Capsule",           company: "Micro Labs", catId: "cat_vitamins",      mrp: 10.00,  price: 9.00,   desc: "Iron + Vitamin B12 + Folic acid capsule for anemia and iron deficiency." },
    { id: "med_melvit",          name: "Melvit Capsule",            company: "Micro Labs", catId: "cat_vitamins",      mrp: 78.00,  price: 70.20,  desc: "Melatonin + vitamins supplement to support healthy sleep cycles." },
    // Eye & Ear
    { id: "med_lutivit",         name: "Lutivit Capsule",           company: "Micro Labs", catId: "cat_eye_ear",       mrp: 80.00,  price: 72.00,  desc: "Lutein + Zeaxanthin + vitamins for macular health and age-related eye protection." },
    // Acidity & Reflux
    { id: "med_pantoflux",       name: "Pantoflux Capsule",         company: "Micro Labs", catId: "cat_acidity",       mrp: 45.00,  price: 40.50,  desc: "Pantoprazole + Domperidone capsule for acid reflux, gastritis, and bloating." },
    { id: "med_omiflux",         name: "Omiflux Capsule",           company: "Micro Labs", catId: "cat_acidity",       mrp: 45.00,  price: 40.50,  desc: "Omeprazole + Domperidone capsule for GERD, acidity, and nausea." },
    { id: "med_esofag_20",       name: "Esofag 20 Tablet",          company: "Micro Labs", catId: "cat_acidity",       mrp: 19.00,  price: 17.10,  desc: "Esomeprazole 20mg for gastric acid suppression and GERD management." },
    { id: "med_esofag_40",       name: "Esofag 40 Tablet",          company: "Micro Labs", catId: "cat_acidity",       mrp: 38.00,  price: 34.20,  desc: "Esomeprazole 40mg for severe acid reflux, erosive esophagitis, and peptic ulcers." },
    { id: "med_esofag_d",        name: "Esofag-D Capsule",          company: "Micro Labs", catId: "cat_acidity",       mrp: 75.00,  price: 67.50,  desc: "Esomeprazole + Domperidone for acid reflux with nausea and gastroparesis." },
    { id: "med_rabiros_20",      name: "Rabiros 20 Tablet",         company: "Micro Labs", catId: "cat_acidity",       mrp: 30.96,  price: 27.86,  desc: "Rabeprazole 20mg proton pump inhibitor for peptic ulcer and GERD." },
    { id: "med_esotag_30",       name: "Esotag 30 Tablet",          company: "Micro Labs", catId: "cat_acidity",       mrp: 65.00,  price: 58.50,  desc: "Esomeprazole 30mg modified-release for sustained acid control." },
    { id: "med_helirab_d",       name: "Helirab-D Capsule",         company: "Micro Labs", catId: "cat_acidity",       mrp: 45.00,  price: 40.50,  desc: "Rabeprazole + Domperidone capsule for acid reflux with gastric motility issues." },
    // Diabetes
    { id: "med_diapride_2",      name: "Diapride 2 Tablet",         company: "Micro Labs", catId: "cat_diabetes",      mrp: 54.00,  price: 48.60,  desc: "Glimepiride 2mg sulfonylurea to stimulate insulin in type 2 diabetes." },
    { id: "med_diapride_4",      name: "Diapride 4 Tablet",         company: "Micro Labs", catId: "cat_diabetes",      mrp: 83.00,  price: 74.70,  desc: "Glimepiride 4mg for better blood sugar control in type 2 diabetes." },
    { id: "med_diabose_50",      name: "Diabose 50 Tablet",         company: "Micro Labs", catId: "cat_diabetes",      mrp: 85.00,  price: 76.50,  desc: "Acarbose 50mg to reduce post-meal blood sugar spikes in type 2 diabetes." },
    { id: "med_dianorm_od",      name: "Dianorm OD 30",             company: "Micro Labs", catId: "cat_diabetes",      mrp: 25.00,  price: 22.50,  desc: "Gliclazide modified-release 30mg for sustained blood glucose control." },
    { id: "med_dibizide_5",      name: "Dibizide 5 Tablet",         company: "Micro Labs", catId: "cat_diabetes",      mrp: 4.86,   price: 4.37,   desc: "Glipizide 5mg to stimulate insulin secretion in type 2 diabetes." },
    // Heart & BP
    { id: "med_angiplat_2_5",    name: "Angiplat 2.5 Capsule",      company: "Micro Labs", catId: "cat_heart_bp",      mrp: 194.00, price: 174.60, desc: "Ticagrelor 2.5mg antiplatelet to prevent blood clots after heart attack or ACS." },
    { id: "med_plagerine_a",     name: "Plagerine-A Capsule",       company: "Micro Labs", catId: "cat_heart_bp",      mrp: 30.00,  price: 27.00,  desc: "Clopidogrel + Aspirin dual antiplatelet for post-cardiac event protection." },
    { id: "med_carvidon_od",     name: "Carvidon OD Capsule",       company: "Micro Labs", catId: "cat_heart_bp",      mrp: 135.00, price: 121.50, desc: "Trimetazidine OD for angina, improves cardiac efficiency and reduces chest pain." },
    { id: "med_nebilong_2_5",    name: "Nebilong 2.5 Tablet",       company: "Micro Labs", catId: "cat_heart_bp",      mrp: 35.00,  price: 31.50,  desc: "Nebivolol beta-blocker for hypertension and heart failure with better tolerability." },
    { id: "med_metadure_2_5",    name: "Metadure 2.5 Tablet",       company: "Micro Labs", catId: "cat_heart_bp",      mrp: 50.00,  price: 45.00,  desc: "Metolazone diuretic for oedema and resistant hypertension." },
    { id: "med_metapro_xl25",    name: "Metapro XL 25",             company: "Micro Labs", catId: "cat_heart_bp",      mrp: 60.00,  price: 54.00,  desc: "Metoprolol succinate XL 25mg extended-release for hypertension and angina." },
    { id: "med_metapro_25",      name: "Metapro 25 Tablet",         company: "Micro Labs", catId: "cat_heart_bp",      mrp: 12.50,  price: 11.25,  desc: "Metoprolol tartrate 25mg for high blood pressure and heart rate control." },
    { id: "med_amlong_mt25",     name: "Amlong MT 25",              company: "Micro Labs", catId: "cat_heart_bp",      mrp: 65.00,  price: 58.50,  desc: "Amlodipine + Metoprolol combination for hypertension with better BP control." },
    { id: "med_rosinorm_2",      name: "Rosinorm 2 Tablet",         company: "Micro Labs", catId: "cat_heart_bp",      mrp: 33.00,  price: 29.70,  desc: "Rosuvastatin 2mg low-dose statin for mild hypercholesterolaemia." },
    { id: "med_rosinorm_4",      name: "Rosinorm 4 Tablet",         company: "Micro Labs", catId: "cat_heart_bp",      mrp: 58.00,  price: 52.20,  desc: "Rosuvastatin 4mg statin to lower LDL and reduce cardiovascular risk." },
    { id: "med_angifree_20",     name: "Angifree 20 Tablet",        company: "Micro Labs", catId: "cat_heart_bp",      mrp: 120.00, price: 108.00, desc: "Isosorbide mononitrate 20mg for prevention and treatment of angina." },
    { id: "med_angifree_30",     name: "Angifree 30 Tablet",        company: "Micro Labs", catId: "cat_heart_bp",      mrp: 145.00, price: 130.50, desc: "Isosorbide mononitrate 30mg sustained-release for angina prophylaxis." },
    { id: "med_arbitel_80",      name: "Arbitel 80 Tablet",         company: "Micro Labs", catId: "cat_heart_bp",      mrp: 210.00, price: 189.00, desc: "Telmisartan 80mg ARB for hypertension and cardiovascular risk reduction." },
    { id: "med_avas_20",         name: "Avas 20 Tablet",            company: "Micro Labs", catId: "cat_heart_bp",      mrp: 110.00, price: 99.00,  desc: "Atorvastatin 20mg to lower bad cholesterol and prevent cardiovascular disease." },
    { id: "med_astin_80",        name: "Astin 80 Tablet",           company: "Micro Labs", catId: "cat_heart_bp",      mrp: 165.00, price: 148.50, desc: "Atorvastatin 80mg high-intensity statin for aggressive cholesterol management." },

  ];

  for (const m of otc) {
    await pool.query(
      `INSERT INTO medirush_medicines (id, name, price, mrp, company, category_id, image_url, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [m.id, m.name, m.price, m.mrp, m.company, m.catId, svgDataUrl(m.name.split(" ")[0], "%2300C853"), m.desc]
    );
  }
}

const ready = ensureTables().then(() => ensureSeedData()).then(() => ensureOtcProducts()).catch((err) => {
  console.warn("DB init skipped:", err?.message ?? err);
});

async function getCartPayload(userId: string) {
  const [cartResult, medicines, categories] = await Promise.all([
    pool.query<{ id: string; medicine_id: string; quantity: number }>(
      `SELECT id, medicine_id, quantity FROM medirush_cart_items WHERE user_id = $1`, [userId]
    ),
    db.select().from(medicinesTable),
    db.select().from(categoriesTable),
  ]);

  const items: CartLine[] = cartResult.rows.flatMap((row) => {
    const medicine = medicines.find((item) => item.id === row.medicine_id);
    if (!medicine) return [];
    return [{ medicine: serializeMedicine(medicine, categories), quantity: row.quantity }];
  });

  const total = items.reduce((sum, item) => sum + item.medicine.price * item.quantity, 0);
  return { items, total };
}

router.use(async (_req, _res, next) => {
  await ready;
  next();
});

router.post("/auth/signup", async (req, res) => {
  const body = SignupBody.parse(req.body);
  const existing = await db.select().from(usersTable).where(sql`"email" = ${body.email} OR "phone" = ${body.phone}`).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ message: "An account already exists for this email or phone" });
    return;
  }
  const user = { id: id("usr"), fullName: body.fullName, phone: body.phone, email: body.email, passwordHash: hashPassword(body.password), location: body.location, role: "user" as Role };
  await pool.query(
    `INSERT INTO medirush_users (id, full_name, phone, email, password_hash, location, role) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [user.id, user.fullName, user.phone, user.email, user.passwordHash, user.location, user.role]
  );
  res.status(201).json({ token: signToken({ id: user.id, role: user.role }), user: { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, location: user.location, role: user.role } });
});

router.patch("/auth/password", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ message: "New password must be at least 6 characters" });
    return;
  }
  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM medirush_users WHERE id=$1`, [userId]
  );
  if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
    res.status(400).json({ message: "Current password is incorrect" });
    return;
  }
  await pool.query(`UPDATE medirush_users SET password_hash=$1 WHERE id=$2`, [hashPassword(newPassword), userId]);
  res.json({ message: "Password updated" });
});

router.patch("/auth/profile", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { fullName, phone, location } = req.body as { fullName?: string; phone?: string; location?: string };
  const sets: string[] = []; const vals: unknown[] = []; let p = 1;
  if (fullName?.trim()) { sets.push(`full_name=$${p++}`); vals.push(fullName.trim()); }
  if (phone?.trim()) { sets.push(`phone=$${p++}`); vals.push(phone.trim()); }
  if (location?.trim()) { sets.push(`location=$${p++}`); vals.push(location.trim()); }
  if (sets.length === 0) { res.status(400).json({ message: "Nothing to update" }); return; }
  vals.push(userId);
  const { rows } = await pool.query<{ id: string; full_name: string; phone: string; email: string; location: string; role: string }>(
    `UPDATE medirush_users SET ${sets.join(",")} WHERE id=$${p} RETURNING *`, vals
  );
  if (!rows[0]) { res.status(404).json({ message: "User not found" }); return; }
  const u = rows[0];
  res.json({ id: u.id, fullName: u.full_name, phone: u.phone, email: u.email, location: u.location, role: u.role });
});

router.post("/auth/login", async (req, res) => {
  const body = LoginBody.parse(req.body);
  const users = await db.select().from(usersTable).where(sql`"email" = ${body.identifier} OR "phone" = ${body.identifier}`).limit(1);
  const user = users[0];
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    res.status(401).json({ message: "Invalid email/phone or password" });
    return;
  }
  const role = user.role as Role;
  res.json({ token: signToken({ id: user.id, role }), user: serializeUser(user) });
});

router.get("/medicines", async (req, res) => {
  const params = ListMedicinesQueryParams.parse(req.query);
  const [medicines, categories] = await Promise.all([db.select().from(medicinesTable), db.select().from(categoriesTable)]);
  const search = params.search?.trim().toLowerCase();
  const filtered = medicines.filter((medicine) => {
    const matchesSearch = !search || medicine.name.toLowerCase().includes(search) || medicine.description.toLowerCase().includes(search);
    const matchesCategory = !params.categoryId || medicine.categoryId === params.categoryId;
    return matchesSearch && matchesCategory;
  });
  res.json(filtered.map((medicine) => serializeMedicine(medicine, categories)));
});

router.post("/medicines", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const body = CreateMedicineBody.parse(req.body);
  const medicine = { id: id("med"), ...body };
  await pool.query(
    `INSERT INTO medirush_medicines (id, name, price, mrp, company, stock, category_id, image_url, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [medicine.id, medicine.name, medicine.price, medicine.mrp ?? null, medicine.company ?? null, (medicine as any).stock ?? null, medicine.categoryId, medicine.imageUrl, medicine.description]
  );
  const categories = await db.select().from(categoriesTable);
  res.status(201).json(serializeMedicine(medicine as any, categories));
});

router.put("/medicines/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const params = UpdateMedicineParams.parse(req.params);
  const body = UpdateMedicineBody.parse(req.body);
  const sets: string[] = []; const vals: unknown[] = []; let p = 1;
  if (body.name !== undefined) { sets.push(`name=$${p++}`); vals.push(body.name); }
  if ((body as any).price !== undefined) { sets.push(`price=$${p++}`); vals.push((body as any).price); }
  if ((body as any).mrp !== undefined) { sets.push(`mrp=$${p++}`); vals.push((body as any).mrp); }
  if ((body as any).company !== undefined) { sets.push(`company=$${p++}`); vals.push((body as any).company); }
  if ((body as any).stock !== undefined) { sets.push(`stock=$${p++}`); vals.push((body as any).stock); }
  if ((body as any).categoryId !== undefined) { sets.push(`category_id=$${p++}`); vals.push((body as any).categoryId); }
  if ((body as any).imageUrl !== undefined) { sets.push(`image_url=$${p++}`); vals.push((body as any).imageUrl); }
  if ((body as any).description !== undefined) { sets.push(`description=$${p++}`); vals.push((body as any).description); }
  if (sets.length === 0) { res.status(400).json({ message: "Nothing to update" }); return; }
  vals.push(params.id);
  const medResult = await pool.query<{ id: string; name: string; price: number; mrp: number | null; company: string | null; category_id: string; image_url: string; description: string; created_at: Date }>(
    `UPDATE medirush_medicines SET ${sets.join(",")} WHERE id=$${p} RETURNING *`, vals
  );
  if (!medResult.rows[0]) { res.status(404).json({ message: "Medicine not found" }); return; }
  const m = medResult.rows[0];
  const categories = await db.select().from(categoriesTable);
  res.json(serializeMedicine({ id: m.id, name: m.name, price: m.price, mrp: m.mrp, company: m.company, categoryId: m.category_id, imageUrl: m.image_url, description: m.description, createdAt: m.created_at } as MedicineRow, categories));
});

router.delete("/medicines/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const params = DeleteMedicineParams.parse(req.params);
  await db.delete(cartItemsTable).where(sql`"medicine_id" = ${params.id}`);
  await db.delete(medicinesTable).where(sql`"id" = ${params.id}`);
  res.status(204).send();
});

router.get("/categories", async (_req, res) => {
  const categories = await db.select().from(categoriesTable);
  res.json(categories.map((category) => ({ id: category.id, name: category.name })));
});

router.post("/categories", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const body = CreateCategoryBody.parse(req.body);
  const category = { id: id("cat"), name: body.name };
  await db.insert(categoriesTable).values(category);
  res.status(201).json(category);
});

router.delete("/categories/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const params = DeleteCategoryParams.parse(req.params);
  await db.delete(categoriesTable).where(sql`"id" = ${params.id}`);
  res.status(204).send();
});

router.get("/cart", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(await getCartPayload(userId));
});

router.post("/cart", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = AddCartItemBody.parse(req.body);
  const existing = await pool.query<{ id: string; quantity: number }>(
    `SELECT id, quantity FROM medirush_cart_items WHERE user_id=$1 AND medicine_id=$2 LIMIT 1`,
    [userId, body.medicineId]
  );
  if (existing.rows[0]) {
    await pool.query(`UPDATE medirush_cart_items SET quantity=$1 WHERE id=$2`, [existing.rows[0].quantity + body.quantity, existing.rows[0].id]);
  } else {
    await pool.query(`INSERT INTO medirush_cart_items (id,user_id,medicine_id,quantity) VALUES ($1,$2,$3,$4)`, [id("cart"), userId, body.medicineId, body.quantity]);
  }
  res.json(await getCartPayload(userId));
});

router.patch("/cart/:medicineId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = UpdateCartItemParams.parse(req.params);
  const body = UpdateCartItemBody.parse(req.body);
  if (body.quantity <= 0) {
    await db.delete(cartItemsTable).where(sql`"user_id" = ${userId} AND "medicine_id" = ${params.medicineId}`);
  } else {
    await db.update(cartItemsTable).set({ quantity: body.quantity }).where(sql`"user_id" = ${userId} AND "medicine_id" = ${params.medicineId}`);
  }
  res.json(await getCartPayload(userId));
});

router.delete("/cart/:medicineId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = RemoveCartItemParams.parse(req.params);
  await db.delete(cartItemsTable).where(sql`"user_id" = ${userId} AND "medicine_id" = ${params.medicineId}`);
  res.json(await getCartPayload(userId));
});

router.delete("/cart", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await db.delete(cartItemsTable).where(sql`"user_id" = ${userId}`);
  res.json(await getCartPayload(userId));
});

router.post("/prescriptions", async (req, res) => {
  const body = UploadPrescriptionBody.parse(req.body);
  const prescription = { id: id("rx"), fileName: body.fileName, imageUrl: body.dataUrl };
  const rxResult = await pool.query<{ id: string; file_name: string; image_url: string; created_at: Date }>(
    `INSERT INTO medirush_prescriptions (id,file_name,image_url) VALUES ($1,$2,$3) RETURNING *`,
    [prescription.id, prescription.fileName, prescription.imageUrl]
  );
  const row = rxResult.rows[0];
  res.status(201).json({ id: row.id, fileName: row.file_name, imageUrl: row.image_url, createdAt: new Date(row.created_at).toISOString() });
});

router.get("/orders", async (req, res) => {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  type OrderRow = { id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; delivery_instructions: string | null; rating: number | null; created_at: Date };
  const serializeOrder = (o: OrderRow, extra?: { customerName?: string; customerPhone?: string }) => ({
    id: o.id, userId: o.user_id, items: o.items, total: o.total,
    paymentMethod: o.payment_method as "cod" | "upi", status: o.status,
    etaMinutes: o.eta_minutes, prescriptionId: o.prescription_id ?? undefined,
    deliveryAddress: o.delivery_address,
    deliveryInstructions: o.delivery_instructions ?? undefined,
    rating: o.rating ?? undefined,
    createdAt: new Date(o.created_at).toISOString(),
    ...extra,
  });
  if (token.role === "owner") {
    const { rows } = await pool.query<OrderRow>(`SELECT * FROM medirush_orders ORDER BY created_at DESC`);
    const userIds = [...new Set(rows.map(o => o.user_id).filter(Boolean))];
    const usersRes = userIds.length > 0
      ? await pool.query<{ id: string; full_name: string; phone: string }>(`SELECT id,full_name,phone FROM medirush_users WHERE id=ANY($1::text[])`, [userIds])
      : { rows: [] as { id: string; full_name: string; phone: string }[] };
    const userMap = new Map(usersRes.rows.map(u => [u.id, u]));
    res.json(rows.map(o => { const u = userMap.get(o.user_id); return serializeOrder(o, { customerName: u?.full_name, customerPhone: u?.phone }); }));
  } else {
    const { rows } = await pool.query<OrderRow>(`SELECT * FROM medirush_orders WHERE user_id=$1 ORDER BY created_at DESC`, [token.id]);
    res.json(rows.map(o => serializeOrder(o)));
  }
});

router.patch("/orders/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { id } = req.params;
  const { status } = req.body as { status: string };
  const validStatuses = ["Placed", "Out for Delivery", "Delivered"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ message: "Invalid status" });
    return;
  }
  const orderRes = await pool.query<{ id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; delivery_instructions: string | null; rating: number | null; created_at: Date }>(
    `UPDATE medirush_orders SET status=$1 WHERE id=$2 RETURNING *`, [status, id]
  );
  if (!orderRes.rows[0]) { res.status(404).json({ message: "Order not found" }); return; }
  const row = orderRes.rows[0];
  res.json({ id: row.id, userId: row.user_id, items: row.items, total: row.total, paymentMethod: row.payment_method as "cod" | "upi", status: row.status, etaMinutes: row.eta_minutes, prescriptionId: row.prescription_id ?? undefined, deliveryAddress: row.delivery_address, deliveryInstructions: row.delivery_instructions ?? undefined, rating: row.rating ?? undefined, createdAt: new Date(row.created_at).toISOString() });
});

router.post("/orders", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = CreateOrderBody.parse(req.body);
  const cart = await getCartPayload(userId);
  if (cart.items.length === 0) {
    res.status(400).json({ message: "Add at least one medicine before checkout" });
    return;
  }
  const order = { id: id("ord"), userId, items: cart.items, total: cart.total, paymentMethod: body.paymentMethod, status: "Placed", etaMinutes: 10 + Math.floor(Math.random() * 11), prescriptionId: body.prescriptionId ?? null, deliveryAddress: body.deliveryAddress, deliveryInstructions: body.deliveryInstructions ?? null };
  const orderRes = await pool.query<{ id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; delivery_instructions: string | null; rating: number | null; created_at: Date }>(
    `INSERT INTO medirush_orders (id,user_id,items,total,payment_method,status,eta_minutes,prescription_id,delivery_address,delivery_instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [order.id, order.userId, JSON.stringify(order.items), order.total, order.paymentMethod, order.status, order.etaMinutes, order.prescriptionId, order.deliveryAddress, order.deliveryInstructions]
  );
  await pool.query(`DELETE FROM medirush_cart_items WHERE user_id=$1`, [userId]);
  // Decrement stock for each ordered item
  for (const item of cart.items) {
    await pool.query(
      `UPDATE medirush_medicines SET stock = GREATEST(0, stock - $1) WHERE id = $2 AND stock IS NOT NULL`,
      [item.quantity, item.medicine.id]
    );
  }
  const row = orderRes.rows[0];
  res.status(201).json({ id: row.id, userId: row.user_id, items: row.items, total: row.total, paymentMethod: row.payment_method as "cod" | "upi", status: row.status, etaMinutes: row.eta_minutes, prescriptionId: row.prescription_id ?? undefined, deliveryAddress: row.delivery_address, deliveryInstructions: row.delivery_instructions ?? undefined, rating: row.rating ?? undefined, createdAt: new Date(row.created_at).toISOString() });
});

router.get("/saved-addresses", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query<{ id: string; label: string; address: string; created_at: Date }>(
    `SELECT id, label, address, created_at FROM medirush_saved_addresses WHERE user_id=$1 ORDER BY created_at DESC`, [userId]
  );
  res.json(rows.map(r => ({ id: r.id, label: r.label, address: r.address, createdAt: new Date(r.created_at).toISOString() })));
});

router.post("/saved-addresses", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { label, address } = req.body as { label: string; address: string };
  if (!label?.trim() || !address?.trim()) { res.status(400).json({ message: "label and address are required" }); return; }
  const result = await pool.query<{ id: string; label: string; address: string; created_at: Date }>(
    `INSERT INTO medirush_saved_addresses (id,user_id,label,address) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id("addr"), userId, label.trim(), address.trim()]
  );
  const r = result.rows[0];
  res.status(201).json({ id: r.id, label: r.label, address: r.address, createdAt: new Date(r.created_at).toISOString() });
});

router.delete("/saved-addresses/:id", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await pool.query(`DELETE FROM medirush_saved_addresses WHERE id=$1 AND user_id=$2`, [req.params.id, userId]);
  res.status(204).send();
});

router.post("/orders/:id/cancel", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query<{ status: string; user_id: string }>(
    `SELECT status, user_id FROM medirush_orders WHERE id=$1`, [req.params.id]
  );
  const order = rows[0];
  if (!order) { res.status(404).json({ message: "Order not found" }); return; }
  if (order.user_id !== userId) { res.status(403).json({ message: "Forbidden" }); return; }
  if (order.status !== "Placed") { res.status(400).json({ message: "Order cannot be cancelled anymore" }); return; }
  await pool.query(`UPDATE medirush_orders SET status='Cancelled' WHERE id=$1`, [req.params.id]);
  res.json({ message: "Order cancelled" });
});

router.post("/orders/:id/rate", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const rating = Number((req.body as any).rating);
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ message: "Rating must be 1 to 5" }); return; }
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM medirush_orders WHERE id=$1`, [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ message: "Order not found" }); return; }
  if (rows[0].user_id !== userId) { res.status(403).json({ message: "Forbidden" }); return; }
  await pool.query(`UPDATE medirush_orders SET rating=$1 WHERE id=$2`, [rating, req.params.id]);
  res.json({ message: "Rated" });
});

router.get("/dashboard/summary", async (_req, res) => {
  const [medicines, categories, orders] = await Promise.all([db.select().from(medicinesTable), db.select().from(categoriesTable), db.select().from(ordersTable)]);
  res.json({ medicines: medicines.length, categories: categories.length, orders: orders.length, revenue: orders.reduce((sum, order) => sum + order.total, 0) });
});

router.get("/debug/status", async (_req, res) => {
  try {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'medirush_%' ORDER BY table_name`
    );
    const tables = rows.map(r => r.table_name);
    let cartTest = "ok";
    try {
      await pool.query(`SELECT 1 FROM medirush_cart_items WHERE user_id = $1 LIMIT 1`, ["test"]);
    } catch (e: any) { cartTest = e.message; }
    res.json({ tables, cartTest, env: { hasDb: !!process.env.DATABASE_URL } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/config/store", async (_req, res) => {
  const { rows } = await pool.query<{ value: string }>(`SELECT value FROM medirush_settings WHERE key='hide_oos'`);
  res.json({ hideOutOfStock: rows[0]?.value === "true" });
});

router.patch("/config/store", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { hideOutOfStock } = req.body as { hideOutOfStock: boolean };
  await pool.query(
    `INSERT INTO medirush_settings (key, value) VALUES ('hide_oos', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [String(!!hideOutOfStock)]
  );
  res.json({ hideOutOfStock: !!hideOutOfStock });
});

// ── Tests ────────────────────────────────────────────────
router.get("/tests", async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM medirush_tests ORDER BY created_at ASC`);
  res.json(rows.map((r: any) => ({ id: r.id, name: r.name, price: r.price, description: r.description, preparation: r.preparation, turnaroundTime: r.turnaround_time, createdAt: r.created_at })));
});

router.post("/tests", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { name, price, description, preparation, turnaroundTime } = req.body as any;
  if (!name || !price) { res.status(400).json({ message: "name and price required" }); return; }
  const testId = id("tst");
  await pool.query(`INSERT INTO medirush_tests (id,name,price,description,preparation,turnaround_time) VALUES ($1,$2,$3,$4,$5,$6)`, [testId, name, Number(price), description || null, preparation || null, turnaroundTime || "24 hrs"]);
  const { rows } = await pool.query(`SELECT * FROM medirush_tests WHERE id=$1`, [testId]);
  const r = rows[0] as any;
  res.status(201).json({ id: r.id, name: r.name, price: r.price, description: r.description, preparation: r.preparation, turnaroundTime: r.turnaround_time, createdAt: r.created_at });
});

router.put("/tests/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { name, price, description, preparation, turnaroundTime } = req.body as any;
  await pool.query(`UPDATE medirush_tests SET name=$1,price=$2,description=$3,preparation=$4,turnaround_time=$5 WHERE id=$6`, [name, Number(price), description || null, preparation || null, turnaroundTime || "24 hrs", req.params.id]);
  res.json({ message: "Updated" });
});

router.delete("/tests/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  await pool.query(`DELETE FROM medirush_tests WHERE id=$1`, [req.params.id]);
  res.status(204).send();
});

// ── Test Bookings ─────────────────────────────────────────
router.get("/test-bookings", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query(`SELECT * FROM medirush_test_bookings WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
  res.json(rows.map((r: any) => ({ id: r.id, tests: r.tests, total: r.total, date: r.date, timeSlot: r.time_slot, collectionType: r.collection_type, address: r.address, status: r.status, createdAt: r.created_at })));
});

router.post("/test-bookings", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { tests, total, date, timeSlot, collectionType, address } = req.body as any;
  if (!tests?.length || !date || !timeSlot || !collectionType || !address) { res.status(400).json({ message: "Missing required fields" }); return; }
  const userRows = await pool.query<{ full_name: string; phone: string }>(`SELECT full_name, phone FROM medirush_users WHERE id=$1`, [userId]);
  const u = userRows.rows[0];
  const bookingId = id("tbk");
  await pool.query(`INSERT INTO medirush_test_bookings (id,user_id,user_name,user_phone,tests,total,date,time_slot,collection_type,address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [bookingId, userId, u?.full_name ?? "", u?.phone ?? "", JSON.stringify(tests), total, date, timeSlot, collectionType, address]);
  res.status(201).json({ id: bookingId, message: "Booking confirmed" });
});

router.get("/test-bookings/all", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { rows } = await pool.query(`SELECT * FROM medirush_test_bookings ORDER BY created_at DESC`);
  res.json(rows.map((r: any) => ({ id: r.id, userId: r.user_id, userName: r.user_name, userPhone: r.user_phone, tests: r.tests, total: r.total, date: r.date, timeSlot: r.time_slot, collectionType: r.collection_type, address: r.address, status: r.status, createdAt: r.created_at })));
});

router.patch("/test-bookings/:id", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { status } = req.body as { status: string };
  await pool.query(`UPDATE medirush_test_bookings SET status=$1 WHERE id=$2`, [status, req.params.id]);
  res.json({ message: "Updated" });
});

router.get("/config/payment", (_req, res) => {
  res.json({
    upiId: process.env.UPI_ID ?? "medirush@upi",
    qrCodeImageUrl: process.env.QR_CODE_IMAGE_URL ?? svgDataUrl("UPI QR", "%2300C853"),
  });
});

export default router;
