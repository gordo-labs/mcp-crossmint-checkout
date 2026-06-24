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
  x402Fetch,
} from "../build/lobster.js";

describe("LobsterCash module — Historia 3.1", () => {
  it("isInstalled returns boolean", () => {
    assert.equal(typeof isInstalled(), "boolean");
  });

  it("status returns degraded object when CLI not installed", () => {
    const s = status();
    assert.equal(s.available, false);
    assert.equal(s.walletConfigured, false);
    assert.equal(s.hasBrowserAutomation, false);
    assert.ok(s.error);
    assert.ok(s.nextStep);
  });

  it("cardsRequest throws not_installed", () => {
    assert.throws(
      () => cardsRequest(10, "test"),
      (err) => err.code === "not_installed"
    );
  });

  it("cardsList throws not_installed", () => {
    assert.throws(
      () => cardsList(),
      (err) => err.code === "not_installed"
    );
  });

  it("cardsReveal throws not_installed", () => {
    assert.throws(
      () => cardsReveal("c1", "Test", "https://t.com", "US"),
      (err) => err.code === "not_installed"
    );
  });

  it("cryptoBalance throws not_installed", () => {
    assert.throws(
      () => cryptoBalance(),
      (err) => err.code === "not_installed"
    );
  });

  it("cryptoSend throws not_installed", () => {
    assert.throws(
      () => cryptoSend("0x123", 1),
      (err) => err.code === "not_installed"
    );
  });

  it("cryptoRequest throws not_installed", () => {
    assert.throws(
      () => cryptoRequest(10, "test"),
      (err) => err.code === "not_installed"
    );
  });

  it("x402Fetch throws not_installed", () => {
    assert.throws(
      () => x402Fetch("https://example.com"),
      (err) => err.code === "not_installed"
    );
  });
});
