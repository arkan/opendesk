import { i18n } from "./index";

/** Localize catalog literals while leaving unknown diagnostics and template code untouched. */
function literalText(ns: "app" | "interface" | "templatesUi") {
  return (value: string, values?: Record<string, string | number>): string => {
    const options = { ...values, ns, keySeparator: false, nsSeparator: false } as const;
    if (!i18n.exists(value, options)) return value;
    return i18n.t(value, { ...options, defaultValue: value });
  };
}

export const appText = literalText("app");
export const uiText = literalText("interface");
export const templateText = literalText("templatesUi");
