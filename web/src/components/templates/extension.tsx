import { useTranslation } from "react-i18next";
// Template tags in the rich editor: every {{ variable }} and {% tag %} shows as a
// soft pill (red when unknown), and typing "{{" offers the variables. The
// document keeps tags as plain text, so what is saved is what was typed.

import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { Braces, GitBranch, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { placeBelowOrAbove, useCaretAnchor } from "@/components/editor/anchor";
import { cn } from "@/lib/cn";
import { localNames, TAG_RE, tagState } from "./catalog";
import { matchSnippets } from "./snippets";

export type VarItem = {
  key: string;
  label: string;
  group: string;
  value?: string;
  /** var (default): a variable; snippet: ready-made logic; filter: a helper after |. */
  kind?: "var" | "snippet" | "filter";
  description?: string;
  /** What a snippet or helper writes, and the part selected after. */
  code?: string;
  select?: string;
};

type State = {
  open: boolean;
  items: VarItem[];
  index: number;
  /** The caret's rect, read again as the page scrolls. */
  getRect: (() => DOMRect | null) | null;
  anchorEl: HTMLElement | null;
  pick: ((item: VarItem) => void) | null;
  /** "values" shows this ticket's values; "examples" sample values. */
  valueLabel: string;
  title: string;
};

export const useVarSuggest = create<State>(() => ({ open: false, items: [], index: 0, getRect: null, anchorEl: null, pick: null, valueLabel: "", title: "Variables" }));
// Closed by Escape or a click outside: stays closed until "{{" is typed again.
const dismiss = () => useVarSuggest.setState({ open: false });

const highlightKey = new PluginKey("template-tags");
const suggestKey = new PluginKey("template-suggest");
const logicKey = new PluginKey("template-logic");

function decorate(doc: PMNode, known: () => Set<string> | null): DecorationSet {
  const decos: Decoration[] = [];
  const set = known();
  const locals = localNames(doc.textContent);
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(TAG_RE)) {
      const from = pos + (m.index ?? 0);
      const state = tagState(m[0], set, locals);
      decos.push(Decoration.inline(from, from + m[0].length, { class: cn("tpl-tag", state === "logic" && "tpl-logic", state === "bad" && "tpl-bad") }));
    }
  });
  return DecorationSet.create(doc, decos);
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Writes code at range (or the selection) and selects its `select` part, so typing replaces it. */
export function insertCode(editor: Editor, code: string, select?: string, range?: Range) {
  const from = range?.from ?? editor.state.selection.from;
  const chain = editor.chain().focus();
  (range ? chain.deleteRange(range) : chain).insertContent(escapeHtml(code)).run();
  const i = select ? code.indexOf(select) : -1;
  if (select && i >= 0) editor.commands.setTextSelection({ from: from + i, to: from + i + select.length });
}

export type FilterInfo = { name: string; args: string; description: string };

function filterItems(filters: FilterInfo[], query: string): VarItem[] {
  const pipe = query.lastIndexOf("|");
  const head = query.slice(0, pipe).trim();
  const q = query.slice(pipe + 1).trim().toLowerCase();
  return filters
    .filter((f) => !q || f.name.includes(q) || f.description.toLowerCase().includes(q))
    .map((f) => ({
      kind: "filter" as const,
      key: f.name,
      label: f.name,
      group: "Helper",
      description: f.description,
      code: `{{ ${head || "contact.first_name"} | ${f.name}${f.args ? `: ${f.args}` : ""} }}`,
      select: f.args || undefined,
    }));
}

function snippetItems(query: string): VarItem[] {
  return matchSnippets(query).map((sn) => ({ kind: "snippet" as const, key: sn.id, label: sn.label, group: "Logic", description: sn.description, code: sn.code, select: sn.select }));
}

function listRender(opts: { valueLabel?: string }, title: string) {
  return () => ({
    onStart: (p: SuggestionProps<VarItem>) =>
      useVarSuggest.setState({
        open: true,
        items: p.items,
        index: 0,
        getRect: p.clientRect ?? null,
        anchorEl: p.editor.view.dom,
        pick: (i) => p.command(i),
        valueLabel: title === "Variables" ? (opts.valueLabel ?? "") : "",
        title: p.items[0]?.kind === "filter" ? "Helpers" : title,
      }),
    onUpdate: (p: SuggestionProps<VarItem>) =>
      useVarSuggest.setState((s) => ({
        items: p.items,
        index: Math.min(s.index, Math.max(0, p.items.length - 1)),
        getRect: p.clientRect ?? s.getRect,
        pick: (i) => p.command(i),
        title: p.items[0]?.kind === "filter" ? "Helpers" : title,
      })),
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      const s = useVarSuggest.getState();
      if (!s.open) return false;
      if (event.key === "Escape") {
        dismiss();
        return true;
      }
      if (!s.items.length) return false;
      if (event.key === "ArrowDown") {
        useVarSuggest.setState({ index: (s.index + 1) % s.items.length });
        return true;
      }
      if (event.key === "ArrowUp") {
        useVarSuggest.setState({ index: (s.index - 1 + s.items.length) % s.items.length });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        s.pick?.(s.items[s.index]);
        return true;
      }
      return false;
    },
    onExit: () => useVarSuggest.setState({ open: false, pick: null, getRect: null, anchorEl: null }),
  });
}

/**
 * The extension. `known` is the set of keys this template may read (null while
 * loading: nothing is marked unknown). `items` lists the variables for a query;
 * `insert` decides what a picked variable writes (a tag, or this ticket's value).
 * "{{" offers variables, and helpers after a "|"; "{%" offers ready-made logic.
 */
export function templateExtension(opts: {
  known: () => Set<string> | null;
  items: (query: string) => VarItem[];
  insert?: (item: VarItem) => string;
  filters?: () => FilterInfo[];
  valueLabel?: string;
  enabled?: () => boolean;
}) {
  // A finished tag closes the list: typing on after "}}" is ordinary text.
  const open = (closer: string) => ({ state, range }: { state: { doc: PMNode }; range: Range }) =>
    (opts.enabled?.() ?? true) && !state.doc.textBetween(range.from, range.to).slice(2).includes(closer);
  const pickCode = (editor: Editor, range: Range, item: VarItem) => insertCode(editor, item.code ?? "", item.select, range);
  return Extension.create({
    name: "templateTags",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: highlightKey,
          state: {
            init: (_, { doc }) => decorate(doc, opts.known),
            apply: (tr, old) => (tr.docChanged || tr.getMeta(highlightKey) ? decorate(tr.doc, opts.known) : old.map(tr.mapping, tr.doc)),
          },
          props: { decorations: (state) => highlightKey.getState(state) as DecorationSet },
        }),
        Suggestion<VarItem>({
          editor,
          pluginKey: suggestKey,
          char: "{{",
          allowSpaces: true,
          allowedPrefixes: null,
          allow: open("}}"),
          items: ({ query }) => {
            const q = query.replace(/\}+$/, "");
            if (q.includes("|")) return filterItems(opts.filters?.() ?? [], q).slice(0, 40);
            return opts.items(q.trim()).slice(0, 40);
          },
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: VarItem }) => {
            if (props.kind === "filter") return pickCode(editor, range, props);
            const text = opts.insert ? opts.insert(props) : `{{ ${props.key} }}`;
            editor.chain().focus().deleteRange(range).insertContent(escapeHtml(text)).run();
          },
          render: listRender(opts, "Variables"),
        }),
        Suggestion<VarItem>({
          editor,
          pluginKey: logicKey,
          char: "{%",
          allowSpaces: true,
          allowedPrefixes: null,
          allow: open("%}"),
          items: ({ query }) => snippetItems(query.replace(/%?\}*$/, "")),
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: VarItem }) => pickCode(editor, range, props),
          render: listRender(opts, "Logic"),
        }),
      ];
    },
  });
}

/** Re-marks unknown tags after the variable list loads. */
export function refreshTags(editor: Editor | null | undefined) {
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(highlightKey, true));
}

/** Matches variables by key, label or group. */
export function matchVars<T extends { key: string; label: string; group: string }>(list: T[], query: string, groupLabel: (g: string) => string): T[] {
  const q = query.toLowerCase();
  if (!q) return list;
  return list.filter((v) => v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q) || groupLabel(v.group).toLowerCase().includes(q));
}

/** The floating list; mount once next to the editor. */
export function VarSuggestPopup() {
  const { t: ui } = useTranslation("ui");
  const { open, items, index, getRect, anchorEl, pick, valueLabel, title } = useVarSuggest();
  const ref = useRef<HTMLDivElement>(null);
  const rect = useCaretAnchor({ open, getRect, anchorEl, popupRef: ref, onDismiss: dismiss });
  useEffect(() => {
    ref.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);
  if (!open || !rect) return null;
  const tip =
    title === "Variables"
      ? ui("templateSyntaxHint")
      : title === "Logic"
        ? ui("insertsWorkingCodeWithThePartToChangeSelected")
        : ui("helpersChangeAValueLeftToRight");
  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label={title === "Variables" ? ui("variables") : title === "Logic" ? ui("logic") : ui("helpers")}
      data-floating
      style={placeBelowOrAbove(rect, 340, 320)}
      className="pointer-events-auto z-[80] flex max-h-[320px] w-[340px] flex-col overflow-hidden rounded-lg border border-line bg-raised shadow-pop animate-pop-in motion-reduce:animate-none"
    >
      <div className="label-caps flex shrink-0 items-center justify-between px-3 pb-1 pt-2">
        <span>{title === "Variables" ? ui("variables") : title === "Logic" ? ui("logic") : ui("helpers")}</span>
        {valueLabel && <span className="normal-case tracking-normal text-fg-4">{valueLabel}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {items.length === 0 ? (
          <div className="px-2 py-3 text-xs text-fg-3">{ui("nothingMatches")}</div>
        ) : (
          items.map((it, i) => (
            <button
              key={`${it.kind ?? "var"}-${it.key}`}
              type="button"
              data-i={i}
              role="option"
              aria-selected={i === index}
              onMouseDown={(e) => {
                e.preventDefault();
                pick?.(it);
              }}
              onMouseEnter={() => useVarSuggest.setState({ index: i })}
              className={cn("flex min-h-8 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]", i === index && "bg-hover")}
            >
              {it.kind === "snippet" ? (
                <GitBranch className="mt-0.5 size-3.5 shrink-0 text-tone-violet" />
              ) : it.kind === "filter" ? (
                <Wand2 className="mt-0.5 size-3.5 shrink-0 text-tone-blue" />
              ) : (
                <Braces className="mt-0.5 size-3.5 shrink-0 text-fg-4" />
              )}
              <span className="min-w-0 flex-1">
                {it.kind === "snippet" || it.kind === "filter" ? (
                  <>
                    <span className={cn("block truncate", it.kind === "filter" && "mono text-[12px]")}>{it.label}</span>
                    <span className="block text-[11.5px] leading-4 text-fg-3">{it.description}</span>
                    {i === index && it.code && <span className="mono mt-1 block break-words text-[10.5px] leading-[15px] text-fg-4">{it.code}</span>}
                  </>
                ) : (
                  <>
                    <span className="block truncate">
                      <span className="text-fg-3">{it.group} · </span>
                      {it.label}
                    </span>
                    <span className="mono block truncate text-[10.5px] text-fg-4">{it.key}</span>
                  </>
                )}
              </span>
              {it.value !== undefined && (
                <span className={cn("max-w-[110px] shrink-0 truncate pt-0.5 text-[11.5px]", it.value ? "text-fg-2" : "italic text-fg-4")} data-ph-mask>
                  {it.value || "empty"}
                </span>
              )}
            </button>
          ))
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-fg-4">
        <span className="min-w-0 flex-1 truncate">{tip}</span>
        <a
          href="https://docs.opendesk.sh/guides/email-templates/variables/"
          target="_blank"
          rel="noreferrer"
          onMouseDown={(e) => e.preventDefault()}
          className="shrink-0 text-fg-3 underline-offset-2 hover:text-fg hover:underline"
        >
          {ui("guide")}
        </a>
      </div>
    </div>,
    document.body,
  );
}
