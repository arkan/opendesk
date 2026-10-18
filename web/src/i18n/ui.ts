import { i18n } from "./index";

/** Translate application-owned interface copy while preserving unknown diagnostics. */
export function uiText(english: string, values?: Record<string, string | number>): string {
  if (!i18n.exists(english, { ns: "interface", keySeparator: false, nsSeparator: false })) return english;
  return i18n.t(english, {
    ...values,
    ns: "interface",
    keySeparator: false,
    nsSeparator: false,
    defaultValue: english,
  });
}
