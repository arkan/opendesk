import type { BackendModule } from "i18next";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { i18n, setAgentLocale } from "@/i18n";
import { NAMESPACES } from "@/i18n/resources";
import { usePublicLocale } from "./locale";

const router = vi.hoisted(() => ({ state: { matches: [{ staticData: { publicLocale: true } }] } }));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { search: { lang: "fr" } } }),
  useRouter: () => router,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([false, true])("loads only public catalogs under StrictMode (ready=%s) and restores the agent language on leaving", async (ready) => {
  router.state.matches[0].staticData.publicLocale = true;
  await setAgentLocale("fr");
  await i18n.changeLanguage("en");
  for (const ns of NAMESPACES) i18n.removeResourceBundle("fr", ns);
  const backend = i18n.services.backendConnector.backend as BackendModule;
  const read = vi.spyOn(backend, "read");
  function Probe({ ready }: { ready: boolean }) {
    const { loaded, locale } = usePublicLocale("en", ready);
    return <p>{loaded ? locale : "Loading"}</p>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;
  try {
    await act(async () => root.render(<StrictMode><Probe ready={ready} /></StrictMode>));
    if (!ready) {
      expect(read).not.toHaveBeenCalled();
      await act(async () => root.render(<StrictMode><Probe ready /></StrictMode>));
    }
    await act(async () => { await vi.waitFor(() => expect(i18n.language).toBe("fr")); });
    expect(container.textContent).toBe("fr");
    expect(new Set(read.mock.calls.map(([, ns]) => ns))).toEqual(new Set(["public", "common"]));
    router.state.matches[0].staticData.publicLocale = false;
    await act(async () => root.unmount());
    mounted = false;
    await vi.waitFor(() => expect(i18n.hasResourceBundle("fr", "shell")).toBe(true));
    expect(i18n.language).toBe("fr");
    expect(localStorage.getItem("od-agent-lang")).toBe("fr");
  } finally {
    if (mounted) act(() => root.unmount());
    container.remove();
    read.mockRestore();
    await setAgentLocale("en");
  }
});
