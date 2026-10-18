import { i18n } from "@/i18n";

/** Translate editor guidance while preserving template code and user content. */
export function templateText(value: string, values?: Record<string, string>): string {
  if (!i18n.exists(value, { ns: "templatesUi", keySeparator: false, nsSeparator: false })) return value;
  return i18n.t(value, { ...values, ns: "templatesUi", keySeparator: false, nsSeparator: false, defaultValue: value });
}
