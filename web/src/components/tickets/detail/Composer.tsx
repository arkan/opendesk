import { useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check, ChevronDown, Loader2, Lock, MessageSquareText, Paperclip, TriangleAlert, X } from "lucide-react";
import { Morph } from "@/components/motion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { tone } from "@/lib/tones";
import { create } from "zustand";
import { DropdownMenu as M } from "radix-ui";
import type { Activity, Attachment, Mailbox, Member, Message, SavedReply, Ticket, TicketStatus } from "@/lib/api/types";
import { api, type SendMessageBody } from "@/lib/api/endpoints";
import { draftApi, draftIdentity, draftKey, type DraftContent, type DraftPreview, type TicketDraft } from "@/lib/api/drafts";
import { useSharedDraft } from "./useSharedDraft";
import { Dialog } from "@/components/ui/dialog";
import { sanitizeHtml } from "@/lib/sanitize";
import { errorMessage } from "@/lib/api/client";
import { q, qk } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { realtime } from "@/lib/realtime/manager";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { keyName } from "@/lib/hotkeys";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { Picker } from "@/components/ui/picker";
import { Tooltip } from "@/components/ui/tooltip";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { floatingPanel } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { RichEditor, type RichEditorHandle } from "@/components/editor/RichEditor";
import { mentionExtension, savedReplyExtension, SuggestionPopup } from "./suggestions";
import { GROUP_LABELS, useCatalog } from "@/components/templates/catalog";
import { matchVars, refreshTags, templateExtension, VarSuggestPopup, type VarItem } from "@/components/templates/extension";
import { variableText } from "./composerTemplates";
import { SignaturePreview } from "./SignaturePreview";
import { StatusIcon, statusLabel } from "../bits";
import { useTicketViewers } from "../presence";
import { applyPatch } from "../useTicketActions";
import { patchTicketEverywhere } from "@/lib/ticketCache";
import { ComposerAiMenu, ComposerAiStatus, ComposerSources, useComposerAi } from "@/components/ai/ticket/ComposerAi";
import { SuggestedReplyCard } from "./SuggestedReply";
import { addressLabel, fromLine, replyAddresses, TeamDot, useTeamsCtx, type TeamsCtx } from "../teams";

type Mode = "reply" | "note";
type Upload = { key: string; file: File; status: "uploading" | "done" | "error"; attachment?: Attachment; preview?: string };
/** mailboxId: this reply goes out from another address (it becomes the ticket's reply address). */
type Draft = { mode: Mode; html: string; cc: string[]; bcc: string[]; showCc: boolean; mailboxId?: string };

// Drafts survive switching tickets (memory only).
const useDrafts = create<Record<string, Draft>>(() => ({}));
const emptyDraft: Draft = { mode: "reply", html: "", cc: [], bcc: [], showCc: false };

export type ComposerHandle = { focus: (mode?: Mode) => void; retry: (m: Message) => void; aiDraft: () => void };

const emailRe = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function EmailChips({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const ok = parts.filter((p) => emailRe.test(p) && !values.includes(p));
    if (ok.length) onChange([...values, ...ok]);
    setText(parts.filter((p) => !emailRe.test(p)).join(" "));
  };
  return (
    <div className="flex min-h-8 items-center gap-2 border-b border-line-soft px-3">
      <span className="w-7 shrink-0 text-xs text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
        {values.map((v) => (
          <span key={v} className="mono inline-flex h-5 items-center gap-1 rounded-sm bg-hover pl-1.5 pr-0.5 text-[11.5px] animate-pop-in motion-reduce:animate-none" data-ph-mask>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="flex size-4 items-center justify-center rounded-xs text-fg-4 hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
              if (text.trim()) {
                e.preventDefault();
                commit();
              }
            }
            if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
          }}
          aria-label={label}
          placeholder={values.length ? "" : "name@example.com"}
          className="h-6 min-w-[120px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-fg-4"
        />
      </div>
    </div>
  );
}

function useSend(ticket: Ticket, ctx: TeamsCtx) {
  const qc = useQueryClient();
  const user = useSession((s) => s.user!);
  return useMutation({
    mutationFn: (v: { body: SendMessageBody; tempId: string }) => api.tickets.send(ticket.id, v.body),
    onMutate: ({ body, tempId }) => {
      const now = new Date().toISOString();
      const mb = body.kind === "reply" ? ctx.mailbox(body.mailbox_id ?? ticket.mailbox_id) : undefined;
      const from = mb ? fromLine(ctx, ticket, mb, user.name) : null;
      const temp: Message = {
        id: tempId,
        ticket_id: ticket.id,
        ai: false,
        kind: body.kind,
        direction: "outbound",
        author: { type: "user", user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url }, contact: null },
        body_html: body.body_html,
        body_text: "",
        has_quoted: false,
        subject: ticket.subject,
        from_email: from?.email ?? "",
        from_name: from?.name ?? user.name,
        mailbox_id: mb?.id ?? null,
        to: body.kind === "reply" && ticket.contact?.email ? [ticket.contact.email] : [],
        cc: body.cc ?? [],
        bcc: body.bcc ?? [],
        attachments: [],
        delivery_status: body.kind === "reply" ? "pending" : "none",
        delivery_error: "",
        created_at: now,
      };
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => [...(old ?? []), temp]);
      const prevTicket = qc.getQueryData<Ticket>(qk.ticket(ticket.id));
      if ((body.status || body.mailbox_id) && prevTicket)
        patchTicketEverywhere(qc, applyPatch(qc, prevTicket, { status: body.status, mailbox_id: body.mailbox_id }), user.id);
      return { prevTicket };
    },
    onSuccess: (m, { tempId }) => {
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => {
        // The socket may have delivered this message (and its delivery status) before
        // the response arrived; that copy is newer than the response.
        const live = (old ?? []).find((x) => x.id === m.id);
        const rest = (old ?? []).filter((x) => x.id !== tempId && x.id !== m.id);
        return [...rest, live ?? m].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      });
    },
    onError: (e, { tempId }, ctx) => {
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) =>
        old?.map((x) => (x.id === tempId ? { ...x, delivery_status: "failed", delivery_error: errorMessage(e, "Not sent") } : x)),
      );
      if (ctx?.prevTicket) patchTicketEverywhere(qc, ctx.prevTicket, user.id);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.counts }),
  });
}

export const Composer = forwardRef<ComposerHandle, { ticket: Ticket; disabled?: boolean }>(function Composer({ ticket, disabled }, ref) {
  const { t } = useTranslation("inbox");
  const reduced = useReducedMotion();
  // Writing: focus went into the editor and has not left the composer since.
  // Focus on the controls above the editor (mode, Cc, the reply address) does not
  // open it up: growing moves those controls under the pointer mid-click.
  const [focused, setFocused] = useState(false);
  const writingArea = useRef<HTMLDivElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const localDraft = useDrafts((s) => s[ticket.id]) ?? emptyDraft;
  const sharedEnabled = config.sharedDrafts && ticket.channel === "email";
  const shared = useSharedDraft(ticket.id, sharedEnabled);
  const sharedReply = sharedEnabled && localDraft.mode === "reply";
  const sharedMachine = shared.machine;
  const draft: Draft = sharedReply ? {
    ...localDraft, html: shared.content.body_html, cc: shared.content.cc, bcc: shared.content.bcc,
    mailboxId: shared.content.mailbox_id ?? undefined,
    showCc: localDraft.showCc || shared.content.cc.length > 0 || shared.content.bcc.length > 0,
  } : localDraft;
  const setDraft = useCallback((p: Partial<Draft>) => {
    const current = useDrafts.getState()[ticket.id] ?? emptyDraft;
    const targetMode = p.mode ?? current.mode;
    const isShared = sharedEnabled && targetMode === "reply";
    if (isShared) {
      const patch: Partial<DraftContent> = {};
      if (p.html !== undefined) patch.body_html = p.html;
      if (p.cc !== undefined) patch.cc = p.cc;
      if (p.bcc !== undefined) patch.bcc = p.bcc;
      if ("mailboxId" in p) patch.mailbox_id = p.mailboxId ?? null;
      if (Object.keys(patch).length && sharedMachine.state.loaded) sharedMachine.edit(patch);
      useDrafts.setState({ [ticket.id]: { ...current, mode: targetMode, showCc: p.showCc ?? current.showCc } });
    } else useDrafts.setState({ [ticket.id]: { ...current, ...p } });
  }, [ticket.id, sharedEnabled, sharedMachine]);
  const { mode } = draft;

  const { data: members } = useQuery(q.members());
  const { data: allReplies } = useQuery(q.savedReplies());
  // Replies for everyone, plus the ticket team's own.
  const replies = useMemo(() => (allReplies ?? []).filter((r) => !r.team_id || r.team_id === ticket.team_id), [allReplies, ticket.team_id]);
  const teams = useTeamsCtx();
  const qc = useQueryClient();
  const viewers = useTicketViewers(ticket.id);
  const others = viewers.filter((v) => v.state === "replying");

  // Variables in replies: "{{" offers them with this ticket's values, from the address the reply goes out from.
  const catalog = useCatalog("reply");
  const { data: vars } = useQuery({ ...q.ticketVariables(ticket.id, draft.mailboxId ?? ticket.mailbox_id), enabled: mode === "reply" });
  const varItems = useMemo<VarItem[]>(
    () =>
      catalog.variables.map((v) => {
        const value = vars?.values[v.key];
        return { key: v.key, label: v.label, group: GROUP_LABELS[v.group] ?? v.group, value: vars ? (v.html && value ? t("composer.valueSet") : (value ?? "")) : undefined };
      }),
    [catalog.variables, vars, t],
  );

  const editor = useRef<RichEditorHandle>(null);
  const membersRef = useRef<Member[]>([]);
  const repliesRef = useRef<SavedReply[]>([]);
  const modeRef = useRef<Mode>(mode);
  const ticketRef = useRef(ticket.id);
  const knownRef = useRef<Set<string> | null>(null);
  const varItemsRef = useRef<VarItem[]>([]);
  const varsRef = useRef(vars);
  const catalogRef = useRef(catalog);
  const tRef = useRef(t);
  const sharedReadyRef = useRef(true);
  sharedReadyRef.current = !sharedEnabled || shared.loaded;
  membersRef.current = members ?? [];
  repliesRef.current = replies;
  modeRef.current = mode;
  ticketRef.current = ticket.id;
  knownRef.current = catalog.loading ? null : catalog.known;
  varItemsRef.current = varItems;
  varsRef.current = vars;
  catalogRef.current = catalog;
  tRef.current = t;

  // Saved replies go in filled for this ticket, so the agent reads real words; notes are never filled.
  // A reply that can't be filled goes in as written (the server fills it on send).
  const [filling, setFilling] = useState(0);
  const insertSavedReply = useCallback((html: string, clear?: () => void) => {
    if (modeRef.current === "reply" && !sharedReadyRef.current) return;
    clear?.();
    if (modeRef.current === "note") return editor.current?.insertHtml(html);
    const id = ticketRef.current;
    setFilling((n) => n + 1);
    api.tickets
      .render(id, html)
      .then((r) => r.body_html, () => html)
      .then((out) => {
        // Another ticket opened meanwhile: this one's draft is not the place.
        if (ticketRef.current === id) editor.current?.insertHtml(out);
      })
      .finally(() => setFilling((n) => n - 1));
  }, []);

  const extensions = useMemo(
    () => [
      mentionExtension(() => membersRef.current, () => modeRef.current === "note"),
      savedReplyExtension(() => repliesRef.current, insertSavedReply),
      templateExtension({
        known: () => knownRef.current,
        items: (query) => matchVars(varItemsRef.current, query, (g) => g),
        insert: (item) => variableText(item.key, varsRef.current?.values[item.key], catalogRef.current.byKey.get(item.key)?.html),
        filters: () => catalogRef.current.filters,
        enabled: () => modeRef.current === "reply",
        // Read when the list opens, so it follows the language.
        get valueLabel() {
          return tRef.current("composer.thisTicket");
        },
      }),
    ],
    [insertSavedReply],
  );
  // Unknown tags are marked once the list is in.
  useEffect(() => {
    if (!catalog.loading) refreshTags(editor.current?.editor);
  }, [catalog.loading, catalog.known]);

  const [localUploads, setLocalUploads] = useState<Upload[]>([]);
  const [replyUploads, setReplyUploads] = useState<Upload[]>([]);
  const uploadGeneration = useRef(0);
  const uploads = sharedReply ? replyUploads : localUploads;
  useEffect(() => {
    if (!shared.dirty && shared.loaded) setReplyUploads((items) => items.filter((u) => u.status !== "done" || shared.content.attachment_ids.includes(u.attachment!.id)));
  }, [shared.loaded, shared.dirty, shared.content.attachment_ids]);
  useBlocker({
    shouldBlockFn: () => {
      if (replyUploads.some((u) => u.status === "uploading")) { toast.error("Wait for the attachments to finish uploading before leaving."); return true; }
      return false;
    },
    enableBeforeUnload: () => replyUploads.some((u) => u.status === "uploading"),
  });
  const setUploads = sharedReply ? setReplyUploads : setLocalUploads;
  const savedAttachments = sharedReply ? (shared.server?.attachments ?? []).filter((a) => shared.content.attachment_ids.includes(a.id) && !uploads.some((u) => u.attachment?.id === a.id)) : [];
  const [review, setReview] = useState<{ preview: DraftPreview; status?: TicketStatus } | null>(null);
  const [conflictReview, setConflictReview] = useState<{ draft: TicketDraft | null } | null>(null);
  const [discardDraft, setDiscardDraft] = useState<TicketDraft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const draftSend = useMutation({
    mutationFn: async () => {
      if (!review) throw new Error("Review the draft before sending.");
      if (shared.dirty || shared.conflict || shared.server?.id !== review.preview.draft_id || shared.server?.revision !== review.preview.revision)
        throw new Error("The draft changed. Review it again before sending.");
      return draftApi.send(ticket.id, { draft_id: review.preview.draft_id, expected_revision: review.preview.revision, review_token: review.preview.review_token, status: review.status });
    },
    onSuccess: () => {
      uploadGeneration.current++;
      shared.machine.reload(null);
      setReplyUploads((items) => { items.forEach((u) => u.preview && URL.revokeObjectURL(u.preview)); return []; });
      setReview(null);
      ai.dismissSources();
      for (const key of [draftKey(ticket.id), qk.ticket(ticket.id), qk.messages(ticket.id), qk.activities(ticket.id), qk.counts]) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      setReview(null); toast.error(e, "Could not confirm the send. Check the conversation before retrying.");
      for (const key of [draftKey(ticket.id), qk.messages(ticket.id), qk.ticket(ticket.id)]) void qc.invalidateQueries({ queryKey: key });
    },
  });
  const inspectConflict = async () => {
    try { setConflictReview(await draftApi.get(ticket.id)); } catch (e) { toast.error(e, "Could not load the shared draft"); }
  };
  const discard = async () => {
    try {
      if (!discardDraft) return;
      await draftApi.discard(ticket.id, draftIdentity(discardDraft));
      uploadGeneration.current++;
      shared.machine.reload(null);
      setReplyUploads((items) => { items.forEach((u) => u.preview && URL.revokeObjectURL(u.preview)); return []; });
      setDiscardDraft(null);
      await qc.invalidateQueries({ queryKey: draftKey(ticket.id) });
    } catch (e) { toast.error(e, "Could not discard the draft"); }
  };
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const send = useSend(ticket, teams);
  const retries = useRef(new Map<string, SendMessageBody>());
  const ai = useComposerAi(editor, ticket, mode);
  /** Ollie drafts a reply; false when it can't here (AI off, or the composer is disabled). */
  const draftReply = () => {
    if (!ai.available || disabled || (sharedEnabled && !shared.loaded)) return false;
    if (mode !== "reply") setDraft({ mode: "reply" });
    ai.draft();
    return true;
  };

  useImperativeHandle(ref, () => ({
    focus: (m) => {
      if (m) setDraft({ mode: m });
      setTimeout(() => editor.current?.focus(), 0);
    },
    // A failed send: a local one is replaced, a bounced one is sent again as a new message.
    retry: (m) => {
      const body = retries.current.get(m.id) ?? { kind: m.kind, body_html: m.body_html, cc: m.cc.length ? m.cc : undefined, bcc: m.bcc.length ? m.bcc : undefined };
      if (m.id.startsWith("tmp-")) qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => old?.filter((x) => x.id !== m.id));
      const tempId = `tmp-${Date.now().toString(36)}`;
      retries.current.set(tempId, body);
      send.mutate({ body, tempId });
    },
    aiDraft: () => void draftReply(),
  }));

  // Presence: "replying" while a draft exists, "viewing" otherwise.
  const hasDraft = !!draft.html;
  useEffect(() => {
    realtime()?.setPresenceState(hasDraft && mode === "reply" ? "replying" : "viewing");
  }, [hasDraft, mode]);

  const upload = (files: FileList | File[]) => {
    if (sharedReply && !shared.loaded) return;
    const generation = uploadGeneration.current;
    let attachmentCount = shared.machine.state.content.attachment_ids.length + uploads.filter((u) => u.status === "uploading").length;
    for (const file of Array.from(files)) {
      if (sharedReply && attachmentCount >= 20) {
        toast.error("A shared draft can contain up to 20 attachments."); break;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error(t("composer.tooLarge", { name: file.name }));
        continue;
      }
      attachmentCount++;
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setUploads((u) => [...u, { key, file, status: "uploading", preview }]);
      api.attachments
        .upload(file)
        .then((attachment) => {
          if (sharedReply && generation !== uploadGeneration.current) return;
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "done", attachment } : x)));
          if (sharedReply) shared.machine.edit({ attachment_ids: [...shared.machine.state.content.attachment_ids, attachment.id] });
        })
        .catch((e) => {
          if (sharedReply && generation !== uploadGeneration.current) return;
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error" } : x)));
          toast.error(e, t("composer.uploadFailed", { name: file.name }));
        });
    }
  };

  const busyUploads = uploads.some((u) => u.status === "uploading");
  // A reply from an address that has no way to send is refused (mailbox_cannot_send): say so up front.
  const noSender = mode === "reply" && ticket.channel === "email" && teams.mailbox(draft.mailboxId ?? ticket.mailbox_id)?.sending === "system_off";
  const sharedBlocked = sharedReply && (!shared.loaded || !!shared.query.error || shared.conflict || !!shared.error || reviewing || draftSend.isPending);
  const canSend = (!!draft.html || (sharedReply && shared.content.attachment_ids.length > 0)) && !busyUploads && !disabled && !ai.busy && !noSender && !filling && !sharedBlocked;

  // The send button's moment: sending while the request is out, then a check.
  const [sent, setSent] = useState(false);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && send.isSuccess) {
      setSent(true);
      const id = setTimeout(() => setSent(false), 1200);
      wasPending.current = send.isPending;
      return () => clearTimeout(id);
    }
    wasPending.current = send.isPending;
  }, [send.isPending, send.isSuccess]);
  const phase = send.isPending || draftSend.isPending || reviewing ? "sending" : sent ? "sent" : "idle";

  const submit = async (status?: TicketStatus) => {
    if (!canSend) return;
    if (sharedReply) {
      setReviewing(true);
      try {
        const saved = await shared.machine.flush();
        if (!saved) return;
        const preview = await draftApi.preview(ticket.id, draftIdentity(saved));
        if (shared.machine.state.dirty || shared.machine.state.server?.revision !== preview.revision)
          throw new Error("The draft changed. Review it again.");
        setReview({ preview, status });
      } catch (e) { toast.error(e, "Could not prepare the draft for review"); }
      finally { setReviewing(false); }
      return;
    }
    const body: SendMessageBody = {
      kind: mode,
      body_html: draft.html,
      cc: mode === "reply" && draft.cc.length ? draft.cc : undefined,
      bcc: mode === "reply" && draft.bcc.length ? draft.bcc : undefined,
      attachment_ids: uploads.filter((u) => u.attachment).map((u) => u.attachment!.id),
      status,
      mailbox_id: mode === "reply" && draft.mailboxId && draft.mailboxId !== ticket.mailbox_id ? draft.mailboxId : undefined,
    };
    const tempId = `tmp-${Date.now().toString(36)}`;
    retries.current.set(tempId, body);
    send.mutate({ body, tempId });
    uploads.forEach((u) => u.preview && URL.revokeObjectURL(u.preview));
    setUploads([]);
    setDraft({ html: "", cc: [], bcc: [], showCc: false, mailboxId: undefined });
    editor.current?.clear();
    ai.dismissSources();
    if (status) toast.success(t(mode === "note" ? "composer.noteAndMarked" : "composer.sentAndMarked", { status: statusLabel[status].toLowerCase() }));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (ticket.channel === "chat" && mode === "reply") realtime()?.typing(ticket.contact?.id);
    else realtime()?.typing();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      submit("solved");
      return true;
    }
    return false;
  };

  const note = mode === "note";
  const recipient = ticket.contact?.email ?? ticket.contact?.name ?? t("composer.theCustomer");
  // The editor opens up while in use or holding a draft, and rests small otherwise.
  const open = focused || !!draft.html || uploads.length > 0 || savedAttachments.length > 0;

  // mod+J in the reply box asks Ollie for a draft; everywhere else it opens Ollie
  // (AssistantRoot). Handled here first, so the app-wide binding sees it as taken.
  const onComposerKey = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || keyName(e.nativeEvent) !== "mod+j") return;
    if (draftReply()) e.preventDefault();
  };

  return (
    <div className="shrink-0 px-5 pb-4" onKeyDown={onComposerKey}>
      <div className="mx-auto w-full max-w-[820px]">
        {!disabled && (!sharedEnabled || shared.loaded) && (
          <SuggestedReplyCard
            ticket={ticket}
            hasDraft={!!draft.html}
            onEdit={(html) => {
              setDraft({ mode: "reply", html });
              editor.current?.setHtml(html);
              setTimeout(() => editor.current?.focus(), 0);
            }}
          />
        )}
        <AnimatePresence initial={false}>
          {others.length > 0 && mode === "reply" && (
            <motion.div
              role="status"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
              className={cn("mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]", tone.amber.soft)}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full animate-pulse-soft motion-reduce:animate-none", tone.amber.solid)} />
              <Avatar name={others[0].name} src={others[0].avatar} size="xs" />
              <span className="min-w-0 flex-1 truncate text-fg-2">
                {t("composer.othersReplying", { names: others.map((o) => o.name.split(" ")[0]).join(", "), count: others.length })}
              </span>
              <button type="button" onClick={() => setDraft({ mode: "note" })} className={cn("shrink-0 text-xs font-medium underline-offset-2 hover:underline", tone.amber.text)}>
                {t("composer.noteInstead")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
          }}
          onFocus={(e) => {
            // Focus events from this composer's popovers (portalled) arrive here too, and keep it open.
            clearTimeout(leaving.current);
            if (writingArea.current?.contains(e.target)) setFocused(true);
          }}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            // Focus may be moving into one of its popovers: that focus event cancels this.
            clearTimeout(leaving.current);
            leaving.current = setTimeout(() => setFocused(false), 0);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              upload(files);
            }
          }}
          className={cn(
            "relative rounded-lg border shadow-xs transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-fg-4 focus-within:shadow-[0_0_0_3px_var(--focus)]",
            note ? "border-dashed border-note-line bg-note" : "border-line bg-surface",
          )}
        >
          <div className="flex h-10 items-center gap-2 border-b border-line-soft px-2">
            <Segmented
              size="xs"
              value={mode}
              onChange={(m) => setDraft({ mode: m })}
              options={[
                { value: "reply", label: t("composer.reply") },
                { value: "note", label: t("composer.note") },
              ]}
            />
            {note ? (
              <span className="truncate text-xs text-fg-3">{t("composer.noteHint")}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-fg-3">
                {t("composer.to")} <span className="mono text-fg-2" data-ph-mask>{recipient}</span>
              </span>
            )}
            {!note && (
              <button
                type="button"
                onClick={() => setDraft({ showCc: !draft.showCc })}
                aria-expanded={draft.showCc}
                className={cn("ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-xs text-fg-3 transition-colors hover:bg-hover hover:text-fg", draft.showCc && "bg-hover text-fg")}
              >
                {t("composer.ccBcc")}
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {!note && draft.showCc && (
              <motion.div
                key="cc"
                initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <EmailChips label="Cc" values={draft.cc} onChange={(cc) => setDraft({ cc })} />
                <EmailChips label="Bcc" values={draft.bcc} onChange={(bcc) => setDraft({ bcc })} />
              </motion.div>
            )}
          </AnimatePresence>
          {!note && (
            <ReplyingAs
              ticket={ticket}
              ctx={teams}
              mailboxId={draft.mailboxId ?? ticket.mailbox_id}
              chosen={!!draft.mailboxId && draft.mailboxId !== ticket.mailbox_id}
              onChange={(id) => setDraft({ mailboxId: id === ticket.mailbox_id ? undefined : id })}
            />
          )}
          <div ref={writingArea}>
            <RichEditor
              ref={editor}
              value={draft.html}
              syncWhileFocused={sharedReply && !shared.dirty}
              onChange={(html) => setDraft({ html })}
              placeholder={note ? t("composer.notePlaceholder") : t("composer.replyPlaceholder", { braces: "{{", interpolation: { escapeValue: false } })}
              extensions={extensions}
              onSubmit={() => submit()}
              onKeyDown={onKeyDown}
              editable={!disabled && !ai.busy && (!sharedReply || shared.loaded) && !draftSend.isPending}
              contentClassName={cn("max-h-[40vh] transition-[min-height] duration-200 ease-out motion-reduce:transition-none", open ? "min-h-[96px]" : "min-h-[44px]")}
              ariaLabel={note ? "Note" : "Reply"}
              toolbarEnd={
                <>
                  <ComposerAiMenu ai={ai} hasDraft={!!draft.html} disabled={disabled || (sharedReply && !shared.loaded)} />
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
                  <Tooltip content={t("composer.attach")}>
                    <button
                      type="button"
                      aria-label="Attach files"
                      disabled={sharedReply && (!shared.loaded || draftSend.isPending)}
                      onClick={() => fileInput.current?.click()}
                      className="flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg active:scale-95"
                    >
                      <Paperclip className="size-[15px]" />
                    </button>
                  </Tooltip>
                  <Picker
                    side="top"
                    align="end"
                    width={300}
                    placeholder={t("composer.searchReplies")}
                    emptyText={t("composer.noReplies")}
                    value={null}
                    items={replies.map((r) => ({ value: r.id, label: r.title, hint: r.shortcut ? `/${r.shortcut.replace(/^\//, "")}` : undefined }))}
                    onSelect={(id) => {
                      const r = replies.find((x) => x.id === id);
                      if (r) insertSavedReply(r.body_html);
                    }}
                    trigger={
                      <Tooltip content={t("composer.savedReplies")}>
                        <button type="button" aria-label="Saved replies" aria-busy={filling > 0} className="flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg active:scale-95">
                          {filling > 0 ? <Loader2 className="size-[15px] animate-spin motion-reduce:animate-none" /> : <MessageSquareText className="size-[15px]" />}
                        </button>
                      </Tooltip>
                    }
                  />
                  <span className="mx-1 h-4 w-px bg-line" />
                  <SendButton note={note} disabled={!canSend} busy={busyUploads} onSend={submit} current={ticket.status} phase={phase} />
                </>
              }
            />
          </div>
          {sharedReply && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2 text-xs text-fg-3" role="status">
              <span className="flex-1">{shared.query.error ? "Could not load the shared draft" : !shared.loaded ? "Loading shared draft…" : shared.conflict ? "The shared draft changed. Your local edits are preserved." : shared.error ? errorMessage(shared.error, "Draft not saved") : shared.saving ? "Saving shared draft…" : shared.dirty ? "Unsaved changes" : shared.server ? "Shared draft saved" : "Replies are saved as shared drafts"}</span>
              {shared.query.error && <button type="button" className="underline" onClick={() => void shared.query.refetch()}>Retry</button>}
              {shared.conflict && <button type="button" className="underline" onClick={() => void inspectConflict()}>Review changes</button>}
              {!!shared.error && !shared.conflict && <button type="button" className="underline" onClick={() => void shared.machine.flush().catch((e) => toast.error(e, "Draft not saved"))}>Retry save</button>}
              {shared.server && !shared.conflict && <button type="button" className="underline" disabled={shared.saving || draftSend.isPending || busyUploads} onClick={() => void shared.machine.flush().then((saved) => setDiscardDraft(saved)).catch((e) => toast.error(e, "Draft not saved"))}>Discard</button>}
            </div>
          )}
          <ComposerSources ai={ai} />
          <ComposerAiStatus ai={ai} />
          {savedAttachments.length > 0 && <div className="flex flex-wrap gap-2 px-3 pb-2">{savedAttachments.map((a) => <div key={a.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-xs"><DraftAttachment attachment={a} /><button type="button" aria-label={`Remove ${a.filename}`} className="flex size-6 items-center justify-center rounded-sm hover:bg-hover" onClick={() => shared.machine.edit({ attachment_ids: shared.content.attachment_ids.filter((id) => id !== a.id) })}><X className="size-3" /></button></div>)}</div>}
          {uploads.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
              {uploads.map((u) => (
                <span key={u.key} className={cn("flex h-8 max-w-[220px] items-center gap-2 rounded-md border bg-surface pl-1 pr-1 animate-pop-in motion-reduce:animate-none", u.status === "error" ? tone.red.line : "border-line")}>
                  {u.preview ? <img src={u.preview} alt="" className="size-6 rounded-sm object-cover" /> : <span className="flex size-6 items-center justify-center rounded-sm bg-hover"><Paperclip className="size-3 text-fg-3" /></span>}
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px]">{u.file.name}</span>
                    <span className="mono block text-[10px] text-fg-4">{u.status === "uploading" ? t("composer.uploading") : u.status === "error" ? t("composer.failed") : bytes(u.file.size)}</span>
                  </span>
                  {u.status === "uploading" ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-4" />
                  ) : (
                    <button type="button" aria-label={`Remove ${u.file.name}`} onClick={() => {
                      setUploads((x) => x.filter((y) => y.key !== u.key));
                      if (sharedReply && u.attachment) shared.machine.edit({ attachment_ids: shared.content.attachment_ids.filter((id) => id !== u.attachment!.id) });
                      if (u.preview) URL.revokeObjectURL(u.preview);
                    }} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-4 hover:bg-hover hover:text-fg">
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-fg-3 bg-surface/90 text-[13px] font-medium text-fg-2 animate-fade-in">
              {t("composer.drop")}
            </div>
          )}
        </div>
        <Dialog open={!!review} onOpenChange={(o) => !o && !draftSend.isPending && setReview(null)} title="Review email" size="lg"
          footer={<><Button variant="ghost" onClick={() => setReview(null)} disabled={draftSend.isPending}>Back to draft</Button><Button disabled={draftSend.isPending || shared.dirty || shared.conflict || shared.server?.revision !== review?.preview.revision} onClick={() => draftSend.mutate()}>{review?.status === "solved" ? "Send and resolve" : "Send email"}</Button></>}>
          {review && <DraftReview preview={review.preview} />}
        </Dialog>
        <Dialog open={!!conflictReview} onOpenChange={(o) => !o && setConflictReview(null)} title="Shared draft changed" description="Your local edits are preserved. Review the latest shared version before choosing which version to keep."
          footer={<><Button variant="ghost" onClick={() => setConflictReview(null)}>Keep editing locally</Button><Button variant="ghost" onClick={() => { uploadGeneration.current++; shared.machine.reload(conflictReview!.draft); setReplyUploads((items) => { items.forEach((u) => u.preview && URL.revokeObjectURL(u.preview)); return []; }); setConflictReview(null); }}>Use shared version</Button><Button onClick={() => { void shared.machine.replace(conflictReview!.draft).then(() => setConflictReview(null)).catch((e) => toast.error(e, "Draft not saved")); }}>Replace with my edits</Button></>}>
          {conflictReview?.draft ? <div className="space-y-3"><p className="text-xs text-fg-3">Cc: {conflictReview.draft.cc.join(", ") || "None"} · Bcc: {conflictReview.draft.bcc.join(", ") || "None"}</p><div className="prose-od" dangerouslySetInnerHTML={{ __html: sanitizeHtml(conflictReview.draft.body_html) }} /><p className="text-xs">{conflictReview.draft.attachments.map((a) => a.filename).join(", ")}</p></div> : <p className="text-sm">The shared draft has been sent or discarded.</p>}
        </Dialog>
        <Dialog open={!!discardDraft} onOpenChange={(o) => !o && setDiscardDraft(null)} title="Discard shared draft?" description="This removes the draft for everyone on this ticket. This action cannot be undone."
          footer={<><Button variant="ghost" onClick={() => setDiscardDraft(null)}>Cancel</Button><Button variant="danger-solid" onClick={() => void discard()}>Discard draft</Button></>} />
        <SuggestionPopup />
        <VarSuggestPopup />
      </div>
    </div>
  );
});

function DraftAttachment({ attachment }: { attachment: Attachment }) {
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const blob = await draftApi.attachment(attachment.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = attachment.filename;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(e, "Could not download the attachment"); }
    finally { setLoading(false); }
  };
  return <button type="button" disabled={loading} className="min-h-6 max-w-64 truncate underline" onClick={() => void download()}>{attachment.filename} ({bytes(attachment.size_bytes)})</button>;
}

function DraftReview({ preview }: { preview: DraftPreview }) {
  return <div className="ph-no-capture space-y-3 text-sm" data-ph-mask>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt>From</dt><dd>{preview.from.name} &lt;{preview.from.email}&gt;</dd><dt>To</dt><dd>{preview.to.join(", ")}</dd>{preview.cc.length > 0 && <><dt>Cc</dt><dd>{preview.cc.join(", ")}</dd></>}{preview.bcc.length > 0 && <><dt>Bcc</dt><dd>{preview.bcc.join(", ")}</dd></>}<dt>Subject</dt><dd>{preview.subject}</dd></dl>
    <div className="prose-od border-t border-line pt-3" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.body_html) }} />
    <div className="prose-od" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.signature_html) }} />
    <div className="flex flex-wrap gap-2">{preview.attachments.map((a) => <DraftAttachment key={a.id} attachment={a} />)}</div>
  </div>;
}

/**
 * Who the customer sees the reply from, and from which address: the address's From
 * name format filled in. Click to send this reply from another of the brand's
 * addresses (it becomes the ticket's reply address).
 */
function ReplyingAs({
  ticket,
  ctx,
  mailboxId,
  chosen,
  onChange,
}: {
  ticket: Ticket;
  ctx: TeamsCtx;
  mailboxId: string | null;
  chosen: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation("inbox");
  const user = useSession((s) => s.user!);
  const { data: activities } = useQuery(q.activities(ticket.id));
  const { data: messages } = useQuery(q.messages(ticket.id));
  const mailbox = ctx.mailbox(mailboxId);
  // The signature this reply carries, filled by the server: the team's, else the address's, else mine.
  const { data: vars } = useQuery({ ...q.ticketVariables(ticket.id, mailboxId), enabled: !!mailbox });
  const options = replyAddresses(ctx, ticket);
  if (!mailbox || (ticket.channel !== "email" && !ticket.mailbox_id)) return null;
  const from = fromLine(ctx, ticket, mailbox, user.name);
  const moved = chosen ? null : movedTo(activities, messages, mailbox, ctx);
  const canPick = options.length > 1 || (options.length === 1 && options[0].id !== mailbox.id);
  const chip = (
    <button
      type="button"
      disabled={!canPick}
      aria-label={t("composer.changeAddress")}
      className="group flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-[12px] outline-none transition-colors hover:bg-hover focus-visible:shadow-[0_0_0_2px_var(--focus)] disabled:pointer-events-none data-[state=open]:bg-hover"
    >
      <span className="truncate text-fg">{from.name}</span>
      <span className="mono min-w-0 truncate text-[11.5px] text-fg-3" data-ph-mask>
        &lt;{from.email}&gt;
      </span>
      {mailbox.private && <Lock className="size-3 shrink-0 text-fg-4" />}
      {canPick && <ChevronDown className="size-3 shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" />}
    </button>
  );
  return (
    <div className="border-b border-line-soft">
      <div className="@container flex min-h-8 items-center gap-2 px-3">
        <span className="shrink-0 text-xs text-fg-3">{t("composer.replyingAs")}</span>
        <div className="flex min-w-0 flex-1 items-center">
          {canPick ? (
            <Picker
              width={320}
              value={mailbox.id}
              placeholder={t("props.searchAddresses")}
              items={options.map((m) => ({
                value: m.id,
                label: addressLabel(m),
                keywords: [m.email, ...(m.aliases ?? [])],
                icon: <TeamDot team={ctx.team(m.team_id)} />,
                hint: m.private ? <Lock className="size-3" /> : undefined,
              }))}
              onSelect={onChange}
              trigger={chip}
            />
          ) : (
            chip
          )}
        </div>
        {vars?.signature_html && <SignaturePreview html={vars.signature_html} />}
      </div>
      {mailbox.sending === "system_off" && (
        <p className="flex items-start gap-1.5 px-3 pb-1.5 text-[11.5px] leading-4 text-fg-2 animate-fade-in motion-reduce:animate-none" role="status">
          <TriangleAlert className="mt-px size-3 shrink-0 text-tone-amber" aria-hidden />
          {t("composer.cannotSend")}
        </p>
      )}
      {(moved || chosen) && (
        <p className="flex items-center gap-1.5 px-3 pb-1.5 text-[11.5px] text-fg-3 animate-fade-in motion-reduce:animate-none">
          <ArrowRightLeft className="size-3 shrink-0 text-fg-4" />
          {chosen ? t("composer.addressChosen") : t("composer.addressMoved", { team: moved })}
        </p>
      )}
    </div>
  );
}

/** The team a transfer switched the reply address for, until the next reply goes out. */
function movedTo(activities: Activity[] | undefined, messages: Message[] | undefined, mailbox: Mailbox, ctx: TeamsCtx): string | null {
  const a = [...(activities ?? [])]
    .reverse()
    .find((x) => x.type === "team_changed" && (x.data.mailbox_to === mailbox.id || x.data.mailbox_to === mailbox.email));
  if (!a) return null;
  const since = Date.parse(a.created_at);
  if ((messages ?? []).some((m) => m.direction === "outbound" && m.kind === "reply" && Date.parse(m.created_at) > since)) return null;
  const to = a.data.to;
  return (typeof to === "string" ? (ctx.team(to)?.name ?? to) : null) ?? ctx.team(mailbox.team_id)?.name ?? null;
}

function SendButton({
  note,
  disabled,
  busy,
  onSend,
  current,
  phase,
}: {
  note: boolean;
  disabled: boolean;
  busy: boolean;
  onSend: (s?: TicketStatus) => void;
  current: TicketStatus;
  phase: "idle" | "sending" | "sent";
}) {
  const { t } = useTranslation("inbox");
  const label = note ? t("composer.addNote") : t("composer.send");
  const options: TicketStatus[] = (["pending", "on_hold", "solved"] as TicketStatus[]).filter((s) => s !== current);
  return (
    <div className="flex items-center">
      <Tooltip content={busy ? t("composer.waitUploads") : note ? t("composer.addNote") : t("composer.sendReply")} shortcut="mod enter">
        <Button variant="primary" size="sm" disabled={disabled && phase === "idle"} onClick={() => onSend()} className="rounded-r-none active:scale-[0.97]">
          {/* The label keeps the width while the spinner and check swap in. */}
          <span className="relative inline-grid place-items-center">
            <span className={cn("col-start-1 row-start-1 transition-opacity", phase !== "idle" && "opacity-0")}>{label}</span>
            <span className="col-start-1 row-start-1 flex">
              <Morph k={phase}>
                {phase === "sending" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-label={t("composer.sending")} />
                ) : phase === "sent" ? (
                  <Check className="size-3.5" strokeWidth={2.5} aria-label={t("composer.sent")} />
                ) : null}
              </Morph>
            </span>
          </span>
        </Button>
      </Tooltip>
      <M.Root>
        <M.Trigger asChild disabled={disabled}>
          <Button variant="primary" size="sm" square aria-label={t("composer.andStatus", { label })} className="rounded-l-none border-l border-white/15 dark:border-black/15" icon={<ChevronDown className="size-3.5" />} />
        </M.Trigger>
        <M.Portal>
          <M.Content side="top" align="end" sideOffset={6} className={cn(floatingPanel, "min-w-[230px] p-1")}>
            <div className="label-caps px-2 pb-1 pt-1.5">{t("composer.andStatus", { label })}</div>
            {options.map((s) => (
              <M.Item key={s} onSelect={() => onSend(s)} className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px] outline-none data-[highlighted]:bg-hover">
                <StatusIcon status={s} />
                <span className="flex-1 whitespace-nowrap">{t("composer.andMark", { label, status: statusLabel[s].toLowerCase() })}</span>
                {s === "solved" && <Kbd className="ml-3 shrink-0">mod shift enter</Kbd>}
              </M.Item>
            ))}
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  );
}
