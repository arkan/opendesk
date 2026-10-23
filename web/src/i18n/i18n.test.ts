import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, intlLocale, isPublicPath, loadAgentCatalogs, matchLocale, pickAgentLocale, pickLocale, resetLocale, RTL, setLocale, SUPPORTED } from "./index";
import { NAMESPACES } from "./resources";

const files = import.meta.glob<Record<string, unknown>>("./locales/*/*.json", { eager: true, import: "default" });
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
function read(lng: string, ns: string): Record<string, unknown> {
  const f = files[`./locales/${lng}/${ns}.json`];
  if (!f) throw new Error(`missing ${lng}/${ns}.json`);
  return f;
}
/** The keys a language must have: English's, with each plural expanded to that language's categories. */
function expected(lng: string, enKeys: string[]): string[] {
  const cats = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
  const out = new Set<string>();
  for (const k of enKeys) {
    if (PLURAL.test(k)) cats.forEach((c) => out.add(k.replace(PLURAL, `_${c}`)));
    else out.add(k);
  }
  return [...out].sort();
}

describe("matchLocale", () => {
  it("maps regional tags onto supported languages", () => {
    expect(matchLocale("pt-BR")).toBe("pt");
    expect(matchLocale("es-419")).toBe("es");
    expect(matchLocale("de_AT")).toBe("de");
    expect(matchLocale("zh")).toBe("zh-CN");
    expect(matchLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(matchLocale("ZH-cn")).toBe("zh-CN");
  });
  it("refuses what it can't serve", () => {
    expect(matchLocale("zh-TW")).toBeNull();
    expect(matchLocale("zh-Hant")).toBeNull();
    expect(matchLocale("sv")).toBeNull();
    expect(matchLocale("")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe("pickLocale", () => {
  it("prefers ?lang, then the browser, then the workspace default, then English", () => {
    expect(pickLocale({ explicit: "ja", browser: ["de-DE"], workspaceDefault: "fr" })).toBe("ja");
    expect(pickLocale({ explicit: "xx", browser: ["sv-SE", "de-DE"], workspaceDefault: "fr" })).toBe("de");
    expect(pickLocale({ browser: ["zh-TW", "sv"], workspaceDefault: "fr" })).toBe("fr");
    expect(pickLocale({ browser: ["sv"], workspaceDefault: null })).toBe("en");
    expect(pickLocale({ browser: [] })).toBe("en");
  });
  it("marks Arabic as right to left", () => {
    expect(RTL.has(pickLocale({ browser: ["ar-EG"] }))).toBe(true);
    expect(RTL.has("en")).toBe(false);
  });
});

describe("loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocale();
  });

  it("boots with common only and keeps the agent catalogs off public pages", async () => {
    expect(i18n.options.ns).toEqual(["common"]);
    await setLocale("fr", ["public", "common"]);
    expect(i18n.hasResourceBundle("fr", "public")).toBe(true);
    for (const ns of NAMESPACES.filter((ns) => ns !== "common" && ns !== "public")) expect(i18n.hasResourceBundle("fr", ns), ns).toBe(false);
  });

  it("tells public routes from the agent app's", () => {
    expect(isPublicPath("/csat")).toBe(true);
    expect(isPublicPath("/csat/abc")).toBe(true);
    expect(isPublicPath("/help/acme/articles/x")).toBe(true);
    expect(isPublicPath("/inbox/unassigned")).toBe(false);
    expect(isPublicPath("/helpers")).toBe(false);
    expect(isPublicPath("/login")).toBe(false);
  });

  it("loads every agent catalog in the agent language, and nothing for English", async () => {
    await loadAgentCatalogs("en");
    expect(i18n.hasResourceBundle("fr", "inbox")).toBe(false);
    await loadAgentCatalogs("fr");
    for (const ns of NAMESPACES) expect(i18n.hasResourceBundle("fr", ns), ns).toBe(true);
  });

  it("falls back to English for a key French does not have yet", async () => {
    i18n.addResourceBundle("en", "fallbackProbe", { old: "Old", added: "Only in English" });
    i18n.addResourceBundle("fr", "fallbackProbe", { old: "Ancien" });
    await i18n.changeLanguage("fr");
    expect(i18n.t("old" as never, { ns: "fallbackProbe" })).toBe("Ancien");
    expect(i18n.t("added" as never, { ns: "fallbackProbe" })).toBe("Only in English");
  });
});

describe("intlLocale", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocale();
  });

  it("keeps the browser's region when it speaks the active language", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "en-US"]);
    await i18n.changeLanguage("fr");
    expect(intlLocale()).toBe("fr-CA");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE", "fr-CH"]);
    expect(intlLocale()).toBe("fr-CH");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    expect(intlLocale()).toBe("fr");
  });

  it("uses the page language on public pages, with a matching region only", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-TW", "pt-BR"]);
    await setLocale("zh-CN", ["common"]);
    expect(intlLocale()).toBe("zh-CN");
    await setLocale("pt", ["common"]);
    expect(intlLocale()).toBe("pt-BR");
  });

  it("formats an English agent app in the browser's locale", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    await i18n.changeLanguage("en");
    expect(intlLocale()).toBe("de-DE");
  });
});

describe("agent language", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocale();
  });

  it("selects French regional variants and falls back to English for other languages", () => {
    expect(pickAgentLocale(["fr-FR", "en-US"])).toBe("fr");
    expect(pickAgentLocale(["fr-CA"])).toBe("fr");
    expect(pickAgentLocale(["en-US"])).toBe("en");
    expect(pickAgentLocale(["de-DE"])).toBe("en");
    expect(pickAgentLocale(["ar-EG"])).toBe("en");
    expect(pickAgentLocale([])).toBe("en");
  });

  it("loads French agent catalogs and restores them after a public page", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    await loadAgentCatalogs();
    await i18n.changeLanguage(pickAgentLocale());
    expect(i18n.t("nav.inbox", { ns: "shell" })).toBe("Boîte de réception");
    await setLocale("ar", ["public", "common"]);
    expect(document.documentElement.dir).toBe("rtl");
    resetLocale();
    expect(i18n.language).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
    expect(i18n.t("nav.inbox", { ns: "shell" })).toBe("Boîte de réception");
  });

  it("does not apply a public language that finishes loading after leaving the page", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    await i18n.changeLanguage("fr");
    let finish!: () => void;
    vi.spyOn(i18n, "loadLanguages").mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = setLocale("ar", ["public", "common"]);
    resetLocale();
    finish();
    await pending;
    expect(i18n.language).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("catalogs", () => {
  it("ships a folder for every supported language", () => {
    const langs = new Set(Object.keys(files).map((k) => k.split("/")[2]));
    expect([...langs].sort()).toEqual([...SUPPORTED].sort());
  });

  // Customer-facing namespaces are fully translated, with each language's plural forms.
  for (const ns of ["public", "common"]) {
    const en = flatten(read("en", ns));
    for (const lng of SUPPORTED.filter((l) => l !== "en")) {
      it(`${lng}/${ns}.json has exactly the English keys`, () => {
        const keys = flatten(read(lng, ns)).sort();
        expect(keys).toEqual(expected(lng, en));
      });
      it(`${lng}/${ns}.json keeps every interpolation`, () => {
        const enCat = read("en", ns);
        const cat = read(lng, ns);
        const get = (o: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o);
        for (const k of en) {
          const base = k.replace(PLURAL, "");
          const vars = new Set((String(get(enCat, k)).match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((v) => v.replace(/\s/g, "")));
          vars.delete("{{count}}"); // a plural form may spell the number out ("مقالة واحدة")
          for (const tk of flatten(cat).filter((x) => x.replace(PLURAL, "") === base)) {
            const text = String(get(cat, tk));
            for (const v of vars) expect(text, `${lng} ${tk}`).toContain(v);
          }
        }
      });
    }
  }

  for (const ns of NAMESPACES.filter((ns) => ns !== "common" && ns !== "public")) {
    it(`fr/${ns}.json translates every agent key and preserves variables and Ollie`, () => {
      const en = read("en", ns);
      const fr = read("fr", ns);
      expect(flatten(fr).sort()).toEqual(expected("fr", flatten(en)));
      const get = (o: Record<string, unknown>, path: string): string => String(path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o));
      for (const k of flatten(fr)) {
        const sourceKey = k.endsWith("_many") ? k.replace(/_many$/, "_other") : k;
        const source = get(en, sourceKey);
        const translated = get(fr, k);
        if (source.trim()) expect(translated.trim(), `${ns}.${k}`).not.toBe("");
        expect((translated.match(/\{\{[^}]+\}\}/g) ?? []).sort(), `${ns}.${k}`).toEqual((source.match(/\{\{[^}]+\}\}/g) ?? []).sort());
        expect(translated.match(/Ollie/g) ?? [], `${ns}.${k}`).toEqual(source.match(/Ollie/g) ?? []);
      }
    });
  }
});
