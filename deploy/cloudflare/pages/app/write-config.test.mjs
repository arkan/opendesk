import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { appleAppIds, buildConfig, helpDomain, mailboxImap, mailboxOAuth, writeConfig } from "./write-config.mjs";

test("defaults to production URLs and leaves optional keys out", () => {
  assert.deepEqual(buildConfig({}), {
    apiUrl: "https://api.opendesk.sh",
    gatewayUrl: "wss://gateway.opendesk.sh/socket",
    selfHosted: false, sharedDrafts: false,
  });
});

test("reads every key from the environment", () => {
  const cfg = buildConfig({
    APP_API_URL: "https://api.example.com/",
    APP_GATEWAY_URL: "wss://gw.example.com/socket",
    WEB_POSTHOG_KEY: "phc_x",
    WEB_POSTHOG_HOST: "https://us.i.posthog.com",
    TURNSTILE_SITE_KEY: "0x4AAA",
  });
  assert.deepEqual(cfg, {
    apiUrl: "https://api.example.com",
    gatewayUrl: "wss://gw.example.com/socket",
    posthogKey: "phc_x",
    posthogHost: "https://us.i.posthog.com",
    turnstileSiteKey: "0x4AAA",
    selfHosted: false, sharedDrafts: false,
  });
});

test("refuses a gateway URL that is not a websocket", () => {
  assert.throws(() => buildConfig({ APP_GATEWAY_URL: "https://gw.example.com" }), /APP_GATEWAY_URL/);
  assert.throws(() => buildConfig({ APP_API_URL: "not a url" }), /APP_API_URL/);
});

test("writes a config.js that sets window.__OPENDESK__", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const [file] = writeConfig(dir, { WEB_POSTHOG_KEY: "phc_</script>" });
  assert.equal(file, join(dir, "config.js"));
  const src = readFileSync(file, "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  assert.equal(ctx.window.__OPENDESK__.apiUrl, "https://api.opendesk.sh");
  assert.equal(ctx.window.__OPENDESK__.posthogKey, "phc_</script>");
  assert.equal(ctx.window.__OPENDESK__.selfHosted, false);
});

test("writes a config.json with the same keys and values as config.js", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const env = { APP_API_URL: "https://api.example.com", TURNSTILE_SITE_KEY: "0x4AAA" };
  const files = writeConfig(dir, env);
  assert.deepEqual(files, [join(dir, "config.js"), join(dir, "config.json")]);
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(files[0], "utf8"), ctx);
  const json = JSON.parse(readFileSync(files[1], "utf8"));
  assert.deepEqual(json, buildConfig(env));
  assert.equal(JSON.stringify(json), JSON.stringify(ctx.window.__OPENDESK__));
});

test("writes no apple-app-site-association without APPLE_APP_IDS", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  writeConfig(dir, { APPLE_APP_IDS: " , " });
  assert.equal(existsSync(join(dir, ".well-known", "apple-app-site-association")), false);
});

test("writes an apple-app-site-association for APPLE_APP_IDS", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const files = writeConfig(dir, { APPLE_APP_IDS: "ABCDE12345.sh.opendesk.app, ABCDE12345.sh.opendesk.app" });
  const file = join(dir, ".well-known", "apple-app-site-association");
  assert.equal(files.at(-1), file);
  const aasa = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(aasa.webcredentials, { apps: ["ABCDE12345.sh.opendesk.app"] });
  assert.equal(aasa.applinks.details.length, 1);
  assert.deepEqual(aasa.applinks.details[0].appIDs, ["ABCDE12345.sh.opendesk.app"]);
  const paths = aasa.applinks.details[0].components.map((c) => c["/"]);
  assert.ok(paths.includes("/inbox/*/?*"));
  assert.ok(!paths.includes("/tickets/?*"));
});

test("refuses an app id that is not TEAMID.bundle", () => {
  assert.throws(() => appleAppIds("sh.opendesk.app"), /APPLE_APP_IDS/);
  assert.throws(() => appleAppIds("abcde12345.sh.opendesk.app"), /APPLE_APP_IDS/);
  assert.throws(() => writeConfig(mkdtempSync(join(tmpdir(), "od-config-")), { APPLE_APP_IDS: "ABCDE12345" }), /APPLE_APP_IDS/);
  assert.deepEqual(appleAppIds(""), []);
  assert.deepEqual(appleAppIds(undefined), []);
});

test("needs an output directory", () => {
  assert.throws(() => writeConfig(undefined, {}), /usage/);
});

test("MAILBOX_OAUTH lists the providers whose mailbox sign-in is offered", () => {
  assert.deepEqual(buildConfig({ MAILBOX_OAUTH: "microsoft" }).mailboxOAuth, ["microsoft"]);
  assert.deepEqual(buildConfig({ MAILBOX_OAUTH: " Google, microsoft,google " }).mailboxOAuth, ["google", "microsoft"]);
  assert.deepEqual(buildConfig({ MAILBOX_OAUTH: "none" }).mailboxOAuth, []);
  assert.equal("mailboxOAuth" in buildConfig({ MAILBOX_OAUTH: "" }), false);
  assert.equal("mailboxOAuth" in buildConfig({}), false);
  assert.deepEqual(mailboxOAuth(","), []);
  assert.throws(() => buildConfig({ MAILBOX_OAUTH: "google,yahoo" }), /MAILBOX_OAUTH/);
});

test("HELP_DOMAIN is the domain help centers live under", () => {
  assert.equal(buildConfig({ HELP_DOMAIN: "opendeskhelp.com" }).helpDomain, "opendeskhelp.com");
  assert.equal(buildConfig({ HELP_DOMAIN: " help.example.co.uk. " }).helpDomain, "help.example.co.uk");
  assert.equal("helpDomain" in buildConfig({ HELP_DOMAIN: "" }), false);
  assert.equal("helpDomain" in buildConfig({ HELP_DOMAIN: "  " }), false);
  assert.equal("helpDomain" in buildConfig({}), false);
});

test("HELP_DOMAIN must be a lowercase hostname without a scheme", () => {
  for (const bad of ["https://opendeskhelp.com", "OpendeskHelp.com", "opendeskhelp.com/help", "opendeskhelp.com:443", "localhost", "-x.com", "a..com", "*.opendeskhelp.com"]) {
    assert.throws(() => buildConfig({ HELP_DOMAIN: bad }), /HELP_DOMAIN/, bad);
  }
  assert.throws(() => helpDomain(undefined), /HELP_DOMAIN/);
});

test("writes helpDomain into both config files", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const files = writeConfig(dir, { HELP_DOMAIN: "opendeskhelp.com" });
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(files[0], "utf8"), ctx);
  assert.equal(ctx.window.__OPENDESK__.helpDomain, "opendeskhelp.com");
  assert.equal(JSON.parse(readFileSync(files[1], "utf8")).helpDomain, "opendeskhelp.com");
});

test("MAILBOX_IMAP says whether the API receives mail over IMAP", () => {
  assert.equal(buildConfig({ MAILBOX_IMAP: "false" }).mailboxImap, false);
  assert.equal(buildConfig({ MAILBOX_IMAP: " TRUE " }).mailboxImap, true);
  assert.equal("mailboxImap" in buildConfig({ MAILBOX_IMAP: "" }), false);
  assert.equal("mailboxImap" in buildConfig({}), false);
  for (const bad of ["yes", "0", "off", "1"]) {
    assert.throws(() => buildConfig({ MAILBOX_IMAP: bad }), /MAILBOX_IMAP/, bad);
  }
  assert.throws(() => mailboxImap(undefined), /MAILBOX_IMAP/);
});

test("writes mailboxImap into both config files", () => {
  const dir = mkdtempSync(join(tmpdir(), "od-config-"));
  const files = writeConfig(dir, { MAILBOX_IMAP: "false" });
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(files[0], "utf8"), ctx);
  assert.equal(ctx.window.__OPENDESK__.mailboxImap, false);
  assert.equal(JSON.parse(readFileSync(files[1], "utf8")).mailboxImap, false);
});

test("shared drafts remain disabled until hosted promotion explicitly enables them", () => {
  assert.equal(buildConfig({}).sharedDrafts, false);
  assert.equal(buildConfig({ SHARED_DRAFTS_ENABLED: "true" }).sharedDrafts, true);
  assert.equal(buildConfig({ SHARED_DRAFTS_ENABLED: "false" }).sharedDrafts, false);
  assert.throws(() => buildConfig({ SHARED_DRAFTS_ENABLED: "invalid" }), /SHARED_DRAFTS_ENABLED/);
});
