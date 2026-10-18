import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setAgentLocale, setLocale } from "@/i18n";
import type { TemplateCatalog } from "@/lib/api/types";
import { qk } from "@/lib/queries";
import { VariablePicker } from "./VariablePicker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("searches localized helpers after a language change and inserts the original code", async () => {
  await setLocale("ar", ["common", "public"]);
  await setAgentLocale("fr");
  const example = '{{ contact.first_name | default: "there" }}';
  const catalog: TemplateCatalog = {
    variables: [
      { key: "contact.name", group: "contact", label: "Customer", description: "Customer", example: "Ada", html: false },
      { key: "contact.fields.customer", group: "contact", label: "Customer", description: "Customer", example: "Custom", html: false },
    ],
    slots: [],
    filters: [{ name: "default", group: "text", args: '"there"', description: "The fallback when the value is empty.", example }],
  };
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  client.setQueryData(qk.templateVariables, catalog);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const insert = vi.fn();
  const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent === text)!;
  const search = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>
      <VariablePicker onPick={() => {}} onInsert={insert} trigger={<button>Insert</button>} />
    </QueryClientProvider>));
    await act(async () => button("Insert").click());
    const dialog = () => document.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain("Client");
    expect(dialog().textContent).toContain("Customer");
    await search("client");
    expect(dialog().textContent).toContain("contact.fields.customer");
    await act(async () => { await setAgentLocale("en"); });
    expect(dialog().textContent).not.toContain("contact.fields.customer");
    await search("customer");
    expect(dialog().textContent).toContain("contact.fields.customer");
    await act(async () => { await setAgentLocale("fr"); });

    await act(async () => button("Fonctions").click());
    await search("secours");
    expect(dialog().textContent).toContain("La valeur de secours si la valeur est vide.");
    expect(dialog().textContent).toContain(example);

    await act(async () => { await setAgentLocale("en"); });
    expect(dialog().textContent).not.toContain(example);
    await search("fallback");
    expect(dialog().textContent).toContain("The fallback when the value is empty.");
    const helper = Array.from(dialog().querySelectorAll("button")).find((el) => el.textContent?.includes(example))!;
    await act(async () => helper.click());
    expect(insert).toHaveBeenCalledExactlyOnceWith(example, '"there"');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(client.getQueryData(qk.templateVariables)).toEqual(catalog);
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
    await setAgentLocale("en");
    localStorage.clear();
  }
});
