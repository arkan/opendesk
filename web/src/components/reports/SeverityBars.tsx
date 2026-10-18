import { appText } from "@/i18n/text";
import { useTranslation } from "react-i18next";
import { SeverityChip, severityLabelKey, severityOrder } from "@/components/tickets/bits";
import type { ReportsOverview, Severity } from "@/lib/api/types";
import { severityTone } from "@/lib/tones";
import { BreakdownBars, ShareBar, type BarRow } from "./Bars";

/** Tickets created in the period by severity, worst first, unset last. */
export function SeverityBars({ data }: { data: NonNullable<ReportsOverview["by_severity"]> }) {
  const { t } = useTranslation("reports");
  const rows: BarRow[] = [
    ...severityOrder.map((s: Severity) => ({
      id: s,
      label: appText(severityLabelKey[s]),
      text: appText(severityLabelKey[s]),
      value: data[s] ?? 0,
      tone: severityTone[s],
      icon: <SeverityChip severity={s} />,
    })),
    {
      id: "none",
      label: t("severity.none"),
      text: t("severity.none"),
      value: data.none ?? 0,
      tone: "gray" as const,
      icon: <span className="h-[16px] w-[22px] shrink-0 rounded-[4px] border border-dashed border-line-strong" />,
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <ShareBar rows={rows} />
      <BreakdownBars rows={rows} unit={(n) => t("unit.tickets", { count: n })} />
    </div>
  );
}
