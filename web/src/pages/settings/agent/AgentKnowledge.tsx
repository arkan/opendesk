// Settings > AI agent > Knowledge: websites, files and Q&A snippets the agent
// (and drafts and copilot) answer from, besides the help center. Status moves
// live over realtime (ai_knowledge.*); a source opens in a drawer with its
// documents, settings and actions.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, BookOpen, ExternalLink, FileUp, Globe, MessageSquareQuote, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { Segmented } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { IconTile, ListSkeleton, MonoChip, SummaryStrip } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { SettingsEmpty } from "@/components/settings2/SettingsEmpty";
import { useListMutation } from "@/components/settings2/optimistic";
import { AgentOffNotice } from "@/components/agent/bits";
import { agentSettings } from "@/components/agent/settings";
import { FileDialog, fileProblem, KIND_ICON, KIND_TONE, SnippetDialog, sourceDetail, STATUS_TONE, WebsiteDialog } from "@/components/agent/knowledge";
import { api } from "@/lib/api/endpoints";
import type { KnowledgeDoc, KnowledgeKind, KnowledgeSource, Page } from "@/lib/api/types";
import { compact, fullDate, number, relShort } from "@/lib/format";
import { useAI } from "@/lib/ai";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

const CHAR_LIMIT = 20_000_000;
type Filter = "all" | KnowledgeKind;
type Editing = { kind: "website" | "snippet"; source: KnowledgeSource | null } | { kind: "file"; file: File | null } | null;

export default function AgentKnowledge() {
  const { t } = useTranslation("agent");
  const admin = atLeast(useRole(), "admin");
  const ai = useAI();
  const { data, isLoading } = useQuery(q.knowledge());
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const toggle = useListMutation<KnowledgeSource, { id: string; enabled: boolean }>(
    qk.knowledge,
    (v) => api.ai.knowledge.update(v.id, { enabled: v.enabled }),
    (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
    { errorText: t("knowledge.updateError") },
  );
  const remove = useListMutation<KnowledgeSource, string>(qk.knowledge, (id) => api.ai.knowledge.remove(id), (rows, id) => rows.filter((r) => r.id !== id), {
    errorText: t("knowledge.deleteError"),
  });
  const sync = useListMutation<KnowledgeSource, string>(
    qk.knowledge,
    (id) => api.ai.knowledge.sync(id),
    (rows, id) => rows.map((r) => (r.id === id ? { ...r, status: "syncing", error: null } : r)),
    { errorText: t("knowledge.syncError") },
  );

  const list = data ?? [];
  const shown = filter === "all" ? list : list.filter((s) => s.kind === filter);
  const open = list.find((s) => s.id === openId) ?? null;
  const count = (k: KnowledgeKind) => list.filter((s) => s.kind === k).length;
  const chars = list.reduce((n, s) => n + s.char_count, 0);
  const docs = list.reduce((n, s) => n + s.doc_count, 0);
  const busy = list.filter((s) => s.status === "syncing" || s.status === "pending").length;
  const failing = list.filter((s) => s.status === "error").length;

  const askDelete = (s: KnowledgeSource) =>
    confirm.show(
      <>
        {t("knowledge.deleteBody", { name: s.name })}
      </>,
      async () => {
        await remove.mutateAsync(s.id);
        if (openId === s.id) setOpenId(null);
      },
      { title: t("knowledge.deleteTitle"), confirmLabel: t("knowledge.delete"), danger: true },
    );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const p = fileProblem(f, t);
    if (p) return void toast.error(p);
    setEditing({ kind: "file", file: f });
  };

  const addMenu = (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="primary" icon={<Plus className="size-3.5" />}>
          {t("knowledge.add")}
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-[220px]">
        <MenuItem icon={<Globe />} onSelect={() => setEditing({ kind: "website", source: null })}>
          {t("knowledge.addWebsite")}
        </MenuItem>
        <MenuItem icon={<Upload />} onSelect={() => setEditing({ kind: "file", file: null })}>
          {t("knowledge.addFile")}
        </MenuItem>
        <MenuItem icon={<MessageSquareQuote />} onSelect={() => setEditing({ kind: "snippet", source: null })}>
          {t("knowledge.addSnippet")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );

  if (!admin)
    return (
      <SettingsPage title={t("knowledge.title")}>
        <NoAccess what={t("knowledge.what")} />
      </SettingsPage>
    );

  return (
    <SettingsPage wide title={t("knowledge.title")} description={t("knowledge.description")} actions={addMenu}>
      {ai.config && !agentSettings(ai.features).widget_answers && <AgentOffNotice className="-mb-3" />}
      {list.length > 0 && (
        <SummaryStrip
          items={[
            { label: t("knowledge.summary.sources"), value: number(list.length), hint: t("knowledge.summary.sourcesHint", { n: 50 }) },
            { label: t("knowledge.summary.docs"), value: number(docs), hint: t("knowledge.summary.docsHint", { n: number(5000) }) },
            {
              label: t("knowledge.summary.chars"),
              value: compact(chars),
              hint: t("knowledge.summary.charsHint", { pct: Math.min(100, Math.round((chars / CHAR_LIMIT) * 100)) }),
            },
            busy
              ? { label: t("knowledge.summary.syncing"), value: number(busy), tone: "violet" as const, hint: t("knowledge.summary.syncingHint") }
              : failing
                ? { label: t("knowledge.summary.failing"), value: number(failing), tone: "red" as const, hint: t("knowledge.summary.failingHint") }
                : { label: t("knowledge.summary.status"), value: t("knowledge.summary.upToDate"), tone: "green" as const },
          ]}
        />
      )}
      <div
        className="relative"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <Section
          flush
          title={data ? t("knowledge.count", { count: list.length }) : undefined}
          actions={
            list.length > 0 ? (
              <Segmented<Filter>
                size="xs"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: t("knowledge.filter.all") },
                  { value: "website", label: `${t("knowledge.filter.website")} ${count("website") || ""}`.trim() },
                  { value: "file", label: `${t("knowledge.filter.file")} ${count("file") || ""}`.trim() },
                  { value: "snippet", label: `${t("knowledge.filter.snippet")} ${count("snippet") || ""}`.trim() },
                ]}
              />
            ) : undefined
          }
        >
          {isLoading ? (
            <ListSkeleton rows={3} />
          ) : !list.length ? (
            <SettingsEmpty
              art="kb"
              title={t("knowledge.empty.title")}
              description={t("knowledge.empty.description")}
              action={
                <Button variant="primary" icon={<Globe className="size-3.5" />} onClick={() => setEditing({ kind: "website", source: null })}>
                  {t("knowledge.addWebsite")}
                </Button>
              }
              secondary={
                <Button icon={<Upload className="size-3.5" />} onClick={() => setEditing({ kind: "file", file: null })}>
                  {t("knowledge.addFile")}
                </Button>
              }
              tips={[
                { label: t("knowledge.empty.tipKb"), icon: <BookOpen /> },
                { label: t("knowledge.empty.tipDrop"), icon: <FileUp /> },
              ]}
            />
          ) : !shown.length ? (
            <div className="px-4 py-10 text-center text-[12.5px] text-fg-3">{t("knowledge.noneOfKind")}</div>
          ) : (
            <MotionList>
              {shown.map((s) => (
                <MotionRow key={s.id}>
                  <SourceRow
                    s={s}
                    onOpen={() => setOpenId(s.id)}
                    onToggle={(enabled) => toggle.mutate({ id: s.id, enabled })}
                    onSync={() => sync.mutate(s.id)}
                    onEdit={s.kind === "file" ? undefined : () => setEditing({ kind: s.kind as "website" | "snippet", source: s })}
                    onDelete={() => askDelete(s)}
                  />
                </MotionRow>
              ))}
            </MotionList>
          )}
        </Section>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex animate-fade-in items-center justify-center rounded-lg border-2 border-dashed border-tone-blue-line bg-[color-mix(in_srgb,var(--surface)_86%,transparent)]">
            <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <FileUp className="size-4 text-tone-blue" />
              {t("knowledge.file.dropNow")}
            </div>
          </div>
        )}
      </div>
      <p className="-mt-3 text-[12px] leading-[18px] text-fg-3">
        {t("knowledge.kbNote")}{" "}
        <Link to="/kb" className="text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
          {t("knowledge.kbLink")}
        </Link>
      </p>

      {editing?.kind === "website" && <WebsiteDialog source={editing.source} onClose={() => setEditing(null)} />}
      {editing?.kind === "snippet" && <SnippetDialog source={editing.source} onClose={() => setEditing(null)} />}
      {editing?.kind === "file" && <FileDialog initial={editing.file} onClose={() => setEditing(null)} />}
      <SourceDrawer
        source={open}
        onClose={() => setOpenId(null)}
        onToggle={(enabled) => open && toggle.mutate({ id: open.id, enabled })}
        onSync={() => open && sync.mutate(open.id)}
        onEdit={() => open && open.kind !== "file" && setEditing({ kind: open.kind, source: open })}
        onDelete={() => open && askDelete(open)}
      />
    </SettingsPage>
  );
}

function StatusPill({ s }: { s: KnowledgeSource }) {
  const { t } = useTranslation("agent");
  const hue = STATUS_TONE[s.status];
  const moving = s.status === "syncing" || s.status === "pending";
  const pill = (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-[11px] font-medium", tone[hue].chip)}>
      {s.status === "error" ? (
        <AlertCircle className="size-3" aria-hidden />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone[hue].solid, moving && "animate-pulse-soft motion-reduce:animate-none")} aria-hidden />
      )}
      {t(`knowledge.status.${s.status}`)}
    </span>
  );
  if (s.status === "error" && s.error) return <Tooltip content={s.error}>{pill}</Tooltip>;
  // A source answers from its last sync while it re-syncs.
  if (moving && s.last_synced_at) return <Tooltip content={t("knowledge.stillAnswering")}>{pill}</Tooltip>;
  return pill;
}

/** A thin violet bar sweeping under a source while it syncs. */
function SyncBar({ className }: { className?: string }) {
  return (
    <div className={cn("h-[2px] overflow-hidden rounded-full bg-tone-violet-soft", className)} aria-hidden>
      <div className={cn("h-full w-1/3 rounded-full motion-reduce:hidden", tone.violet.solid)} style={{ animation: "pending-bar 1.4s ease-in-out infinite" }} />
    </div>
  );
}

function Figures({ s }: { s: KnowledgeSource }) {
  const { t } = useTranslation("agent");
  if (s.kind === "snippet") return <span className="text-fg-4">{t("knowledge.snippetDoc")}</span>;
  return (
    <span className="mono tabular-nums">
      {t("knowledge.docs", { count: s.doc_count, n: number(s.doc_count) })} · {compact(s.char_count)}
    </span>
  );
}

function SourceRow({
  s,
  onOpen,
  onToggle,
  onSync,
  onEdit,
  onDelete,
}: {
  s: KnowledgeSource;
  onOpen: () => void;
  onToggle: (v: boolean) => void;
  onSync: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("agent");
  const Icon = KIND_ICON[s.kind];
  const moving = s.status === "syncing" || s.status === "pending";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken md:grid md:grid-cols-[minmax(0,1fr)_150px_96px_92px_64px] md:gap-4"
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-3", !s.enabled && "opacity-60")}>
        <IconTile tone={KIND_TONE[s.kind]}>
          <Icon />
        </IconTile>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium text-fg">{s.name}</div>
          <div className={cn("truncate text-[12px] text-fg-3", s.kind === "website" && "mono text-[11.5px]")}>
            {s.status === "error" && s.error ? <span className="text-danger-fg">{s.error}</span> : sourceDetail(s)}
          </div>
        </div>
      </div>
      <span className="hidden text-[11.5px] text-fg-3 md:block">
        <Figures s={s} />
      </span>
      <span className="mono hidden text-[11.5px] text-fg-3 md:block">
        {s.last_synced_at ? (
          <Tooltip content={fullDate(s.last_synced_at)}>
            <span>{relShort(s.last_synced_at)}</span>
          </Tooltip>
        ) : (
          <span className="text-fg-4">{t("knowledge.never")}</span>
        )}
      </span>
      <span>
        <StatusPill s={s} />
      </span>
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Switch checked={s.enabled} onCheckedChange={onToggle} aria-label={t("knowledge.useFor", { name: s.name })} />
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t("knowledge.actions", { name: s.name })}
              className="flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent>
            {s.kind !== "snippet" && (
              <MenuItem icon={<RefreshCw />} disabled={moving} onSelect={onSync}>
                {t("knowledge.sync")}
              </MenuItem>
            )}
            {onEdit && (
              <MenuItem icon={<Pencil />} onSelect={onEdit}>
                {t("knowledge.edit")}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 />} onSelect={onDelete}>
              {t("knowledge.delete")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {moving && <SyncBar className="absolute inset-x-4 bottom-0" />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label-caps">{label}</div>
      <div className="mt-1 truncate text-[12.5px] text-fg">{children}</div>
    </div>
  );
}

function SourceDrawer({
  source: s,
  onClose,
  onToggle,
  onSync,
  onEdit,
  onDelete,
}: {
  source: KnowledgeSource | null;
  onClose: () => void;
  onToggle: (v: boolean) => void;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("agent");
  const Icon = s ? KIND_ICON[s.kind] : Globe;
  const moving = s?.status === "syncing" || s?.status === "pending";
  return (
    <Drawer
      open={!!s}
      onOpenChange={(o) => !o && onClose()}
      title={s?.name ?? t("knowledge.title")}
      width={560}
      header={
        s ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <IconTile size="sm" tone={KIND_TONE[s.kind]}>
              <Icon />
            </IconTile>
            <span className="truncate text-sm font-medium">{s.name}</span>
            <StatusPill s={s} />
          </div>
        ) : null
      }
    >
      {s && (
        <div className="flex flex-col">
          {moving && <SyncBar className="mx-5 mt-0" />}
          <div className="flex flex-col gap-5 px-5 py-4">
            {s.status === "error" && s.error && (
              <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12.5px]", tone.red.soft, tone.red.line)} role="alert">
                <AlertCircle className="mt-px size-3.5 shrink-0 text-tone-red" />
                <span className="text-fg">{s.error}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {s.kind !== "snippet" && (
                <Button icon={<RefreshCw className={cn("size-3.5", moving && "animate-spin motion-reduce:animate-none")} />} disabled={moving} onClick={onSync}>
                  {moving ? t("knowledge.syncing") : t("knowledge.sync")}
                </Button>
              )}
              {s.kind !== "file" && (
                <Button icon={<Pencil className="size-3.5" />} onClick={onEdit}>
                  {s.kind === "website" ? t("knowledge.editCrawl") : t("knowledge.edit")}
                </Button>
              )}
              <label className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-2">
                {t("knowledge.useForAnswers")}
                <Switch checked={s.enabled} onCheckedChange={onToggle} aria-label={t("knowledge.useForAnswers")} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-sunken px-4 py-3 sm:grid-cols-4">
              <Fact label={t("knowledge.fact.docs")}>{number(s.doc_count)}</Fact>
              <Fact label={t("knowledge.fact.chars")}>{number(s.char_count)}</Fact>
              <Fact label={t("knowledge.fact.synced")}>{s.last_synced_at ? relShort(s.last_synced_at) : t("knowledge.never")}</Fact>
              <Fact label={t("knowledge.fact.added")}>{relShort(s.created_at)}</Fact>
            </div>

            {s.kind === "website" && s.website && (
              <div className="flex flex-col gap-3">
                <a
                  href={s.website.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono inline-flex min-w-0 items-center gap-1.5 text-[12px] text-fg-2 hover:text-fg"
                >
                  <span className="truncate">{s.website.url}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-fg-3">
                  <span>{t("knowledge.upTo", { n: number(s.website.max_pages) })}</span>
                  <span>{s.website.recrawl === "weekly" ? t("knowledge.recrawlWeekly") : t("knowledge.recrawlOff")}</span>
                </div>
                {(s.website.include.length > 0 || s.website.exclude.length > 0) && (
                  <div className="flex flex-col gap-1.5">
                    {s.website.include.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-[11.5px] text-fg-3">{t("knowledge.only")}</span>
                        {s.website.include.map((p) => (
                          <MonoChip key={p}>{p}</MonoChip>
                        ))}
                      </div>
                    )}
                    {s.website.exclude.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-[11.5px] text-fg-3">{t("knowledge.skip")}</span>
                        {s.website.exclude.map((p) => (
                          <MonoChip key={p}>{p}</MonoChip>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {s.kind === "snippet" && s.snippet && (
              <div className="flex flex-col gap-2 rounded-lg border border-line px-4 py-3">
                <div className="text-[12.5px] font-medium text-fg">{s.snippet.question}</div>
                <div className="whitespace-pre-wrap text-[12.5px] leading-[19px] text-fg-2">{s.snippet.answer}</div>
              </div>
            )}

            {s.kind === "file" && s.file && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-fg-3">
                <span className="mono truncate text-fg-2">{s.file.filename}</span>
                <span>{s.file.content_type}</span>
              </div>
            )}

            {s.kind !== "snippet" && <Docs source={s} />}

            <div className="mt-2 border-t border-line-soft pt-4">
              <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                {t("knowledge.deleteSource")}
              </Button>
              <p className="mt-2 text-xs text-fg-3">{t("knowledge.deleteHint")}</p>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Docs({ source }: { source: KnowledgeSource }) {
  const { t } = useTranslation("agent");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const docs = useInfiniteQuery(q.knowledgeDocs(source.id));
  const rows = docs.data?.pages.flatMap((p) => p.data) ?? [];

  const remove = useMutation({
    mutationFn: (d: KnowledgeDoc) => api.ai.knowledge.removeDoc(source.id, d.id),
    onMutate: async (d) => {
      const key = qk.knowledgeDocs(source.id);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InfiniteData<Page<KnowledgeDoc>>>(key);
      if (prev) qc.setQueryData(key, { ...prev, pages: prev.pages.map((p) => ({ ...p, data: p.data.filter((x) => x.id !== d.id) })) });
      return { prev };
    },
    onError: (e, _d, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.knowledgeDocs(source.id), ctx.prev);
      toast.error(e, t("knowledge.docDeleteError"));
    },
    onSuccess: () => toast.success(t("knowledge.docDeleted")),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.knowledge, exact: true }),
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-2">
        <span className="label-caps">{t("knowledge.documents")}</span>
        <span className="mono text-[10.5px] tabular-nums text-fg-4">{number(source.doc_count)}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        {docs.isLoading ? (
          <ListSkeleton rows={3} />
        ) : !rows.length ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-fg-3">
            {source.status === "syncing" || source.status === "pending" ? t("knowledge.docsComing") : t("knowledge.noDocs")}
          </div>
        ) : (
          <ul>
            {rows.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-fg">{d.title || d.url || t("knowledge.untitled")}</div>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="mono block truncate text-[11px] text-fg-3 hover:text-fg">
                      {d.url.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
                <span className="mono shrink-0 text-[11px] tabular-nums text-fg-4">{compact(d.chars)}</span>
                <Button
                  square
                  size="xs"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t("knowledge.removeDoc", { title: d.title })}
                  onClick={() =>
                    confirm.show(source.kind === "website" ? t("knowledge.removeDocWebsite") : t("knowledge.removeDocBody"), () => remove.mutateAsync(d), {
                      title: t("knowledge.removeDocTitle"),
                      confirmLabel: t("knowledge.removeDocConfirm"),
                      danger: true,
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {docs.hasNextPage && (
        <Button size="xs" variant="ghost" className="mt-2 self-center" loading={docs.isFetchingNextPage} onClick={() => void docs.fetchNextPage()}>
          {t("knowledge.moreDocs")}
        </Button>
      )}
    </div>
  );
}
