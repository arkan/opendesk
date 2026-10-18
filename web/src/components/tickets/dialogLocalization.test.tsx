import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAgentLocale } from "@/i18n";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { useSession } from "@/lib/session";
import { ticket } from "@/lib/test/fixtures";
import NewTicketDialog from "./NewTicketDialog";
import { MergeDialog } from "./detail/MergeDialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const initialUser = useSession.getState().user;

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  await setAgentLocale("en");
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } } });
  useSession.setState({ user: { id: "agent", email: "agent@example.com", name: "Test Agent", avatar_url: null, avatar_source: null, email_verified: true, totp_enabled: false, created_at: "2020-01-01T00:00:00Z" } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  useSession.setState({ user: initialUser });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await setAgentLocale("en");
  localStorage.clear();
});

async function renderDialog(dialog: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  await act(async () => root.render(<QueryClientProvider client={client}>
    <RouterContextProvider router={router}>
      <TooltipProvider><ConfirmProvider>{dialog}</ConfirmProvider></TooltipProvider>
    </RouterContextProvider>
  </QueryClientProvider>));
}

const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent === text)!;
const alert = () => document.querySelector('[role="dialog"] [role="alert"]')?.textContent;

it("updates ticket validation without discarding the subject or creating a ticket", async () => {
  const create = vi.spyOn(api.tickets, "create");
  await renderDialog(<NewTicketDialog />);
  const subject = document.querySelector<HTMLInputElement>('input[placeholder="What is this about?"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(subject, "High");
    subject.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Create and send").click());
  expect(alert()).toBe("Add a recipient.");
  await act(async () => { await setAgentLocale("fr"); });
  expect(alert()).toBe("Ajoutez un destinataire.");
  expect(subject.value).toBe("High");
  expect(create).not.toHaveBeenCalled();
});

it("updates a failed merge while retaining its target and making no second request", async () => {
  const source = ticket();
  const target = ticket({ id: "t2", number: 2, subject: "High" });
  client.setQueryData(["merge-search", source.id, ""], { data: [target] });
  const merge = vi.spyOn(api.tickets, "merge").mockRejectedValue(new ApiError({ status: 0 }));
  const close = vi.fn();
  await renderDialog(<MergeDialog ticket={source} open onOpenChange={close} />);
  const choice = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]')].find((el) => el.textContent?.includes("High"))!;
  await act(async () => choice.click());
  await act(async () => button("Merge into #2").click());
  await vi.waitFor(() => expect(alert()).toBe("Can't reach the server. Check your connection."));
  await act(async () => { await setAgentLocale("fr"); });
  expect(alert()).toBe("Impossible de joindre le serveur. Vérifiez votre connexion.");
  expect(choice.getAttribute("aria-pressed")).toBe("true");
  expect(choice.textContent).toContain("High");
  expect(merge).toHaveBeenCalledExactlyOnceWith("t1", "t2");
  expect(close).not.toHaveBeenCalled();
});
