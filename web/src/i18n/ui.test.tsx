import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FieldError, PasswordInput } from "@/components/auth/parts";
import { ApiError, errorMessage } from "@/lib/api/client";
import { i18n } from "./index";
import french from "./locales/fr/interface.json";
import { uiText } from "./text";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  i18n.addResourceBundle("fr", "interface", french, true, true);
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  await i18n.changeLanguage("en");
});

describe("interface translations", () => {
  it("translates catalog copy and count forms while preserving unknown diagnostics", async () => {
    await i18n.changeLanguage("fr");
    expect(uiText("Password")).toBe("Mot de passe");
    expect(uiText("{{count}} more characters", { count: 1 })).toBe("Encore 1 caractère");
    expect(uiText("{{count}} more characters", { count: 2 })).toBe("Encore 2 caractères");
    expect(uiText("Provider diagnostic 451: retry later")).toBe("Provider diagnostic 451: retry later");
    expect(uiText("Provider diagnostic: $t(Close)")).toBe("Provider diagnostic: $t(Close)");
  });

  it("updates visible schema errors and accessible password controls after switching", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<><FieldError message="Enter your email." /><PasswordInput /></>));
    expect(container.textContent).toContain("Enter your email.");
    await act(async () => { await i18n.changeLanguage("fr"); });
    expect(container.textContent).toContain("Saisissez votre adresse e-mail.");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Afficher le mot de passe");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(container.textContent).toContain("Enter your email.");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Show password");
  });

  it("localizes transport errors and preserves server diagnostic precedence", async () => {
    await i18n.changeLanguage("fr");
    expect(errorMessage(new ApiError({ status: 0 }))).toBe("Impossible de joindre le serveur. Vérifiez votre connexion.");
    expect(errorMessage(null)).toBe("Une erreur s’est produite");
    const detailed = new ApiError({ status: 422, detail: "Provider rejected recipient", errors: [{ message: "Invalid recipient" }] });
    expect(errorMessage(detailed)).toBe("Provider rejected recipient");
    expect(errorMessage(new ApiError({ status: 422, errors: [{ message: "Invalid recipient" }] }))).toBe("Invalid recipient");
  });
});
