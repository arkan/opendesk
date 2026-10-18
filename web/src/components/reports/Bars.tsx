import { intlLocale } from "@/i18n";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { toneVar, type Tone } from "@/lib/tones";

export type BarRow = { id: string; label: ReactNode; text: string; value: number; tone: Tone; icon?: ReactNode };

/** A bar that grows to its share; reduced motion draws it in place. */
export function Bar({ pct, tone, className = "h-1.5" }: { pct: number; tone: Tone; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={`${className} w-full overflow-hidden rounded-xs bg-sunken`}>
      <motion.div
        className="h-full rounded-xs"
        style={{ background: toneVar(tone) }}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 260, damping: 34 }}
      />
    </div>
  );
}

/** Ranked horizontal bars: label and figure on one line, a tone bar under it. */
export function BreakdownBars({ rows, unit, empty }: { rows: BarRow[]; unit: (n: number) => string; empty?: ReactNode }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || total === 0) return <>{empty}</>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <li key={r.id}>
            <Tooltip content={`${r.text}: ${unit(r.value)}, ${share}%`}>
              <div tabIndex={0} className="rounded-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--focus)]">
                <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                  {r.icon}
                  <span className="min-w-0 truncate text-fg-2">{r.label}</span>
                  <span className="mono ml-auto text-xs tabular-nums text-fg">{r.value.toLocaleString(intlLocale())}</span>
                  <span className="mono w-9 text-right text-[11px] tabular-nums text-fg-4">{share}%</span>
                </div>
                <Bar pct={Math.max(r.value ? 2 : 0, (r.value / max) * 100)} tone={r.tone} />
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** One full-width bar split by share, with a legend under it. */
export function ShareBar({ rows }: { rows: BarRow[] }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const reduce = useReducedMotion();
  if (!total) return null;
  return (
    <div>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-xs">
        {rows
          .filter((r) => r.value > 0)
          .map((r) => (
            <motion.div
              key={r.id}
              className="h-full first:rounded-l-xs last:rounded-r-xs"
              style={{ background: toneVar(r.tone) }}
              initial={reduce ? false : { flexGrow: 0 }}
              animate={{ flexGrow: r.value }}
              transition={{ type: "spring", stiffness: 260, damping: 34 }}
            />
          ))}
      </div>
    </div>
  );
}
