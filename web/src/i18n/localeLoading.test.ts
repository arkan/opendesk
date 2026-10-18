import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BackendModule } from "i18next";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("loads only the requested public catalogs, even if an agent catalog is unavailable", async () => {
  const { i18n, i18nReady, setLocale } = await import("./index");
  await i18nReady;
  const backend = i18n.services.backendConnector.backend as BackendModule;
  const read = backend.read.bind(backend);
  const reads = vi.spyOn(backend, "read").mockImplementation((lng, ns, callback) => {
    if (ns === "billing") callback(new Error("offline"), null);
    else read(lng, ns, callback);
  });

  await setLocale("fr", ["public", "common"]);

  expect(reads.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual(["fr/common", "fr/public"]);
  expect(i18n.language).toBe("fr");
  expect(i18n.hasResourceBundle("fr", "billing")).toBe(false);
});

it("loads the agent catalogs on return and reuses previously loaded bundles", async () => {
  const { i18n, i18nReady, resetLocale, setAgentLocale, setLocale } = await import("./index");
  const { NAMESPACES } = await import("./resources");
  await i18nReady;
  const reads = vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read");
  await setAgentLocale("fr");
  expect(NAMESPACES.every((ns) => i18n.hasResourceBundle("fr", ns))).toBe(true);
  reads.mockClear();
  await setLocale("de", ["public", "common"]);
  await resetLocale();
  expect(reads.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual(["de/common", "de/public"]);
  expect(i18n.language).toBe("fr");
});

it("retries an actual failed catalog without losing the agent preference", async () => {
  const { getAgentLocale, i18n, i18nReady, setAgentLocale } = await import("./index");
  await i18nReady;
  vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read").mockImplementationOnce((_lng, _ns, callback) => {
    callback(new Error("offline"), null);
  });
  await expect(setAgentLocale("fr")).rejects.toThrow("Could not load language catalogs");
  expect(getAgentLocale()).toBe("en");
  expect(i18n.language).toBe("en");
  await setAgentLocale("fr");
  expect(getAgentLocale()).toBe("fr");
  expect(localStorage.getItem("od-agent-lang")).toBe("fr");
});
