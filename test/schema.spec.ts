import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";

const d = () => db(env);
const NOW = "2026-11-20T00:00:00.000Z";

async function product(handle: string) {
  const [p] = await d()
    .insert(s.products)
    .values({ handle, title: handle, createdAt: NOW, updatedAt: NOW })
    .returning();
  return p!;
}
const variant = (productId: number, sku: string, sizeLabel = "Standard", colour: string | null = null) =>
  d().insert(s.variants).values({ productId, sku, sizeLabel, colour });
const orderRow = (number: number, razorpayOrderId: string | null = null) =>
  d().insert(s.orders).values({
    number,
    customerName: "A",
    phone: "9999999999",
    email: "a@b.in",
    address: "{}",
    subtotalPaise: 100,
    totalPaise: 100,
    razorpayOrderId,
    createdAt: NOW,
    updatedAt: NOW,
  });

describe("schema", () => {
  beforeEach(async () => {
    for (const t of [s.refunds, s.orderStatusLog, s.orderItems, s.orders, s.webhookEvents, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("applies migrations: all tables exist and accept rows", async () => {
    const p = await product("lotus");
    await variant(p.id, "SKU-1");
    expect(await d().select().from(s.variants)).toHaveLength(1);

    await d().insert(s.categories).values({ name: "Plants", handle: "plants" });
    const cats = await d().select().from(s.categories);
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ name: "Plants", handle: "plants", isInternal: 0 });

    await d().insert(s.productSources).values({ productId: p.id, license: "CC0" });
    const srcs = await d().select().from(s.productSources);
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toMatchObject({ productId: p.id, license: "CC0" });

    await d().insert(s.productImages).values({ productId: p.id, r2Key: "a.jpg", position: 0 });
    const imgs = await d().select().from(s.productImages);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ productId: p.id, r2Key: "a.jpg", position: 0 });

    await orderRow(2001);
    const [o] = await d().select().from(s.orders);
    const [v] = await d().select().from(s.variants);
    await d().insert(s.orderItems).values({
      orderId: o!.id, variantId: v!.id, productTitle: "lotus", sizeLabel: "Standard",
      unitPricePaise: 50, quantity: 2, lineTotalPaise: 100,
    });
    const items = await d().select().from(s.orderItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ orderId: o!.id, variantId: v!.id, quantity: 2, lineTotalPaise: 100 });

    await d().insert(s.orderStatusLog).values({ orderId: o!.id, fromStatus: null, toStatus: "new", by: "system", at: NOW });
    const logs = await d().select().from(s.orderStatusLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ orderId: o!.id, toStatus: "new", by: "system" });

    await d().insert(s.refunds).values({ orderId: o!.id, razorpayRefundId: "rfnd_1", amountPaise: 100, status: "processed", createdAt: NOW });
    const refs = await d().select().from(s.refunds);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ orderId: o!.id, razorpayRefundId: "rfnd_1", amountPaise: 100 });
  });

  it("allows the same size and colour on a different product", async () => {
    const a = await product("pa");
    const b = await product("pb");
    await variant(a.id, "X1", "Std", "Red");
    await variant(b.id, "X2", "Std", "Red");
    await variant(a.id, "X3", "Big", null);
    await variant(b.id, "X4", "Big", null);
    expect(await d().select().from(s.variants)).toHaveLength(4);
  });

  it("rejects duplicate products.handle", async () => {
    await product("dup");
    await expect(product("dup")).rejects.toThrow();
  });

  it("rejects duplicate variants.sku", async () => {
    const p = await product("p1");
    await variant(p.id, "S1", "A");
    await expect(variant(p.id, "S1", "B")).rejects.toThrow();
  });

  it("rejects duplicate (product, size, colour) including NULL colour", async () => {
    const p = await product("p2");
    await variant(p.id, "A1", "Std", null);
    await expect(variant(p.id, "A2", "Std", null)).rejects.toThrow();
    await variant(p.id, "B1", "Std", "Red");
    await expect(variant(p.id, "B2", "Std", "Red")).rejects.toThrow();
    await variant(p.id, "C1", "Std", "Blue"); // different colour is fine
  });

  it("variants default: in_stock 1, hidden 0", async () => {
    const p = await product("p3");
    await variant(p.id, "D1");
    const [v] = await d().select().from(s.variants);
    expect(v!.inStock).toBe(1);
    expect(v!.hidden).toBe(0);
  });

  it("rejects duplicate webhook_events.id", async () => {
    await d().insert(s.webhookEvents).values({ id: "evt_1", receivedAt: NOW });
    await expect(d().insert(s.webhookEvents).values({ id: "evt_1", receivedAt: NOW })).rejects.toThrow();
  });

  it("rejects duplicate orders.number and razorpay_order_id", async () => {
    await orderRow(1001, "order_1");
    await expect(orderRow(1001, "order_2")).rejects.toThrow();
    await expect(orderRow(1002, "order_1")).rejects.toThrow();
    await orderRow(1003, null);
    await orderRow(1004, null); // multiple NULLs allowed
  });

  it("order defaults", async () => {
    await orderRow(1010);
    const [o] = await d().select().from(s.orders);
    expect(o!.status).toBe("pending_payment");
    expect(o!.paymentStatus).toBe("unpaid");
    expect(o!.needsReview).toBe(0);
    expect(o!.reviewReason).toBeNull();
    expect(o!.deliveryPaise).toBe(0);
  });
});
