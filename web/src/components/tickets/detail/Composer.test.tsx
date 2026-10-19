import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "@/lib/api/types";
import type { RichEditorHandle } from "@/components/editor/RichEditor";
import { SharedDraftStateMachine } from "./sharedDraftState";
import { Composer, type ComposerHandle } from "./Composer";

const setup = vi.hoisted(() => ({
  machine: null as unknown as SharedDraftStateMachine, sending: false, aiBusy: false, aiAvailable: false,
  aiDraft: vi.fn(), upload: vi.fn(), editorFocused: false, readEditor: (): string => "", writeEditor: (_html: string) => {},
}));
vi.mock("@/lib/config", () => ({ config: { sharedDrafts: true } }));
vi.mock("react-i18next", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-i18next")>()), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSession: (select: (s: unknown) => unknown) => select({ user: { id: "user-1", name: "Agent" } }) }));
vi.mock("@/lib/realtime/manager", () => ({ realtime: () => null }));
vi.mock("../presence", () => ({ useTicketViewers: () => [] }));
vi.mock("@/components/templates/catalog", () => ({ GROUP_LABELS: {}, useCatalog: () => ({ variables: [], loading: false, known: new Set(), byKey: new Map(), filters: [] }) }));
vi.mock("@/components/templates/extension", () => ({ matchVars: () => [], refreshTags: () => {}, templateExtension: () => ({}), VarSuggestPopup: () => null }));
vi.mock("./suggestions", () => ({ mentionExtension: () => ({}), savedReplyExtension: () => ({}), SuggestionPopup: () => null }));
vi.mock("./SuggestedReply", () => ({ SuggestedReplyCard: () => null }));
vi.mock("./SignaturePreview", () => ({ SignaturePreview: () => null }));
vi.mock("@/components/ai/ticket/ComposerAi", () => ({
  useComposerAi: (editor: RefObject<RichEditorHandle | null>, ticket: Ticket, mode: string) => ({
    available: setup.aiAvailable, busy: setup.aiBusy ? { kind: "rewrite" } : null, dismissSources: () => {},
    draft: () => {
      setup.aiDraft({ ticketId: ticket.id, mode, backup: setup.readEditor() });
      editor.current?.setHtml("Generated reply");
    },
  }),
  ComposerAiMenu: () => null, ComposerAiStatus: () => null, ComposerSources: () => null,
}));
vi.mock("./useSharedDraft", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useSharedDraft: () => ({ ...useSyncExternalStore(setup.machine.subscribe, setup.machine.snapshot), machine: setup.machine, query: { error: null } }) };
});
vi.mock("./useSharedDraftActions", () => ({ useSharedDraftActions: () => ({ dialog: null, busy: setup.sending, sending: setup.sending, reviewing: false }) }));
vi.mock("./useComposerUploads", () => ({ useComposerUploads: () => ({ uploads: [], savedAttachments: [], busy: false, attachmentIds: [], upload: setup.upload, clearLocal: () => {}, clearShared: () => {} }) }));
vi.mock("@/lib/queries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queries")>();
  const list = (key: string) => ({ queryKey: [key], queryFn: async () => [] });
  return { ...original, q: { members: () => list("members"), savedReplies: () => list("saved-replies"), activities: () => list("activities"), messages: () => list("messages"), ticketVariables: () => list("variables") } };
});
vi.mock("../teams", () => {
  const mailboxes = [
    { id: "mailbox-1", name: "Support", email: "support@example.com", team_id: null },
    { id: "mailbox-2", name: "Orders", email: "orders@example.com", team_id: null },
  ];
  return {
    useTeamsCtx: () => ({ mailbox: (id: string) => mailboxes.find((m) => m.id === id), team: () => undefined }),
    fromLine: (_ctx: unknown, _ticket: unknown, mailbox: typeof mailboxes[number]) => ({ name: mailbox.name, email: mailbox.email }),
    replyAddresses: () => mailboxes, addressLabel: (mailbox: typeof mailboxes[number]) => mailbox.name, TeamDot: () => null,
  };
});
vi.mock("@/components/editor/RichEditor", async () => {
  const { forwardRef, useEffect, useImperativeHandle, useRef } = await import("react");
  return { RichEditor: forwardRef<import("@/components/editor/RichEditor").RichEditorHandle, import("@/components/editor/RichEditor").RichEditorProps>(function Editor(props, ref) {
    const content = useRef(props.value ?? "");
    const write = (html: string) => { content.current = html; props.onChange?.(html); };
    setup.readEditor = () => content.current;
    setup.writeEditor = write;
    useEffect(() => {
      if (props.syncWhileFocused || !setup.editorFocused) content.current = props.value ?? "";
    }, [props.value, props.syncWhileFocused]);
    useImperativeHandle(ref, () => ({ editor: null, focus: () => {}, clear: () => write(""), insertHtml: (html) => write(`${content.current}${html}`), setHtml: write, isEmpty: () => !content.current }));
    return <><textarea aria-label={props.ariaLabel} disabled={!props.editable} value={props.value} onChange={(e) => write(e.target.value)} />{props.toolbarEnd}</>;
  }) };
});

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let ticket: Ticket;
const composer = createRef<ComposerHandle>();
async function run(action: () => void) { await act(async () => action()); }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!; }
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await run(() => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function view() { return <QueryClientProvider client={client}><Tooltip.Provider><Composer ref={composer} ticket={ticket} /></Tooltip.Provider></QueryClientProvider>; }
async function render() { await run(() => root.render(view())); }

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  setup.machine = new SharedDraftStateMachine(vi.fn());
  setup.sending = false;
  setup.aiBusy = false;
  setup.aiAvailable = false;
  setup.editorFocused = false;
  setup.aiDraft.mockReset();
  setup.upload.mockReset();
  ticket = { id: crypto.randomUUID(), channel: "email", status: "open", subject: "Order", mailbox_id: "mailbox-1", contact: { id: "contact-1", name: "Customer", email: "customer@example.com" }, team_id: null } as Ticket;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await run(() => { setup.machine.reload(null); root.unmount(); }); client.clear(); host.remove(); });

describe("composer shared content guards", () => {
  it("does not accept and silently drop Cc edits before the shared draft loads", async () => {
    await run(() => button("composer.ccBcc").click());
    const cc = host.querySelector<HTMLInputElement>('input[aria-label="Cc"]')!;
    await type(cc, "buyer@example.com");
    await run(() => cc.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(cc.disabled || setup.machine.state.content.cc.includes("buyer@example.com") || cc.value === "buyer@example.com").toBe(true);
  });

  it("keeps the internal note editable while the shared reply is loading", async () => {
    await run(() => button("composer.note").click());
    const note = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!;
    expect(note.disabled).toBe(false);
    await type(note, "Internal context");
    expect(note.value).toBe("Internal context");
    expect(setup.machine.state.content.body_html).toBe("");
  });

  it("keeps chat replies editable without waiting for an email draft", async () => {
    ticket = { ...ticket, channel: "chat", mailbox_id: null };
    await render();
    const reply = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!;
    expect(reply.disabled).toBe(false);
    await type(reply, "Chat reply");
    expect(reply.value).toBe("Chat reply");
    expect(setup.machine.state.content.body_html).toBe("");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]')?.disabled).toBe(false);
  });

  it("applies the same loading and sending guard to recipients, sender and pasted files", async () => {
    await run(() => button("composer.ccBcc").click());
    const cc = host.querySelector<HTMLInputElement>('input[aria-label="Cc"]')!;
    const sender = host.querySelector<HTMLButtonElement>('button[aria-label="composer.changeAddress"]')!;
    const attach = host.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]')!;
    const paste = () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { files: [new File(["pdf"], "order.pdf")] } });
      host.querySelector("textarea")!.dispatchEvent(event);
    };
    expect(cc.disabled && sender.disabled && attach.disabled).toBe(true);
    await run(paste);
    expect(setup.upload).not.toHaveBeenCalled();
    await run(() => setup.machine.receive(null));
    expect(cc.disabled || sender.disabled || attach.disabled).toBe(false);
    await type(cc, "buyer@example.com");
    await run(() => cc.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(setup.machine.state.content.cc).toEqual(["buyer@example.com"]);
    await run(paste);
    expect(setup.upload).toHaveBeenCalledOnce();
    setup.sending = true;
    await render();
    expect(cc.disabled && sender.disabled && attach.disabled).toBe(true);
    await run(paste);
    expect(setup.upload).toHaveBeenCalledOnce();
  });

  it("keeps an asynchronous note rewrite in Note despite mouse and imperative mode changes", async () => {
    await run(() => setup.machine.receive(null));
    await run(() => button("composer.note").click());
    await type(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!, "Private note");
    setup.aiBusy = true;
    await render();
    expect(button("composer.reply").matches(":disabled")).toBe(true);
    await run(() => button("composer.reply").click());
    await run(() => composer.current?.focus("reply"));
    await run(() => setup.writeEditor("Rewritten private note"));
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')?.value).toBe("Rewritten private note");
    expect(setup.machine.state.content.body_html).toBe("");
    setup.aiBusy = false;
    await render();
    await run(() => button("composer.reply").click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')?.value).toBe("");
  });

  it.each(["handle", "shortcut"])("starts AI from %s in the hydrated reply, preserving its backup and the note", async (trigger) => {
    await run(() => { setup.machine.receive(null); setup.machine.edit({ body_html: "Customer reply" }); });
    await run(() => button("composer.note").click());
    setup.editorFocused = true;
    await type(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!, "Private note");
    setup.aiAvailable = true;
    await render();
    await run(() => {
      if (trigger === "handle") composer.current?.aiDraft();
      else host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(setup.aiDraft).toHaveBeenCalledExactlyOnceWith({ ticketId: ticket.id, mode: "reply", backup: "Customer reply" });
    expect(setup.machine.state.content.body_html).toBe("Generated reply");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')?.value).toBe("Generated reply");
    await run(() => button("composer.note").click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')?.value).toBe("Private note");
  });

  it("cancels a pending AI draft when its mode changes before generation", async () => {
    await run(() => setup.machine.receive(null));
    await run(() => button("composer.note").click());
    setup.aiAvailable = true;
    await render();
    await run(() => { composer.current?.aiDraft(); composer.current?.focus("note"); });
    expect(setup.aiDraft).not.toHaveBeenCalled();
    expect(host.querySelector('textarea[aria-label="Note"]')).not.toBeNull();
  });

  it("cancels a pending AI draft when another ticket opens before generation", async () => {
    await run(() => setup.machine.receive(null));
    await run(() => button("composer.note").click());
    setup.aiAvailable = true;
    await render();
    await run(() => {
      composer.current?.aiDraft();
      ticket = { ...ticket, id: crypto.randomUUID() };
      root.render(view());
    });
    expect(setup.aiDraft).not.toHaveBeenCalled();
    expect(setup.machine.state.content.body_html).toBe("");
  });
});
