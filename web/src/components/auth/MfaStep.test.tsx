import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { MfaStep } from "./MfaStep";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("shows an MFA failure in the active language even when it changes during the request", async () => {
  await setAgentLocale("fr");
  // JSDOM does not implement the geometry lookup used by input-otp.
  const elementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  let rejectResponse!: (error: unknown) => void;
  const response = new Promise<never>((_, reject) => { rejectResponse = reject; });
  const mfa = vi.spyOn(api.auth, "mfa").mockReturnValue(response);
  const onDone = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MfaStep mfaToken="test-challenge" onDone={onDone} onBack={() => {}} />));
    const recovery = [...container.querySelectorAll("button")].find((button) => button.textContent === "Utiliser un code de récupération")!;
    await act(async () => recovery.click());
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "test-recovery-code");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await setAgentLocale("en"); });
    await act(async () => { rejectResponse(new ApiError({ status: 429, code: "rate_limited" })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Too many attempts. Wait a moment and try again.");

    await act(async () => { await setAgentLocale("fr"); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Trop de tentatives. Patientez un instant et réessayez.");
    expect(input.value).toBe("");
    expect(mfa).toHaveBeenCalledExactlyOnceWith({ mfa_token: "test-challenge", code: "test-recovery-code" });
    expect(onDone).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    mfa.mockRestore();
    if (elementFromPoint) Object.defineProperty(document, "elementFromPoint", elementFromPoint);
    else Reflect.deleteProperty(document, "elementFromPoint");
    await setAgentLocale("en");
    localStorage.clear();
  }
});
