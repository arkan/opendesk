import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/api/types";
import { tone as tones, type Tone } from "@/lib/tones";

/** Up/down reorder buttons for ordered settings lists. */
export function ReorderButtons({
  onUp,
  onDown,
  first,
  last,
  label,
  disabled,
}: {
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
  label: string;
  disabled?: boolean;
}) {
  useTranslation("app");
  const btn =
    "flex size-6 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <Tooltip content={appText("Move up")}>
        <button type="button" aria-label={appText("Move {{name}} up", { name: label })} disabled={first || disabled} onClick={onUp} className={btn}>
          <ArrowUp className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={appText("Move down")}>
        <button type="button" aria-label={appText("Move {{name}} down", { name: label })} disabled={last || disabled} onClick={onDown} className={btn}>
          <ArrowDown className="size-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}

/** A small rounded scope/event chip in mono. */
export function MonoChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("mono inline-flex h-[18px] shrink-0 items-center rounded-sm border border-line px-1.5 text-[10.5px] text-fg-2", className)}>
      {children}
    </span>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  useTranslation("app");
  return (
    <div aria-busy="true" aria-label={appText("Loading")}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b border-line-soft px-4 last:border-0">
          <div className="skeleton h-2.5" style={{ width: `${28 + ((i * 13) % 25)}%` }} />
          <div className="skeleton ml-auto h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

// Colour for meaning in settings lists: roles, states, summary figures.

const roleTone = { owner: "indigo", admin: "blue", agent: "teal", viewer: "gray" } as const satisfies Record<Role, Tone>;
const roleText: Record<Role, string> = { get owner() { return appText("Owner"); }, get admin() { return appText("Admin"); }, get agent() { return appText("Agent"); }, get viewer() { return appText("Viewer"); } };

/** A workspace role in its tone. */
export function RolePill({ role, className }: { role: Role; className?: string }) {
  return (
    <Badge tone={roleTone[role]} className={className}>
      {roleText[role]}
    </Badge>
  );
}
export { roleTone, roleText };

export type ItemState = "active" | "failing" | "paused" | "pending" | "revoked" | "expired" | "disabled";
const stateTone: Record<ItemState, Tone> = {
  active: "green",
  failing: "red",
  paused: "amber",
  pending: "amber",
  revoked: "gray",
  expired: "gray",
  disabled: "gray",
};

/** A status pill for things that run: mailboxes, webhooks, API keys. A dot, a word, the tone of its state. */
export function StatePill({ state, children, className, pulse }: { state: ItemState; children: React.ReactNode; className?: string; pulse?: boolean }) {
  const t = stateTone[state];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-medium", tones[t].chip, className)}>
      <span className={cn("size-1.5 rounded-full", tones[t].solid, pulse && "animate-pulse-soft motion-reduce:animate-none")} aria-hidden />
      {children}
    </span>
  );
}

/** A small rounded-square icon tile in a tone, for list rows and summaries. */
export function IconTile({ tone: t = "gray", children, className, size = "md" }: { tone?: Tone; children: React.ReactNode; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
        tones[t].chip,
        className,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

/** A light strip of figures above a settings list: a bordered card with hairlines between cells. */
export function SummaryStrip({
  items,
  className,
}: {
  items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid animate-rise-in grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface shadow-xs md:auto-cols-fr md:grid-flow-col md:grid-cols-none",
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="min-w-0 border-line px-4 py-3 max-md:odd:border-r max-md:[&:nth-child(n+3)]:border-t md:[&:not(:last-child)]:border-r">
          <div className="flex items-center gap-1.5">
            {it.tone && <span className={cn("size-1.5 shrink-0 rounded-full", tones[it.tone].solid)} aria-hidden />}
            <span className="label-caps truncate">{it.label}</span>
          </div>
          <div className="mt-1.5 text-[20px] font-light leading-none tracking-[-0.02em] tabular-nums text-fg">{it.value}</div>
          {it.hint && <div className="mt-1 truncate text-[11.5px] text-fg-3">{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}
