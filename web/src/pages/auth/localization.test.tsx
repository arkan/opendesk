import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/queries";
import Callback from "./Callback";
import Forgot from "./Forgot";
import Login from "./Login";
import Register from "./Register";
import Reset from "./Reset";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(async () => {
  await setAgentLocale("fr");
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(qk.authConfig, { providers: [], password_login: true, signup_enabled: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.restoreAllMocks();
  await setAgentLocale("en");
  localStorage.clear();
});

async function renderPage(path: string) {
  const rootRoute = createRootRoute();
  const auth = createRoute({ getParentRoute: () => rootRoute, id: "auth", component: Outlet });
  const routeTree = rootRoute.addChildren([auth.addChildren([
    createRoute({ getParentRoute: () => auth, path: "login", component: Login }),
    createRoute({ getParentRoute: () => auth, path: "forgot", component: Forgot }),
    createRoute({ getParentRoute: () => auth, path: "reset", component: Reset }),
    createRoute({ getParentRoute: () => auth, path: "register", component: Register }),
    createRoute({ getParentRoute: () => auth, path: "auth/callback", component: Callback }),
  ])]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  await act(async () => root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
}

async function submit(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

const alert = () => container.querySelector('[role="alert"]')?.textContent;

it("updates an existing login transport error in both language directions", async () => {
  vi.spyOn(api.auth, "login").mockRejectedValue(new ApiError({ status: 0 }));
  await renderPage("/login");
  await submit({ email: "agent@example.com", password: "example-password" });
  expect(alert()).toBe("Impossible de joindre le serveur. Vérifiez votre connexion.");

  await act(async () => { await setAgentLocale("en"); });
  expect(alert()).toBe("Can't reach the server. Check your connection.");
  await act(async () => { await setAgentLocale("fr"); });
  expect(alert()).toBe("Impossible de joindre le serveur. Vérifiez votre connexion.");
  expect(api.auth.login).toHaveBeenCalledOnce();
});

it("updates an incomplete callback error without remounting the page", async () => {
  await renderPage("/auth/callback");
  expect(alert()).toBe("Ce lien de connexion est incomplet. Recommencez.");
  await act(async () => { await setAgentLocale("en"); });
  expect(alert()).toBe("This sign-in link is incomplete. Start again.");
});

it.each(["constructor", "toString", "__proto__", "unknown_provider_error"])("handles unknown OAuth code %s as a translatable error", async (code) => {
  await renderPage(`/auth/callback?error=${code}`);
  expect(alert()).toBe("La connexion a échoué. Réessayez.");
  await act(async () => { await setAgentLocale("en"); });
  expect(alert()).toBe("Sign-in failed. Try again.");
});

it("updates a registration error and its login link without resubmitting", async () => {
  vi.spyOn(api.auth, "register").mockRejectedValue(new ApiError({ status: 409, code: "email_taken" }));
  await renderPage("/register");
  await submit({ name: "Test Agent", email: "agent@example.com", password: "example-password" });
  expect(alert()).toContain("Un compte utilise déjà cette adresse e-mail.");
  await act(async () => { await setAgentLocale("en"); });
  expect(alert()).toContain("An account already uses this email.");
  expect(container.querySelector('[role="alert"] a')?.textContent?.trim()).toBe("Log in instead");
  expect(api.auth.register).toHaveBeenCalledOnce();
});

it.each([undefined, new ApiError({ status: 404, code: "not_found" })])("keeps password recovery private across language changes (%s)", async (error) => {
  const forgot = vi.spyOn(api.auth, "forgot");
  if (error) forgot.mockRejectedValue(error);
  else forgot.mockResolvedValue(undefined);
  await renderPage("/forgot");
  await submit({ email: "agent@example.com" });
  expect(alert()).toBeUndefined();
  expect(container.querySelector("h1")?.textContent).toBe("Consultez vos e-mails");
  expect(container.textContent).toContain("agent@example.com");

  await act(async () => { await setAgentLocale("en"); });
  expect(container.querySelector("h1")?.textContent).toBe("Check your email");
  expect(alert()).toBeUndefined();
  expect(forgot).toHaveBeenCalledExactlyOnceWith("agent@example.com", undefined);
});

it.each(["invalid_token", "not_found"])("updates the reset-link error for %s without losing the entered password", async (code) => {
  vi.spyOn(api.auth, "reset").mockRejectedValue(new ApiError({ status: 400, code }));
  await renderPage("/reset?token=expired-link");
  await submit({ password: "example-password", confirm: "example-password" });
  expect(alert()).toBe("Ce lien de réinitialisation a expiré ou a déjà été utilisé. Demandez-en un nouveau.");

  await act(async () => { await setAgentLocale("en"); });
  expect(alert()).toBe("This reset link has expired or was already used. Request a new one.");
  expect(container.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe("example-password");
  expect(api.auth.reset).toHaveBeenCalledExactlyOnceWith("expired-link", "example-password");
});
