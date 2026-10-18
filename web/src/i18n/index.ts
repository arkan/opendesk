// i18n: i18next with one JSON catalog per namespace and language under
// ./locales/<lng>/<ns>.json. English is bundled; other languages load on demand,
// so a page only downloads the catalogs it shows.
//
// Agent language is chosen manually and remembered per browser. Public surfaces
// independently choose from SUPPORTED using visitor and workspace preferences.

import i18n, { type BackendModule, type ReadCallback } from "i18next";
import { initReactI18next } from "react-i18next";
import { en, NAMESPACES, type Namespace } from "./resources";

export const SUPPORTED = ["en", "es", "fr", "de", "pt", "it", "nl", "pl", "ja", "zh-CN", "ko", "tr", "ar"] as const;
export type Locale = (typeof SUPPORTED)[number];
export const RTL: ReadonlySet<string> = new Set(["ar"]);

/** Native names, for language pickers. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  ja: "日本語",
  "zh-CN": "简体中文",
  ko: "한국어",
  tr: "Türkçe",
  ar: "العربية",
};

/** Map any BCP 47 tag onto a supported locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const t = tag.trim().replace("_", "-").toLowerCase();
  const exact = SUPPORTED.find((l) => l.toLowerCase() === t);
  if (exact) return exact;
  const base = t.split("-")[0];
  if (base === "zh") return t.includes("hant") || t.endsWith("-tw") || t.endsWith("-hk") ? null : "zh-CN";
  return SUPPORTED.find((l) => l.toLowerCase() === base) ?? null;
}

/**
 * The language for a customer-facing page: an explicit `?lang=` first, then the
 * visitor's browser languages in order, then the workspace default, then English.
 */
export function pickLocale(opts: { explicit?: string | null; browser?: readonly string[]; workspaceDefault?: string | null } = {}): Locale {
  const browser = opts.browser ?? (typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []);
  return matchLocale(opts.explicit) ?? browser.map(matchLocale).find((x): x is Locale => !!x) ?? matchLocale(opts.workspaceDefault) ?? "en";
}

const loaders = import.meta.glob<{ default: Record<string, unknown> }>(["./locales/*/*.json", "!./locales/en/*.json"]);

const lazyBackend: BackendModule = {
  type: "backend",
  init() {},
  read(lng: string, ns: string, cb: ReadCallback) {
    const load = loaders[`./locales/${lng}/${ns}.json`];
    if (!load) return cb(null, {});
    load().then(
      (m) => cb(null, m.default),
      (e: unknown) => cb(e instanceof Error ? e : new Error(String(e)), null),
    );
  },
};

export const i18nReady = i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED],
    ns: [...NAMESPACES],
    defaultNS: "common",
    resources: { en },
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

export type AgentLocale = "en" | "fr";
const AGENT_KEY = "od-agent-lang";

export function readAgentLocale(): AgentLocale {
  try {
    return localStorage.getItem(AGENT_KEY) === "fr" ? "fr" : "en";
  } catch {
    return "en";
  }
}

let agentLocale = readAgentLocale();
let pageLocale: Locale | null = null;
let transition = 0;
let commits = Promise.resolve();

export function getAgentLocale(): AgentLocale {
  return agentLocale;
}

async function prepare(lng: Locale, namespaces: readonly Namespace[]) {
  const missing = namespaces.filter((ns) => !i18n.hasResourceBundle(lng, ns) || !Object.keys(i18n.getResourceBundle(lng, ns)).length);
  // Read only this surface's missing bundles and allow a failed import to retry.
  await Promise.all(missing.map((ns) => new Promise<void>((resolve, reject) => {
    lazyBackend.read(lng, ns, (err, data) => {
      if (err || !data || typeof data !== "object" || !Object.keys(data).length) {
        reject(new Error("Could not load language catalogs"));
        return;
      }
      i18n.addResourceBundle(lng, ns, data);
      resolve();
    });
  })));
}

function documentLocale(lng: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL.has(lng) ? "rtl" : "ltr";
}

/** Only the newest request may commit, including public-page cleanup. */
async function applyLocale(lng: Locale, namespaces: readonly Namespace[], publicPage: boolean, remember = false): Promise<void> {
  const request = ++transition;
  try {
    await i18nReady;
    if (request !== transition) return;
    await prepare(lng, namespaces);
  } catch (err) {
    if (request === transition) throw err;
    return;
  }
  const commit = commits.then(async () => {
    if (request !== transition) return;
    // changeLanguage also loads resources; keep it scoped to the prepared surface.
    i18n.options.ns = [...namespaces];
    await i18n.changeLanguage(lng);
    if (request !== transition) return;
    pageLocale = publicPage ? lng : null;
    if (remember) {
      agentLocale = lng as AgentLocale;
      try {
        localStorage.setItem(AGENT_KEY, agentLocale);
      } catch {
        /* The in-memory preference still applies when storage is unavailable. */
      }
    }
    documentLocale(lng);
  });
  commits = commit.catch(() => {});
  await commit;
}

/** Called before mounting React, so remembered French never flashes English. */
export async function initAgentLocale(): Promise<void> {
  agentLocale = readAgentLocale();
  try {
    await applyLocale(agentLocale, NAMESPACES, false);
  } catch {
    // Keep the stored choice for a retry on the next visit.
    agentLocale = "en";
    await applyLocale("en", NAMESPACES, false);
  }
}

export function setAgentLocale(lng: AgentLocale): Promise<void> {
  return applyLocale(lng, NAMESPACES, false, true);
}

/** Apply a public surface's independent language. */
export function setLocale(lng: Locale, ns: Namespace[] = ["common"]): Promise<void> {
  return applyLocale(lng, ns, true);
}

/** Restore the manual agent preference after leaving a public surface. */
export function resetLocale(): Promise<void> {
  return applyLocale(agentLocale, NAMESPACES, false).catch(() => applyLocale("en", NAMESPACES, false));
}

/** Public language, chosen French, or the existing English browser formatting. */
export function intlLocale(): string {
  if (pageLocale) return pageLocale;
  if (i18n.language && i18n.language !== "en") return i18n.language;
  return typeof navigator !== "undefined" ? navigator.language || "en" : "en";
}

export { i18n };
