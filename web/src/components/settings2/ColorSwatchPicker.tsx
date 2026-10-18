import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
// A row of tone swatches for things people colour (tags, labels). Arrow keys
// move between swatches like a radio group; the current one carries a ring.

import { Check } from "lucide-react";
import { useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { TAG_TONES, tone as tones, type Tone } from "@/lib/tones";

const toneName: Record<Tone, string> = {
  get gray() { return appText("Gray"); },
  get blue() { return appText("Blue"); },
  get indigo() { return appText("Indigo"); },
  get violet() { return appText("Violet"); },
  get purple() { return appText("Purple"); },
  get pink() { return appText("Pink"); },
  get rose() { return appText("Rose"); },
  get red() { return appText("Red"); },
  get orange() { return appText("Orange"); },
  get amber() { return appText("Amber"); },
  get yellow() { return appText("Yellow"); },
  get lime() { return appText("Lime"); },
  get green() { return appText("Green"); },
  get teal() { return appText("Teal"); },
  get cyan() { return appText("Cyan"); },
};

export function ColorSwatchPicker({
  value,
  onChange,
  tones: choices = TAG_TONES,
  label = appText("Colour"),
  size = "md",
  className,
}: {
  value: Tone | null | undefined;
  onChange: (t: Tone) => void;
  tones?: Tone[];
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  useTranslation("app");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value && choices.includes(value) ? value : null;
  const focusIndex = current ? choices.indexOf(current) : 0;
  const move = (i: number) => {
    const n = (i + choices.length) % choices.length;
    onChange(choices[n]);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {choices.map((t, i) => {
        const on = t === current;
        return (
          <Tooltip key={t} content={toneName[t]}>
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={toneName[t]}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => onChange(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i - 1);
                }
              }}
              className={cn(
                "relative flex items-center justify-center rounded-sm outline-none transition-[transform,box-shadow] duration-150 hover:scale-110 active:scale-95 focus-visible:shadow-[0_0_0_3px_var(--focus)] motion-reduce:transition-none motion-reduce:hover:scale-100",
                size === "sm" ? "size-5" : "size-6",
                tones[t].solid,
                on && "shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--fg-3)]",
              )}
            >
              {on && <Check className="size-3 text-white" strokeWidth={2.5} aria-hidden />}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { toneName };
