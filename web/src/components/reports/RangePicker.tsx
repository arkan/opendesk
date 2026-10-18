import { dateLocale } from "@/lib/dateLocale";
import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
import { endOfMonth, format, parseISO, startOfMonth, subDays, subMonths } from "date-fns";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ReportsRange } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { DateField } from "@/components/ui/date-picker";

const day = (d: Date) => format(d, "yyyy-MM-dd");

export function presets(now = new Date()): { id: string; label: string; range: ReportsRange }[] {
  return [
    { id: "7", label: appText("Last 7 days"), range: { from: day(subDays(now, 6)), to: day(now) } },
    { id: "30", label: appText("Last 30 days"), range: { from: day(subDays(now, 29)), to: day(now) } },
    { id: "90", label: appText("Last 90 days"), range: { from: day(subDays(now, 89)), to: day(now) } },
    { id: "month", label: appText("This month"), range: { from: day(startOfMonth(now)), to: day(now) } },
    { id: "last-month", label: appText("Last month"), range: { from: day(startOfMonth(subMonths(now, 1))), to: day(endOfMonth(subMonths(now, 1))) } },
  ];
}

export function rangeLabel(r: ReportsRange) {
  const p = presets().find((x) => x.range.from === r.from && x.range.to === r.to);
  if (p) return p.label;
  const a = parseISO(r.from);
  const b = parseISO(r.to);
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${format(a, sameYear ? "MMM d" : "MMM d, yyyy", { locale: dateLocale() })} – ${format(b, "MMM d, yyyy", { locale: dateLocale() })}`;
}

export function RangePicker({ value, onChange }: { value: ReportsRange; onChange: (r: ReportsRange) => void }) {
  const { t: appText } = useTranslation("app");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const list = presets();
  const active = list.find((p) => p.range.from === value.from && p.range.to === value.to)?.id;
  const invalid = !from || !to || from > to;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setFrom(value.from);
          setTo(value.to);
        }
      }}
      align="start"
      className="w-[280px] p-1"
      trigger={
        <Button icon={<CalendarDays className="size-3.5 text-fg-3" />} iconRight={<ChevronDown className="size-3 text-fg-4" />}>
          {rangeLabel(value)}
        </Button>
      }
    >
      <div role="listbox" aria-label={appText("Date range")}>
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={active === p.id}
            onClick={() => {
              onChange(p.range);
              setOpen(false);
            }}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-hover",
              active === p.id ? "font-medium text-fg" : "text-fg-2",
            )}
          >
            <span className="flex-1">{p.label}</span>
            <span className="mono text-[10.5px] text-fg-4">{format(parseISO(p.range.from), "MMM d", { locale: dateLocale() })}</span>
            <Check className={cn("size-4", active === p.id ? "text-fg" : "invisible")} strokeWidth={2.5} />
          </button>
        ))}
      </div>
      <form
        className="mt-1 border-t border-line px-2 pb-2 pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onChange({ from, to });
          setOpen(false);
        }}
      >
        <div className="label-caps mb-2">{appText("Custom range")}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-fg-3">

            {appText("From")}
            <DateField size="sm" aria-label={appText("From")} value={from} max={to} onChange={setFrom} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-3">

            {appText("To")}
            <DateField size="sm" aria-label={appText("To")} value={to} min={from} max={day(new Date())} onChange={setTo} />
          </label>
        </div>
        <Button type="submit" variant="primary" size="sm" className="mt-2.5 w-full" disabled={invalid}>

          {appText("Apply range")}
        </Button>
      </form>
    </Popover>
  );
}
