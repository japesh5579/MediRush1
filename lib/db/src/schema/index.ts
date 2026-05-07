import { doublePrecision, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("medirush_users", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  location: text("location").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const categoriesTable = pgTable("medirush_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const medicinesTable = pgTable("medirush_medicines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: doublePrecision("price").notNull(),
  mrp: doublePrecision("mrp"),
  company: text("company"),
  categoryId: text("category_id").notNull(),
  imageUrl: text("image_url").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const cartItemsTable = pgTable("medirush_cart_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  medicineId: text("medicine_id").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const prescriptionsTable = pgTable("medirush_prescriptions", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  imageUrl: text("image_url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ordersTable = pgTable("medirush_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  items: jsonb("items").notNull(),
  total: doublePrecision("total").notNull(),
  paymentMethod: text("payment_method").notNull(),
  status: text("status").notNull(),
  etaMinutes: integer("eta_minutes").notNull(),
  prescriptionId: text("prescription_id"),
  deliveryAddress: text("delivery_address").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
