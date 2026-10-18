import { categoryLabel } from "@/lib/decisions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentLocale, i18n, initAgentLocale, intlLocale, readAgentLocale, resetLocale, setAgentLocale, setLocale } from "./index";

beforeEach(async () => {
  localStorage.clear();
  await setAgentLocale("en");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await setAgentLocale("en");
  localStorage.clear();
});

describe("manual agent language", () => {
  it("defaults to English even for a French browser and ignores invalid preferences", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    localStorage.removeItem("od-agent-lang");
    await initAgentLocale();
    expect(getAgentLocale()).toBe("en");
    expect(i18n.language).toBe("en");
    localStorage.setItem("od-agent-lang", "de");
    expect(readAgentLocale()).toBe("en");
  });

  it("loads remembered French before startup and persists a manual switch", async () => {
    localStorage.setItem("od-agent-lang", "fr");
    await initAgentLocale();
    expect(getAgentLocale()).toBe("fr");
    expect(i18n.t("nav.inbox", { ns: "shell" })).not.toBe("Inbox");
    expect(document.documentElement.lang).toBe("fr");
    expect(intlLocale()).toBe("fr");
    await setAgentLocale("en");
    expect(localStorage.getItem("od-agent-lang")).toBe("en");
  });

  it("localizes built-in categories and count-sensitive inbox labels", async () => {
    await setAgentLocale("fr");
    expect(categoryLabel("problem")).toBe("Problème");
    expect(categoryLabel("custom_customer_value")).toBe("custom customer value");
    expect(categoryLabel("constructor")).toBe("constructor");
    expect(categoryLabel("toString")).toBe("toString");
    expect(i18n.t("waiting.new", { ns: "inbox", count: 1 })).toBe("1 nouveau");
    expect(i18n.t("waiting.new", { ns: "inbox", count: 2 })).toBe("2 nouveaux");
    expect(i18n.t("sla.over", { ns: "inbox", time: "5j" })).toBe("5j de dépassement");
  });

  it("restores French after an independent right-to-left public page", async () => {
    await setAgentLocale("fr");
    await setLocale("ar", ["public", "common"]);
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("od-agent-lang")).toBe("fr");
    await resetLocale();
    expect(i18n.language).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("keeps a session choice when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readAgentLocale()).toBe("en");
    await setAgentLocale("fr");
    expect(getAgentLocale()).toBe("fr");
    await setLocale("de", ["common"]);
    await resetLocale();
    expect(i18n.language).toBe("fr");
  });

  it("does not let an obsolete public load overwrite a newer agent transition", async () => {
    let finish: (() => void) | undefined;
    const realLoad = i18n.loadLanguages.bind(i18n);
    vi.spyOn(i18n, "loadLanguages").mockImplementationOnce((_lng, callback) => {
      finish = () => callback?.(null, i18n.t);
      return Promise.resolve();
    }).mockImplementation(realLoad);
    const obsolete = setLocale("ar", ["common"]);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await setAgentLocale("fr");
    finish!();
    await obsolete;
    expect(i18n.language).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(getAgentLocale()).toBe("fr");
  });

  it("preserves the previous language on load failure and allows retry", async () => {
    vi.spyOn(i18n, "loadLanguages").mockImplementationOnce((_lng, callback) => {
      callback?.([new Error("offline")], i18n.t);
      return Promise.resolve();
    });
    await expect(setAgentLocale("fr")).rejects.toThrow("Could not load language catalogs");
    expect(i18n.language).toBe("en");
    expect(getAgentLocale()).toBe("en");
    expect(localStorage.getItem("od-agent-lang")).toBe("en");
    await setAgentLocale("fr");
    expect(i18n.language).toBe("fr");
  });

  it("falls back to bundled English if French fails at startup without clearing the stored choice", async () => {
    localStorage.setItem("od-agent-lang", "fr");
    vi.spyOn(i18n, "loadLanguages").mockImplementationOnce((_lng, callback) => {
      callback?.([new Error("offline")], i18n.t);
      return Promise.resolve();
    });
    await initAgentLocale();
    expect(i18n.language).toBe("en");
    expect(getAgentLocale()).toBe("en");
    expect(localStorage.getItem("od-agent-lang")).toBe("fr");
  });
});
