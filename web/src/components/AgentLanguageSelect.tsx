import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAgentLocale, LOCALE_NAMES, setAgentLocale, type AgentLocale } from "@/i18n";
import { appText } from "@/i18n/text";
import { Select } from "@/components/ui/select";

export function AgentLanguageSelect() {
  useTranslation("app");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const choose = async (lng: AgentLocale) => {
    setPending(true);
    setError(false);
    try {
      await setAgentLocale(lng);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-[180px] max-w-full">
      <Select<AgentLocale>
        value={getAgentLocale()}
        onChange={(lng) => void choose(lng)}
        disabled={pending}
        aria-label={appText("Language")}
        options={(["en", "fr"] as const).map((lng) => ({ value: lng, label: <span lang={lng}>{LOCALE_NAMES[lng]}</span> }))}
      />
      {error && <p role="alert" className="mt-1 text-xs text-danger-fg">{appText("Could not load this language. Check your connection and try again.")}</p>}
    </div>
  );
}
