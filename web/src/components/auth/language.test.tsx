import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { OnboardingSteps } from "./OnboardingSteps";
import { oauthErrorMessage, PasswordInput, StrengthMeter } from "./parts";

vi.mock("@/lib/password-strength", () => ({
  usePasswordStrength: () => ({ score: 1, warning: "This is a commonly used password." }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await i18n.changeLanguage("en");
});

describe("auth language", () => {
  it("updates labels and password accessibility when the language changes", async () => {
    await act(async () => root.render(<><PasswordInput /><OnboardingSteps current={1} /></>));
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Show password");
    expect(container.textContent).toContain("Workspace");

    await act(async () => { await i18n.changeLanguage("fr"); });
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Afficher le mot de passe");
    expect(container.querySelector("ol")?.getAttribute("aria-label")).toBe("Progression de la configuration");
    expect(container.textContent).toContain("Espace de travail");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("input")?.type).toBe("text");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Masquer le mot de passe");
  });

  it("keeps the English strength copy and translates French counts and warnings", async () => {
    await act(async () => root.render(<StrengthMeter password="12345678901" />));
    expect(container.textContent).toContain("1 more characters");
    await act(async () => { await i18n.changeLanguage("fr"); });
    expect(container.textContent).toContain("Encore 1 caractère");
    await act(async () => root.render(<StrengthMeter password="1234567890" />));
    expect(container.textContent).toContain("Encore 2 caractères");
    await act(async () => root.render(<StrengthMeter password="123456789012" />));
    expect(container.textContent).toContain("Ce mot de passe est courant.");
    expect(container.textContent).not.toContain("This is a commonly used password.");
  });

  it("resolves OAuth errors at call time, including unknown error codes", async () => {
    expect(oauthErrorMessage("access_denied")).toBe("Sign-in was cancelled.");
    await i18n.changeLanguage("fr");
    expect(oauthErrorMessage("access_denied")).toBe("La connexion a été annulée.");
    expect(oauthErrorMessage("unknown")).toBe("La connexion a échoué. Réessayez.");
    expect(oauthErrorMessage(undefined)).toBeNull();
  });
});
