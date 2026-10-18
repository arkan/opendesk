import { i18n } from "./index";

export const appText = i18n.getFixedT(null, "app");
export const uiText = i18n.getFixedT(null, "interface");
export const templateText = i18n.getFixedT(null, "templatesUi");

/** Translate known server copy without interpreting unknown diagnostics or template code. */
function serverText(ns: "interface" | "templatesUi") {
  return (value: string, values?: Record<string, string | number>): string => {
    const options = { ...values, ns, keySeparator: false, nsSeparator: false } as const;
    if (!i18n.exists(value, options)) return value;
    return i18n.t(value, { ...options, defaultValue: value });
  };
}

export const diagnosticText = serverText("interface");
export const templateMetadataText = serverText("templatesUi");
