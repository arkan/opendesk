import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHelpDomain, parseMailboxImap, parseMailboxOAuth, readConfig } from "./config";

describe("parseMailboxImap", () => {
  it("takes the runtime value first", () => {
    expect(parseMailboxImap(false, "true")).toBe(false);
    expect(parseMailboxImap(true, "false")).toBe(true);
    expect(parseMailboxImap("false", undefined)).toBe(false);
    expect(parseMailboxImap(" TRUE ", "false")).toBe(true);
  });
  it("falls back to the build env, then on", () => {
    expect(parseMailboxImap(undefined, "false")).toBe(false);
    expect(parseMailboxImap("", "false")).toBe(false);
    expect(parseMailboxImap("${MAILBOX_IMAP}", "false")).toBe(false);
    expect(parseMailboxImap(undefined, "true")).toBe(true);
    expect(parseMailboxImap(undefined, undefined)).toBe(true);
    expect(parseMailboxImap(undefined, "")).toBe(true);
    expect(parseMailboxImap(["google"], "maybe")).toBe(true);
  });
});

describe("parseMailboxOAuth", () => {
  it("reads a list, a comma list or none", () => {
    expect(parseMailboxOAuth(["google", "nope"], undefined)).toEqual(["google"]);
    expect(parseMailboxOAuth(undefined, "google, microsoft")).toEqual(["google", "microsoft"]);
    expect(parseMailboxOAuth(undefined, "none")).toEqual([]);
    expect(parseMailboxOAuth(undefined, undefined)).toBeNull();
  });
});

describe("parseHelpDomain", () => {
  it("keeps a bare hostname only", () => {
    expect(parseHelpDomain("Help.Example.com.")).toBe("help.example.com");
    expect(parseHelpDomain("https://help.example.com")).toBe("");
  });
});


describe("shared draft rollout configuration", () => {
  afterEach(() => { delete window.__OPENDESK__; vi.unstubAllEnvs(); });
  it("defaults on for development and self-hosted apps without runtime configuration", () => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "");
    expect(readConfig().sharedDrafts).toBe(true);
  });
  it("respects the instance runtime switch before the build environment", () => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "true");
    window.__OPENDESK__ = { sharedDrafts: false };
    expect(readConfig().sharedDrafts).toBe(false);
    window.__OPENDESK__ = { sharedDrafts: "true" };
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "false");
    expect(readConfig().sharedDrafts).toBe(true);
  });
  it("supports a disabled build fallback when no runtime switch is supplied", () => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "false");
    expect(readConfig().sharedDrafts).toBe(false);
  });
});
