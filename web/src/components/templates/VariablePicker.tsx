import { templateText } from "./text";
import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
// A searchable list of the template variables, grouped, with what each reads.
// Used as the "Variables" button of template editors and as the reference tab.

import { useQuery } from "@tanstack/react-query";
import { BookOpen, Braces, Check, Copy, GitBranch, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { copyText } from "@/components/ui/copy-button";
import type { TemplateKind, TemplateVariable } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";
import { GROUP_LABELS, GROUP_ORDER, tagFor, useCatalog } from "./catalog";
import { matchVars } from "./extension";
import { matchSnippets } from "./snippets";

type Row = { key: string; label: string; group: string; description: string; example: string; html?: boolean; list?: boolean; slot?: boolean };

function rowsOf(variables: TemplateVariable[], slots: { key: string; label: string; description: string }[]): Row[] {
  return [
    ...slots.map((s) => ({ key: s.key, label: s.label, group: "slot", description: s.description, example: "", slot: true })),
    ...variables.map((v) => ({ ...v })),
  ];
}

const groupLabel = (g: string) => (g === "slot" ? templateText("Places") : (GROUP_LABELS[g as keyof typeof GROUP_LABELS] ?? g));

/** The grouped list itself. */
export function VariableList({
  kind = "reply",
  onPick,
  values,
  autoFocus,
  className,
  copy,
}: {
  kind?: TemplateKind;
  onPick?: (key: string) => void;
  /** A ticket's values, shown instead of the examples. */
  values?: Record<string, string>;
  autoFocus?: boolean;
  className?: string;
  /** Rows copy their tag on click (the reference). */
  copy?: boolean;
}) {
  useTranslation(["app", "templatesUi"]);
  const { variables, slots, loading } = useCatalog(kind);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const rows = matchVars(rowsOf(variables, slots), query.trim(), groupLabel);
  const groups = ["slot", ...GROUP_ORDER]
    .map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0);

  const pick = (key: string) => {
    if (copy) {
      void copyText(tagFor(key));
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    }
    onPick?.(key);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="p-2 pb-1.5">
        <SearchInput value={query} onChange={setQuery} placeholder={appText("Search variables")} autoFocus={autoFocus} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {loading && <div className="px-2 py-3 text-xs text-fg-3">{appText("Loading variables…")}</div>}
        {!loading && groups.length === 0 && <div className="px-2 py-3 text-xs text-fg-3">{appText("No variables match “")}{query}”</div>}
        {groups.map((g) => (
          <div key={g.group} className="pb-1">
            <div className="label-caps px-2 pb-1 pt-2">{groupLabel(g.group)}</div>
            {g.rows.map((r) => {
              const value = values?.[r.key];
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => pick(r.key)}
                  className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12.5px] text-fg">
                      {r.label}
                      {r.html && <span className="rounded-sm bg-hover px-1 text-[10px] text-fg-3">HTML</span>}
                      {r.list && <span className="rounded-sm bg-hover px-1 text-[10px] text-fg-3">{appText("List")}</span>}
                    </span>
                    <span className="mono block truncate text-[11px] text-fg-3">{tagFor(r.key)}</span>
                    <span className="block text-[11.5px] leading-4 text-fg-4">{r.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {values ? (
                      <span className={cn("max-w-[120px] truncate text-[11.5px]", value ? "text-fg-2" : "italic text-fg-4")} data-ph-mask>
                        {value ? (r.html ? templateText("Set") : value) : templateText("empty")}
                      </span>
                    ) : (
                      r.example && <span className="max-w-[120px] truncate text-[11.5px] text-fg-4">{r.example}</span>
                    )}
                    {copy && (copied === r.key ? <Check className="size-3.5 text-tone-green" /> : <Copy className="size-3.5 text-fg-4 opacity-0 group-hover:opacity-100" />)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ready-made logic: if, case, loops… */
function LogicList({ onInsert }: { onInsert: (code: string, select?: string) => void }) {
  useTranslation(["app", "templatesUi"]);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const list = matchSnippets(query);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2 pb-1.5">
        <SearchInput value={query} onChange={setQuery} placeholder={appText("Search logic")} autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {list.length === 0 && <div className="px-2 py-3 text-xs text-fg-3">{appText("Nothing matches “")}{query}”</div>}
        {list.map((sn) => (
          <button
            key={sn.id}
            type="button"
            onClick={() => onInsert(sn.code, sn.select)}
            onMouseEnter={() => setHover(sn.id)}
            onFocus={() => setHover(sn.id)}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
          >
            <GitBranch className="mt-0.5 size-3.5 shrink-0 text-tone-violet" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px]">{sn.label}</span>
              <span className="block text-[11.5px] leading-4 text-fg-3">{sn.description}</span>
              {hover === sn.id && <span className="mono mt-1 block break-words text-[10.5px] leading-[15px] text-fg-4">{sn.code}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const FILTER_GROUP_LABELS: Record<string, string> = { text: "Text", list: "Lists", number: "Numbers", date: "Dates" };

/** The helpers (filters), each inserting its example. */
function HelperList({ onInsert }: { onInsert: (code: string, select?: string) => void }) {
  useTranslation(["app", "templatesUi"]);
  const { data } = useQuery(q.templateVariables());
  const [query, setQuery] = useState("");
  const ql = query.toLowerCase().trim();
  const filters = (data?.filters ?? []).map((f) => ({ ...f, description: templateText(f.description) })).filter((f) => !ql || f.name.includes(ql) || f.description.toLowerCase().includes(ql));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2 pb-1.5">
        <SearchInput value={query} onChange={setQuery} placeholder={appText("Search helpers")} autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {filters.length === 0 && <div className="px-2 py-3 text-xs text-fg-3">{appText("Nothing matches “")}{query}”</div>}
        {(["text", "list", "number", "date"] as const).map((g) => {
          const rows = filters.filter((f) => f.group === g);
          if (!rows.length) return null;
          return (
            <div key={g} className="pb-1">
              <div className="label-caps px-2 pb-1 pt-2">{templateText(FILTER_GROUP_LABELS[g])}</div>
              {rows.map((f) => {
                const arg = f.args && f.example.includes(f.args) ? f.args : undefined;
                return (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onInsert(f.example, arg)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
                  >
                    <Wand2 className="mt-0.5 size-3.5 shrink-0 text-tone-blue" />
                    <span className="min-w-0 flex-1">
                      <span className="mono block text-[12px]">
                        {f.name}
                        {f.args && <span className="text-fg-4">: {f.args}</span>}
                      </span>
                      <span className="block text-[11.5px] leading-4 text-fg-3">{f.description}</span>
                      <span className="mono mt-0.5 block truncate text-[10.5px] text-fg-4">{f.example}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Insert button of an editor toolbar: variables, and with `onInsert` also
 * ready-made logic and helpers.
 */
export function VariablePicker({
  kind,
  onPick,
  onInsert,
  trigger,
  side = "top",
}: {
  kind?: TemplateKind;
  onPick: (key: string) => void;
  /** Writes code and selects `select`; turns on the Logic and Helpers tabs. */
  onInsert?: (code: string, select?: string) => void;
  trigger?: ReactNode;
  side?: "top" | "bottom";
}) {
  useTranslation(["app", "templatesUi"]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"variables" | "logic" | "helpers">("variables");
  const done = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTab("variables");
      }}
      side={side}
      align="end"
      className="flex h-[400px] w-[360px] flex-col p-0"
      trigger={
        trigger ?? (
          <Tooltip content={templateText(onInsert ? "Insert a variable, logic or a helper. Or type {{ or {%" : "Insert a variable, or type {{")}>
            <button
              type="button"
              aria-label={templateText(onInsert ? "Insert" : "Insert a variable")}
              onMouseDown={(e) => e.preventDefault()}
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-fg-3 transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover [&_svg]:size-[15px]"
            >
              <Braces />
              {templateText(onInsert ? "Insert" : "Variables")}
            </button>
          </Tooltip>
        )
      }
    >
      {onInsert && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <Segmented
            size="xs"
            value={tab}
            onChange={setTab}
            className="w-full [&>button]:flex-1 [&>button]:justify-center"
            options={[
              { value: "variables", label: templateText("Variables") },
              { value: "logic", label: templateText("Logic") },
              { value: "helpers", label: templateText("Helpers") },
            ]}
          />
        </div>
      )}
      {tab === "variables" || !onInsert ? (
        <VariableList kind={kind} autoFocus className="min-h-0 flex-1" onPick={(k) => done(() => onPick(k))} />
      ) : tab === "logic" ? (
        <LogicList onInsert={(c, sel) => done(() => onInsert(c, sel))} />
      ) : (
        <HelperList onInsert={(c, sel) => done(() => onInsert(c, sel))} />
      )}
      <a
        href="https://docs.opendesk.sh/guides/email-templates/variables/"
        target="_blank"
        rel="noreferrer"
        className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2 text-[12px] text-fg-3 transition-colors hover:text-fg"
      >
        <BookOpen className="size-3.5" />

        {appText("Template guide: conditions, loops and every variable")}
      </a>
    </Popover>
  );
}
