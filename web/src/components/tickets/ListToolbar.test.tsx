import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { i18n, i18nReady } from "@/i18n";
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

async function renderToolbar(language: string) {
  await i18n.changeLanguage(language);
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ListToolbar title="Inbox" icon={null} search={{}} onSearch={() => {}} compact />
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
