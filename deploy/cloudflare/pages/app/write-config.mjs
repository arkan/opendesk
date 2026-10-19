#!/usr/bin/env node
// Writes the runtime config files for the opendesk-app Pages project:
//
//   <outdir>/config.js     window.__OPENDESK__ = {...}, read by the web app
//   <outdir>/config.json   the same object as JSON, read by the desktop and iPhone apps
//   <outdir>/.well-known/apple-app-site-association
//                          only when APPLE_APP_IDS is set: associates the iPhone app
//                          with this host for passkeys and ticket links
//
// The self-hosted binary serves config.js and config.json itself (internal/webui
// RuntimeConfig); on Cloudflare Pages there is no server, so deploy.yml writes the
// same files into the build output before uploading it. Keys match the Go JSON
// tags exactly (contracts/native.md, Finding an instance).
//
//   node deploy/cloudflare/pages/app/write-config.mjs web/dist
//
// Env: APP_API_URL, APP_GATEWAY_URL, WEB_POSTHOG_KEY, WEB_POSTHOG_HOST,
// TURNSTILE_SITE_KEY, APPLE_APP_IDS (comma-separated TEAMID.bundle ids),
// MAILBOX_OAUTH (the providers whose sign-in the mailbox wizard offers: "google",
// "microsoft", "google,microsoft" or "none"; unset leaves it to the API),
// HELP_DOMAIN (the domain help centers live under, as <slug>.<HELP_DOMAIN>, e.g.
// "opendeskhelp.com": a lowercase hostname without a scheme; unset puts them at
// /help/<slug> on the app's host), MAILBOX_IMAP ("true" or "false": whether the API
// receives mail over IMAP; unset leaves it out). The URLs default to production.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  apiUrl: "https://api.opendesk.sh",
  gatewayUrl: "wss://gateway.opendesk.sh/socket",
};

// App paths the iPhone app opens instead of the browser: a ticket in an inbox
// folder or a view (web/src/router.tsx).
export const APP_LINK_PATHS = ["/inbox/*/?*", "/views/*/?*"];

function url(name, value, schemes) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (!schemes.includes(u.protocol)) {
    throw new Error(`${name} must use ${schemes.join(" or ")}, got ${u.protocol}`);
  }
  return value.replace(/\/+$/, "");
}

const MAILBOX_OAUTH_PROVIDERS = ["google", "microsoft"];

// MAILBOX_OAUTH: a comma-separated list of providers, or "none" for an empty list.
export function mailboxOAuth(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "none") return [];
  const list = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of list) {
    if (!MAILBOX_OAUTH_PROVIDERS.includes(p)) {
      throw new Error(`MAILBOX_OAUTH must list ${MAILBOX_OAUTH_PROVIDERS.join(" or ")}, or be "none", got ${p}`);
    }
  }
  return [...new Set(list)];
}

// HELP_DOMAIN: a lowercase hostname such as "opendeskhelp.com", no scheme, path or port.
const HOSTNAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function helpDomain(value) {
  const v = (value ?? "").trim().replace(/\.$/, "");
  if (!HOSTNAME.test(v) || v.length > 253) {
    throw new Error(`HELP_DOMAIN must be a lowercase domain name without a scheme, such as opendeskhelp.com, got ${value}`);
  }
  return v;
}

// MAILBOX_IMAP: "true" or "false", as the API's own MAILBOX_IMAP is set.
export function mailboxImap(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`MAILBOX_IMAP must be true or false, got ${value}`);
}

export function buildConfig(env = process.env) {
  const cfg = {
    apiUrl: url("APP_API_URL", env.APP_API_URL || DEFAULTS.apiUrl, ["https:", "http:"]),
    gatewayUrl: url("APP_GATEWAY_URL", env.APP_GATEWAY_URL || DEFAULTS.gatewayUrl, ["wss:", "ws:"]),
  };
  // omitempty, as in the Go struct.
  if (env.WEB_POSTHOG_KEY) cfg.posthogKey = env.WEB_POSTHOG_KEY;
  if (env.WEB_POSTHOG_HOST) cfg.posthogHost = url("WEB_POSTHOG_HOST", env.WEB_POSTHOG_HOST, ["https:"]);
  if (env.TURNSTILE_SITE_KEY) cfg.turnstileSiteKey = env.TURNSTILE_SITE_KEY;
  cfg.selfHosted = false;
  const draftRollout = (env.SHARED_DRAFTS_ENABLED ?? "false").trim().toLowerCase();
  if (draftRollout !== "true" && draftRollout !== "false") throw new Error("SHARED_DRAFTS_ENABLED must be true or false");
  cfg.sharedDrafts = draftRollout === "true";
  if (env.MAILBOX_OAUTH !== undefined && env.MAILBOX_OAUTH.trim() !== "") cfg.mailboxOAuth = mailboxOAuth(env.MAILBOX_OAUTH);
  if (env.HELP_DOMAIN !== undefined && env.HELP_DOMAIN.trim() !== "") cfg.helpDomain = helpDomain(env.HELP_DOMAIN);
  if (env.MAILBOX_IMAP !== undefined && env.MAILBOX_IMAP.trim() !== "") cfg.mailboxImap = mailboxImap(env.MAILBOX_IMAP);
  return cfg;
}

export function render(cfg) {
  return `window.__OPENDESK__=${JSON.stringify(cfg)};`;
}

// APPLE_APP_IDS: "TEAMID.bundle[,TEAMID.bundle...]". A team id is ten
// uppercase letters or digits; the bundle id is reverse DNS.
export function appleAppIds(value = "") {
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (!/^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(id)) {
      throw new Error(`APPLE_APP_IDS must be TEAMID.bundle ids, got ${id}`);
    }
  }
  return [...new Set(ids)];
}

export function buildAppSiteAssociation(ids) {
  return {
    applinks: {
      details: [{ appIDs: ids, components: APP_LINK_PATHS.map((p) => ({ "/": p })) }],
    },
    webcredentials: { apps: ids },
  };
}

export function writeConfig(outdir, env = process.env) {
  if (!outdir) throw new Error("usage: write-config.mjs <outdir>");
  const cfg = buildConfig(env);
  const ids = appleAppIds(env.APPLE_APP_IDS);
  mkdirSync(outdir, { recursive: true });
  const files = [join(outdir, "config.js"), join(outdir, "config.json")];
  writeFileSync(files[0], render(cfg) + "\n");
  writeFileSync(files[1], JSON.stringify(cfg) + "\n");
  if (ids.length > 0) {
    const dir = join(outdir, ".well-known");
    mkdirSync(dir, { recursive: true });
    const aasa = join(dir, "apple-app-site-association");
    writeFileSync(aasa, JSON.stringify(buildAppSiteAssociation(ids)) + "\n");
    files.push(aasa);
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    for (const file of writeConfig(process.argv[2])) console.log(`wrote ${file}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
