// Rename and recolour statuses and priorities for this workspace. Display
// only: the API values never change. Shapes follow `status_labels` and
// `priority_labels` in the workspace settings contract.

import { RotateCcw } from "lucide-react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { PriorityIcon, StatusIcon, priorityLabelKey, priorityOrder, statusLabelKey, statusOrder } from "@/components/indicators";
import { Popover } from "@/components/ui/popover";
import { TextInput } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type { Priority, TicketStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { priorityTone, statusTone, tone as tones, type Tone } from "@/lib/tones";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

export type DisplayOverride = { label?: string; color?: Tone };
export type Overrides<K extends string> = Partial<Record<K, DisplayOverride>>;

const labelRe = /^[^<>]{0,40}$/;

export function DisplayOverridesEditor({
  statuses,
  priorities,
  onStatuses,
  onPriorities,
  disabled,
}: {
  statuses: Overrides<TicketStatus>;
  priorities: Overrides<Priority>;
  onStatuses: (v: Overrides<TicketStatus>) => void;
  onPriorities: (v: Overrides<Priority>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("settings");
  return (
    <div className="grid gap-x-8 md:grid-cols-2">
      <OverrideList
        title={t("display.statuses")}
        keys={statusOrder}
        defaultKeys={statusLabelKey}
        tones={statusTone}
        icon={(k) => <StatusIcon status={k} />}
        value={statuses}
        onChange={onStatuses}
        disabled={disabled}
      />
      <OverrideList
        title={t("display.priorities")}
        keys={priorityOrder}
        defaultKeys={priorityLabelKey}
        tones={priorityTone}
        icon={(k) => <PriorityIcon priority={k} />}
        value={priorities}
        onChange={onPriorities}
        disabled={disabled}
      />
    </div>
  );
}

function OverrideList<K extends string>({
  title,
  keys,
  defaultKeys,
  tones: defaultTones,
  icon,
  value,
  onChange,
  disabled,
}: {
  title: string;
  keys: K[];
  defaultKeys: Record<K, ParseKeys<"app">>;
  tones: Record<K, Tone>;
  icon: (k: K) => React.ReactNode;
  value: Overrides<K>;
  onChange: (v: Overrides<K>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("settings");
  const { t: appText } = useTranslation("app");
  const set = (k: K, patch: DisplayOverride) => {
    const next: DisplayOverride = { ...value[k], ...patch };
    if (!next.label) delete next.label;
    if (!next.color || next.color === defaultTones[k]) delete next.color;
    const out = { ...value };
    if (Object.keys(next).length) out[k] = next;
    else delete out[k];
    onChange(out);
  };
  return (
    <div className="py-3">
      <div className="label-caps mb-2">{title}</div>
      <div className="flex flex-col">
        {keys.map((k) => {
          const labelKey: ParseKeys<"app"> = defaultKeys[k];
          const defaultLabel = appText(labelKey);
          const o = value[k] ?? {};
          const hue = o.color ?? defaultTones[k];
          const changed = !!(o.label || o.color);
          const bad = !!o.label && !labelRe.test(o.label);
          return (
            <div key={k} className="group flex h-10 items-center gap-2.5">
              <span className="flex w-5 justify-center">{icon(k)}</span>
              <TextInput
                inputSize="sm"
                value={o.label ?? ""}
                placeholder={defaultLabel}
                maxLength={40}
                invalid={bad}
                disabled={disabled}
                aria-label={t("display.labelFor", { name: defaultLabel })}
                onChange={(e) => set(k, { label: e.target.value })}
                className="min-w-0 flex-1"
              />
              <Popover
                align="end"
                className="p-2.5"
                trigger={
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("display.colourFor", { name: defaultLabel })}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface transition-colors hover:border-line-strong disabled:opacity-50"
                  >
                    <span className={cn("size-3.5 rounded-xs", tones[hue].solid)} />
                  </button>
                }
              >
                <ColorSwatchPicker value={hue} onChange={(c) => set(k, { color: c })} size="sm" className="w-[124px]" label={t("display.colourFor", { name: defaultLabel })} />
              </Popover>
              <Tooltip content={t("display.reset")}>
                <button
                  type="button"
                  aria-label={t("display.resetFor", { name: defaultLabel })}
                  disabled={disabled || !changed}
                  onClick={() => {
                    const out = { ...value };
                    delete out[k];
                    onChange(out);
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-4 transition-[opacity,color] hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-0"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
