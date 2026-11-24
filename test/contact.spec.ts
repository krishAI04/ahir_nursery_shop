import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("shop contact", () => {
  it("GET /api/store/contact gives the WhatsApp number and chat link for price enquiries", async () => {
    const res = await SELF.fetch("http://example.com/api/store/contact", { headers: { Origin: "https://shop.test" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://shop.test");
    expect(await res.json()).toEqual({ whatsapp_number: "919999999999", whatsapp_url: "https://wa.me/919999999999" });
  });
});
