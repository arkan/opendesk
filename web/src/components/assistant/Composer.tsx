// The message box: Enter sends, Shift+Enter breaks the line, "/" lists quick
// asks. Every keystroke boops the blob.

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { pulseOllie } from "./pulse";
import { useAssistantName } from "./name";

export type ComposerHandle = { focus: () => void; set: (text: string) => void };

const SLASH = ["summarize", "assign", "reply", "note", "triage", "unassigned", "report", "kb"] as const;
export type SlashKey = (typeof SLASH)[number];

export const Composer = forwardRef<ComposerHandle, { running: boolean; onSend: (text: string) => void; onStop: () => void; disabled?: boolean }>(function Composer(
  { running, onSend, onStop, disabled },
  ref,
) {
  const { t: ui } = useTranslation("ui");
  const { t } = useTranslation("assistant");
  const name = useAssistantName();
  const [text, setText] = useState("");
  const [hint, setHint] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), set: (v) => setText(v) }), []);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const slash = useMemo(() => {
    const m = text.match(/^\/(\w*)$/);
    if (!m) return [];
    return SLASH.filter((k) => k.startsWith(m[1].toLowerCase()));
  }, [text]);
  const open = slash.length > 0;

  const pick = (k: SlashKey) => {
    setText("");
    onSend(t(`prompts.${k}`));
  };
  const submit = () => {
    const v = text.trim();
    if (!v || running || disabled) return;
    setText("");
    onSend(v);
  };

  return (
    <div className="relative">
      {open && (
        <div role="listbox" aria-label={ui("quickAsks")} className="absolute inset-x-0 bottom-full mb-1.5 overflow-hidden rounded-lg border border-line bg-raised p-1 shadow-pop">
          {slash.map((k, i) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={i === hint % slash.length}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(k);
              }}
              onMouseEnter={() => setHint(i)}
              className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]", i === hint % slash.length ? "bg-hover text-fg" : "text-fg-2")}
            >
              <span className="mono w-20 shrink-0 text-[11.5px] text-tone-violet">/{k}</span>
              <span className="truncate">{t(`slash.${k}`)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-xl border border-line bg-surface p-1.5 pl-3 shadow-xs transition-[border-color,box-shadow] focus-within:border-[color-mix(in_srgb,var(--tone-violet-solid)_45%,var(--line))] focus-within:shadow-[0_0_0_3px_var(--tone-violet-soft)]">
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          aria-label={t("placeholder", { name })}
          placeholder={t("placeholder", { name })}
          onChange={(e) => {
            setText(e.target.value);
            setHint(0);
          }}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) pulseOllie();
            if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHint((h) => (h + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length);
              return;
            }
            if (open && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pick(slash[hint % slash.length]);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 focus-visible:shadow-none text-[13px] leading-5 text-fg outline-none placeholder:text-fg-4 disabled:opacity-50"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t("stop")}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-fg transition-colors hover:bg-active"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || disabled}
            aria-label={t("send")}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-inverse text-inverse-fg transition-[opacity,transform] hover:bg-inverse-hover active:scale-95 disabled:opacity-30"
          >
            <ArrowUp className="size-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
});
