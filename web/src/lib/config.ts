// Runtime configuration: `window.__OPENDESK__` from /config.js (served by the
// self-hosted binary or generated at deploy), falling back to VITE_* build env.
// One build therefore serves any deployment.

export type RuntimeConfig = {
  apiUrl: string;
  gatewayUrl: string;
  posthogKey: string;
  posthogHost: string;
  turnstileSiteKey: string;
  selfHosted: boolean;
  /**
   * The sign-ins the app may offer for a new mailbox, or null when the deployment
   * does not restrict them. The API's connect options must allow a provider too.
   */
  mailboxOAuth: MailboxOAuthProvider[] | null;
  /**
   * Whether mailboxes may receive by signing in over IMAP (generic IMAP, or syncing a
   * Google or Microsoft mailbox). Off, every mailbox receives by forwarding.
   */
  mailboxImap: boolean;
  /** Instance rollout switch. Enable only after every worker understands shared draft reservations. */
  sharedDrafts: boolean;
  /**
   * The domain help centers live under, as https://<slug>.<helpDomain>
   * (HELP_DOMAIN), or "" when they are at /help/<slug> on the app's host.
   */
  helpDomain: string;
};

export type MailboxOAuthProvider = "google" | "microsoft";

declare global {
  interface Window {
    __OPENDESK__?: Partial<Record<keyof RuntimeConfig, string | boolean | string[]>>;
  }
}

function pick(key: keyof RuntimeConfig, env: string | undefined): string {
  const v = typeof window !== "undefined" ? window.__OPENDESK__?.[key] : undefined;
  if (typeof v === "string" && v !== "" && !v.startsWith("${")) return v;
  return env ?? "";
}

/**
 * mailboxOAuth: a list from config.js, else VITE_MAILBOX_OAUTH ("google,microsoft",
 * "none" for an empty list), else null.
 */
export function parseMailboxOAuth(raw: unknown, env: string | undefined): MailboxOAuthProvider[] | null {
  const valid = (v: unknown): v is MailboxOAuthProvider => v === "google" || v === "microsoft";
  if (Array.isArray(raw)) return raw.filter(valid);
  const src = typeof raw === "string" && raw !== "" && !raw.startsWith("${") ? raw : env;
  if (src === undefined || src.trim() === "") return null;
  if (src.trim() === "none") return [];
  return src.split(",").map((s) => s.trim()).filter(valid);
}

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return null;
}

/**
 * mailboxImap: a boolean (or "true"/"false") from config.js, else VITE_MAILBOX_IMAP,
 * else on (development and self-hosted instances).
 */
export function parseMailboxImap(raw: unknown, env: string | undefined): boolean {
  return parseBoolean(raw) ?? parseBoolean(env) ?? true;
}

/** helpDomain: a bare hostname, lowercase, without a scheme or trailing dot; anything else is "". */
export function parseHelpDomain(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/\.$/, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(v) ? v : "";
}

function trimSlash(s: string) {
  return s.replace(/\/+$/, "");
}

function defaultGateway(): string {
  if (typeof location === "undefined") return "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/socket`;
}

export function readConfig(): RuntimeConfig {
  const env = import.meta.env;
  const runtime = typeof window !== "undefined" ? window.__OPENDESK__ : undefined;
  const selfHostedRaw = runtime?.selfHosted;
  return {
    apiUrl: trimSlash(pick("apiUrl", env.VITE_API_URL)),
    gatewayUrl: trimSlash(pick("gatewayUrl", env.VITE_GATEWAY_URL)) || defaultGateway(),
    posthogKey: pick("posthogKey", env.VITE_POSTHOG_KEY),
    posthogHost: pick("posthogHost", env.VITE_POSTHOG_HOST) || "https://us.i.posthog.com",
    turnstileSiteKey: pick("turnstileSiteKey", env.VITE_TURNSTILE_SITE_KEY),
    selfHosted: selfHostedRaw === true || selfHostedRaw === "true" || env.VITE_SELF_HOSTED === "1",
    mailboxOAuth: parseMailboxOAuth(runtime?.mailboxOAuth, env.VITE_MAILBOX_OAUTH),
    mailboxImap: parseMailboxImap(runtime?.mailboxImap, env.VITE_MAILBOX_IMAP),
    // A configured instance must explicitly advertise support for shared drafts.
    sharedDrafts: runtime === undefined
      ? parseBoolean(env.VITE_SHARED_DRAFTS_ENABLED) ?? true
      : parseBoolean(runtime?.sharedDrafts) ?? false,
    helpDomain: parseHelpDomain(pick("helpDomain", env.VITE_HELP_DOMAIN)),
  };
}

export const config: RuntimeConfig = readConfig();

const HOSTED_APP = "https://app.opendesk.sh";

/**
 * Where this instance serves its app, help centers and chat widget: the hosted app on
 * opendesk.sh, otherwise the origin the app runs on (a self-hosted domain, or a local
 * address while developing).
 */
export function appOrigin(): string {
  if (typeof window === "undefined") return HOSTED_APP;
  if (!config.selfHosted && window.location.hostname.endsWith("opendesk.sh")) return HOSTED_APP;
  return window.location.origin;
}

// Mock mode is checked inline as `import.meta.env.VITE_MOCK === "1"` at each use,
// so the bundler can drop the mock branches from production builds.
