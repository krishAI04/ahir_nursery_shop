import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/admin/session";

// The hash is made on the laptop (Node) and checked in the Worker, so both sides must agree.
describe("admin password hash in Node", () => {
  it("round-trips", async () => {
    const h = await hashPassword("green-mango-41");
    expect(await verifyPassword("green-mango-41", h)).toBe(true);
    expect(await verifyPassword("green-mango-42", h)).toBe(false);
  });
});
