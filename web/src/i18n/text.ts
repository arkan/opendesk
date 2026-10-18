import { i18n } from "./index";

/** Translate interface literals outside the original feature catalogs. */
export function appText(value: string, values: Record<string, string | number> = {}): string {
  if (!i18n.exists(value, { ...values, ns: "app", keySeparator: false, nsSeparator: false })) return value;
  return i18n.t(value, { ...values, ns: "app", keySeparator: false, nsSeparator: false, defaultValue: value });
}
