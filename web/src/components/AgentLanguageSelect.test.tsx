import type { BackendModule } from "i18next";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, resetLocale, setAgentLocale, setLocale } from "@/i18n";
import { AgentLanguageSelect } from "./AgentLanguageSelect";
import { VolumeTable } from "./reports/VolumeChart";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
// Flush external-store subscribers at the signal, before the transition resolves.
const flushLanguageChange = () => flushSync(() => {});

beforeEach(async () => {
  await setAgentLocale("fr");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  i18n.off("languageChanged", flushLanguageChange);
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  await setAgentLocale("en");
  localStorage.clear();
});

it("updates a mounted selector and report dates on fallback, then allows retry", async () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
  await act(async () => root.render(<>
    <AgentLanguageSelect />
    <VolumeTable days={[{ date: "2020-10-18", created: 3, solved: 2 }]} />
  </>));
  i18n.on("languageChanged", flushLanguageChange);
  const selection = () => container.querySelector('[role="combobox"]')?.textContent;
  const date = () => container.querySelector("tbody td")?.textContent;
  expect(selection()).toBe("Français");
  expect(date()).toBe("dim. 18 oct.");

  await act(async () => { await setLocale("ar", ["public", "common"]); });
  i18n.removeResourceBundle("fr", "shell");
  vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read").mockImplementationOnce((_lng, _ns, callback) => {
    callback(new Error("offline"), null);
  });
  await act(async () => { await resetLocale(); });
  expect(selection()).toBe("English");
  expect(date()).toBe("Sun, Oct 18");
  expect(localStorage.getItem("od-agent-lang")).toBe("fr");

  await act(async () => { await setAgentLocale("fr"); });
  expect(selection()).toBe("Français");
  expect(date()).toBe("dim. 18 oct.");
});
