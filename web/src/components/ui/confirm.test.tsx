import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { i18n, loadAgentCatalogs } from "@/i18n";
import { ConfirmProvider, useConfirm } from "./confirm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => loadAgentCatalogs("fr"));
afterEach(async () => { await i18n.changeLanguage("en"); });

function Ask({ name }: { name: string }) {
  const confirm = useConfirm();
  useEffect(() => confirm.show("Delete it?", () => {}, { typeToConfirm: name }), [confirm, name]);
  return null;
}

async function prompt(name: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ConfirmProvider><Ask name={name} /></ConfirmProvider>));
  const text = document.querySelector("label")?.textContent;
  const value = document.querySelector("label .mono")?.textContent;
  await act(async () => root.unmount());
  host.remove();
  return { text, value };
}

it("asks to type the name as one sentence, with the name kept as typed", async () => {
  expect(await prompt("Acme <b>Support</b>")).toEqual({ text: "Type Acme <b>Support</b> to confirm", value: "Acme <b>Support</b>" });
  await i18n.changeLanguage("fr");
  expect(await prompt("Acme")).toEqual({ text: "Saisissez Acme pour confirmer", value: "Acme" });
});
