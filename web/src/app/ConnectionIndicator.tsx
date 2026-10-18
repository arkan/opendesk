import { appText } from "@/i18n/text";
import { useRealtime } from "@/lib/realtime/store";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

const copy = {
  idle: { get label() { return appText("Not connected"); }, tone: "bg-fg-4", pulse: false },
  connecting: { get label() { return appText("Connecting"); }, tone: "bg-fg-4", pulse: true },
  live: { get label() { return appText("Live: updates appear as they happen"); }, tone: "bg-ok", pulse: false },
  reconnecting: { get label() { return appText("Reconnecting. Changes will sync when the connection is back."); }, tone: "bg-warn", pulse: true },
  offline: { get label() { return appText("Offline. Retrying."); }, tone: "bg-danger", pulse: true },
} as const;

export function ConnectionIndicator({ className }: { className?: string }) {
  const status = useRealtime((s) => s.status);
  const c = copy[status];
  return (
    <Tooltip content={c.label} side="bottom">
      <span
        role="status"
        aria-label={c.label}
        className={cn("inline-flex size-6 items-center justify-center rounded-md hover:bg-chrome-hover", className)}
      >
        <span className="relative flex size-1.5">
          {c.pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", c.tone)} />}
          <span className={cn("relative size-1.5 rounded-full", c.tone)} />
        </span>
      </span>
    </Tooltip>
  );
}
