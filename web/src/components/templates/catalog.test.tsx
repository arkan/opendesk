import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BackendModule } from "i18next";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { i18n, setLocale } from "@/i18n";
import { qk } from "@/lib/queries";
import { useCatalog } from "./catalog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("updates template guidance when its catalog arrives after a public page in the same language", async () => {
  await setLocale("fr", ["common", "public"]);
  const backend = i18n.services.backendConnector.backend as BackendModule;
  const read = backend.read.bind(backend);
  let finish: (() => Promise<void>) | undefined;
  const spy = vi.spyOn(backend, "read").mockImplementation((lng, ns, callback) => {
    if (lng === "fr" && ns === "templatesUi") {
      finish = () => new Promise<void>((resolve) => read(lng, ns, (err, data) => {
        callback(err, data);
        resolve();
      }));
    } else read(lng, ns, callback);
  });
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  client.setQueryData(qk.templateVariables, {
    variables: [{ key: "contact.name", label: "Customer", description: "Customer" }],
    slots: [], filters: [],
  });
  function Probe() {
    const catalog = useCatalog();
    return <p>{catalog.loading ? "Loading" : catalog.variables[0]?.label}</p>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    expect(container.textContent).toBe("Loading");
    expect(finish).toBeTypeOf("function");
    await act(async () => { await finish!(); });
    expect(container.textContent).toBe("Client");
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
    spy.mockRestore();
    await i18n.changeLanguage("en");
  }
});
