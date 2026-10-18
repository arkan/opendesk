import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { BackendModule } from "i18next";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { expect, it, vi } from "vitest";
import { Notice } from "@/components/auth/parts";
import { usePublicLocale } from "@/components/help/locale";
import { i18n, setAgentLocale } from "@/i18n";
import { RootLayout } from "./RootLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("keeps public notices and the root layout within public catalogs, then restores the agent UI", async () => {
  await setAgentLocale("en");
  const read = vi.spyOn(i18n.services.backendConnector.backend as BackendModule, "read");

  function PublicPage() {
    const { loaded } = usePublicLocale("fr", true);
    const { t } = useTranslation("public");
    return loaded ? <Notice>{t("csat.offline")}</Notice> : null;
  }
  function AgentPage() {
    const { t } = useTranslation("app");
    return <h1>{t("Profile")}</h1>;
  }
  const rootRoute = createRootRoute({ component: RootLayout });
  const publicRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/csat/$token",
    staticData: { publicLocale: true },
    component: PublicPage,
  });
  const agentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    staticData: { title: "Profile" },
    component: AgentPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([publicRoute, agentRoute]),
    history: createMemoryHistory({ initialEntries: ["/csat/review?lang=fr"] }),
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await router.load();
    await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
    await act(async () => { await vi.waitFor(() => expect(i18n.language).toBe("fr")); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.textContent).toBe(i18n.t("csat.offline", { ns: "public" }));
    expect(new Set(read.mock.calls.map(([lng, ns]) => `${lng}/${ns}`))).toEqual(new Set(["fr/public", "fr/common"]));

    await act(async () => { await router.navigate({ to: "/login" }); });
    await act(async () => { await vi.waitFor(() => expect(i18n.language).toBe("en")); });
    expect(container.querySelector("h1")?.textContent).toBe("Profile");
    expect(document.title).toBe("Profile · opendesk");
    expect(container.querySelector('[aria-label="Notifications alt+T"]')).not.toBeNull();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("od-agent-lang")).toBe("en");
  } finally {
    act(() => root.unmount());
    container.remove();
    read.mockRestore();
    await setAgentLocale("en");
    localStorage.clear();
  }
});
