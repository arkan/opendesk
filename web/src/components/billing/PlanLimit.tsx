import { appText } from "@/i18n/text";
// Limits shown up front on Free: "1 of 1 mailboxes on Free" with an upgrade
// prompt, where mailboxes are added and members invited.

import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { upgrade } from "@/lib/upgrade";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useLimit } from "./hooks";
import type { LimitKind } from "./model";
import { Meter } from "./Meter";

export function limitDetail(kind: LimitKind, max: number) {
  return kind === "mailboxes"
    ? appText("The Free plan includes {{max}} mailbox. Upgrade to Pro for unlimited mailboxes.", { max })
    : appText("The Free plan includes {{max}} member. Upgrade to Pro to invite your team.", { max });
}

/** Opens the shared upgrade dialog for this limit. */
export function showLimit(kind: LimitKind, max: number) {
  upgrade.show({ code: "plan_limit", detail: limitDetail(kind, max) });
}

/**
 * A quiet line with a tiny meter. Renders nothing when the plan has no cap.
 * `compact` drops the meter for tight spots (dialogs).
 */
export function PlanLimitHint({ kind, className, compact }: { kind: LimitKind; className?: string; compact?: boolean }) {
  const { t } = useTranslation("billing");
  const l = useLimit(kind);
  if (!l.limited) return null;
  const opts = { used: l.used, count: l.max };
  const text = l.over
    ? kind === "mailboxes"
      ? t("limits.hintMailboxesOver", opts)
      : t("limits.hintMembersOver", opts)
    : kind === "mailboxes"
      ? t("limits.hintMailboxes", opts)
      : t("limits.hintMembers", opts);
  return (
    <div className={cn("flex items-center gap-3 rounded-md border border-line bg-sunken/60 px-3 py-2", className)}>
      {!compact && <Meter value={l.used} max={l.max} label={text} className="w-12 shrink-0" />}
      <span className="mono min-w-0 flex-1 truncate text-[12px] text-fg-2">{text}</span>
      {l.atLimit && (
        <Button size="xs" variant="ghost" iconRight={<ArrowUpRight className="size-3" />} onClick={() => showLimit(kind, l.max)}>
          {t("limits.upgrade")}
        </Button>
      )}
    </div>
  );
}
