import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { useDisplay } from "@/components/tickets/fields";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qk } from "@/lib/queries";
import { DisplayOverridesEditor } from "./DisplayOverrides";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const statuses = { open: { label: "Open" } };
const priorities = { high: { label: "High" } };

beforeEach(async () => {
  await setAgentLocale("en");
  client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  client.setQueryData(qk.workspace, { settings: { status_labels: statuses, priority_labels: priorities } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  await setAgentLocale("en");
  localStorage.clear();
});

it("reacts to language changes while keeping workspace labels verbatim", async () => {
  function Labels() {
    const display = useDisplay();
    return <p>{[display.status("open"), display.status("pending"), display.priority("high"), display.priority("low")].join(" / ")}</p>;
  }
  await act(async () => root.render(<QueryClientProvider client={client}><Labels /></QueryClientProvider>));
  expect(container.textContent).toBe("Open / Pending / High / Low");
  await act(async () => { await setAgentLocale("fr"); });
  expect(container.textContent).toBe("Open / En attente / High / Basse");
});

it("translates editor defaults without translating or changing saved labels", async () => {
  const onStatuses = vi.fn();
  await act(async () => root.render(<TooltipProvider>
    <DisplayOverridesEditor statuses={statuses} priorities={priorities} onStatuses={onStatuses} onPriorities={() => {}} />
  </TooltipProvider>));
  const status = container.querySelector<HTMLInputElement>('input[placeholder="Open"]')!;
  const priority = container.querySelector<HTMLInputElement>('input[placeholder="High"]')!;
  expect(status.value).toBe("Open");
  expect(priority.value).toBe("High");

  await act(async () => { await setAgentLocale("fr"); });
  expect(status.placeholder).toBe("Ouvert");
  expect(status.value).toBe("Open");
  expect(priority.placeholder).toBe("Haute");
  expect(priority.value).toBe("High");
  expect(onStatuses).not.toHaveBeenCalled();

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(status, "$t(Open)");
    status.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onStatuses).toHaveBeenCalledExactlyOnceWith({ open: { label: "$t(Open)" } });
});
