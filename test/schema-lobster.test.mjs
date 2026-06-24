import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CheckoutSchema,
  PlatformSessionSchema,
  ProductSnapshotSchema,
} from "../build/basket/schema.js";

describe("CheckoutSchema — Historia 1.1", () => {
  it("parses old checkout without new fields", () => {
    const result = CheckoutSchema.safeParse({
      provider: "crossmint",
      readiness: "ready",
      locator: "amazon:B00TEST1234",
    });
    assert.ok(result.success);
  });

  it("parses new checkout with requiresAuth and sessionDomain", () => {
    const result = CheckoutSchema.safeParse({
      provider: "lobstercash_card",
      readiness: "needs_session",
      requiresAuth: true,
      sessionDomain: "namecheap.com",
      authType: "login",
      guestCheckoutAvailable: false,
    });
    assert.ok(result.success);
    assert.equal(result.data.requiresAuth, true);
    assert.equal(result.data.sessionDomain, "namecheap.com");
  });

  it("defaults requiresAuth to false when not provided", () => {
    const result = CheckoutSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.requiresAuth, false);
    assert.equal(result.data.authType, "unknown");
  });

  it("accepts new readiness values", () => {
    for (const r of ["needs_session", "needs_approval"]) {
      const result = CheckoutSchema.safeParse({ readiness: r });
      assert.ok(result.success, `readiness ${r} should parse`);
    }
  });

  it("rejects invalid readiness", () => {
    const result = CheckoutSchema.safeParse({ readiness: "invalid" });
    assert.ok(!result.success);
  });

  it("accepts new provider values", () => {
    for (const p of ["lobstercash_card", "lobstercash_crypto"]) {
      const result = CheckoutSchema.safeParse({ provider: p });
      assert.ok(result.success, `provider ${p} should parse`);
    }
  });
});

describe("PlatformSessionSchema — Historia 1.1", () => {
  it("parses a valid session", () => {
    const result = PlatformSessionSchema.safeParse({
      domain: "namecheap.com",
      status: "logged_in",
      method: "oauth_google",
      email: "test@gmail.com",
    });
    assert.ok(result.success);
  });

  it("defaults status to none", () => {
    const result = PlatformSessionSchema.safeParse({ domain: "example.com" });
    assert.ok(result.success);
    assert.equal(result.data.status, "none");
  });
});

describe("ProductSnapshotSchema — Historia 1.2", () => {
  it("parses product with platformCheckout", () => {
    const result = ProductSnapshotSchema.safeParse({
      title: "Test Product",
      platformCheckout: {
        guestCheckout: true,
        authRequired: false,
        supportedPaymentMethods: ["credit_card", "paypal"],
      },
    });
    assert.ok(result.success);
    assert.equal(result.data.platformCheckout.guestCheckout, true);
  });

  it("parses product without platformCheckout (backward compat)", () => {
    const result = ProductSnapshotSchema.safeParse({ title: "Old Product" });
    assert.ok(result.success);
  });
});
