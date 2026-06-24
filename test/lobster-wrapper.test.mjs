import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

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

const cliInstalled = isInstalled();

describe("LobsterCash module — Historia 3.1", () => {
  it("isInstalled returns true", () => {
    assert.equal(isInstalled(), true);
  });

  it("status returns structured object", () => {
    const s = status();
    assert.equal(s.installed, true);
    // walletConfigured depends on human authorization
    assert.equal(typeof s.walletConfigured, "boolean");
    assert.ok("hasBrowserAutomation" in s);
  });

  it("cardsRequest returns approval URL even without configured wallet", () => {
    const result = cardsRequest(10, "test purchase");
    assert.ok(result.approvalUrl.startsWith("https://www.lobster.cash/request/"));
    assert.ok(result.message.includes("approve"));
  });

  it("cardsList throws wallet_not_configured", () => {
    assert.throws(
      () => cardsList(),
      (err) => err.code === "wallet_not_configured"
    );
  });

  it("cardsReveal throws wallet_not_configured", () => {
    assert.throws(
      () => cardsReveal("c1", "Test", "https://t.com", "US"),
      (err) => err.code === "wallet_not_configured"
    );
  });

  it("cryptoBalance throws wallet_not_configured", () => {
    assert.throws(
      () => cryptoBalance(),
      (err) => err.code === "wallet_not_configured"
    );
  });

  it("cryptoSend throws wallet_not_configured", () => {
    assert.throws(
      () => cryptoSend("0x123", 1),
      (err) => err.code === "wallet_not_configured"
    );
  });

  it("cryptoRequest returns approval URL even without configured wallet", () => {
    const result = cryptoRequest(10, "test top-up");
    assert.ok(result.approvalUrl.startsWith("https://www.lobster.cash/request/"));
    assert.ok(result.message.includes("approve"));
  });
});
