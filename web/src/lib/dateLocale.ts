import { enUS, fr } from "date-fns/locale";
import { intlLocale } from "@/i18n";

/** Agent-only date-fns labels; stored date formats remain locale-independent. */
export function dateLocale() {
  return intlLocale().toLowerCase().startsWith("fr") ? fr : enUS;
}
