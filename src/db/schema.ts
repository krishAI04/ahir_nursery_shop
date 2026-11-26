import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Conventions: money = integer *_paise; booleans = integer 0/1; JSON = text;
// timestamps = ISO-8601 UTC text. Status columns are plain text, validated in app code.

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  handle: text("handle").notNull().unique(),
  isInternal: integer("is_internal").notNull().default(0),
});

export const products = sqliteTable(
  "products",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  handle: text("handle").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | published
  photoCredit: text("photo_credit"), // JSON {author, license, source_url} or null
  representativePhoto: integer("representative_photo").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  },
  // List pages walk these in title order and stop after one page (D1 bills rows read).
  (t) => [
    index("products_status_title_idx").on(t.status, sql`${t.title} COLLATE NOCASE`, t.id),
    index("products_title_idx").on(sql`${t.title} COLLATE NOCASE`, t.id),
    // Publish page: "products changed since" counts by updated_at.
    index("products_updated_at_idx").on(t.updatedAt),
    // Similar photo filter walks only the similar ones, in title order.
    index("products_similar_title_idx").on(sql`${t.title} COLLATE NOCASE`, t.id).where(sql`representative_photo = 1`),
  ],
);

// One row (id 1) kept current by triggers in migration 0003, so the admin list shows counts without reading every product.
// Never use INSERT OR REPLACE on products or product_images: REPLACE deletes without firing delete triggers, so product_stats would drift.
export const productStats = sqliteTable("product_stats", {
  id: integer("id").primaryKey(),
  total: integer("total").notNull().default(0),
  published: integer("published").notNull().default(0),
  draft: integer("draft").notNull().default(0),
  needsPhoto: integer("needs_photo").notNull().default(0),
  similar: integer("similar").notNull().default(0),
});

export const productCategories = sqliteTable(
  "product_categories",
  {
    productId: integer("product_id").notNull().references(() => products.id),
    categoryId: integer("category_id").notNull().references(() => categories.id),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] }), index("product_categories_category_idx").on(t.categoryId, t.productId)],
);

// No INSERT OR REPLACE here either (see product_stats above).
export const productImages = sqliteTable(
  "product_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id),
    r2Key: text("r2_key").notNull(),
    position: integer("position").notNull().default(0),
    // 1 = a look-alike photo borrowed before a real one was taken; real uploads go before these.
    similar: integer("similar").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const variants = sqliteTable(
  "variants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id),
    sku: text("sku").notNull().unique(),
    sizeLabel: text("size_label").notNull(),
    colour: text("colour"),
    pricePaise: integer("price_paise"), // null = "Price on request"
    inStock: integer("in_stock").notNull().default(1),
    hidden: integer("hidden").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("variants_product_size_colour_uq").on(t.productId, t.sizeLabel, sql`coalesce(${t.colour}, '')`),
    // Small: only sizes that are out of stock or removed. The admin "Out of stock" filter starts from it instead of every product.
    index("variants_unavailable_idx").on(t.productId).where(sql`in_stock = 0 OR hidden = 1`),
  ],
);

export const productSources = sqliteTable("product_sources", {
  productId: integer("product_id").primaryKey().references(() => products.id),
  sheetRows: text("sheet_rows"), // JSON
  rawNames: text("raw_names"), // JSON
  notes: text("notes"), // JSON
  photoSource: text("photo_source"),
  sourceUrl: text("source_url"),
  license: text("license"),
  author: text("author"),
});

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    number: integer("number").notNull().unique(),
    status: text("status").notNull().default("pending_payment"), // pending_payment|new|confirmed|out_for_delivery|delivered|cancelled
    paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid|paid|failed|partially_refunded|refunded
    needsReview: integer("needs_review").notNull().default(0),
    reviewReason: text("review_reason"),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    address: text("address").notNull(), // JSON {line1, line2, city, state, pincode}
    subtotalPaise: integer("subtotal_paise").notNull(),
    deliveryPaise: integer("delivery_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    razorpayOrderId: text("razorpay_order_id").unique(),
    razorpayPaymentId: text("razorpay_payment_id"),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("orders_status_idx").on(t.status)],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id").notNull().references(() => orders.id),
    variantId: integer("variant_id").notNull().references(() => variants.id),
    productTitle: text("product_title").notNull(),
    sizeLabel: text("size_label").notNull(),
    colour: text("colour"),
    unitPricePaise: integer("unit_price_paise").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalPaise: integer("line_total_paise").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const orderStatusLog = sqliteTable(
  "order_status_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id").notNull().references(() => orders.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    by: text("by").notNull(), // staff email or 'system'
    at: text("at").notNull(),
  },
  (t) => [index("order_status_log_order_idx").on(t.orderId)],
);

export const refunds = sqliteTable("refunds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id),
  razorpayRefundId: text("razorpay_refund_id"),
  amountPaise: integer("amount_paise").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(), // Razorpay event id
  receivedAt: text("received_at").notNull(),
});

// Single row (id = 1): the last failed deploy the 30-minute check already retried.
export const sitePublish = sqliteTable("site_publish", {
  id: integer("id").primaryKey(),
  lastRetriedDeployId: text("last_retried_deploy_id"),
});

// One row whose token changes on every write that can change the public product list (set by triggers in migration 0007).
export const catalogVersion = sqliteTable("catalog_version", {
  id: integer("id").primaryKey(),
  token: text("token").notNull(),
});
