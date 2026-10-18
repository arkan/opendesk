import { describe, expect, it } from "vitest";
import { matchLocale, pickLocale, RTL, SUPPORTED } from "./index";
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

describe("catalogs", () => {
  it("ships a folder for every supported language", () => {
    const langs = new Set(Object.keys(files).map((k) => k.split("/")[2]));
    expect([...langs].sort()).toEqual([...SUPPORTED].sort());
  });

  // Customer-facing namespaces are fully translated, with each language's plural forms.
  for (const ns of NAMESPACES) {
    const en = flatten(read("en", ns));
    for (const lng of SUPPORTED.filter((l) => l !== "en" && (l === "fr" || ns === "public" || ns === "common"))) {
      it(`${lng}/${ns}.json has exactly the English keys`, () => {
        const keys = flatten(read(lng, ns)).sort();
        expect(keys).toEqual(expected(lng, en));
      });
      it(`${lng}/${ns}.json keeps every interpolation`, () => {
        const enCat = read("en", ns);
        const cat = read(lng, ns);
        const get = (o: Record<string, unknown>, path: string) => path in o ? o[path] : path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o);
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
});
