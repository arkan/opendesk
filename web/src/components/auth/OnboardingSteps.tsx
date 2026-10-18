import { uiText } from "@/i18n/ui";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const steps = ["Workspace", "Mailbox"] as const;

/** Two-step progress for onboarding: 1 Workspace, 2 Mailbox. */
export function OnboardingSteps({ current }: { current: 1 | 2 }) {
  useTranslation("interface");
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label={uiText("Setup progress")}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            {i > 0 && <span className={cn("h-px w-8", done || active ? "bg-fg-3" : "bg-line")} aria-hidden />}
            <span
              className={cn(
                "mono flex size-5 items-center justify-center rounded-[5px] text-[10.5px] font-medium",
                done ? "bg-inverse text-inverse-fg" : active ? "border border-fg text-fg" : "border border-line text-fg-4",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : n}
            </span>
            <span className={cn("text-[12.5px]", active ? "font-medium text-fg" : "text-fg-3")}>{uiText(label)}</span>
          </li>
        );
      })}
    </ol>
  );
}
