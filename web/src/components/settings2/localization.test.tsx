import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { api } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { RolePill } from "./bits";
import { WebhookDialog } from "./webhooks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const initialUser = useSession.getState().user;

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  await setAgentLocale("en");
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  useSession.setState({ user: { id: "agent", email: "agent@example.com", name: "Test Agent", avatar_url: null, avatar_source: null, email_verified: true, totp_enabled: false, created_at: "2020-01-01T00:00:00Z" } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  useSession.setState({ user: initialUser });
  container.remove();
  await setAgentLocale("en");
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("updates role and colour labels without a translating parent", async () => {
  await act(async () => root.render(<TooltipProvider>
    <RolePill role="owner" />
    <ColorSwatchPicker value="gray" tones={["gray", "blue"]} onChange={() => {}} />
  </TooltipProvider>));
  const selected = container.querySelector('[role="radio"][aria-checked="true"]');
  expect(container.textContent).toContain("Owner");
  expect(selected?.getAttribute("aria-label")).toBe("Gray");

  await act(async () => { await setAgentLocale("fr"); });
  expect(container.textContent).toContain("Propriétaire");
  expect(selected?.getAttribute("aria-label")).toBe("Gris");
  expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Couleur");
  expect(selected?.getAttribute("aria-checked")).toBe("true");

  await act(async () => { await setAgentLocale("en"); });
  expect(container.textContent).toContain("Owner");
  expect(selected?.getAttribute("aria-label")).toBe("Gray");
});

it("keeps webhook event controls mounted and selected when group labels change", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <TooltipProvider><WebhookDialog hook={null} onClose={() => {}} /></TooltipProvider>
  </QueryClientProvider>));
  const group = document.querySelector('[role="checkbox"][aria-label="All messages events"]');
  const event = document.querySelector('[role="checkbox"][aria-label="message.created"]');
  expect(group).not.toBeNull();
  expect(event?.getAttribute("aria-checked")).toBe("true");
  await act(async () => { await setAgentLocale("fr"); });
  expect(group?.isConnected).toBe(true);
  expect(group?.getAttribute("aria-label")).not.toBe("All messages events");
  expect(document.querySelector('[role="checkbox"][aria-label="message.created"]')).toBe(event);
  expect(event?.getAttribute("aria-checked")).toBe("true");
  await act(async () => { await setAgentLocale("en"); });
  expect(group?.getAttribute("aria-label")).toBe("All messages events");
});

async function openWebhook() {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <TooltipProvider><WebhookDialog hook={null} onClose={() => {}} /></TooltipProvider>
  </QueryClientProvider>));
}

async function enterUrl(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/hooks/opendesk"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitWebhook() {
  await act(async () => { document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

it.each([
  ["http://example.com/hooks", "Use an https:// URL.", "Utilisez une URL en https://."],
  ["not-a-url", "Enter a full URL, like https://example.com/hooks/opendesk.", "Saisissez une URL complète, par exemple https://example.com/hooks/opendesk."],
])("updates webhook URL validation after changing language (%s)", async (url, english, french) => {
  const create = vi.spyOn(api.webhooks, "create");
  await openWebhook();
  await enterUrl(url);
  await submitWebhook();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(english);
  await act(async () => { await setAgentLocale("fr"); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(french);
  expect(create).not.toHaveBeenCalled();
});

it("updates webhook request failures without resending or translating event codes", async () => {
  const create = vi.spyOn(api.webhooks, "create").mockRejectedValue(new ApiError({ status: 429 }));
  await openWebhook();
  await enterUrl("https://example.com/hooks");
  await submitWebhook();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Too many attempts. Wait a moment and try again."));
  await act(async () => { await setAgentLocale("fr"); });
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Trop de tentatives. Patientez un instant et réessayez.");
  expect(create).toHaveBeenCalledExactlyOnceWith({ url: "https://example.com/hooks", description: "", events: ["ticket.created", "ticket.updated", "message.created"], enabled: true });
});

it("updates missing-event validation and keeps submission blocked", async () => {
  const create = vi.spyOn(api.webhooks, "create");
  await openWebhook();
  await enterUrl("https://example.com/hooks");
  const all = document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="All events"]')!;
  await act(async () => all.click());
  await act(async () => all.click());
  await submitWebhook();
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Choose at least one event.");
  await act(async () => { await setAgentLocale("fr"); });
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Choisissez au moins un événement.");
  expect(create).not.toHaveBeenCalled();
});
