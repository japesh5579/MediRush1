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
    "Thyroid Care":      "cat_thyroid",
    "Vaccines":          "cat_vaccines",
    "Oncology":          "cat_oncology",
    "Health Drinks":     "cat_health_drinks",
    "Medical Devices":   "cat_medical_devices",
    "Feminine Care":     "cat_feminine_care",
    "Grooming":          "cat_grooming",
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

    // ── Himalaya Medicines ──────────────────────────────
    { id: "med_liv52_ds",            name: "Liv.52 DS",                  company: "Himalaya", catId: "cat_ayurvedic",        mrp: 165,  price: 148.50, desc: "Double-strength herbal liver tonic for hepatic protection and liver function support." },
    { id: "med_liv52_syrup",         name: "Liv.52 Syrup",               company: "Himalaya", catId: "cat_ayurvedic",        mrp: 145,  price: 130.50, desc: "Herbal liver syrup for appetite improvement and protection against liver damage." },
    { id: "med_septilin",            name: "Septilin Tablet",             company: "Himalaya", catId: "cat_ayurvedic",        mrp: 155,  price: 139.50, desc: "Herbal immunomodulator to strengthen immunity and fight recurrent infections." },
    { id: "med_cystone",             name: "Cystone Tablet",              company: "Himalaya", catId: "cat_ayurvedic",        mrp: 145,  price: 130.50, desc: "Herbal formulation for kidney stone dissolution and urinary tract infection relief." },
    { id: "med_rumalaya_forte",      name: "Rumalaya Forte",              company: "Himalaya", catId: "cat_pain_relief",      mrp: 185,  price: 166.50, desc: "Herbal tablet for arthritis, joint pain, and musculoskeletal inflammation." },
    { id: "med_bresol_syrup",        name: "Bresol Syrup",                company: "Himalaya", catId: "cat_respiratory",      mrp: 135,  price: 121.50, desc: "Herbal respiratory syrup for bronchial asthma, allergic rhinitis, and sinusitis." },
    { id: "med_bonnisan_syrup",      name: "Bonnisan Syrup",              company: "Himalaya", catId: "cat_baby_care",        mrp: 125,  price: 112.50, desc: "Herbal baby digestive tonic for colic, indigestion, and flatulence in infants." },
    { id: "med_mentat",              name: "Mentat Tablet",               company: "Himalaya", catId: "cat_ayurvedic",        mrp: 175,  price: 157.50, desc: "Herbal brain tonic to improve memory, concentration, and cognitive function." },
    { id: "med_koflet_syrup",        name: "Koflet Syrup",                company: "Himalaya", catId: "cat_cold_cough",       mrp: 110,  price: 99.00,  desc: "Herbal cough syrup with honey for dry and productive cough relief." },
    { id: "med_pilex_forte",         name: "Pilex Forte",                 company: "Himalaya", catId: "cat_ayurvedic",        mrp: 160,  price: 144.00, desc: "Herbal tablet for piles and haemorrhoids to reduce bleeding, pain, and swelling." },
    { id: "med_purim",               name: "Purim Tablet",                company: "Himalaya", catId: "cat_skin_care",        mrp: 150,  price: 135.00, desc: "Herbal blood purifier for acne, skin infections, and inflammatory skin conditions." },
    { id: "med_tentex_forte",        name: "Tentex Forte",                company: "Himalaya", catId: "cat_ayurvedic",        mrp: 210,  price: 189.00, desc: "Herbal tablet for male sexual health, libido, and stress-related dysfunction." },
    { id: "med_geriforte",           name: "Geriforte",                   company: "Himalaya", catId: "cat_ayurvedic",        mrp: 185,  price: 166.50, desc: "Herbal anti-stress adaptogen for general wellness, vitality, and healthy aging." },
    { id: "med_confido",             name: "Confido Tablet",              company: "Himalaya", catId: "cat_ayurvedic",        mrp: 175,  price: 157.50, desc: "Herbal tablet for premature ejaculation and male sexual performance." },
    { id: "med_gasex",               name: "Gasex Tablet",                company: "Himalaya", catId: "cat_digestive",        mrp: 145,  price: 130.50, desc: "Herbal antiflatulent for gas, bloating, and abdominal discomfort." },
    { id: "med_diabecon_ds",         name: "Diabecon DS",                 company: "Himalaya", catId: "cat_diabetes",         mrp: 215,  price: 193.50, desc: "Herbal double-strength tablet to control blood sugar in type 2 diabetes." },
    { id: "med_himalaya_neem_fw",    name: "Neem Face Wash",              company: "Himalaya", catId: "cat_skin_care",        mrp: 140,  price: 126.00, desc: "Neem-based face wash for deep cleansing, acne control, and oil removal." },
    { id: "med_himalaya_neem_pack",  name: "Purifying Neem Pack",         company: "Himalaya", catId: "cat_skin_care",        mrp: 135,  price: 121.50, desc: "Herbal face pack with neem and turmeric for purified, clear, and radiant skin." },
    { id: "med_himalaya_ahf_shamp",  name: "Anti Hair Fall Shampoo",      company: "Himalaya", catId: "cat_personal_hygiene", mrp: 160,  price: 144.00, desc: "Herbal shampoo with bhringaraja and chickpea to reduce hair fall." },
    { id: "med_himalaya_prot_shamp", name: "Protein Shampoo",             company: "Himalaya", catId: "cat_personal_hygiene", mrp: 175,  price: 157.50, desc: "Protein-enriched herbal shampoo for strength, shine, and damage repair." },
    { id: "med_himalaya_baby_cream", name: "Baby Cream",                  company: "Himalaya", catId: "cat_baby_care",        mrp: 145,  price: 130.50, desc: "Gentle moisturising baby cream with olive oil for soft and healthy skin." },
    { id: "med_himalaya_baby_lot",   name: "Baby Lotion",                 company: "Himalaya", catId: "cat_baby_care",        mrp: 185,  price: 166.50, desc: "Nourishing baby lotion with olive oil for soft, healthy, and hydrated baby skin." },
    { id: "med_himalaya_baby_soap",  name: "Baby Soap",                   company: "Himalaya", catId: "cat_baby_care",        mrp: 75,   price: 67.50,  desc: "Gentle herbal baby soap with olive oil for delicate baby skin." },
    { id: "med_himalaya_baby_pwd",   name: "Baby Powder",                 company: "Himalaya", catId: "cat_baby_care",        mrp: 165,  price: 148.50, desc: "Talc-free herbal baby powder with khus khus for rash prevention and freshness." },
    { id: "med_himalaya_baby_wipe",  name: "Baby Wipes",                  company: "Himalaya", catId: "cat_baby_care",        mrp: 110,  price: 99.00,  desc: "Gentle hypoallergenic baby wipes with aloe vera for safe and thorough cleaning." },
    { id: "med_himalaya_baby_pant",  name: "Total Care Baby Pants",       company: "Himalaya", catId: "cat_baby_care",        mrp: 499,  price: 449.10, desc: "Ultra-soft diaper pants with aloe vera for all-night dryness and comfort." },
    { id: "med_himalaya_adult_m",    name: "Adult Diaper Medium",         company: "Himalaya", catId: "cat_personal_hygiene", mrp: 609,  price: 548.10, desc: "Absorbent adult diapers for incontinence, post-surgery care, and mobility support." },
    { id: "med_himalaya_adult_l",    name: "Adult Diaper Large",          company: "Himalaya", catId: "cat_personal_hygiene", mrp: 609,  price: 548.10, desc: "Large adult diapers for heavy incontinence with superior leak protection." },
    { id: "med_himalaya_adult_xl",   name: "Adult Diaper XL",             company: "Himalaya", catId: "cat_personal_hygiene", mrp: 609,  price: 548.10, desc: "XL adult diapers for maximum coverage and overnight incontinence management." },
    { id: "med_himalaya_aloe_gel",   name: "Aloe Vera Gel",               company: "Himalaya", catId: "cat_skin_care",        mrp: 110,  price: 99.00,  desc: "Pure aloe vera gel for skin hydration, sunburn relief, and acne management." },
    { id: "med_himalaya_nour_cream", name: "Nourishing Skin Cream",       company: "Himalaya", catId: "cat_skin_care",        mrp: 150,  price: 135.00, desc: "Herbal nourishing cream with winter cherry and aloe vera for smooth, supple skin." },
    { id: "med_himalaya_lip_balm",   name: "Lip Balm",                    company: "Himalaya", catId: "cat_skin_care",        mrp: 45,   price: 40.50,  desc: "Moisturising lip balm with kokum butter and vitamin E for soft, healthy lips." },
    { id: "med_himalaya_spw_tp",     name: "Sparkling White Toothpaste",  company: "Himalaya", catId: "cat_personal_hygiene", mrp: 95,   price: 85.50,  desc: "Herbal whitening toothpaste with pomegranate for bright teeth and healthy gums." },
    { id: "med_himalaya_gum_tp",     name: "Gum Expert Toothpaste",       company: "Himalaya", catId: "cat_personal_hygiene", mrp: 125,  price: 112.50, desc: "Specialised herbal toothpaste for gum health, preventing bleeding and sensitivity." },
    { id: "med_himalaya_baby_shamp", name: "Gentle Baby Shampoo",         company: "Himalaya", catId: "cat_baby_care",        mrp: 155,  price: 139.50, desc: "Tear-free herbal baby shampoo for gentle cleansing and soft, tangle-free hair." },
    { id: "med_liv52_hb",            name: "Liv.52 HB",                   company: "Himalaya", catId: "cat_ayurvedic",        mrp: 180,  price: 162.00, desc: "Herbal liver formulation for hepatitis B support and liver cell regeneration." },
    { id: "med_ashvagandha",         name: "Ashvagandha Tablet",          company: "Himalaya", catId: "cat_ayurvedic",        mrp: 165,  price: 148.50, desc: "Ashwagandha adaptogen tablet for stress relief, energy, and immunity enhancement." },
    { id: "med_tagara",              name: "Tagara Tablet",               company: "Himalaya", catId: "cat_ayurvedic",        mrp: 155,  price: 139.50, desc: "Herbal sleep aid with Indian valerian for insomnia and anxiety relief." },
    { id: "med_lukol",               name: "Lukol Tablet",                company: "Himalaya", catId: "cat_womens_health",    mrp: 145,  price: 130.50, desc: "Herbal tablet for leucorrhoea, pelvic inflammatory disease, and vaginal health." },
    { id: "med_styplon",             name: "Styplon Tablet",              company: "Himalaya", catId: "cat_ayurvedic",        mrp: 125,  price: 112.50, desc: "Herbal haemostatic for bleeding gums, haemorrhoids, and post-surgical bleeding." },
    { id: "med_himplasia",           name: "Himplasia Tablet",            company: "Himalaya", catId: "cat_ayurvedic",        mrp: 175,  price: 157.50, desc: "Herbal tablet for benign prostatic hyperplasia (BPH) and urinary flow improvement." },
    { id: "med_evecare_syrup",       name: "Evecare Syrup",               company: "Himalaya", catId: "cat_womens_health",    mrp: 145,  price: 130.50, desc: "Herbal syrup for irregular periods, PMS, and hormonal balance in women." },
    { id: "med_renalka_syrup",       name: "Renalka Syrup",               company: "Himalaya", catId: "cat_ayurvedic",        mrp: 125,  price: 112.50, desc: "Herbal kidney and urinary tract tonic for UTI prevention and renal health." },
    { id: "med_himcocid_syrup",      name: "Himcocid Syrup",              company: "Himalaya", catId: "cat_acidity",          mrp: 118,  price: 106.20, desc: "Herbal antacid syrup for instant relief from acidity, heartburn, and gastritis." },
    { id: "med_partysmart",          name: "PartySmart Capsule",          company: "Himalaya", catId: "cat_ayurvedic",        mrp: 85,   price: 76.50,  desc: "Herbal capsule taken before drinking to prevent hangover and protect the liver." },
    { id: "med_clarina_fw",          name: "Clarina Face Wash",           company: "Himalaya", catId: "cat_skin_care",        mrp: 155,  price: 139.50, desc: "Herbal face wash for acne-prone skin with anti-bacterial and sebum-control properties." },
    { id: "med_himalaya_foot_cream", name: "FootCare Cream",              company: "Himalaya", catId: "cat_skin_care",        mrp: 125,  price: 112.50, desc: "Herbal foot cream for cracked heels, dry feet, and diabetic foot care." },
    { id: "med_himalaya_pain_balm",  name: "Pain Balm Strong",            company: "Himalaya", catId: "cat_pain_relief",      mrp: 95,   price: 85.50,  desc: "Strong herbal pain balm for headache, muscle pain, and joint stiffness." },
    { id: "med_tentex_royal",        name: "Tentex Royal",                company: "Himalaya", catId: "cat_ayurvedic",        mrp: 260,  price: 234.00, desc: "Premium herbal aphrodisiac for male vitality, stamina, and erectile function." },
    { id: "med_liv52_drops",         name: "Liv.52 Drops",                company: "Himalaya", catId: "cat_ayurvedic",        mrp: 105,  price: 94.50,  desc: "Herbal liver drops for infants and children for appetite and liver support." },

    // ── Abbott Medicines ──────────────────────────────
    { id: "med_thyronorm_50",        name: "Thyronorm 50",                company: "Abbott", catId: "cat_thyroid",          mrp: 146,  price: 131.40, desc: "Levothyroxine 50mcg for hypothyroidism and thyroid hormone replacement therapy." },
    { id: "med_thyronorm_100",       name: "Thyronorm 100",               company: "Abbott", catId: "cat_thyroid",          mrp: 162,  price: 145.80, desc: "Levothyroxine 100mcg for underactive thyroid, goitre, and thyroid cancer adjunct therapy." },
    { id: "med_digene_gel_abbott",   name: "Digene Gel",                  company: "Abbott", catId: "cat_acidity",          mrp: 135,  price: 121.50, desc: "Antacid gel for fast relief from acidity, heartburn, and gas." },
    { id: "med_digene_tab",          name: "Digene Tablet",               company: "Abbott", catId: "cat_acidity",          mrp: 42,   price: 37.80,  desc: "Chewable antacid tablet for quick relief from acidity and indigestion." },
    { id: "med_duphalac_syrup",      name: "Duphalac Syrup",              company: "Abbott", catId: "cat_digestive",        mrp: 185,  price: 166.50, desc: "Lactulose syrup for constipation treatment and hepatic encephalopathy management." },
    { id: "med_cremaffin_plus",      name: "Cremaffin Plus",              company: "Abbott", catId: "cat_digestive",        mrp: 118,  price: 106.20, desc: "Liquid paraffin + milk of magnesia laxative for smooth stool and constipation relief." },
    { id: "med_udiliv_300",          name: "Udiliv 300",                  company: "Abbott", catId: "cat_digestive",        mrp: 620,  price: 558.00, desc: "Ursodeoxycholic acid 300mg for gallstone dissolution and primary biliary cholangitis." },
    { id: "med_udiliv_150",          name: "Udiliv 150",                  company: "Abbott", catId: "cat_digestive",        mrp: 350,  price: 315.00, desc: "Ursodeoxycholic acid 150mg for liver and bile duct disorders." },
    { id: "med_brufen_400",          name: "Brufen 400",                  company: "Abbott", catId: "cat_pain_relief",      mrp: 28,   price: 25.20,  desc: "Ibuprofen 400mg NSAID for pain, fever, and inflammation." },
    { id: "med_brufen_600",          name: "Brufen 600",                  company: "Abbott", catId: "cat_pain_relief",      mrp: 42,   price: 37.80,  desc: "Ibuprofen 600mg for moderate pain, arthritis, and post-operative pain." },
    { id: "med_brufen_mr",           name: "Brufen MR",                   company: "Abbott", catId: "cat_pain_relief",      mrp: 115,  price: 103.50, desc: "Ibuprofen modified-release for prolonged pain relief from arthritis and back pain." },
    { id: "med_duphaston_10",        name: "Duphaston 10",                company: "Abbott", catId: "cat_womens_health",    mrp: 598,  price: 538.20, desc: "Dydrogesterone for irregular periods, endometriosis, and threatened miscarriage." },
    { id: "med_vertin_16",           name: "Vertin 16",                   company: "Abbott", catId: "cat_vertigo",          mrp: 275,  price: 247.50, desc: "Betahistine 16mg for vertigo, tinnitus, and Meniere's disease." },
    { id: "med_vertin_24",           name: "Vertin 24",                   company: "Abbott", catId: "cat_vertigo",          mrp: 398,  price: 358.20, desc: "Betahistine 24mg for severe vertigo and Meniere's disease." },
    { id: "med_librax",              name: "Librax Capsule",              company: "Abbott", catId: "cat_digestive",        mrp: 180,  price: 162.00, desc: "Chlordiazepoxide + Clidinium antispasmodic for IBS, peptic ulcer, and bowel cramps." },
    { id: "med_ganaton_total",       name: "Ganaton Total",               company: "Abbott", catId: "cat_digestive",        mrp: 245,  price: 220.50, desc: "Itopride prokinetic for gastroparesis, bloating, and delayed gastric emptying." },
    { id: "med_ganaton_od",          name: "Ganaton OD",                  company: "Abbott", catId: "cat_digestive",        mrp: 198,  price: 178.20, desc: "Itopride OD once-daily for nausea, vomiting, and gastric motility issues." },
    { id: "med_creon_10000",         name: "Creon 10000",                 company: "Abbott", catId: "cat_digestive",        mrp: 690,  price: 621.00, desc: "Pancreatin 10000 units for pancreatic exocrine insufficiency and cystic fibrosis." },
    { id: "med_creon_25000",         name: "Creon 25000",                 company: "Abbott", catId: "cat_digestive",        mrp: 1490, price: 1341.00, desc: "Pancreatin 25000 units for severe pancreatic enzyme deficiency and malabsorption." },
    { id: "med_prothiaden_25",       name: "Prothiaden 25",               company: "Abbott", catId: "cat_neuro_sleep",      mrp: 58,   price: 52.20,  desc: "Dosulepin 25mg tricyclic antidepressant for depression, anxiety, and chronic pain." },
    { id: "med_prothiaden_75",       name: "Prothiaden 75",               company: "Abbott", catId: "cat_neuro_sleep",      mrp: 120,  price: 108.00, desc: "Dosulepin 75mg for major depressive disorder and neuropathic pain." },
    { id: "med_influvac",            name: "Influvac Vaccine",            company: "Abbott", catId: "cat_vaccines",         mrp: 1450, price: 1305.00, desc: "Inactivated influenza vaccine for seasonal flu prevention in adults and children." },
    { id: "med_similac_s1",          name: "Similac Stage 1",             company: "Abbott", catId: "cat_baby_care",        mrp: 875,  price: 787.50, desc: "Infant formula for 0-6 months as breast milk supplement or alternative." },
    { id: "med_similac_s2",          name: "Similac Stage 2",             company: "Abbott", catId: "cat_baby_care",        mrp: 895,  price: 805.50, desc: "Follow-on formula for 6-12 months with DHA for brain and eye development." },
    { id: "med_pediasure_vanilla",   name: "Pediasure Vanilla",           company: "Abbott", catId: "cat_baby_care",        mrp: 850,  price: 765.00, desc: "Complete nutritional supplement drink for children 2-10 years for height and weight gain." },
    { id: "med_ensure_powder",       name: "Ensure Powder",               company: "Abbott", catId: "cat_multivitamins",    mrp: 910,  price: 819.00, desc: "Adult nutritional supplement powder for strength, immunity, and energy in adults 50+." },
    { id: "med_ensure_diabetes",     name: "Ensure Diabetes Care",        company: "Abbott", catId: "cat_diabetes",         mrp: 980,  price: 882.00, desc: "Specialised nutritional supplement for diabetics for blood sugar and weight management." },
    { id: "med_surbex_z",            name: "Surbex-Z",                    company: "Abbott", catId: "cat_vitamins",         mrp: 110,  price: 99.00,  desc: "B-complex + Zinc formula for energy, immunity, and skin health." },
    { id: "med_arachitol_nano",      name: "Arachitol Nano",              company: "Abbott", catId: "cat_vitamins",         mrp: 98,   price: 88.20,  desc: "Vitamin D3 nano shot for rapid correction of severe Vitamin D deficiency." },
    { id: "med_limcee_tab",          name: "Limcee Tablet",               company: "Abbott", catId: "cat_vitamins",         mrp: 28,   price: 25.20,  desc: "Vitamin C 500mg tablet for immunity, skin health, and antioxidant protection." },
    { id: "med_digene_acidity_gum",  name: "Digene Acidity Gum",          company: "Abbott", catId: "cat_acidity",          mrp: 22,   price: 19.80,  desc: "Chewable gum antacid for on-the-go acidity and heartburn relief." },
    { id: "med_duphalac_fiber",      name: "Duphalac Fiber",              company: "Abbott", catId: "cat_digestive",        mrp: 230,  price: 207.00, desc: "Lactulose + fiber combination for constipation and gut microbiome health." },
    { id: "med_klaricid_500",        name: "Klaricid 500",                company: "Abbott", catId: "cat_antibiotics",      mrp: 310,  price: 279.00, desc: "Clarithromycin 500mg macrolide antibiotic for respiratory and H.pylori infections." },
    { id: "med_klaricid_xl",         name: "Klaricid XL",                 company: "Abbott", catId: "cat_antibiotics",      mrp: 450,  price: 405.00, desc: "Clarithromycin extended-release for once-daily dosing in respiratory infections." },
    { id: "med_thyronorm_25",        name: "Thyronorm 25",                company: "Abbott", catId: "cat_thyroid",          mrp: 125,  price: 112.50, desc: "Levothyroxine 25mcg low-dose for mild hypothyroidism and thyroid supplementation." },
    { id: "med_thyronorm_75",        name: "Thyronorm 75",                company: "Abbott", catId: "cat_thyroid",          mrp: 155,  price: 139.50, desc: "Levothyroxine 75mcg for hypothyroidism requiring intermediate dosing." },
    { id: "med_duphaston_sr",        name: "Duphaston SR",                company: "Abbott", catId: "cat_womens_health",    mrp: 780,  price: 702.00, desc: "Dydrogesterone sustained-release for endometriosis, luteal phase support, and IVF." },
    { id: "med_colospa_retard",      name: "Colospa Retard",              company: "Abbott", catId: "cat_digestive",        mrp: 225,  price: 202.50, desc: "Mebeverine retard for IBS, intestinal cramps, and functional bowel disorders." },
    { id: "med_colospa_x",           name: "Colospa X",                   company: "Abbott", catId: "cat_digestive",        mrp: 175,  price: 157.50, desc: "Mebeverine extended-release for sustained relief from IBS and colonic spasm." },
    { id: "med_digene_mint",         name: "Digene Mint",                 company: "Abbott", catId: "cat_acidity",          mrp: 42,   price: 37.80,  desc: "Mint-flavoured antacid tablet for fast relief from acidity and indigestion." },
    { id: "med_brufen_spray",        name: "Brufen Power Spray",          company: "Abbott", catId: "cat_pain_relief",      mrp: 165,  price: 148.50, desc: "Ibuprofen topical spray for targeted pain relief from sprains and muscle soreness." },
    { id: "med_pedialyte_apple",     name: "Pedialyte Apple",             company: "Abbott", catId: "cat_baby_care",        mrp: 75,   price: 67.50,  desc: "Apple-flavoured oral rehydration solution for children with diarrhoea and dehydration." },
    { id: "med_pedialyte_orange",    name: "Pedialyte Orange",            company: "Abbott", catId: "cat_baby_care",        mrp: 75,   price: 67.50,  desc: "Orange-flavoured electrolyte drink for paediatric dehydration recovery." },
    { id: "med_duphalac_oral",       name: "Duphalac Oral Solution",      company: "Abbott", catId: "cat_digestive",        mrp: 355,  price: 319.50, desc: "Lactulose oral solution for chronic constipation and hepatic encephalopathy prevention." },
    { id: "med_vertin_melt",         name: "Vertin Melt",                 company: "Abbott", catId: "cat_vertigo",          mrp: 315,  price: 283.50, desc: "Betahistine mouth-dissolving tablet for quick vertigo relief." },
    { id: "med_arachitol_6l",        name: "Arachitol 6L",                company: "Abbott", catId: "cat_vitamins",         mrp: 42,   price: 37.80,  desc: "Vitamin D3 6 lakh IU oral solution for severe Vitamin D deficiency correction." },
    { id: "med_digene_fizz",         name: "Digene Fizz",                 company: "Abbott", catId: "cat_acidity",          mrp: 95,   price: 85.50,  desc: "Effervescent antacid sachet for quick fizzing relief from acidity and bloating." },
    { id: "med_prothiaden_forte",    name: "Prothiaden Forte",            company: "Abbott", catId: "cat_neuro_sleep",      mrp: 140,  price: 126.00, desc: "Dosulepin forte strength for treatment-resistant depression and anxiety disorders." },
    { id: "med_similac_comfort",     name: "Similac Total Comfort",       company: "Abbott", catId: "cat_baby_care",        mrp: 1190, price: 1071.00, desc: "Partially hydrolysed formula for infants with colic, gas, and feeding discomfort." },
    { id: "med_pediasure_choc",      name: "Pediasure Chocolate",         company: "Abbott", catId: "cat_baby_care",        mrp: 875,  price: 787.50, desc: "Chocolate-flavoured nutritional supplement for children 2-10 years for healthy growth." },

    // ── GSK Medicines ──────────────────────────────
    { id: "med_augmentin_625",       name: "Augmentin 625 Duo",           company: "GSK", catId: "cat_antibiotics",      mrp: 204,   price: 183.60,  desc: "Amoxicillin + Clavulanate broad-spectrum antibiotic for respiratory, skin, and UTI infections." },
    { id: "med_calpol_650",          name: "Calpol 650",                  company: "GSK", catId: "cat_cold_care",        mrp: 33,    price: 29.70,   desc: "Paracetamol 650mg for fever and pain relief." },
    { id: "med_calpol_500",          name: "Calpol 500",                  company: "GSK", catId: "cat_cold_care",        mrp: 15,    price: 13.50,   desc: "Paracetamol 500mg for mild fever and pain." },
    { id: "med_ceftum_500",          name: "Ceftum 500",                  company: "GSK", catId: "cat_antibiotics",      mrp: 525,   price: 472.50,  desc: "Cefuroxime 500mg second-generation cephalosporin for respiratory and skin infections." },
    { id: "med_tbact",               name: "T-Bact Ointment",             company: "GSK", catId: "cat_skin_care",        mrp: 98,    price: 88.20,   desc: "Mupirocin antibiotic ointment for impetigo, skin infections, and nasal decolonisation." },
    { id: "med_betnovate",           name: "Betnovate Cream",             company: "GSK", catId: "cat_skin_care",        mrp: 22,    price: 19.80,   desc: "Betamethasone valerate cream for eczema, psoriasis, and inflammatory skin conditions." },
    { id: "med_betnovate_n",         name: "Betnovate-N",                 company: "GSK", catId: "cat_skin_care",        mrp: 38,    price: 34.20,   desc: "Betamethasone + Neomycin cream for infected eczema and dermatitis." },
    { id: "med_betnovate_gm",        name: "Betnovate-GM",                company: "GSK", catId: "cat_skin_care",        mrp: 45,    price: 40.50,   desc: "Betamethasone + Gentamicin + Miconazole triple-action cream for mixed skin infections." },
    { id: "med_physiogel",           name: "Physiogel Lotion",            company: "GSK", catId: "cat_skin_care",        mrp: 365,   price: 328.50,  desc: "Physiological lipid replacement lotion for dry, sensitive, and eczema-prone skin." },
    { id: "med_physiogel_ai",        name: "Physiogel AI Cream",          company: "GSK", catId: "cat_skin_care",        mrp: 699,   price: 629.10,  desc: "Anti-irritant cream for very sensitive and reactive skin conditions." },
    { id: "med_eltroxin_50",         name: "Eltroxin 50",                 company: "GSK", catId: "cat_thyroid",          mrp: 135,   price: 121.50,  desc: "Levothyroxine 50mcg for hypothyroidism and thyroid hormone replacement." },
    { id: "med_eltroxin_100",        name: "Eltroxin 100",                company: "GSK", catId: "cat_thyroid",          mrp: 148,   price: 133.20,  desc: "Levothyroxine 100mcg for hypothyroidism requiring higher dose replacement." },
    { id: "med_neosporin_pwd",       name: "Neosporin Powder",            company: "GSK", catId: "cat_skin_care",        mrp: 120,   price: 108.00,  desc: "Bacitracin + Neomycin antibiotic powder for wound healing and infection prevention." },
    { id: "med_tenovate",            name: "Tenovate Cream",              company: "GSK", catId: "cat_skin_care",        mrp: 210,   price: 189.00,  desc: "Clobetasol propionate for severe eczema, psoriasis, and resistant dermatoses." },
    { id: "med_tenovate_m",          name: "Tenovate-M",                  company: "GSK", catId: "cat_skin_care",        mrp: 225,   price: 202.50,  desc: "Clobetasol + Miconazole cream for infected eczema and fungal skin infections." },
    { id: "med_flutivate",           name: "Flutivate Cream",             company: "GSK", catId: "cat_skin_care",        mrp: 160,   price: 144.00,  desc: "Fluticasone propionate cream for moderate-to-severe inflammatory skin conditions." },
    { id: "med_flutivate_e",         name: "Flutivate-E",                 company: "GSK", catId: "cat_skin_care",        mrp: 188,   price: 169.20,  desc: "Fluticasone + Econazole cream for dermatitis with secondary fungal infection." },
    { id: "med_zinetac_150",         name: "Zinetac 150",                 company: "GSK", catId: "cat_acidity",          mrp: 35,    price: 31.50,   desc: "Ranitidine 150mg H2-blocker for acidity, peptic ulcer, and GERD relief." },
    { id: "med_cetzine",             name: "Cetzine Tablet",              company: "GSK", catId: "cat_allergy",          mrp: 28,    price: 25.20,   desc: "Cetirizine antihistamine for allergic rhinitis, urticaria, and skin allergies." },
    { id: "med_cobadex_czs",         name: "Cobadex CZS",                 company: "GSK", catId: "cat_vitamins",         mrp: 145,   price: 130.50,  desc: "B-complex + Zinc + Selenium for metabolic support and deficiency correction." },
    { id: "med_zincovit",            name: "Zincovit Tablet",             company: "GSK", catId: "cat_vitamins",         mrp: 115,   price: 103.50,  desc: "Zinc + Multivitamins for immunity, growth, and wound healing support." },
    { id: "med_zincovit_syrup",      name: "Zincovit Syrup",              company: "GSK", catId: "cat_vitamins",         mrp: 95,    price: 85.50,   desc: "Zinc + Multivitamin syrup for children for immunity and nutritional support." },
    { id: "med_horlicks_women",      name: "Horlicks Women",              company: "GSK", catId: "cat_multivitamins",    mrp: 399,   price: 359.10,  desc: "Nutritional supplement for women with iron, calcium, and vitamins for bone and blood health." },
    { id: "med_horlicks_junior",     name: "Horlicks Junior",             company: "GSK", catId: "cat_baby_care",        mrp: 425,   price: 382.50,  desc: "Junior health drink for children with essential nutrients for height, strength, and growth." },
    { id: "med_sensodyne_rapid",     name: "Sensodyne Rapid Relief",      company: "GSK", catId: "cat_personal_hygiene", mrp: 140,   price: 126.00,  desc: "Fast-acting sensitive toothpaste for instant dentinal hypersensitivity relief." },
    { id: "med_sensodyne_fresh",     name: "Sensodyne Fresh Gel",         company: "GSK", catId: "cat_personal_hygiene", mrp: 135,   price: 121.50,  desc: "Freshening sensitive gel toothpaste for long-lasting sensitivity protection." },
    { id: "med_otrivin_drops",       name: "Otrivin Nasal Drops",         company: "GSK", catId: "cat_cold_cough",       mrp: 98,    price: 88.20,   desc: "Xylometazoline nasal drops for instant nasal congestion and blocked nose relief." },
    { id: "med_otrivin_spray",       name: "Otrivin Spray",               company: "GSK", catId: "cat_cold_cough",       mrp: 110,   price: 99.00,   desc: "Xylometazoline nasal spray for quick decongestant action in cold and sinusitis." },
    { id: "med_iodex",               name: "Iodex Balm",                  company: "GSK", catId: "cat_pain_relief",      mrp: 145,   price: 130.50,  desc: "Methyl salicylate + Menthol balm for muscular pain, joint ache, and stiffness." },
    { id: "med_crocin_adv_gsk",      name: "Crocin Advance",              company: "GSK", catId: "cat_cold_care",        mrp: 20,    price: 18.00,   desc: "Paracetamol 500mg for fever and pain with faster absorption." },
    { id: "med_crocin_cold_flu",     name: "Crocin Cold & Flu",           company: "GSK", catId: "cat_cold_cough",       mrp: 48,    price: 43.20,   desc: "Paracetamol + Phenylephrine + Caffeine for cold, flu, and nasal congestion." },
    { id: "med_phexin_500",          name: "Phexin 500",                  company: "GSK", catId: "cat_antibiotics",      mrp: 88,    price: 79.20,   desc: "Cephalexin 500mg antibiotic for skin, soft tissue, and urinary tract infections." },
    { id: "med_becosules_gsk",        name: "Becosules Capsule",           company: "GSK", catId: "cat_vitamins",         mrp: 48,    price: 43.20,   desc: "Vitamin B-complex + Vitamin C capsule for nutritional deficiency and energy metabolism." },
    { id: "med_becosules_z",         name: "Becosules Z",                 company: "GSK", catId: "cat_vitamins",         mrp: 60,    price: 54.00,   desc: "B-complex + Zinc capsule for enhanced immunity and metabolic enzyme support." },
    { id: "med_macprox_dz",          name: "Macprox DZ",                  company: "GSK", catId: "cat_antibiotics",      mrp: 210,   price: 189.00,  desc: "Clarithromycin + Tinidazole combination for H.pylori eradication and bacterial infections." },
    { id: "med_duolin_respules",     name: "Duolin Respules",             company: "GSK", catId: "cat_respiratory",      mrp: 145,   price: 130.50,  desc: "Ipratropium + Levosalbutamol nebulisation solution for acute asthma and COPD." },
    { id: "med_seretide",            name: "Seretide Evohaler",           company: "GSK", catId: "cat_respiratory",      mrp: 435,   price: 391.50,  desc: "Fluticasone + Salmeterol preventer inhaler for asthma and COPD maintenance." },
    { id: "med_ventorlin",           name: "Ventorlin Inhaler",           company: "GSK", catId: "cat_respiratory",      mrp: 180,   price: 162.00,  desc: "Salbutamol rescue inhaler for acute bronchospasm and asthma attack relief." },
    { id: "med_asthalin_respules",   name: "Asthalin Respules",           company: "GSK", catId: "cat_respiratory",      mrp: 95,    price: 85.50,   desc: "Salbutamol nebulisation solution for severe asthma and bronchospasm in children." },
    { id: "med_candid_b",            name: "Candid-B Lotion",             company: "GSK", catId: "cat_skin_care",        mrp: 78,    price: 70.20,   desc: "Clotrimazole + Beclomethasone lotion for fungal skin infections with inflammation." },
    { id: "med_cloben_g",            name: "Cloben-G Cream",              company: "GSK", catId: "cat_skin_care",        mrp: 65,    price: 58.50,   desc: "Clobetasol + Gentamicin + Miconazole cream for mixed infected dermatoses." },
    { id: "med_nucala",              name: "Nucala Injection",            company: "GSK", catId: "cat_respiratory",      mrp: 15400, price: 13860.00, desc: "Mepolizumab biologic injection for severe eosinophilic asthma add-on treatment." },
    { id: "med_trelegy",             name: "Trelegy Ellipta",             company: "GSK", catId: "cat_respiratory",      mrp: 2890,  price: 2601.00, desc: "Fluticasone + Umeclidinium + Vilanterol triple inhaler for COPD maintenance." },
    { id: "med_zejula",              name: "Zejula Capsule",              company: "GSK", catId: "cat_oncology",         mrp: 85200, price: 76680.00, desc: "Niraparib PARP inhibitor for maintenance therapy in ovarian and peritoneal cancer." },
    { id: "med_jemperli",            name: "Jemperli Injection",          company: "GSK", catId: "cat_oncology",         mrp: 92000, price: 82800.00, desc: "Dostarlimab PD-1 checkpoint inhibitor for endometrial and mismatch repair deficient cancers." },
    { id: "med_varilrix",            name: "Varilrix Vaccine",            company: "GSK", catId: "cat_vaccines",         mrp: 1850,  price: 1665.00, desc: "Live attenuated varicella (chickenpox) vaccine for children and susceptible adults." },
    { id: "med_havrix",              name: "Havrix Vaccine",              company: "GSK", catId: "cat_vaccines",         mrp: 1650,  price: 1485.00, desc: "Inactivated hepatitis A vaccine for travellers and high-risk individuals." },
    { id: "med_boostrix",            name: "Boostrix Vaccine",            company: "GSK", catId: "cat_vaccines",         mrp: 2450,  price: 2205.00, desc: "Tdap booster vaccine for tetanus, diphtheria, and pertussis in adolescents and adults." },
    { id: "med_synflorix",           name: "Synflorix Vaccine",           company: "GSK", catId: "cat_vaccines",         mrp: 3250,  price: 2925.00, desc: "10-valent pneumococcal vaccine for infants to prevent pneumonia, meningitis, and ear infections." },
    { id: "med_infanrix_hexa",       name: "Infanrix Hexa",               company: "GSK", catId: "cat_vaccines",         mrp: 3890,  price: 3501.00, desc: "6-in-1 vaccine for infants covering diphtheria, tetanus, pertussis, hepatitis B, polio, and Hib." },

    // ── Multi-brand Best-sellers ──────────────────────────────
    { id: "med_azithral_alembic",     name: "Azithral 500",                company: "Alembic Pharmaceuticals", catId: "cat_antibiotics",  mrp: 120,  price: 108.00, desc: "Azithromycin 500mg macrolide antibiotic for respiratory, skin, and STI infections." },
    { id: "med_pantocid_sp",          name: "Pantocid 40",                 company: "Sun Pharma",              catId: "cat_acidity",      mrp: 145,  price: 130.50, desc: "Pantoprazole 40mg proton pump inhibitor for GERD, gastric ulcers, and acid reflux." },
    { id: "med_livogen_xt",          name: "Livogen XT",                  company: "Abbott India",            catId: "cat_vitamins",     mrp: 180,  price: 162.00, desc: "Iron + Folic acid + Zinc supplement for anaemia, pregnancy, and iron deficiency." },
    { id: "med_telma_40",            name: "Telma 40",                    company: "Glenmark Pharmaceuticals",catId: "cat_heart_bp",     mrp: 140,  price: 126.00, desc: "Telmisartan 40mg ARB for hypertension and cardiovascular risk reduction." },
    { id: "med_ecosprin_75",         name: "Ecosprin 75",                 company: "USV Private Limited",     catId: "cat_heart_bp",     mrp: 22,   price: 19.80,  desc: "Aspirin 75mg enteric-coated antiplatelet for prevention of heart attack and stroke." },
    { id: "med_montek_lc",           name: "Montek LC",                   company: "Sun Pharma",              catId: "cat_allergy",      mrp: 210,  price: 189.00, desc: "Montelukast + Levocetirizine for allergic rhinitis, asthma, and chronic urticaria." },
    { id: "med_zerodol_sp",          name: "Zerodol SP",                  company: "Ipca Laboratories",       catId: "cat_pain_relief",  mrp: 125,  price: 112.50, desc: "Aceclofenac + Serratiopeptidase + Paracetamol for post-operative and inflammatory pain." },
    { id: "med_azee_500",            name: "Azee 500",                    company: "Cipla",                   catId: "cat_antibiotics",  mrp: 110,  price: 99.00,  desc: "Azithromycin 500mg for respiratory tract, skin, and community-acquired infections." },
    { id: "med_allegra_120",         name: "Allegra 120",                 company: "Sanofi India",            catId: "cat_allergy",      mrp: 240,  price: 216.00, desc: "Fexofenadine 120mg non-drowsy antihistamine for allergic rhinitis and chronic urticaria." },
    { id: "med_rantac_150",          name: "Rantac 150",                  company: "JB Chemicals",            catId: "cat_acidity",      mrp: 32,   price: 28.80,  desc: "Ranitidine 150mg H2-blocker for acidity, peptic ulcer, and heartburn relief." },
    { id: "med_neurobion_forte_pg",   name: "Neurobion Forte",             company: "Procter & Gamble Health", catId: "cat_vitamins",     mrp: 42,   price: 37.80,  desc: "Vitamin B1, B6, B12 combination for nerve health, fatigue, and B-vitamin deficiency." },
    { id: "med_pan_40",              name: "Pan 40",                      company: "Alkem Laboratories",      catId: "cat_acidity",      mrp: 120,  price: 108.00, desc: "Pantoprazole 40mg for gastric acid suppression, GERD, and peptic ulcer treatment." },
    { id: "med_taxim_o_200",         name: "Taxim-O 200",                 company: "Alkem Laboratories",      catId: "cat_antibiotics",  mrp: 180,  price: 162.00, desc: "Cefixime 200mg third-generation cephalosporin for urinary, respiratory, and enteric infections." },
    { id: "med_moxikind_cv625",      name: "Moxikind CV 625",             company: "Mankind Pharma",          catId: "cat_antibiotics",  mrp: 230,  price: 207.00, desc: "Amoxicillin + Clavulanate 625mg for resistant respiratory, skin, and ENT infections." },
    { id: "med_chymoral_forte",      name: "Chymoral Forte",              company: "Torrent Pharmaceuticals", catId: "cat_pain_relief",  mrp: 165,  price: 148.50, desc: "Trypsin + Chymotrypsin enzymes for reducing inflammation, swelling, and post-op pain." },
    { id: "med_cetcip_10",           name: "Cetcip 10",                   company: "Cipla",                   catId: "cat_allergy",      mrp: 18,   price: 16.20,  desc: "Cetirizine 10mg antihistamine for allergic rhinitis, urticaria, and skin allergies." },
    { id: "med_omez_drr",             name: "Omez 20",                     company: "Dr. Reddy's Laboratories",catId: "cat_acidity",      mrp: 98,   price: 88.20,  desc: "Omeprazole 20mg proton pump inhibitor for acidity, GERD, and peptic ulcers." },
    { id: "med_gemcal",              name: "Gemcal",                      company: "Alkem Laboratories",      catId: "cat_calcium",      mrp: 190,  price: 171.00, desc: "Calcium carbonate + Vitamin D3 + Vitamin K2 for bone density and calcium absorption." },
    { id: "med_ondem_4",             name: "Ondem 4",                     company: "Alkem Laboratories",      catId: "cat_digestive",    mrp: 78,   price: 70.20,  desc: "Ondansetron 4mg for nausea and vomiting due to chemotherapy, surgery, or illness." },
    { id: "med_clavam_alkem",         name: "Clavam 625",                  company: "Alkem Laboratories",      catId: "cat_antibiotics",  mrp: 240,  price: 216.00, desc: "Amoxicillin + Clavulanate 625mg broad-spectrum antibiotic for tough bacterial infections." },
    { id: "med_voveran_sr",          name: "Voveran SR",                  company: "Novartis India",          catId: "cat_pain_relief",  mrp: 130,  price: 117.00, desc: "Diclofenac sodium 100mg sustained-release for arthritis, back pain, and post-op pain." },
    { id: "med_atarax_25",           name: "Atarax 25",                   company: "Dr. Reddy's Laboratories",catId: "cat_allergy",      mrp: 95,   price: 85.50,  desc: "Hydroxyzine 25mg antihistamine for anxiety, allergic pruritus, and chronic urticaria." },
    { id: "med_meftal_spas",         name: "Meftal Spas",                 company: "Blue Cross Laboratories", catId: "cat_pain_relief",  mrp: 65,   price: 58.50,  desc: "Mefenamic acid + Dicyclomine for menstrual pain, abdominal cramps, and IBS spasms." },

    // ── Pain Relief ──────────────────────────────
    { id: "med_flexon",              name: "Flexon",                      company: "Aristo Pharmaceuticals",  catId: "cat_pain_relief",  mrp: 55,   price: 49.50,  desc: "Ibuprofen + Paracetamol combination for fever, body pain, and inflammation." },
    { id: "med_combiflam",           name: "Combiflam",                   company: "Sanofi India",            catId: "cat_pain_relief",  mrp: 42,   price: 37.80,  desc: "Ibuprofen + Paracetamol for fever, headache, dental pain, and muscular pain." },
    { id: "med_nicip_plus",          name: "Nicip Plus",                  company: "Cipla",                   catId: "cat_pain_relief",  mrp: 48,   price: 43.20,  desc: "Nimesulide + Paracetamol for fever, acute pain, and post-operative discomfort." },
    { id: "med_aceclo_plus",         name: "Aceclo Plus",                 company: "Aristo Pharmaceuticals",  catId: "cat_pain_relief",  mrp: 120,  price: 108.00, desc: "Aceclofenac + Paracetamol NSAID combination for musculoskeletal and joint pain." },
    { id: "med_dolokind_plus",       name: "Dolokind Plus",               company: "Mankind Pharma",          catId: "cat_pain_relief",  mrp: 58,   price: 52.20,  desc: "Diclofenac + Paracetamol for fever, inflammation, and moderate pain." },
    { id: "med_ultracet",            name: "Ultracet",                    company: "Janssen India",           catId: "cat_pain_relief",  mrp: 198,  price: 178.20, desc: "Tramadol + Acetaminophen for moderate to severe pain management." },
    { id: "med_myospaz_forte",       name: "Myospaz Forte",               company: "Win-Medicare",            catId: "cat_pain_relief",  mrp: 155,  price: 139.50, desc: "Chlorzoxazone + Diclofenac + Paracetamol for muscle spasm and back pain." },
    { id: "med_hifenac_p",           name: "Hifenac P",                   company: "Intas Pharmaceuticals",   catId: "cat_pain_relief",  mrp: 110,  price: 99.00,  desc: "Aceclofenac + Paracetamol for joint pain, sports injuries, and post-op pain." },
    { id: "med_zerodol_th4",         name: "Zerodol TH4",                 company: "Ipca Laboratories",       catId: "cat_pain_relief",  mrp: 165,  price: 148.50, desc: "Aceclofenac + Thiocolchicoside for back pain, muscle spasm, and neck pain." },
    { id: "med_dynapar_gel",         name: "Dynapar Gel",                 company: "Troikaa Pharmaceuticals", catId: "cat_pain_relief",  mrp: 145,  price: 130.50, desc: "Diclofenac diethylamine gel for topical relief from arthritis and soft tissue injuries." },
    { id: "med_moov_spray",          name: "Moov Spray",                  company: "Reckitt",                 catId: "cat_pain_relief",  mrp: 210,  price: 189.00, desc: "Wintergreen + Camphor spray for fast topical relief from muscle and joint pain." },
    { id: "med_hifenac_mr",          name: "Hifenac MR",                  company: "Intas Pharmaceuticals",   catId: "cat_pain_relief",  mrp: 145,  price: 130.50, desc: "Aceclofenac + Thiocolchicoside modified-release for prolonged relief from back pain." },
    { id: "med_ace_proxyvon",        name: "Ace Proxyvon",                company: "Wockhardt",               catId: "cat_pain_relief",  mrp: 125,  price: 112.50, desc: "Aceclofenac + Paracetamol + Rabeprazole for pain with gastric protection." },
    { id: "med_dolonex_dt",          name: "Dolonex DT",                  company: "Pfizer India",            catId: "cat_pain_relief",  mrp: 88,   price: 79.20,  desc: "Piroxicam dispersible tablet for rheumatoid arthritis, osteoarthritis, and gout." },
    { id: "med_paracip_500",         name: "Paracip 500",                 company: "Cipla",                   catId: "cat_cold_care",    mrp: 22,   price: 19.80,  desc: "Paracetamol 500mg for fever and mild to moderate pain relief." },
    { id: "med_flexura_d",           name: "Flexura D",                   company: "Macleods Pharmaceuticals",catId: "cat_pain_relief",  mrp: 165,  price: 148.50, desc: "Aceclofenac + Drotaverine for pain with smooth muscle spasm." },
    { id: "med_etoshine_90",         name: "Etoshine 90mg",               company: "Sun Pharma",              catId: "cat_pain_relief",  mrp: 185,  price: 166.50, desc: "Etoricoxib 90mg COX-2 inhibitor for arthritis, acute gout, and post-op pain." },
    { id: "med_etova_400",           name: "Etova 400",                   company: "Ipca Laboratories",       catId: "cat_pain_relief",  mrp: 145,  price: 130.50, desc: "Etodolac 400mg NSAID for osteoarthritis, rheumatoid arthritis, and acute pain." },
    { id: "med_dolowin_plus",        name: "Dolowin Plus",                company: "Mankind Pharma",          catId: "cat_pain_relief",  mrp: 65,   price: 58.50,  desc: "Aceclofenac + Paracetamol for fever, headache, and musculoskeletal pain." },
    { id: "med_zerodol_p",           name: "Zerodol P",                   company: "Ipca Laboratories",       catId: "cat_pain_relief",  mrp: 98,   price: 88.20,  desc: "Aceclofenac + Paracetamol for acute pain, fever, and inflammatory conditions." },
    { id: "med_voveran_gel",         name: "Voveran Gel",                 company: "Novartis India",          catId: "cat_pain_relief",  mrp: 140,  price: 126.00, desc: "Diclofenac diethylamine 1% topical gel for joint pain, strains, and sports injuries." },

    // ── Cold & Cough ──────────────────────────────
    { id: "med_piriton_syrup",       name: "Piriton Syrup",               company: "GSK India",               catId: "cat_allergy",      mrp: 75,   price: 67.50,  desc: "Chlorpheniramine maleate syrup for allergic rhinitis, itching, and cold symptoms." },
    { id: "med_alex_syrup",          name: "Alex Syrup",                  company: "Glenmark Pharmaceuticals",catId: "cat_cold_cough",   mrp: 135,  price: 121.50, desc: "Dextromethorphan + Triprolidine + Phenylephrine for cough, cold, and nasal congestion." },
    { id: "med_ascoril_ls",          name: "Ascoril LS",                  company: "Glenmark Pharmaceuticals",catId: "cat_cold_cough",   mrp: 145,  price: 130.50, desc: "Levosalbutamol + Ambroxol + Guaifenesin for productive cough and bronchospasm." },
    { id: "med_ambrodil_syrup",      name: "Ambrodil Syrup",              company: "Aristo Pharmaceuticals",  catId: "cat_cold_cough",   mrp: 88,   price: 79.20,  desc: "Ambroxol mucolytic syrup for loosening mucus in productive cough and bronchitis." },
    { id: "med_tusq_dx",             name: "TusQ DX",                     company: "Zuventus Healthcare",     catId: "cat_cold_cough",   mrp: 120,  price: 108.00, desc: "Dextromethorphan + Phenylephrine + Chlorpheniramine for dry cough and cold." },
    { id: "med_chericof_syrup",      name: "Chericof Syrup",              company: "Cipla",                   catId: "cat_cold_cough",   mrp: 105,  price: 94.50,  desc: "Dextromethorphan + Phenylephrine + Triprolidine for cough and nasal congestion." },
    { id: "med_solvin_cold",         name: "Solvin Cold",                 company: "Ipca Laboratories",       catId: "cat_cold_cough",   mrp: 95,   price: 85.50,  desc: "Ambroxol + Guaifenesin + Terbutaline for productive cough and chest congestion." },
    { id: "med_soframycin_cream",    name: "Soframycin Cream",            company: "Sanofi India",            catId: "cat_skin_care",    mrp: 68,   price: 61.20,  desc: "Framycetin sulphate antibiotic cream for infected wounds, burns, and skin infections." },

    // ── Heart & BP ──────────────────────────────
    { id: "med_dytor_10",            name: "Dytor 10",                    company: "Cipla",                   catId: "cat_heart_bp",     mrp: 145,  price: 130.50, desc: "Torsemide 10mg diuretic for heart failure, oedema, and resistant hypertension." },
    { id: "med_lasix_40",            name: "Lasix 40",                    company: "Sanofi India",            catId: "cat_heart_bp",     mrp: 28,   price: 25.20,  desc: "Furosemide 40mg loop diuretic for oedema in heart failure and kidney disease." },
    { id: "med_amlokind_at",         name: "Amlokind AT",                 company: "Mankind Pharma",          catId: "cat_heart_bp",     mrp: 145,  price: 130.50, desc: "Amlodipine + Atenolol combination for hypertension with enhanced BP control." },
    { id: "med_olmezest_20",         name: "Olmezest 20",                 company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 165,  price: 148.50, desc: "Olmesartan 20mg ARB for hypertension and cardiovascular risk reduction." },
    { id: "med_telmikind_40",        name: "Telmikind 40",                company: "Mankind Pharma",          catId: "cat_heart_bp",     mrp: 110,  price: 99.00,  desc: "Telmisartan 40mg for hypertension and reducing cardiovascular events." },
    { id: "med_telvas_40",           name: "Telvas 40",                   company: "Aristo Pharmaceuticals",  catId: "cat_heart_bp",     mrp: 135,  price: 121.50, desc: "Telmisartan 40mg ARB for blood pressure control and organ protection." },
    { id: "med_repace_25",           name: "Repace 25",                   company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 165,  price: 148.50, desc: "Losartan 25mg low-dose ARB for hypertension and diabetic nephropathy." },
    { id: "med_olmin_20",            name: "Olmin 20",                    company: "Micro Labs",              catId: "cat_heart_bp",     mrp: 155,  price: 139.50, desc: "Olmesartan 20mg for high blood pressure and kidney protection in diabetics." },
    { id: "med_cardace_2_5",         name: "Cardace 2.5",                 company: "Sanofi India",            catId: "cat_heart_bp",     mrp: 145,  price: 130.50, desc: "Ramipril 2.5mg ACE inhibitor for hypertension, heart failure, and post-MI protection." },
    { id: "med_nebicard_5",          name: "Nebicard 5",                  company: "Torrent Pharmaceuticals", catId: "cat_heart_bp",     mrp: 125,  price: 112.50, desc: "Nebivolol 5mg selective beta-blocker for hypertension with vasodilatory properties." },
    { id: "med_concor_5",            name: "Concor 5",                    company: "Merck India",             catId: "cat_heart_bp",     mrp: 168,  price: 151.20, desc: "Bisoprolol 5mg selective beta-blocker for hypertension and stable angina." },
    { id: "med_metolar_xr50",        name: "Metolar XR 50",               company: "Cipla",                   catId: "cat_heart_bp",     mrp: 118,  price: 106.20, desc: "Metoprolol succinate XR 50mg for hypertension, angina, and heart failure." },
    { id: "med_nicardia_r20",        name: "Nicardia Retard 20",          company: "JB Chemicals",            catId: "cat_heart_bp",     mrp: 98,   price: 88.20,  desc: "Nifedipine retard 20mg calcium channel blocker for hypertension and Raynaud's." },
    { id: "med_clopitab_75",         name: "Clopitab 75",                 company: "Lupin Limited",           catId: "cat_heart_bp",     mrp: 110,  price: 99.00,  desc: "Clopidogrel 75mg antiplatelet for prevention of heart attack and stroke." },
    { id: "med_rosuvas_10",          name: "Rosuvas 10",                  company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 165,  price: 148.50, desc: "Rosuvastatin 10mg for lowering LDL cholesterol and reducing cardiovascular risk." },
    { id: "med_atorlip_10",          name: "Atorlip 10",                  company: "Cipla",                   catId: "cat_heart_bp",     mrp: 145,  price: 130.50, desc: "Atorvastatin 10mg statin for cholesterol management and cardiovascular prevention." },
    { id: "med_storvas_20",          name: "Storvas 20",                  company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 175,  price: 157.50, desc: "Atorvastatin 20mg for moderate-to-high cardiovascular risk cholesterol reduction." },
    { id: "med_ecosprin_av75",       name: "Ecosprin AV 75",              company: "USV Private Limited",     catId: "cat_heart_bp",     mrp: 155,  price: 139.50, desc: "Aspirin 75mg + Atorvastatin 10mg dual combo for cardiac event prevention." },
    { id: "med_deplatt_a75",         name: "Deplatt A 75",                company: "Torrent Pharmaceuticals", catId: "cat_heart_bp",     mrp: 185,  price: 166.50, desc: "Clopidogrel + Aspirin dual antiplatelet for ACS and post-stent prevention." },
    { id: "med_cardivas_6_25",       name: "Cardivas 6.25",               company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 98,   price: 88.20,  desc: "Carvedilol 6.25mg alpha+beta blocker for heart failure and hypertension." },
    { id: "med_lasilactone_50",      name: "Lasilactone 50",              company: "Sanofi India",            catId: "cat_heart_bp",     mrp: 125,  price: 112.50, desc: "Furosemide + Spironolactone for refractory oedema and heart failure." },
    { id: "med_arkamin_100",         name: "Arkamin 100",                 company: "Torrent Pharmaceuticals", catId: "cat_heart_bp",     mrp: 88,   price: 79.20,  desc: "Clonidine 100mcg centrally-acting antihypertensive for resistant hypertension." },
    { id: "med_angizem_cd90",        name: "Angizem CD 90",               company: "Sun Pharma",              catId: "cat_heart_bp",     mrp: 145,  price: 130.50, desc: "Diltiazem CD 90mg calcium channel blocker for hypertension and angina." },
    { id: "med_minipress_xl5",       name: "Minipress XL 5",              company: "Pfizer India",            catId: "cat_heart_bp",     mrp: 178,  price: 160.20, desc: "Prazosin XL 5mg alpha-blocker for hypertension and BPH." },

    // ── Antibiotics ──────────────────────────────
    { id: "med_metrogyl_400",        name: "Metrogyl 400",                company: "JB Chemicals",            catId: "cat_antibiotics",  mrp: 35,   price: 31.50,  desc: "Metronidazole 400mg antibiotic for bacterial and parasitic gut infections." },
    { id: "med_flagyl_400",          name: "Flagyl 400",                  company: "Abbott India",            catId: "cat_antibiotics",  mrp: 38,   price: 34.20,  desc: "Metronidazole 400mg for anaerobic bacterial infections and amoebiasis." },
    { id: "med_cefakind_500",        name: "Cefakind 500",                company: "Mankind Pharma",          catId: "cat_antibiotics",  mrp: 210,  price: 189.00, desc: "Cephalexin 500mg for skin, soft tissue, respiratory, and UTI infections." },
    { id: "med_monocef_o200",        name: "Monocef-O 200",               company: "Aristo Pharmaceuticals",  catId: "cat_antibiotics",  mrp: 185,  price: 166.50, desc: "Cefpodoxime 200mg for community-acquired pneumonia, UTI, and ENT infections." },
    { id: "med_zifi_200",            name: "Zifi 200",                    company: "FDC Limited",             catId: "cat_antibiotics",  mrp: 175,  price: 157.50, desc: "Cefixime 200mg third-generation cephalosporin for respiratory and urinary infections." },
    { id: "med_cefolac_100",         name: "Cefolac 100 DT",              company: "Macleods Pharmaceuticals",catId: "cat_antibiotics",  mrp: 145,  price: 130.50, desc: "Cefpodoxime 100mg dispersible tablet for children with respiratory and ENT infections." },
    { id: "med_mox_cv625",           name: "Mox CV 625",                  company: "Sun Pharma",              catId: "cat_antibiotics",  mrp: 245,  price: 220.50, desc: "Amoxicillin + Clavulanate 625mg for resistant respiratory and skin infections." },
    { id: "med_novamox_500",         name: "Novamox 500",                 company: "Cipla",                   catId: "cat_antibiotics",  mrp: 135,  price: 121.50, desc: "Amoxicillin 500mg broad-spectrum penicillin for respiratory and ENT infections." },
    { id: "med_taxim_500_inj",       name: "Taxim 500 Injection",         company: "Alkem Laboratories",      catId: "cat_antibiotics",  mrp: 85,   price: 76.50,  desc: "Cefotaxime 500mg injection for serious bacterial infections and meningitis." },
    { id: "med_azax_500",            name: "Azax 500",                    company: "Ranbaxy Laboratories",    catId: "cat_antibiotics",  mrp: 115,  price: 103.50, desc: "Azithromycin 500mg for respiratory tract and community-acquired infections." },
    { id: "med_levoflox_500",        name: "Levoflox 500",                company: "Cipla",                   catId: "cat_antibiotics",  mrp: 155,  price: 139.50, desc: "Levofloxacin 500mg fluoroquinolone for respiratory, UTI, and skin infections." },
    { id: "med_cifran_500",          name: "Cifran 500",                  company: "Sun Pharma",              catId: "cat_antibiotics",  mrp: 92,   price: 82.80,  desc: "Ciprofloxacin 500mg for urinary, respiratory, and gastrointestinal infections." },
    { id: "med_satrogyl_300",        name: "Satrogyl 300",                company: "Alkem Laboratories",      catId: "cat_antibiotics",  mrp: 145,  price: 130.50, desc: "Metronidazole 300mg for amoebic dysentery, giardiasis, and anaerobic infections." },
    { id: "med_norflox_tz",          name: "Norflox TZ",                  company: "Cipla",                   catId: "cat_antibiotics",  mrp: 98,   price: 88.20,  desc: "Norfloxacin + Tinidazole for diarrhoea, dysentery, and gastrointestinal infections." },
    { id: "med_taxim_az",            name: "Taxim AZ",                    company: "Alkem Laboratories",      catId: "cat_antibiotics",  mrp: 210,  price: 189.00, desc: "Cefixime + Azithromycin combination for respiratory and genital tract infections." },
    { id: "med_mahacef_xl200",       name: "Mahacef XL 200",              company: "Mankind Pharma",          catId: "cat_antibiotics",  mrp: 198,  price: 178.20, desc: "Cefpodoxime 200mg for respiratory tract, skin, and urinary infections." },
    { id: "med_cefix_200",           name: "Cefix 200",                   company: "Lupin Limited",           catId: "cat_antibiotics",  mrp: 188,  price: 169.20, desc: "Cefixime 200mg cephalosporin for typhoid, gonorrhoea, and respiratory infections." },
    { id: "med_rediclav_625",        name: "RediCLAV 625",                company: "Dr. Reddy's Laboratories",catId: "cat_antibiotics",  mrp: 245,  price: 220.50, desc: "Amoxicillin + Clavulanate 625mg for skin, respiratory, and ENT infections." },
    { id: "med_megamox_cv",          name: "Megamox CV",                  company: "Intas Pharmaceuticals",   catId: "cat_antibiotics",  mrp: 225,  price: 202.50, desc: "Amoxicillin + Clavulanate for resistant bacterial infections." },
    { id: "med_azee_xl200",          name: "Azee XL 200",                 company: "Cipla",                   catId: "cat_antibiotics",  mrp: 155,  price: 139.50, desc: "Azithromycin 200mg DT for paediatric respiratory and ENT infections." },
    { id: "med_levoquin_500",        name: "Levoquin 500",                company: "Macleods Pharmaceuticals",catId: "cat_antibiotics",  mrp: 148,  price: 133.20, desc: "Levofloxacin 500mg for community-acquired pneumonia, UTI, and skin infections." },

    // ── Acidity ──────────────────────────────
    { id: "med_rabekind_20",         name: "Rabekind 20",                 company: "Mankind Pharma",          catId: "cat_acidity",      mrp: 98,   price: 88.20,  desc: "Rabeprazole 20mg proton pump inhibitor for acidity, GERD, and peptic ulcers." },
    { id: "med_rablet_20",           name: "Rablet 20",                   company: "Lupin Limited",           catId: "cat_acidity",      mrp: 105,  price: 94.50,  desc: "Rabeprazole 20mg for acid suppression, GERD, and Zollinger-Ellison syndrome." },
    { id: "med_aciloc_150",          name: "Aciloc 150",                  company: "Cadila Pharmaceuticals",  catId: "cat_acidity",      mrp: 28,   price: 25.20,  desc: "Ranitidine 150mg H2-blocker for peptic ulcer and gastro-oesophageal reflux." },
    { id: "med_gelusil_mps",         name: "Gelusil MPS",                 company: "Pfizer India",            catId: "cat_acidity",      mrp: 165,  price: 148.50, desc: "Magnesium hydroxide + Aluminium hydroxide + Simethicone antacid for acidity and gas." },
    { id: "med_ulgel_a",             name: "Ulgel A",                     company: "Alembic Pharmaceuticals", catId: "cat_acidity",      mrp: 110,  price: 99.00,  desc: "Aluminium hydroxide + Magnesium hydroxide antacid gel for acidity and heartburn." },
    { id: "med_pantosec_dsr",        name: "Pantosec DSR",                company: "Cipla",                   catId: "cat_acidity",      mrp: 198,  price: 178.20, desc: "Pantoprazole + Domperidone DSR capsule for acid reflux with nausea and bloating." },
    { id: "med_pan_d",               name: "Pan-D",                       company: "Alkem Laboratories",      catId: "cat_acidity",      mrp: 175,  price: 157.50, desc: "Pantoprazole + Domperidone for GERD, acidity, and gastric motility issues." },
    { id: "med_razo_d",              name: "Razo D",                      company: "Dr. Reddy's Laboratories",catId: "cat_acidity",      mrp: 188,  price: 169.20, desc: "Rabeprazole + Domperidone for acid reflux with delayed gastric emptying." },
    { id: "med_ocid_20",             name: "Ocid 20",                     company: "Zydus Lifesciences",      catId: "cat_acidity",      mrp: 82,   price: 73.80,  desc: "Omeprazole 20mg for short-term treatment of GERD and gastric ulcers." },
    { id: "med_pentacid_gel",        name: "Pentacid Gel",                company: "Alembic Pharmaceuticals", catId: "cat_acidity",      mrp: 125,  price: 112.50, desc: "Antacid gel with simethicone for acidity, heartburn, and gas relief." },
    { id: "med_mucaine_gel",         name: "Mucaine Gel",                 company: "Pfizer India",            catId: "cat_acidity",      mrp: 155,  price: 139.50, desc: "Oxethazaine + Antacid gel for esophagitis, dyspepsia, and heartburn relief." },

    // ── Digestive ──────────────────────────────
    { id: "med_metrogyl_400_jb",     name: "Metrogyl 400",                company: "JB Chemicals",            catId: "cat_digestive",    mrp: 35,   price: 31.50,  desc: "Metronidazole for giardiasis, amoebiasis, and bacterial digestive infections." },
    { id: "med_sporlac_ds",          name: "Sporlac DS",                  company: "Sanzyme",                 catId: "cat_digestive",    mrp: 145,  price: 130.50, desc: "Lactobacillus double-strength probiotic for antibiotic-associated diarrhoea and IBS." },
    { id: "med_vizylac",             name: "Vizylac Capsules",            company: "Torrent Pharmaceuticals", catId: "cat_digestive",    mrp: 155,  price: 139.50, desc: "Lactobacillus acidophilus probiotic for gut restoration after antibiotic therapy." },
    { id: "med_pudin_hara_pearls",   name: "Pudin Hara Pearls",           company: "Dabur India",             catId: "cat_digestive",    mrp: 35,   price: 31.50,  desc: "Peppermint oil pearls for instant relief from gas, bloating, and stomach cramps." },
    { id: "med_lactihep_syrup",      name: "Lactihep Syrup",              company: "Sun Pharma",              catId: "cat_digestive",    mrp: 210,  price: 189.00, desc: "Lactulose syrup for constipation and hepatic encephalopathy management." },
    { id: "med_cremaffin_syrup",     name: "Cremaffin Syrup",             company: "Abbott India",            catId: "cat_digestive",    mrp: 145,  price: 130.50, desc: "Liquid paraffin laxative syrup for smooth constipation relief." },
    { id: "med_lactifiber",          name: "Lactifiber Powder",           company: "Sun Pharma",              catId: "cat_digestive",    mrp: 265,  price: 238.50, desc: "Ispaghula husk + Lactulose powder for constipation with prebiotic gut support." },
    { id: "med_happy_d_syrup",       name: "Happy D Syrup",               company: "Mankind Pharma",          catId: "cat_vitamins",     mrp: 95,   price: 85.50,  desc: "Vitamin D3 + Calcium oral syrup for bone health and Vitamin D deficiency." },

    // ── Vitamins & Supplements ──────────────────────────────
    { id: "med_supradyn",            name: "Supradyn Tablets",            company: "Bayer India",             catId: "cat_multivitamins",mrp: 135,  price: 121.50, desc: "Comprehensive multivitamin + multimineral tablet for daily nutritional supplementation." },
    { id: "med_becadexamin",         name: "Becadexamin",                 company: "GSK India",               catId: "cat_vitamins",     mrp: 120,  price: 108.00, desc: "B-complex + Vitamin A + D + E capsule for overall nutritional support." },
    { id: "med_ferium_xt",           name: "Ferium XT",                   company: "Emcure Pharmaceuticals",  catId: "cat_vitamins",     mrp: 210,  price: 189.00, desc: "Iron polymaltose + Folic acid + Vitamin B12 for iron deficiency anaemia." },
    { id: "med_dexorange_syrup",     name: "Dexorange Syrup",             company: "Franco-Indian Pharma",    catId: "cat_vitamins",     mrp: 165,  price: 148.50, desc: "Iron + Folic acid + Vitamin B12 tonic syrup for anaemia and nutritional deficiency." },
    { id: "med_a_to_z_gold",         name: "A to Z Gold",                 company: "Alkem Laboratories",      catId: "cat_multivitamins",mrp: 210,  price: 189.00, desc: "Gold-strength multivitamin + multimineral for immunity, energy, and overall vitality." },
    { id: "med_neurokind_gold",      name: "Neurokind Gold",              company: "Mankind Pharma",          catId: "cat_vitamins",     mrp: 165,  price: 148.50, desc: "Methylcobalamin + Alpha lipoic acid + Folic acid for neuropathy and nerve health." },
    { id: "med_maxirich",            name: "Maxirich Capsules",           company: "Cipla",                   catId: "cat_multivitamins",mrp: 145,  price: 130.50, desc: "Multivitamin + multimineral capsule for energy, immunity, and daily nutrition." },
    { id: "med_calcimax_500",        name: "Calcimax 500",                company: "Meyer Organics",          catId: "cat_calcium",      mrp: 120,  price: 108.00, desc: "Calcium carbonate 500mg + Vitamin D3 for bone health and calcium deficiency." },
    { id: "med_osteocalcium",        name: "Osteocalcium",                company: "Zydus Lifesciences",      catId: "cat_calcium",      mrp: 95,   price: 85.50,  desc: "Calcium + Vitamin D3 + Vitamin K2 tablet for bone density and osteoporosis prevention." },
    { id: "med_uprise_d3_60k",       name: "Uprise D3 60K",               company: "Alkem Laboratories",      catId: "cat_vitamins",     mrp: 125,  price: 112.50, desc: "Vitamin D3 60000 IU weekly sachet for Vitamin D deficiency correction." },
    { id: "med_gemsoline",           name: "Gemsoline",                   company: "Alkem Laboratories",      catId: "cat_vitamins",     mrp: 175,  price: 157.50, desc: "Methylcobalamin + Alpha lipoic acid + Folic acid for neuropathy and diabetic nerve damage." },
    { id: "med_renerve_plus",        name: "Renerve Plus",                company: "Dr. Reddy's Laboratories",catId: "cat_vitamins",     mrp: 240,  price: 216.00, desc: "Methylcobalamin + Alpha lipoic acid + Benfotiamine for peripheral neuropathy." },
    { id: "med_autrin",              name: "Autrin Capsules",             company: "Pfizer India",            catId: "cat_vitamins",     mrp: 135,  price: 121.50, desc: "Ferrous fumarate + Folic acid + Vitamin C capsule for pregnancy-related anaemia." },
    { id: "med_fefol",               name: "Fefol Capsules",              company: "Abbott India",            catId: "cat_vitamins",     mrp: 115,  price: 103.50, desc: "Ferrous sulfate + Folic acid slow-release capsule for iron deficiency anaemia." },
    { id: "med_benadon_40",          name: "Benadon 40",                  company: "Pfizer India",            catId: "cat_vitamins",     mrp: 52,   price: 46.80,  desc: "Pyridoxine (Vitamin B6) 40mg for nerve health, morning sickness, and B6 deficiency." },
    { id: "med_celin_500",           name: "Celin 500",                   company: "GSK India",               catId: "cat_vitamins",     mrp: 32,   price: 28.80,  desc: "Vitamin C 500mg effervescent tablet for immunity and antioxidant support." },
    { id: "med_evion_lc",            name: "Evion LC",                    company: "Merck India",             catId: "cat_vitamins",     mrp: 145,  price: 130.50, desc: "Vitamin E + Vitamin C combination capsule for skin health and antioxidant protection." },
    { id: "med_celin_zinc",          name: "Celin Zinc",                  company: "GSK India",               catId: "cat_vitamins",     mrp: 68,   price: 61.20,  desc: "Vitamin C + Zinc effervescent tablet for immunity, wound healing, and cold prevention." },
    { id: "med_ferikind_plus",       name: "Ferikind Plus",               company: "Mankind Pharma",          catId: "cat_vitamins",     mrp: 165,  price: 148.50, desc: "Iron + Folic acid + Zinc + Vitamin B12 for comprehensive anaemia treatment." },
    { id: "med_riconia_lp",          name: "Riconia LP",                  company: "Abbott India",            catId: "cat_vitamins",     mrp: 185,  price: 166.50, desc: "Multivitamin + Lycopene + Piperine for enhanced absorption and antioxidant support." },
    { id: "med_zincovit_apex",       name: "Zincovit Syrup",              company: "Apex Laboratories",       catId: "cat_vitamins",     mrp: 115,  price: 103.50, desc: "Zinc + Multivitamin syrup for children's immunity and growth support." },
    { id: "med_livfit_syrup",        name: "Livfit Syrup",                company: "Mankind Pharma",          catId: "cat_ayurvedic",    mrp: 135,  price: 121.50, desc: "Herbal liver tonic for liver protection, appetite, and digestive health." },
    { id: "med_hepamerz",            name: "Hepamerz Sachet",             company: "Win-Medicare",            catId: "cat_digestive",    mrp: 420,  price: 378.00, desc: "L-Ornithine L-Aspartate sachet for hepatic encephalopathy and liver detoxification." },

    // ── Allergy ──────────────────────────────
    { id: "med_allegra_m",           name: "Allegra M",                   company: "Sanofi India",            catId: "cat_allergy",      mrp: 265,  price: 238.50, desc: "Montelukast + Fexofenadine for allergic rhinitis, urticaria, and asthma prevention." },
    { id: "med_montair_lc",          name: "Montair LC",                  company: "Cipla",                   catId: "cat_allergy",      mrp: 198,  price: 178.20, desc: "Montelukast + Levocetirizine for allergic rhinitis, chronic urticaria, and asthma." },
    { id: "med_levocet_syrup",       name: "Levocet Syrup",               company: "Cipla",                   catId: "cat_allergy",      mrp: 82,   price: 73.80,  desc: "Levocetirizine 2.5mg/5ml syrup for allergic rhinitis and urticaria in children." },
    { id: "med_montek_fx",           name: "Montek FX",                   company: "Sun Pharma",              catId: "cat_allergy",      mrp: 245,  price: 220.50, desc: "Montelukast + Fexofenadine for chronic urticaria and seasonal allergic rhinitis." },
    { id: "med_telekast_f",          name: "Telekast F",                  company: "Lupin Limited",           catId: "cat_allergy",      mrp: 215,  price: 193.50, desc: "Montelukast + Fexofenadine for allergic rhinitis and allergy-related asthma." },

    // ── Diabetes ──────────────────────────────
    { id: "med_glyree_m1",           name: "Glyree M1",                   company: "Dr. Reddy's Laboratories",catId: "cat_diabetes",     mrp: 155,  price: 139.50, desc: "Glimepiride 1mg + Metformin 500mg combination for type 2 diabetes." },
    { id: "med_janumet_50_500",      name: "Janumet 50/500",               company: "MSD Pharmaceuticals",    catId: "cat_diabetes",     mrp: 420,  price: 378.00, desc: "Sitagliptin + Metformin DPP-4 inhibitor combo for type 2 diabetes management." },
    { id: "med_istamet_50_500",      name: "Istamet 50/500",               company: "Sun Pharma",              catId: "cat_diabetes",     mrp: 395,  price: 355.50, desc: "Sitagliptin 50mg + Metformin 500mg for effective blood sugar control." },
    { id: "med_galvus_met",          name: "Galvus Met",                   company: "Novartis India",          catId: "cat_diabetes",     mrp: 385,  price: 346.50, desc: "Vildagliptin + Metformin DPP-4 inhibitor combination for type 2 diabetes." },
    { id: "med_human_mixtard",       name: "Human Mixtard Insulin",        company: "Novo Nordisk India",      catId: "cat_diabetes",     mrp: 165,  price: 148.50, desc: "Biphasic isophane insulin 30/70 for type 1 and type 2 diabetes requiring insulin." },
    { id: "med_lantus",              name: "Lantus Injection",             company: "Sanofi India",            catId: "cat_diabetes",     mrp: 950,  price: 855.00, desc: "Insulin glargine long-acting basal insulin for type 1 and type 2 diabetes." },
    { id: "med_glycomet_gp2",        name: "Glycomet GP2",                 company: "USV Private Limited",     catId: "cat_diabetes",     mrp: 165,  price: 148.50, desc: "Glimepiride 2mg + Metformin 500mg for dual blood sugar control in type 2 diabetes." },
    { id: "med_glimisave_m2",        name: "Glimisave M2",                 company: "Eris Lifesciences",       catId: "cat_diabetes",     mrp: 155,  price: 139.50, desc: "Glimepiride 2mg + Metformin 1000mg for type 2 diabetes with better glycaemic control." },
    { id: "med_amaryl_m1",           name: "Amaryl M1",                    company: "Sanofi India",            catId: "cat_diabetes",     mrp: 210,  price: 189.00, desc: "Glimepiride 1mg + Metformin 250mg for type 2 diabetes blood sugar management." },
    { id: "med_voglibose_md_03",     name: "Voglibose MD 0.3",             company: "Torrent Pharmaceuticals", catId: "cat_diabetes",     mrp: 175,  price: 157.50, desc: "Voglibose 0.3mg mouth-dissolving tablet to reduce post-meal blood sugar spikes." },
    { id: "med_jalra_m_50_500",      name: "Jalra M 50/500",               company: "USV Private Limited",     catId: "cat_diabetes",     mrp: 365,  price: 328.50, desc: "Vildagliptin 50mg + Metformin 500mg DPP-4 inhibitor combo for type 2 diabetes." },
    { id: "med_glyciphage_sr1000",   name: "Glyciphage SR 1000",           company: "Franco-Indian Pharma",    catId: "cat_diabetes",     mrp: 145,  price: 130.50, desc: "Metformin SR 1000mg extended-release for type 2 diabetes with better tolerability." },
    { id: "med_obimet_gx1",          name: "Obimet GX1",                   company: "Corona Remedies",         catId: "cat_diabetes",     mrp: 195,  price: 175.50, desc: "Glibenclamide + Metformin combination for type 2 diabetes blood glucose management." },
    { id: "med_zoryl_m2",            name: "Zoryl M2",                     company: "Intas Pharmaceuticals",   catId: "cat_diabetes",     mrp: 165,  price: 148.50, desc: "Glimepiride 2mg + Metformin 500mg for type 2 diabetes management." },
    { id: "med_cetapin_xr1000",      name: "Cetapin XR 1000",              company: "Sanofi India",            catId: "cat_diabetes",     mrp: 178,  price: 160.20, desc: "Metformin XR 1000mg extended-release for type 2 diabetes with minimal GI side effects." },
    { id: "med_insugen_30_70",       name: "Insugen 30/70",                company: "Biocon",                  catId: "cat_diabetes",     mrp: 155,  price: 139.50, desc: "Premixed biosimilar insulin 30/70 for type 1 and type 2 diabetes requiring insulin." },

    // ── Respiratory ──────────────────────────────
    { id: "med_budecort_respules",   name: "Budecort Respules",            company: "Cipla",                   catId: "cat_respiratory",  mrp: 145,  price: 130.50, desc: "Budesonide nebulisation solution for children with acute asthma and croup." },
    { id: "med_seroflo_rotacaps",    name: "Seroflo 250 Rotacaps",         company: "Cipla",                   catId: "cat_respiratory",  mrp: 310,  price: 279.00, desc: "Fluticasone + Salmeterol dry powder inhaler for long-term asthma control." },
    { id: "med_levolin_inhaler",     name: "Levolin Inhaler",              company: "Cipla",                   catId: "cat_respiratory",  mrp: 172,  price: 154.80, desc: "Levosalbutamol MDI rescue inhaler for asthma and acute bronchospasm." },
    { id: "med_deriphyllin_r150",    name: "Deriphyllin Retard 150",       company: "Zydus Lifesciences",      catId: "cat_respiratory",  mrp: 68,   price: 61.20,  desc: "Etofylline + Theophylline retard for bronchial asthma and COPD bronchodilation." },
    { id: "med_theo_asthalin",       name: "Theo Asthalin Forte",          company: "Cipla",                   catId: "cat_respiratory",  mrp: 92,   price: 82.80,  desc: "Theophylline + Salbutamol for bronchial asthma and chronic obstructive pulmonary disease." },
    { id: "med_aerocort_inhaler",    name: "Aerocort Inhaler",             company: "Cipla",                   catId: "cat_respiratory",  mrp: 165,  price: 148.50, desc: "Beclomethasone + Salbutamol combination inhaler for asthma control and relief." },

    // ── Eye & Ear Care ──────────────────────────────
    { id: "med_moxicip_drops",       name: "Moxicip Eye Drops",            company: "Cipla",                   catId: "cat_eye_ear",      mrp: 165,  price: 148.50, desc: "Moxifloxacin 0.5% eye drops for bacterial conjunctivitis and corneal ulcer." },
    { id: "med_gatiquin_drops",      name: "Gatiquin Eye Drops",           company: "Cipla",                   catId: "cat_eye_ear",      mrp: 175,  price: 157.50, desc: "Gatifloxacin 0.3% eye drops for bacterial eye infections and post-operative care." },

    // ── Skin Care ──────────────────────────────
    { id: "med_betnesol_cream",      name: "Betnesol Cream",               company: "GSK India",               catId: "cat_skin_care",    mrp: 42,   price: 37.80,  desc: "Betamethasone valerate 0.1% cream for eczema, dermatitis, and inflammatory skin conditions." },
    { id: "med_quadriderm_rf",       name: "Quadriderm RF Cream",          company: "Cipla",                   catId: "cat_skin_care",    mrp: 115,  price: 103.50, desc: "Beclomethasone + Clotrimazole + Neomycin + Tolnaftate cream for mixed skin infections." },
    { id: "med_panderm_plus",        name: "Panderm Plus",                 company: "Mankind Pharma",          catId: "cat_skin_care",    mrp: 135,  price: 121.50, desc: "Mometasone + Clotrimazole + Neomycin cream for mixed infected skin conditions." },
    { id: "med_candid_b_cream",      name: "Candid B Cream",               company: "Glenmark Pharmaceuticals",catId: "cat_skin_care",    mrp: 98,   price: 88.20,  desc: "Clotrimazole + Beclomethasone cream for fungal dermatitis and infected eczema." },
    { id: "med_cloben_g_hh",         name: "Cloben G Cream",               company: "Hegde & Hegde Pharma",    catId: "cat_skin_care",    mrp: 125,  price: 112.50, desc: "Clobetasol + Gentamicin + Miconazole cream for mixed infected dermatoses." },
    { id: "med_lobate_gm",           name: "Lobate GM Cream",              company: "Lupin Limited",           catId: "cat_skin_care",    mrp: 118,  price: 106.20, desc: "Clobetasol + Gentamicin + Miconazole cream for resistant skin infections." },
    { id: "med_terbest_cream",       name: "Terbest Cream",                company: "Sun Pharma",              catId: "cat_skin_care",    mrp: 165,  price: 148.50, desc: "Terbinafine antifungal cream for athlete's foot, ringworm, and fungal nail infections." },
    { id: "med_nizral_shampoo",      name: "Nizral Shampoo",               company: "Johnson & Johnson",       catId: "cat_personal_hygiene", mrp: 325, price: 292.50, desc: "Ketoconazole 2% shampoo for dandruff, seborrhoeic dermatitis, and scalp fungal infections." },
    { id: "med_scalpe_plus",         name: "Scalpe Plus Shampoo",          company: "Glenmark Pharmaceuticals",catId: "cat_personal_hygiene", mrp: 345, price: 310.50, desc: "Ciclopirox olamine shampoo for seborrhoeic dermatitis and resistant dandruff." },

    // ── Health Drinks & Nutrition ──────────────────────────────
    { id: "med_horlicks_classic",    name: "Horlicks Classic 1kg",         company: "Horlicks India",          catId: "cat_health_drinks",    mrp: 549,  price: 494.10, desc: "Classic malted milk drink with vitamins and minerals for strength and energy." },
    { id: "med_boost_drink",         name: "Boost Energy Drink",           company: "GSK India",               catId: "cat_health_drinks",    mrp: 499,  price: 449.10, desc: "Chocolate energy drink with 3× more stamina nutrients for active children." },
    { id: "med_bournvita",           name: "Bournvita Health Drink",       company: "Mondelez India",          catId: "cat_health_drinks",    mrp: 525,  price: 472.50, desc: "Chocolate-flavoured health drink with calcium, vitamins, and iron for children." },
    { id: "med_complan",             name: "Complan Nutrition Drink",      company: "Complan India",           catId: "cat_health_drinks",    mrp: 445,  price: 400.50, desc: "Complete planned nutritional drink with 34 nutrients for height and growth." },
    { id: "med_pediasure_powder",    name: "Pediasure Powder",             company: "Abbott India",            catId: "cat_health_drinks",    mrp: 799,  price: 719.10, desc: "Complete nutritional supplement powder for children 2-10 years for healthy growth." },
    { id: "med_ensure_vanilla",      name: "Ensure Vanilla",               company: "Abbott India",            catId: "cat_health_drinks",    mrp: 875,  price: 787.50, desc: "Adult nutritional shake in vanilla flavour for strength, immunity, and muscle health." },
    { id: "med_protinex",            name: "Protinex Original",            company: "Danone India",            catId: "cat_health_drinks",    mrp: 595,  price: 535.50, desc: "High-protein health drink with whey and soy protein for muscle strength and recovery." },
    { id: "med_dabur_glucose",       name: "Dabur Glucose D",              company: "Dabur India",             catId: "cat_hydration",        mrp: 180,  price: 162.00, desc: "Instant glucose powder with vitamins for quick energy replenishment and dehydration." },
    { id: "med_orsl",                name: "ORSL Electrolyte Drink",       company: "Johnson & Johnson",       catId: "cat_hydration",        mrp: 85,   price: 76.50,  desc: "Oral rehydration solution with electrolytes for dehydration and fluid loss." },
    { id: "med_fastup_reload",       name: "Fast&Up Reload",               company: "Fast&Up India",           catId: "cat_hydration",        mrp: 399,  price: 359.10, desc: "Effervescent electrolyte tablet with zinc and vitamins for hydration and recovery." },

    // ── Ayurvedic & Natural ──────────────────────────────
    { id: "med_patanjali_aloe",      name: "Patanjali Aloe Vera Juice",    company: "Patanjali Ayurved",       catId: "cat_ayurvedic",        mrp: 200,  price: 180.00, desc: "Pure aloe vera juice for digestion, skin health, immunity, and detoxification." },
    { id: "med_baidyanath_chyw",     name: "Baidyanath Chyawanprash",      company: "Baidyanath",              catId: "cat_ayurvedic",        mrp: 420,  price: 378.00, desc: "Traditional ayurvedic chyawanprash with amla and herbs for immunity and vitality." },
    { id: "med_zandu_kesari",        name: "Zandu Kesari Jivan",           company: "Zandu Care",              catId: "cat_ayurvedic",        mrp: 310,  price: 279.00, desc: "Ayurvedic tonic with kesari (saffron) and herbs for strength and rejuvenation." },
    { id: "med_liv52_syrup_hw",      name: "Liv.52 Syrup",                 company: "Himalaya Wellness",       catId: "cat_ayurvedic",        mrp: 145,  price: 130.50, desc: "Herbal liver syrup for liver protection and appetite improvement." },
    { id: "med_septilin_hw",         name: "Septilin Tablets",             company: "Himalaya Wellness",       catId: "cat_ayurvedic",        mrp: 165,  price: 148.50, desc: "Herbal immunomodulator for recurrent infections and immunity enhancement." },
    { id: "med_ashvagandha_hw",      name: "Ashwagandha Tablets",          company: "Himalaya Wellness",       catId: "cat_ayurvedic",        mrp: 210,  price: 189.00, desc: "Ashwagandha adaptogen for stress relief, energy, and general wellness." },
    { id: "med_dabur_triphala",      name: "Dabur Triphala Churna",        company: "Dabur India",             catId: "cat_ayurvedic",        mrp: 120,  price: 108.00, desc: "Triphala churna for digestive health, constipation relief, and gut cleansing." },
    { id: "med_patanjali_giloy",     name: "Patanjali Giloy Juice",        company: "Patanjali Ayurved",       catId: "cat_ayurvedic",        mrp: 190,  price: 171.00, desc: "Giloy (guduchi) juice for immunity, fever, and chronic inflammatory conditions." },
    { id: "med_charak_m2tone",       name: "Charak M2 Tone",               company: "Charak Pharma",          catId: "cat_womens_health",    mrp: 215,  price: 193.50, desc: "Ayurvedic tablet for irregular periods, PCOS, and hormonal imbalance in women." },
    { id: "med_dabur_lal_tail",      name: "Dabur Lal Tail",               company: "Dabur India",             catId: "cat_ayurvedic",        mrp: 165,  price: 148.50, desc: "Ayurvedic baby massage oil with natural herbs for bone strength and growth." },
    { id: "med_dabur_honey",         name: "Dabur Honey 500g",             company: "Dabur India",             catId: "cat_ayurvedic",        mrp: 325,  price: 292.50, desc: "Pure natural honey for immunity, energy, digestion, and as a healthy sweetener." },
    { id: "med_patanjali_honey",     name: "Patanjali Honey",              company: "Patanjali Ayurved",       catId: "cat_ayurvedic",        mrp: 299,  price: 269.10, desc: "Natural bee honey for immunity, cough relief, and as a healthy sugar substitute." },
    { id: "med_himalaya_liv52_tab",  name: "Himalaya Liv.52 Tablets",      company: "Himalaya Wellness",       catId: "cat_ayurvedic",        mrp: 155,  price: 139.50, desc: "Herbal liver tablets for hepatic support, appetite, and liver enzyme normalisation." },

    // ── Throat & Oral ──────────────────────────────
    { id: "med_nicotex_2mg",         name: "Nicotex 2mg Gum",              company: "Cipla",                   catId: "cat_personal_hygiene", mrp: 399,  price: 359.10, desc: "Nicotine replacement therapy gum for smoking cessation and nicotine withdrawal." },
    { id: "med_strepsils_orange",    name: "Strepsils Orange",             company: "Reckitt",                 catId: "cat_cold_cough",       mrp: 38,   price: 34.20,  desc: "Orange-flavoured antibacterial throat lozenges for sore throat and oral infections." },
    { id: "med_vicks_cough_drops",   name: "Vicks Cough Drops",            company: "Procter & Gamble",        catId: "cat_cold_cough",       mrp: 30,   price: 27.00,  desc: "Menthol lozenges for soothing sore throat and temporary cough relief." },
    { id: "med_cofsils",             name: "Cofsils Lozenges",             company: "Piramal Healthcare",      catId: "cat_cold_cough",       mrp: 35,   price: 31.50,  desc: "Antibacterial lozenges with benzocaine for sore throat pain and infection relief." },

    // ── Skin & Topical Care ──────────────────────────────
    { id: "med_boroline_cream",      name: "Boroline Cream",               company: "G.D. Pharmaceuticals",   catId: "cat_skin_care",        mrp: 42,   price: 37.80,  desc: "Antiseptic night cream with boric acid and zinc oxide for skin protection." },
    { id: "med_boroplus_emi",        name: "Boroplus Antiseptic Cream",    company: "Emami Limited",           catId: "cat_skin_care",        mrp: 110,  price: 99.00,  desc: "Antiseptic cream with neem and tulsi for skin protection and winter care." },
    { id: "med_vicco_turmeric",      name: "Vicco Turmeric Cream",         company: "Vicco Laboratories",     catId: "cat_skin_care",        mrp: 145,  price: 130.50, desc: "Turmeric-based cream for fair complexion, pimples, and natural skin glow." },
    { id: "med_dermicool_pwd",       name: "Dermicool Powder",             company: "Emami Limited",           catId: "cat_personal_hygiene", mrp: 135,  price: 121.50, desc: "Prickly heat powder with menthol for cooling, rash prevention, and freshness." },
    { id: "med_nycil_powder",        name: "Nycil Cool Powder",            company: "Heinz India",             catId: "cat_personal_hygiene", mrp: 155,  price: 139.50, desc: "Cool talc powder for prickly heat, sweating, and body odour control." },
    { id: "med_candid_dust_pwd",     name: "Candid Dusting Powder",        company: "Glenmark Pharmaceuticals",catId: "cat_skin_care",        mrp: 165,  price: 148.50, desc: "Clotrimazole antifungal dusting powder for tinea, intertrigo, and fungal skin infections." },
    { id: "med_sugar_free_gold",     name: "Sugar Free Gold",              company: "Zydus Wellness",          catId: "cat_diabetes",         mrp: 145,  price: 130.50, desc: "Aspartame-based zero-calorie sweetener for diabetics and calorie-conscious individuals." },
    { id: "med_cetaphil_lotion",     name: "Cetaphil Moisturising Lotion", company: "Galderma India",          catId: "cat_skin_care",        mrp: 495,  price: 445.50, desc: "Dermatologist-recommended gentle moisturiser for normal to combination sensitive skin." },
    { id: "med_venusia_max",         name: "Venusia Max Cream",            company: "Dr. Reddy's Laboratories",catId: "cat_skin_care",        mrp: 395,  price: 355.50, desc: "Intensive moisturising cream with ceramides and glycerine for very dry skin." },
    { id: "med_moisturex_cream",     name: "Moisturex Cream",              company: "Sun Pharma",              catId: "cat_skin_care",        mrp: 355,  price: 319.50, desc: "Paraffin-based emollient cream for dry, chapped, and eczema-prone skin." },
    { id: "med_emolene_cream",       name: "Emolene Cream",                company: "Fulford India",           catId: "cat_skin_care",        mrp: 345,  price: 310.50, desc: "Emollient cream with white soft paraffin for dry, scaly, and atopic dermatitis skin." },
    { id: "med_venusia_lotion",      name: "Venusia Lotion",               company: "Dr. Reddy's Laboratories",catId: "cat_skin_care",        mrp: 420,  price: 378.00, desc: "Light moisturising lotion with ceramides for daily use on dry and sensitive skin." },
    { id: "med_cetaphil_dam",        name: "Cetaphil DAM Lotion",          company: "Galderma India",          catId: "cat_skin_care",        mrp: 550,  price: 495.00, desc: "Daily Advance Moisturiser for eczema-prone skin with extra hydration." },

    // ── Vitamins (extended) ──────────────────────────────
    { id: "med_revital_h_woman",     name: "Revital H Woman",              company: "Sun Pharma",              catId: "cat_multivitamins",    mrp: 345,  price: 310.50, desc: "Women's multivitamin with iron, calcium, and ginseng for energy and vitality." },
    { id: "med_revital_h_man",       name: "Revital H Man",                company: "Sun Pharma",              catId: "cat_multivitamins",    mrp: 345,  price: 310.50, desc: "Men's multivitamin with zinc, selenium, and ginseng for stamina and vitality." },
    { id: "med_calcigen_d3",         name: "Calcigen D3 Sachet",           company: "Cadila Pharmaceuticals",  catId: "cat_calcium",          mrp: 110,  price: 99.00,  desc: "Calcium + Vitamin D3 sachet for bone health and calcium deficiency correction." },
    { id: "med_shelcal_hd",          name: "Shelcal HD",                   company: "Torrent Pharmaceuticals", catId: "cat_calcium",          mrp: 245,  price: 220.50, desc: "High-dose calcium + Vitamin D3 + Vitamin K2 for severe osteoporosis and fracture prevention." },
    { id: "med_uprise_d3_nano",      name: "Uprise D3 Nano Shot",          company: "Alkem Laboratories",      catId: "cat_vitamins",         mrp: 98,   price: 88.20,  desc: "Vitamin D3 nano-sized oral solution for rapid absorption and deficiency correction." },
    { id: "med_neurobion_inj",       name: "Neurobion Injection",          company: "Procter & Gamble Health", catId: "cat_vitamins",         mrp: 75,   price: 67.50,  desc: "Vitamin B1, B6, B12 injection for severe neuropathy and deficiency conditions." },
    { id: "med_dexorange_caps",      name: "Dexorange Capsules",           company: "Franco-Indian Pharma",    catId: "cat_vitamins",         mrp: 135,  price: 121.50, desc: "Iron + Folic acid + Vitamin B12 capsule for anaemia and iron deficiency." },
    { id: "med_feronia_xt",          name: "Feronia XT Tablets",           company: "Emcure Pharmaceuticals",  catId: "cat_vitamins",         mrp: 210,  price: 189.00, desc: "Ferric carboxymaltose + Folic acid for iron deficiency anaemia in pregnancy." },
    { id: "med_becadexamin_syrup",   name: "Becadexamin Syrup",            company: "GSK India",               catId: "cat_vitamins",         mrp: 145,  price: 130.50, desc: "B-complex + Vitamin A, D, E syrup for children's nutritional supplementation." },

    // ── Personal Care & Hygiene ──────────────────────────────
    { id: "med_dabur_red_tp",        name: "Dabur Red Toothpaste",         company: "Dabur India",             catId: "cat_personal_hygiene", mrp: 135,  price: 121.50, desc: "Ayurvedic toothpaste with clove, mint, and herbs for strong teeth and fresh breath." },
    { id: "med_himalaya_care_tp",    name: "Himalaya Complete Care Paste", company: "Himalaya Wellness",       catId: "cat_personal_hygiene", mrp: 120,  price: 108.00, desc: "Herbal toothpaste with pomegranate and neem for complete oral care." },
    { id: "med_senquel_f",           name: "Senquel F Toothpaste",         company: "Dr. Reddy's Laboratories",catId: "cat_personal_hygiene", mrp: 195,  price: 175.50, desc: "Fluoride toothpaste for sensitive teeth with strontium acetate for pain relief." },
    { id: "med_veet_cream",          name: "Veet Hair Removal Cream",      company: "Reckitt",                 catId: "cat_personal_hygiene", mrp: 125,  price: 112.50, desc: "Fast-acting depilatory cream for smooth hair removal from legs, arms, and underarms." },
    { id: "med_nivea_men_fw",        name: "Nivea Men Face Wash",          company: "Nivea India",             catId: "cat_personal_hygiene", mrp: 199,  price: 179.10, desc: "Men's face wash with deep cleansing formula for oil control and fresh skin." },
    { id: "med_dove_soap",           name: "Dove Soap Pack",               company: "HUL India",               catId: "cat_personal_hygiene", mrp: 240,  price: 216.00, desc: "Moisturising beauty bar with 1/4 cream for soft, nourished skin." },
    { id: "med_pears_soap",          name: "Pears Pure Soap",              company: "HUL India",               catId: "cat_personal_hygiene", mrp: 180,  price: 162.00, desc: "Transparent glycerine soap for gentle cleansing and soft, healthy skin." },
    { id: "med_dettol_handwash",     name: "Dettol Handwash",              company: "Reckitt",                 catId: "cat_personal_hygiene", mrp: 110,  price: 99.00,  desc: "Antibacterial liquid handwash for protection against 99.9% germs." },
    { id: "med_lifebuoy_hw",         name: "Lifebuoy Handwash",            company: "HUL India",               catId: "cat_personal_hygiene", mrp: 99,   price: 89.10,  desc: "Germ-protection handwash for complete family hygiene and skin care." },
    { id: "med_savlon_sanitizer",    name: "Savlon Hand Sanitizer",        company: "ITC India",               catId: "cat_first_aid",        mrp: 85,   price: 76.50,  desc: "70% isopropyl alcohol hand sanitizer for effective germ kill without water." },
    { id: "med_sterillium",          name: "Sterillium Sanitizer",         company: "Bode Chemie",             catId: "cat_first_aid",        mrp: 250,  price: 225.00, desc: "Hospital-grade hygienic hand rub for rapid disinfection and skin tolerance." },
    { id: "med_n95_mask",            name: "N95 Face Mask",                company: "Venus Safety",            catId: "cat_first_aid",        mrp: 150,  price: 135.00, desc: "N95 particulate respirator mask for protection from airborne pollutants and pathogens." },

    // ── Medical Devices ──────────────────────────────
    { id: "med_flamingo_heat_pad",   name: "Flamingo Heating Pad",         company: "Flamingo Healthcare",     catId: "cat_medical_devices",  mrp: 1450, price: 1305.00, desc: "Electric heating pad for pain relief from arthritis, back pain, and muscle stiffness." },
    { id: "med_accusure_scale",      name: "AccuSure Weighing Scale",      company: "AccuSure India",          catId: "cat_medical_devices",  mrp: 1299, price: 1169.10, desc: "Digital body weighing scale with step-on technology and high accuracy." },
    { id: "med_drtrust_oximeter",    name: "Dr Trust Oximeter",            company: "Dr Trust",                catId: "cat_medical_devices",  mrp: 2199, price: 1979.10, desc: "Fingertip pulse oximeter to measure blood oxygen saturation (SpO2) and heart rate." },
    { id: "med_beurer_bp",           name: "Beurer BP Monitor",            company: "Beurer India",            catId: "cat_medical_devices",  mrp: 2899, price: 2609.10, desc: "Automatic upper arm BP monitor with arrhythmia detection and memory function." },
    { id: "med_omron_bp",            name: "Omron Digital BP Machine",     company: "Omron Healthcare",        catId: "cat_medical_devices",  mrp: 3499, price: 3149.10, desc: "Clinically validated digital BP machine with irregular heartbeat indicator." },

    // ── Baby Care ──────────────────────────────
    { id: "med_johnsons_baby_shamp", name: "Johnson's Baby Shampoo",       company: "Johnson & Johnson",       catId: "cat_baby_care",        mrp: 185,  price: 166.50, desc: "Tear-free baby shampoo with No More Tears formula for gentle and safe hair washing." },
    { id: "med_sebamed_baby_soap",   name: "Sebamed Baby Soap",            company: "Sebamed India",           catId: "cat_baby_care",        mrp: 299,  price: 269.10, desc: "pH 5.5 baby soap for sensitive baby skin with syndet formula." },
    { id: "med_meemee_wipes",        name: "Mee Mee Baby Wipes",           company: "Mee Mee",                 catId: "cat_baby_care",        mrp: 225,  price: 202.50, desc: "Soft baby wipes with aloe vera for gentle cleaning of baby's delicate skin." },
    { id: "med_himalaya_baby_cre2",  name: "Himalaya Baby Cream",          company: "Himalaya Wellness",       catId: "cat_baby_care",        mrp: 165,  price: 148.50, desc: "Gentle moisturising baby cream for soft, healthy, and nourished baby skin." },
    { id: "med_drypers_diapers",     name: "Drypers Baby Diapers",         company: "Drypers India",           catId: "cat_baby_care",        mrp: 499,  price: 449.10, desc: "Soft baby diapers with absorbent core for all-night dryness and rash prevention." },

    // ── Feminine Care ──────────────────────────────
    { id: "med_friends_adult_dpr",   name: "Friends Adult Diapers",        company: "Nobel Hygiene",           catId: "cat_personal_hygiene", mrp: 650,  price: 585.00, desc: "Adult diapers for moderate to heavy incontinence with superior absorption." },
    { id: "med_whisper_xl",          name: "Whisper Choice XL",            company: "Procter & Gamble",        catId: "cat_feminine_care",    mrp: 145,  price: 130.50, desc: "XL-size sanitary pads for heavy flow days with leak-guard protection." },
    { id: "med_stayfree_all_night",  name: "Stayfree All Night Pads",      company: "Johnson & Johnson",       catId: "cat_feminine_care",    mrp: 210,  price: 189.00, desc: "Ultra-thin overnight pads with 360° leak protection for heavy menstrual flow." },
    { id: "med_sofy_xl",             name: "Sofy Bodyfit XL",              company: "Unicharm India",          catId: "cat_feminine_care",    mrp: 225,  price: 202.50, desc: "Body-contour XL sanitary pads for active days with extra coverage." },
    { id: "med_paree_pads",          name: "Paree Sanitary Pads",          company: "Paree",                   catId: "cat_feminine_care",    mrp: 199,  price: 179.10, desc: "Biodegradable sanitary pads with soft cottony top for comfortable period care." },
    { id: "med_sirona_cup",          name: "Sirona Menstrual Cup",         company: "Sirona India",            catId: "cat_feminine_care",    mrp: 399,  price: 359.10, desc: "Medical-grade silicone menstrual cup for up to 12-hour leak-free protection." },
    { id: "med_peesafe_spray",       name: "Pee Safe Toilet Spray",        company: "Pee Safe",                catId: "cat_feminine_care",    mrp: 175,  price: 157.50, desc: "Toilet seat sanitizer spray for protection against germs and infections in public toilets." },
    { id: "med_vwash_wipes",         name: "VWash Wipes",                  company: "Glenmark Pharmaceuticals",catId: "cat_feminine_care",    mrp: 120,  price: 108.00, desc: "pH-balanced intimate hygiene wipes for gentle freshness and protection on the go." },
    { id: "med_everteen_rollon",     name: "Everteen Cramp Relief Roll On",company: "NAD Wellness",            catId: "cat_feminine_care",    mrp: 180,  price: 162.00, desc: "Menthol roll-on for quick relief from menstrual cramps and period discomfort." },

    // ── Hair Care ──────────────────────────────
    { id: "med_dabur_amla_oil",      name: "Dabur Amla Hair Oil",          company: "Dabur India",             catId: "cat_personal_hygiene", mrp: 165,  price: 148.50, desc: "Amla-enriched hair oil for stronger, thicker, and shinier hair." },
    { id: "med_parachute_oil",       name: "Parachute Coconut Oil",        company: "Marico India",            catId: "cat_personal_hygiene", mrp: 210,  price: 189.00, desc: "Pure coconut oil for hair nourishment, scalp health, and conditioning." },
    { id: "med_navratna_oil",        name: "Navratna Cool Oil",            company: "Emami Limited",           catId: "cat_personal_hygiene", mrp: 145,  price: 130.50, desc: "9-herb cool oil for stress relief, cooling, and scalp nourishment." },
    { id: "med_indulekha_oil",       name: "Indulekha Bringha Oil",        company: "HUL India",               catId: "cat_personal_hygiene", mrp: 432,  price: 388.80, desc: "Bringharaj-based ayurvedic hair oil for hair fall control and new hair growth." },
    { id: "med_head_shoulders",      name: "Head & Shoulders Shampoo",     company: "Procter & Gamble",        catId: "cat_personal_hygiene", mrp: 299,  price: 269.10, desc: "Anti-dandruff shampoo with zinc pyrithione for scalp health and flake-free hair." },
    { id: "med_clinic_plus",         name: "Clinic Plus Shampoo",          company: "HUL India",               catId: "cat_personal_hygiene", mrp: 185,  price: 166.50, desc: "Protein-enriched family shampoo for strong, shiny, and healthy hair." },
    { id: "med_pantene_hfc",         name: "Pantene Hair Fall Control",    company: "Procter & Gamble",        catId: "cat_personal_hygiene", mrp: 320,  price: 288.00, desc: "Keratin-fortified shampoo for reducing hair fall and strengthening hair roots." },
    { id: "med_dove_hair_shamp",     name: "Dove Hair Therapy Shampoo",    company: "HUL India",               catId: "cat_personal_hygiene", mrp: 310,  price: 279.00, desc: "Intensive repair shampoo with Keratin Tri-Silk serum for damaged hair." },
    { id: "med_sunsilk_shamp",       name: "Sunsilk Black Shine Shampoo",  company: "HUL India",               catId: "cat_personal_hygiene", mrp: 245,  price: 220.50, desc: "Black shine shampoo with amla for glossy, smooth, and healthy black hair." },
    { id: "med_tresemme_shamp",      name: "Tresemme Keratin Shampoo",     company: "HUL India",               catId: "cat_personal_hygiene", mrp: 525,  price: 472.50, desc: "Professional keratin smooth shampoo for frizz control and silk-smooth hair." },

    // ── Grooming ──────────────────────────────
    { id: "med_gillette_mach3",      name: "Gillette Mach3 Razor",         company: "Procter & Gamble",        catId: "cat_grooming",         mrp: 399,  price: 359.10, desc: "3-blade precision razor for a close, comfortable, and irritation-free shave." },
    { id: "med_park_avenue_shave",   name: "Park Avenue Shaving Cream",    company: "Raymond Limited",         catId: "cat_grooming",         mrp: 95,   price: 85.50,  desc: "Rich lather shaving cream for smooth shave and skin protection." },
    { id: "med_old_spice_aftershave",name: "Old Spice After Shave",        company: "Procter & Gamble",        catId: "cat_grooming",         mrp: 245,  price: 220.50, desc: "Classic after shave lotion for skin cooling, soothing, and fresh masculine fragrance." },
    { id: "med_nivea_men_deo",       name: "Nivea Men Deodorant",          company: "Nivea India",             catId: "cat_grooming",         mrp: 299,  price: 269.10, desc: "48-hour protection men's deodorant for freshness and odour control." },
    { id: "med_axe_bodyspray",       name: "Axe Signature Body Spray",     company: "HUL India",               catId: "cat_grooming",         mrp: 275,  price: 247.50, desc: "Long-lasting signature fragrance body spray for all-day freshness." },
    { id: "med_engage_cologne",      name: "Engage Cologne Spray",         company: "ITC India",               catId: "cat_grooming",         mrp: 225,  price: 202.50, desc: "Cologne spray for men with fresh aquatic fragrance and long-lasting effect." },
    { id: "med_fogg_bodyspray",      name: "Fogg Body Spray",              company: "Vini Cosmetics",          catId: "cat_grooming",         mrp: 275,  price: 247.50, desc: "No-gas body spray with concentrated perfume for long-lasting freshness." },
    { id: "med_wild_stone_deo",      name: "Wild Stone Deodorant",         company: "McNroe Consumer Products",catId: "cat_grooming",         mrp: 250,  price: 225.00, desc: "Classic men's deodorant for strong, long-lasting fragrance and sweat control." },
    { id: "med_yardley_deo",         name: "Yardley London Deo",           company: "Wipro Consumer Care",     catId: "cat_grooming",         mrp: 299,  price: 269.10, desc: "English lavender deodorant body spray for feminine freshness and elegance." },
    { id: "med_denver_perfume",      name: "Denver Hamilton Perfume",      company: "Denver India",            catId: "cat_grooming",         mrp: 450,  price: 405.00, desc: "Premium Hamilton perfume for men with woody, spicy, and masculine fragrance." },

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
