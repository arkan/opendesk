import { categoryLabel } from "@/lib/decisions";
import type { BackendModule } from "i18next";
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

  it("keeps the active language in sync when restoring French fails and allows retry", async () => {
    await setAgentLocale("fr");
    await setLocale("ar", ["public", "common"]);
    i18n.removeResourceBundle("fr", "shell");
    vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read").mockImplementationOnce((_lng, _ns, callback) => {
      callback(new Error("offline"), null);
    });

    await resetLocale();

    expect(i18n.language).toBe("en");
    expect(getAgentLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(localStorage.getItem("od-agent-lang")).toBe("fr");

    await setAgentLocale("fr");
    expect(i18n.language).toBe("fr");
    expect(getAgentLocale()).toBe("fr");
  });

  it("does not let an obsolete public load overwrite a newer agent transition", async () => {
    let finish: (() => void) | undefined;
    i18n.removeResourceBundle("ar", "common");
    const backend = i18n.services.backendConnector.backend as BackendModule;
    const read = backend.read.bind(backend);
    vi.spyOn(backend, "read").mockImplementationOnce((lng, ns, callback) => {
      finish = () => read(lng, ns, callback);
    });
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
    i18n.removeResourceBundle("fr", "shell");
    vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read").mockImplementationOnce((_lng, _ns, callback) => {
      callback(new Error("offline"), null);
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
    i18n.removeResourceBundle("fr", "shell");
    vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read").mockImplementationOnce((_lng, _ns, callback) => {
      callback(new Error("offline"), null);
    });
    await initAgentLocale();
    expect(i18n.language).toBe("en");
    expect(getAgentLocale()).toBe("en");
    expect(localStorage.getItem("od-agent-lang")).toBe("fr");
  });
});
