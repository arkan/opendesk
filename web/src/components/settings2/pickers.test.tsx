import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { i18n, i18nReady } from "@/i18n";
import french from "@/i18n/locales/fr/app.json";
import { channelItems, priorityItems, severityFilterItems, severityItems, SinglePick, statusItems } from "./pickers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function SelectedValues() {
  useTranslation("app");
  return (
    <TooltipProvider>
      <SinglePick items={statusItems()} value="open" onChange={() => {}} placeholder="Status" disabled />
      <SinglePick items={priorityItems()} value="high" onChange={() => {}} placeholder="Priority" disabled />
      <SinglePick items={severityItems()} value="sev1" onChange={() => {}} placeholder="Severity" disabled />
      <SinglePick items={severityFilterItems()} value="sev2" onChange={() => {}} placeholder="Severity filter" disabled />
      <SinglePick items={channelItems()} value="portal" onChange={() => {}} placeholder="Channel" disabled />
    </TooltipProvider>
  );
}

beforeEach(async () => {
  await i18nReady;
  i18n.addResourceBundle("fr", "app", french, true, true);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await i18n.changeLanguage("en");
});

it("updates selected filter and action labels when the language changes without remounting", async () => {
  await act(async () => root.render(<SelectedValues />));
  const labels = () => [...container.querySelectorAll("button")].map((button) => button.querySelector("span.truncate")?.textContent);
  expect(labels()).toEqual(["Open", "High", "Sev 1", "Sev 2", "Portal"]);

  await act(async () => { await i18n.changeLanguage("fr"); });
  expect(labels()).toEqual(["Ouvert", "Haute", "Gravité 1", "Gravité 2", "Portail"]);

  await act(async () => { await i18n.changeLanguage("en"); });
  expect(labels()).toEqual(["Open", "High", "Sev 1", "Sev 2", "Portal"]);
});
