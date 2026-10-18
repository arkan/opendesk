import type { ParseKeys } from "i18next";
import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit"].includes(type);
  }
  return false;
}

function modalOpen() {
  return !!document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"], [data-radix-popper-content-wrapper]');
}

/** Normalised name for a key event: "mod+k", "shift+?", "j", "enter", "escape". */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  let k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (k === " ") k = "space";
  if (e.shiftKey && k.length > 1) parts.push("shift");
  parts.push(k);
  return parts.join("+");
}

/**
 * Page-level single-key shortcuts. Ignored while typing or while a dialog or
 * popover is open, except bindings that use the mod key. "g i"-style
 * sequences are supported.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const name = keyName(e);
      const withMod = name.startsWith("mod+");
      if (!withMod && (isTypingTarget(e.target) || modalOpen())) return;
      const seq = pending ? `${pending} ${name}` : null;
      const fn = (seq && ref.current[seq]) || ref.current[name];
      if (fn) {
        pending = null;
        e.preventDefault();
        fn(e);
        return;
      }
      if (!withMod && Object.keys(ref.current).some((k) => k.startsWith(`${name} `))) {
        pending = name;
        clearTimeout(timer);
        timer = setTimeout(() => (pending = null), 900);
      } else pending = null;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [enabled]);
}

export const shortcutGroups: { title: ParseKeys<"app">; items: { keys: string; label: ParseKeys<"app"> }[] }[] = [
  {
    title: "General",
    items: [
      { keys: "mod k", label: "Command menu" },
      { keys: "mod j", label: "Ask Ollie" },
      { keys: "/", label: "Search tickets" },
      { keys: "c", label: "New ticket" },
      { keys: "?", label: "Keyboard shortcuts" },
      { keys: "g i", label: "Go to inbox" },
      { keys: "g t", label: "Switch team" },
      { keys: "g c", label: "Go to contacts" },
      { keys: "g k", label: "Go to knowledge base" },
      { keys: "g s", label: "Go to settings" },
    ],
  },
  {
    title: "Ticket list",
    items: [
      { keys: "j", label: "Next ticket" },
      { keys: "k", label: "Previous ticket" },
      { keys: "enter", label: "Open ticket" },
      { keys: "x", label: "Select ticket" },
      { keys: "e", label: "Solve focused ticket" },
      { keys: "r", label: "Open and reply" },
      { keys: "escape", label: "Close ticket or clear selection" },
    ],
  },
  {
    title: "Ticket",
    items: [
      { keys: "r", label: "Reply" },
      { keys: "n", label: "Add a note" },
      { keys: "a", label: "Assign" },
      { keys: "s", label: "Change status" },
      { keys: "p", label: "Change priority" },
      { keys: "t", label: "Move to team" },
      { keys: "h", label: "Snooze" },
      { keys: "e", label: "Solve" },
      { keys: "mod enter", label: "Send" },
      { keys: "mod j", label: "Draft a reply with Ollie, in the reply box" },
    ],
  },
];
