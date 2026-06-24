import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";

import { SessionStore } from "../build/sessions/store.js";

const TEST_PATH = "/tmp/mcp-checkout-test-sessions.json";

describe("SessionStore — Historia 1.3", () => {
  let store;

  before(async () => {
    await unlink(TEST_PATH).catch(() => {});
    store = new SessionStore(TEST_PATH);
  });

  after(async () => {
    await unlink(TEST_PATH).catch(() => {});
  });

  it("loads empty on first access", async () => {
    const sessions = await store.load();
    assert.deepEqual(sessions, {});
  });

  it("setSession and getSession", async () => {
    const session = {
      domain: "namecheap.com",
      status: "logged_in",
      method: "oauth_google",
      email: "test@gmail.com",
      lastVerified: new Date().toISOString(),
    };
    await store.setSession("namecheap.com", session);
    const got = await store.getSession("namecheap.com");
    assert.ok(got);
    assert.equal(got.status, "logged_in");
    assert.equal(got.email, "test@gmail.com");
  });

  it("listSessions returns all domains", async () => {
    await store.setSession("example.com", {
      domain: "example.com",
      status: "needs_login",
    });
    const all = await store.listSessions();
    assert.ok("namecheap.com" in all);
    assert.ok("example.com" in all);
    assert.equal(Object.keys(all).length, 2);
  });

  it("deleteSession removes domain", async () => {
    const removed = await store.deleteSession("example.com");
    assert.equal(removed, true);
    const got = await store.getSession("example.com");
    assert.equal(got, null);
    const all = await store.listSessions();
    assert.equal(Object.keys(all).length, 1);
  });

  it("deleteSession returns false for missing domain", async () => {
    const removed = await store.deleteSession("nonexistent.com");
    assert.equal(removed, false);
  });

  it("updating session works", async () => {
    await store.setSession("namecheap.com", {
      domain: "namecheap.com",
      status: "logged_in",
      method: "username_password",
    });
    const updated = await store.getSession("namecheap.com");
    assert.equal(updated.method, "username_password");
  });
});
