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
  it.each([false, true])("keeps shared drafts off with an older runtime (selfHosted=%s)", (selfHosted) => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "true");
    window.__OPENDESK__ = { apiUrl: "https://api.example.test", selfHosted };
    expect(readConfig().sharedDrafts).toBe(false);
  });
  it.each([undefined, "", "${SHARED_DRAFTS_ENABLED}", "maybe", ["true"]].map((sharedDrafts) => ({ sharedDrafts })))("keeps shared drafts off with an invalid runtime switch ($sharedDrafts)", ({ sharedDrafts }) => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", "true");
    window.__OPENDESK__ = { sharedDrafts };
    expect(readConfig().sharedDrafts).toBe(false);
  });
  it.each([["true", true], ["false", false], ["maybe", true]] as const)("uses the build fallback %s without runtime configuration", (env, enabled) => {
    vi.stubEnv("VITE_SHARED_DRAFTS_ENABLED", env);
    expect(readConfig().sharedDrafts).toBe(enabled);
  });
  it.each([["true", true], ["false", false]] as const)("preserves the IMAP build fallback %s with an older runtime", (env, enabled) => {
    vi.stubEnv("VITE_MAILBOX_IMAP", env);
    window.__OPENDESK__ = {};
    expect(readConfig().mailboxImap).toBe(enabled);
  });
});
