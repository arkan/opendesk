import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setAgentLocale } from "@/i18n";
import { CredentialsForm } from "./Connect";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("translates credential guidance and choices while preserving entered values and API codes", async () => {
  await setAgentLocale("fr");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(async () => root.render(<>
      <CredentialsForm source="zendesk" value={{ subdomain: "my-workspace" }} onChange={onChange} errors={{}} autoFocus={false} />
      <CredentialsForm source="intercom" value={{ region: "eu" }} onChange={onChange} errors={{}} autoFocus={false} />
    </>));
    expect(container.textContent).toContain("Adresse Zendesk");
    expect(container.textContent).toContain("Hébergement de votre espace de travail");
    expect(container.textContent).toContain("États-Unis");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("my-workspace");
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe("Europe");

    await act(async () => { await setAgentLocale("en"); });
    expect(container.textContent).toContain("Zendesk address");
    expect(container.textContent).toContain("Where your workspace is hosted");
    expect(container.textContent).toContain("United States");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("my-workspace");
    expect(onChange).not.toHaveBeenCalled();

    const us = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent === "United States");
    await act(async () => us!.click());
    expect(onChange).toHaveBeenCalledWith({ region: "us" });
  } finally {
    act(() => root.unmount());
    container.remove();
    await setAgentLocale("en");
    localStorage.clear();
  }
});
