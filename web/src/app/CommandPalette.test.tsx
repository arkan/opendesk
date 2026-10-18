import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, i18nReady } from "@/i18n";
import french from "@/i18n/locales/fr/app.json";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/queries";
import { setTheme } from "@/lib/theme";
import { CommandPalette } from "./CommandPalette";
import { shell, usePageCommands, useShell } from "./shellStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const command = (value: string) => document.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`);

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api, "search").mockResolvedValue({ tickets: [], contacts: [], articles: [] });
  await i18nReady;
  i18n.addResourceBundle("fr", "app", french, true, true);
  await i18n.changeLanguage("fr");
  setTheme("light");
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  shell.palette(true);
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <CommandPalette />
      </RouterContextProvider>
    </QueryClientProvider>,
  ));
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  shell.palette(false);
  shell.newTicket(false);
  usePageCommands.setState({ commands: [] });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  await i18n.changeLanguage("en");
});

it.each([
  ["entreprises", "go companies", "Entreprises"],
  ["connaissances", "go knowledge base kb articles", "Base de connaissances"],
  ["rapports", "go reports analytics", "Rapports"],
  ["raccourcis", "keyboard shortcuts help", "Raccourcis clavier"],
  ["nouveau", "new ticket compose create", "Nouveau ticket"],
  ["sombre", "toggle theme dark light mode", "Passer au thème sombre"],
  ["ajouter un compte", "add account sign in another switch account", "Ajouter un compte"],
])("finds the displayed French command with %s", async (query, value, label) => {
  await search(query);
  expect(command(value)?.textContent ?? "").toContain(label);
});

it("refreshes searchable labels when switching language with the palette open", async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
  await search("entreprises");
  expect(command("go companies")).toBeNull();
  await act(async () => { await i18n.changeLanguage("fr"); });
  expect(command("go companies")?.textContent).toBe("Entreprises");
});

it("preserves English command aliases and runs the selected action", async () => {
  await search("compose");
  const item = command("new ticket compose create");
  expect(item?.textContent).toContain("Nouveau ticket");
  await act(async () => item!.click());
  expect(useShell.getState().newTicketOpen).toBe(true);
});

it("searches user names without translating them and preserves contextual keywords", async () => {
  const run = vi.fn();
  await act(async () => {
    client.setQueryData(qk.views, [{ id: "custom", name: "Knowledge base" }]);
    usePageCommands.setState({ commands: [{ id: "custom-action", label: "Action personnalisée", keywords: ["shortcut-alias"], run }] });
  });
  await search("Knowledge base");
  expect(command("go view Knowledge base")?.textContent).toContain("Knowledge base");
  await search("shortcut-alias");
  const item = command("Action personnalisée custom-action");
  expect(item?.textContent).toContain("Action personnalisée");
  await act(async () => item!.click());
  expect(run).toHaveBeenCalledOnce();
});
