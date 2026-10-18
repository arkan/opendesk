import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/queries";
import { useSession } from "@/lib/session";
import Security from "./Security";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const initialUser = useSession.getState().user;

beforeEach(async () => {
  await setAgentLocale("en");
  vi.spyOn(api.me, "password").mockResolvedValue(undefined);
  useSession.setState({ user: { id: "agent", email: "agent@example.com", name: "Test Agent", avatar_url: null, avatar_source: null, email_verified: true, totp_enabled: false, created_at: "2020-01-01T00:00:00Z" } });
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(qk.sessions, []);
  client.setQueryData(["me", "passkeys"], { data: [], next_cursor: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}>
    <ConfirmProvider><TooltipProvider><Security /></TooltipProvider></ConfirmProvider>
  </QueryClientProvider>));
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  useSession.setState({ user: initialUser });
  vi.restoreAllMocks();
  await setAgentLocale("en");
  localStorage.clear();
});

const form = () => container.querySelector("form")!;
const inputs = () => Array.from(form().querySelectorAll<HTMLInputElement>('input[type="password"]'));
const message = () => form().querySelector("p")?.textContent;

async function submit(next: string, confirmation = next) {
  for (const [i, value] of ["current-password", next, confirmation].entries()) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs()[i], value);
      inputs()[i].dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

it.each([
  ["short", "short", "Use at least 12 characters.", "Utilisez au moins 12 caractères."],
  ["a".repeat(129), "a".repeat(129), "Use at most 128 characters.", "Utilisez au maximum 128 caractères."],
  ["new-password-123", "different-password", "The new passwords don't match.", "Les nouveaux mots de passe ne correspondent pas."],
])("updates validation without losing input or submitting: %s", async (next, confirmation, english, french) => {
  await submit(next, confirmation);
  expect(message()).toBe(english);
  await act(async () => { await setAgentLocale("fr"); });
  expect(message()).toBe(french);
  expect(inputs().map((input) => input.value)).toEqual(["current-password", next, confirmation]);
  await act(async () => { await setAgentLocale("en"); });
  expect(message()).toBe(english);
  expect(api.me.password).not.toHaveBeenCalled();
});

it.each([
  [new ApiError({ status: 401, code: "invalid_credentials" }), "Your current password is not right.", "Votre mot de passe actuel est incorrect."],
  [new ApiError({ status: 0 }), "Can't reach the server. Check your connection.", "Impossible de joindre le serveur. Vérifiez votre connexion."],
])("updates a password API failure without resubmitting: %s", async (error, english, french) => {
  vi.mocked(api.me.password).mockRejectedValue(error);
  await submit("new-password-123");
  expect(message()).toBe(english);
  await act(async () => { await setAgentLocale("fr"); });
  expect(message()).toBe(french);
  expect(inputs().map((input) => input.value)).toEqual(["current-password", "new-password-123", "new-password-123"]);
  expect(api.me.password).toHaveBeenCalledExactlyOnceWith("current-password", "new-password-123");

  await submit("short");
  expect(message()).toBe("Utilisez au moins 12 caractères.");
  expect(api.me.password).toHaveBeenCalledOnce();
});
