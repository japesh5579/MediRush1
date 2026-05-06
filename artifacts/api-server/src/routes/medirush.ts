import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, pool, cartItemsTable, categoriesTable, medicinesTable, ordersTable, prescriptionsTable, usersTable } from "@workspace/db";
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

const ready = ensureTables().then(() => ensureSeedData()).catch((err) => {
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
    `INSERT INTO medirush_medicines (id, name, price, category_id, image_url, description) VALUES ($1,$2,$3,$4,$5,$6)`,
    [medicine.id, medicine.name, medicine.price, medicine.categoryId, medicine.imageUrl, medicine.description]
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
  if ((body as any).categoryId !== undefined) { sets.push(`category_id=$${p++}`); vals.push((body as any).categoryId); }
  if ((body as any).imageUrl !== undefined) { sets.push(`image_url=$${p++}`); vals.push((body as any).imageUrl); }
  if ((body as any).description !== undefined) { sets.push(`description=$${p++}`); vals.push((body as any).description); }
  if (sets.length === 0) { res.status(400).json({ message: "Nothing to update" }); return; }
  vals.push(params.id);
  const medResult = await pool.query<{ id: string; name: string; price: number; category_id: string; image_url: string; description: string; created_at: Date }>(
    `UPDATE medirush_medicines SET ${sets.join(",")} WHERE id=$${p} RETURNING *`, vals
  );
  if (!medResult.rows[0]) { res.status(404).json({ message: "Medicine not found" }); return; }
  const m = medResult.rows[0];
  const categories = await db.select().from(categoriesTable);
  res.json(serializeMedicine({ id: m.id, name: m.name, price: m.price, categoryId: m.category_id, imageUrl: m.image_url, description: m.description, createdAt: m.created_at } as any, categories));
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
  type OrderRow = { id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; created_at: Date };
  const serializeOrder = (o: OrderRow, extra?: { customerName?: string; customerPhone?: string }) => ({
    id: o.id, userId: o.user_id, items: o.items, total: o.total,
    paymentMethod: o.payment_method as "cod" | "upi", status: o.status,
    etaMinutes: o.eta_minutes, prescriptionId: o.prescription_id ?? undefined,
    deliveryAddress: o.delivery_address, createdAt: new Date(o.created_at).toISOString(),
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
  const orderRes = await pool.query<{ id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; created_at: Date }>(
    `UPDATE medirush_orders SET status=$1 WHERE id=$2 RETURNING *`, [status, id]
  );
  if (!orderRes.rows[0]) { res.status(404).json({ message: "Order not found" }); return; }
  const row = orderRes.rows[0];
  res.json({ id: row.id, userId: row.user_id, items: row.items, total: row.total, paymentMethod: row.payment_method as "cod" | "upi", status: row.status, etaMinutes: row.eta_minutes, prescriptionId: row.prescription_id ?? undefined, deliveryAddress: row.delivery_address, createdAt: new Date(row.created_at).toISOString() });
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
  const order = { id: id("ord"), userId, items: cart.items, total: cart.total, paymentMethod: body.paymentMethod, status: "Placed", etaMinutes: 10 + Math.floor(Math.random() * 11), prescriptionId: body.prescriptionId ?? null, deliveryAddress: body.deliveryAddress };
  const orderRes = await pool.query<{ id: string; user_id: string; items: CartLine[]; total: number; payment_method: string; status: string; eta_minutes: number; prescription_id: string | null; delivery_address: string; created_at: Date }>(
    `INSERT INTO medirush_orders (id,user_id,items,total,payment_method,status,eta_minutes,prescription_id,delivery_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [order.id, order.userId, JSON.stringify(order.items), order.total, order.paymentMethod, order.status, order.etaMinutes, order.prescriptionId, order.deliveryAddress]
  );
  await pool.query(`DELETE FROM medirush_cart_items WHERE user_id=$1`, [userId]);
  const row = orderRes.rows[0];
  res.status(201).json({ id: row.id, userId: row.user_id, items: row.items, total: row.total, paymentMethod: row.payment_method as "cod" | "upi", status: row.status, etaMinutes: row.eta_minutes, prescriptionId: row.prescription_id ?? undefined, deliveryAddress: row.delivery_address, createdAt: new Date(row.created_at).toISOString() });
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

router.get("/config/payment", (_req, res) => {
  res.json({
    upiId: process.env.UPI_ID ?? "medirush@upi",
    qrCodeImageUrl: process.env.QR_CODE_IMAGE_URL ?? svgDataUrl("UPI QR", "%2300C853"),
  });
});

export default router;
