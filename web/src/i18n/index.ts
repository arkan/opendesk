// i18n: i18next with one JSON catalog per namespace and language under
// ./locales/<lng>/<ns>.json. English is bundled; other languages load on demand,
// so a page only downloads the catalogs it shows.
//
// The agent app ships English and French, following the browser's language. The
// customer-facing surfaces (help center, CSAT, widget) ship every SUPPORTED
// language, picked from the visitor's browser with the workspace default as
// the fallback (see pickLocale).

import i18n, { type BackendModule, type ReadCallback } from "i18next";
import { initReactI18next } from "react-i18next";
import { en, NAMESPACES, type Namespace } from "./resources";

export const SUPPORTED = ["en", "es", "fr", "de", "pt", "it", "nl", "pl", "ja", "zh-CN", "ko", "tr", "az", "ar"] as const;
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
  az: "Azərbaycan dili",
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

/** Agent catalogs are complete in English and French only. */
export function pickAgentLocale(browser?: readonly string[]): "en" | "fr" {
  return pickLocale({ browser }) === "fr" ? "fr" : "en";
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

void i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: pickAgentLocale(),
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

// The language a customer-facing page chose, so Intl formatting follows the
// page (an English page for a German browser formats dates in English).
let pageLocale: string | null = null;
let localeVersion = 0;

/** Switch language for the page (customer surfaces) and set <html lang dir>. */
export async function setLocale(lng: Locale, ns: Namespace[] = ["common"]): Promise<void> {
  const version = ++localeVersion;
  pageLocale = lng;
  await i18n.loadLanguages(lng);
  await i18n.loadNamespaces(ns);
  if (version !== localeVersion) return;
  await i18n.changeLanguage(lng);
  if (version !== localeVersion) return;
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
    document.documentElement.dir = RTL.has(lng) ? "rtl" : "ltr";
  }
}

/** Restore the browser's agent language when leaving a public page. */
export function resetLocale() {
  ++localeVersion;
  pageLocale = null;
  const lng = pickAgentLocale();
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
    document.documentElement.dir = "ltr";
  }
}

resetLocale();

/** The active locale for Intl formatting. Agent app: the browser's locale; public pages: the page language. */
export function intlLocale(): string {
  if (pageLocale) return pageLocale;
  if (i18n.language && i18n.language !== "en") return i18n.language;
  return typeof navigator !== "undefined" ? navigator.language || "en" : "en";
}

export { i18n };
