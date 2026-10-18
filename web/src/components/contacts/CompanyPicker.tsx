import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Picker } from "@/components/ui/picker";
import { api } from "@/lib/api/endpoints";
import type { CompanyRef } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { CompanyGlyph } from "./bits";
import { useDebounced } from "./hooks";

/** Pick a company with server-side search. `null` clears it. */
export function CompanyPicker({ value, onChange, id }: { value: CompanyRef | null; onChange: (c: CompanyRef | null) => void; id?: string }) {
  const { t: appText } = useTranslation("app");
  const [query, setQuery] = useState("");
  const term = useDebounced(query, 200);
  const { data } = useQuery({
    queryKey: ["companies", "pick", term],
    queryFn: () => api.companies.search({ q: term || undefined, limit: 12 }),
  });
  const rows = data?.data ?? [];
  return (
    <Picker
      items={[
        { value: "__none", label: appText("No company"), icon: <span className="size-3.5" /> },
        ...rows.map((c) => ({ value: c.id, label: c.name, hint: c.domain, icon: <CompanyGlyph name={c.name} src={c.avatar_url} size="xs" /> })),
      ]}
      value={value?.id ?? "__none"}
      width={300}
      placeholder={appText("Search companies")}
      onQueryChange={setQuery}
      onSelect={(v) => {
        if (v === "__none") return onChange(null);
        const c = rows.find((r) => r.id === v);
        if (c) onChange({ id: c.id, name: c.name, domain: c.domain, avatar_url: c.avatar_url });
      }}
      trigger={
        <button
          id={id}
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm shadow-[0_1px_1px_rgb(0_0_0/0.02)] hover:border-line-strong focus-visible:border-fg-3"
        >
          {value ? <CompanyGlyph name={value.name} src={value.avatar_url} size="xs" /> : <Building2 className="size-3.5 shrink-0 text-fg-3" />}
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-fg-4")}>{value?.name ?? appText("No company")}</span>
          <ChevronDown className="size-3.5 text-fg-3" />
        </button>
      }
    />
  );
}
