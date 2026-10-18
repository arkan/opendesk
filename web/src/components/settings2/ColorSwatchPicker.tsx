import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
// A row of tone swatches for things people colour (tags, labels). Arrow keys
// move between swatches like a radio group; the current one carries a ring.

import { Check } from "lucide-react";
import { useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { TAG_TONES, tone as tones, type Tone } from "@/lib/tones";

const toneName: Record<Tone, ParseKeys<"app">> = {
  gray: "Gray", blue: "Blue", indigo: "Indigo", violet: "Violet", purple: "Purple",
  pink: "Pink", rose: "Rose", red: "Red", orange: "Orange", amber: "Amber",
  yellow: "Yellow", lime: "Lime", green: "Green", teal: "Teal", cyan: "Cyan",
};

export function ColorSwatchPicker({
  value,
  onChange,
  tones: choices = TAG_TONES,
  label,
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
  const { t: appText } = useTranslation("app");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value && choices.includes(value) ? value : null;
  const focusIndex = current ? choices.indexOf(current) : 0;
  const move = (i: number) => {
    const n = (i + choices.length) % choices.length;
    onChange(choices[n]);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label ?? appText("Colour")} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {choices.map((t, i) => {
        const on = t === current;
        const name = appText(toneName[t]);
        return (
          <Tooltip key={t} content={name}>
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={name}
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
