import { appText } from "@/i18n/text";
// Small shared pieces for the contacts and companies directory.

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { TagChip } from "@/components/ui/badge";
import type { TagRef } from "@/lib/api/types";
import { cn } from "@/lib/cn";

export type LabelRef = TagRef;
export const labelsOf = (x: { tags?: TagRef[] }): TagRef[] => x.tags ?? [];
/** Legacy `custom` values whose keys have no field definition (those render as editable fields). */
export function fieldsOf(x: { custom?: Record<string, unknown> }, defined: Set<string> = new Set()): [string, unknown][] {
  return Object.entries(x.custom ?? {}).filter(([k, v]) => !defined.has(k) && v !== null && v !== undefined && v !== "");
}
/** "plan_tier" -> "Plan tier", for field keys without a definition. */
export function fieldLabel(key: string): string {
  const k = key.replace(/[_-]+/g, " ").trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}
export function fieldText(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? appText("Yes") : appText("No");
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function Labels({ labels, max = 2, className }: { labels: LabelRef[]; max?: number; className?: string }) {
  if (!labels.length) return null;
  const shown = labels.slice(0, max);
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {shown.map((l) => (
        <TagChip key={l.id} name={l.name} color={l.color} />
      ))}
      {labels.length > shown.length && <span className="mono text-[10.5px] text-fg-4">+{labels.length - shown.length}</span>}
    </span>
  );
}

const glyph = { xs: "sm", md: "md", lg: "lg", xl: "xl" } as const;

/** A company's tile: its logo, or its initial on a stable tinted square. */
export function CompanyGlyph({ name, src, size = "md" }: { name: string; src?: string | null; size?: keyof typeof glyph }) {
  return <Avatar name={name || "?"} src={src} size={glyph[size]} square />;
}

/** Label / value pair in a drawer's detail list. */
export function Detail({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid min-h-9 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 py-1.5">
      <dt className="truncate text-[12.5px] text-fg-3">{label}</dt>
      <dd className={mono ? "mono min-w-0 truncate text-xs text-fg" : "min-w-0 text-[13px] text-fg"}>{children}</dd>
    </div>
  );
}

/** Small figure cell for a drawer's stat row. */
export function MiniStat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <div className="label-caps truncate">{label}</div>
      <div className="mt-1 truncate text-[15px] font-semibold tabular-nums tracking-[-0.01em] text-fg">{value}</div>
    </div>
  );
}

export const none = <span className="text-fg-4">–</span>;
