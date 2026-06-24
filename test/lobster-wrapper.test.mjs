import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isInstalled,
  status,
  cardsRequest,
  cardsList,
  cardsReveal,
  cryptoBalance,
  cryptoSend,
  cryptoRequest,
} from "../build/lobster.js";

describe("LobsterCash module — Historia 3.1", () => {
  it("isInstalled returns true", () => {
    assert.equal(isInstalled(), true);
  });

  it("status returns authorized wallet", () => {
    const s = status();
    assert.equal(s.installed, true);
    assert.equal(s.walletConfigured, true);
    assert.ok(s.walletAddress?.startsWith("0x"));
    assert.ok(Array.isArray(s.balances));
    assert.ok(s.available);
  });

  it("cardsRequest returns approval URL", () => {
    const result = cardsRequest(10, "test purchase");
    assert.ok(result.approvalUrl.startsWith("https://www.lobster.cash/request/"));
    assert.ok(result.message.includes("approve"));
  });

  it("cardsList returns empty list", () => {
    const result = cardsList();
    assert.ok(Array.isArray(result.cards));
  });

  it("cardsReveal fails for non-existent card", () => {
    assert.throws(
      () => cardsReveal("c1", "Test", "https://t.com", "US"),
      (err) => err.code === "command_failed"
    );
  });

  it("cryptoBalance returns balances", () => {
    const result = cryptoBalance();
    assert.ok(Array.isArray(result.balances));
    // Should have ETH and USDC entries (even if zero)
    const tokens = result.balances.map((b) => b.token);
    assert.ok(tokens.includes("ETH"));
    assert.ok(tokens.includes("USDC"));
  });

  it("cryptoSend fails with insufficient funds", () => {
    assert.throws(
      () => cryptoSend("0x123", 1),
      (err) => err.code === "command_failed"
    );
  });

  it("cryptoRequest returns approval URL", () => {
    const result = cryptoRequest(10, "test top-up");
    assert.ok(result.approvalUrl.startsWith("https://www.lobster.cash/request/"));
    assert.ok(result.message.includes("approve"));
  });
});
