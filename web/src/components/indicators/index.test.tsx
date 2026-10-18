import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setAgentLocale } from "@/i18n";
import { ChannelIcon, PriorityIcon, PriorityPill, SentimentIcon, SeverityChip, SeverityPill, StatusIcon, StatusPill } from ".";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await setAgentLocale("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await setAgentLocale("en");
  localStorage.clear();
});

it("updates standalone labels without rerendering their parent and preserves overrides", async () => {
  await act(async () => root.render(<>
    <StatusIcon status="open" />
    <StatusPill status="pending" />
    <PriorityIcon priority="high" />
    <PriorityIcon priority={null} />
    <PriorityPill priority="low" />
    <SeverityChip severity="sev1" />
    <SeverityPill severity="sev2" />
    <ChannelIcon channel="portal" />
    <ChannelIcon channel="api" />
    <SentimentIcon sentiment="frustrated" />
    <SentimentIcon sentiment="custom" />
    <div data-override="status"><StatusPill status="open" label="Open" /></div>
    <div data-override="priority"><PriorityPill priority="high" label="High" /></div>
    <SeverityChip severity="sev3" title="Open" />
  </>));
  const labels = () => Array.from(container.querySelectorAll('[role="img"]')).map((el) => el.getAttribute("aria-label"));
  const english = ["Open", "Pending", "High", "No priority", "Low", "Sev 1", "Sev 2", "Portal", "API", "Frustrated", "Neutral", "Open", "High", "Open"];
  expect(labels()).toEqual(english);

  await act(async () => { await setAgentLocale("fr"); });
  expect(labels()).toEqual(["Ouvert", "En attente", "Haute", "Aucune priorité", "Basse", "Gravité 1", "Gravité 2", "Portail", "API", "Mécontent", "Neutre", "Ouvert", "Haute", "Open"]);
  expect(container.textContent).toContain("En attente");
  expect(container.textContent).toContain("Basse");
  expect(container.textContent).toContain("Gravité 2");
  expect(container.querySelector('[data-override="status"]')?.textContent).toBe("Open");
  expect(container.querySelector('[data-override="priority"]')?.textContent).toBe("High");

  await act(async () => { await setAgentLocale("en"); });
  expect(labels()).toEqual(english);
});
