import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { i18n, i18nReady } from "@/i18n";
import type { InboxSearch } from "@/lib/folders";
import { ListToolbar } from "./ListToolbar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(async () => {
  await i18nReady;
  client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  await i18n.changeLanguage("en");
});

async function renderToolbar(language: string, search: InboxSearch = {}, onSearch: (search: InboxSearch) => void = () => {}) {
  await i18n.changeLanguage(language);
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ListToolbar title="Inbox" icon={null} search={search} onSearch={onSearch} compact />
      </TooltipProvider>
    </QueryClientProvider>,
  ));
}

it.each(["en", "fr"])("opens and focuses ticket search with / in %s", async (language) => {
  await renderToolbar(language);
  expect(container.querySelector("input")).toBeNull();

  const pressSlash = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  await act(async () => { pressSlash(); });
  const search = container.querySelector("input");
  expect(search).not.toBeNull();
  expect(document.activeElement).toBe(search);

  search!.blur();
  await act(async () => { pressSlash(); });
  expect(document.activeElement).toBe(search);
});

it("leaves / available while typing or a dialog is open", async () => {
  await renderToolbar("fr");
  const editor = document.createElement("textarea");
  container.appendChild(editor);
  editor.focus();
  const typing = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  await act(async () => { editor.dispatchEvent(typing); });
  expect(typing.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(editor);
  expect(container.querySelector("input")).toBeNull();
  editor.remove();

  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  container.appendChild(dialog);
  const inDialog = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  await act(async () => { document.body.dispatchEvent(inDialog); });
  expect(inDialog.defaultPrevented).toBe(false);
  expect(container.querySelector("input")).toBeNull();
});

it("translates active filters without changing their query values or a custom label", async () => {
  const onSearch = vi.fn();
  const search = { priority: "high", severity: "sev1", channel: "email", tag: "High" };
  await renderToolbar("fr", search, onSearch);
  expect(container.textContent).toContain("Haute");
  expect(container.textContent).toContain("E-mail");
  expect(container.textContent).toContain("High");

  await act(async () => { await i18n.changeLanguage("en"); });
  expect(container.textContent).toContain("High");
  expect(container.textContent).toContain("Email");
  expect(onSearch).not.toHaveBeenCalled();

  const remove = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.parentElement?.querySelector('svg[aria-label="High"]'))!;
  await act(async () => remove.click());
  expect(onSearch).toHaveBeenCalledExactlyOnceWith({ ...search, priority: undefined });
});
