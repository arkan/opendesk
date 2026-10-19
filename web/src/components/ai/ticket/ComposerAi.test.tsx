import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RichEditorHandle } from "@/components/editor/RichEditor";
import type { Ticket } from "@/lib/api/types";
import type { StreamHandlers } from "@/lib/api/client";
import { useComposerAi, type ComposerAi } from "./ComposerAi";

const mocks = vi.hoisted(() => ({ draft: vi.fn(), rewrite: vi.fn(), translate: vi.fn(), confirm: vi.fn(), toast: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/api/endpoints", () => ({ api: { ai: { draft: mocks.draft, rewrite: mocks.rewrite, translate: mocks.translate } } }));
vi.mock("@/lib/ai", () => ({ useAI: () => ({ enabled: true }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
vi.mock("react-i18next", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-i18next")>()), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => ({ show: mocks.confirm }) }));
vi.mock("@/components/ui/toast", () => ({ toast: { info: mocks.toast, error: vi.fn() } }));
vi.mock("./errors", () => ({ balanceSpent: vi.fn(), isAbort: (e: unknown) => e instanceof DOMException && e.name === "AbortError", reportAiError: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let editor: Editor;
let editorRef: RefObject<RichEditorHandle | null>;
let ai: ComposerAi;
type Context = { ticketId: string; mode: "reply" | "note" };
let context: Context;
const original = "<p>Original content</p>";
const generated = "<p>Generated content</p>";
const other = "<p>Other context content</p>";

function Probe({ ticketId, mode }: Context) {
  const ticket: Ticket = {
    id: ticketId, number: 1, subject: "Order", status: "open", priority: "normal", severity: null,
    channel: "email", mailbox_id: null, contact: null, assignee: null, team_id: null, brand_id: "brand-1",
    widget_id: null, origin_mailbox_id: null, received_at: "", page_url: "", routed: null, tags: [], fields: {},
    sla: null, first_responded_at: null, solved_at: null, snoozed_until: null, last_message_at: "",
    last_customer_message_at: null, waiting_since: null, unanswered_count: 0, last_message_preview: "",
    message_count: 1, spam: false, csat: null, custom: { language: "fr" }, created_at: "", updated_at: "",
  };
  ai = useComposerAi(editorRef, ticket, mode);
  return null;
}
async function run(action: () => void) { await act(async () => action()); }
async function render() { await run(() => root.render(<Probe {...context} />)); }
async function changeContext(next: Partial<Context>) {
  context = { ...context, ...next };
  await render();
  // Composer switches the visible body without emitting an editor update.
  editor.commands.setContent(other, { emitUpdate: false });
}
function undoToast() {
  const options = mocks.toast.mock.lastCall?.[1] as { action: { onClick: () => void } };
  options.action.onClick();
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.draft.mockResolvedValue({ body_html: generated, sources: [] });
  mocks.rewrite.mockResolvedValue({ html: generated });
  mocks.translate.mockResolvedValue({ html: generated });
  mocks.confirm.mockImplementation((_text: string, submit: () => void) => submit());
  editor = new Editor({ extensions: [StarterKit], content: original });
  editorRef = { current: {
    editor, setHtml: (html) => { editor.commands.setContent(html, { emitUpdate: true }); },
    focus: vi.fn(), clear: vi.fn(), insertHtml: vi.fn(), isEmpty: () => editor.isEmpty,
  } };
  context = { ticketId: "ticket-1", mode: "note" };
  host = document.createElement("div");
  root = createRoot(host);
  await render();
});
afterEach(async () => { await run(() => root.unmount()); editorRef.current = null; editor.destroy(); host.remove(); });

describe("composer AI action ownership", () => {
  it("undoes a generated draft in the same context", async () => {
    await run(() => ai.draft());
    expect(editor.getHTML()).toBe(generated);
    await run(undoToast);
    expect(editor.getHTML()).toBe(original);
  });

  it.each([{ mode: "reply" as const }, { ticketId: "ticket-2" }])("ignores draft toast Undo after changing context to %j", async (next) => {
    await run(() => ai.draft());
    await changeContext(next);
    await run(undoToast);
    expect(editor.getHTML()).toBe(other);
  });

  it.each(["rewrite", "translate"] as const)("undoes a %s in the same context", async (operation) => {
    context.mode = "reply";
    await render();
    await run(() => operation === "rewrite" ? ai.rewrite("shorter") : ai.translate());
    expect(ai.review).not.toBeNull();
    expect(editor.getHTML()).toBe(generated);
    await run(() => ai.undoReview());
    expect(editor.getHTML()).toBe(original);
    expect(ai.review).toBeNull();
  });

  it.each([{ mode: "reply" as const }, { ticketId: "ticket-2" }])("ignores review Undo after changing context to %j", async (next) => {
    await run(() => ai.rewrite("shorter"));
    const undo = ai.undoReview;
    await changeContext(next);
    await run(undo);
    await run(() => ai.undoReview());
    expect(editor.getHTML()).toBe(other);
    expect(ai.review).toBeNull();
  });

  it("ignores a deferred draft replacement confirmation from another mode", async () => {
    mocks.confirm.mockImplementation(() => {});
    await run(() => ai.draft());
    const submit = mocks.confirm.mock.lastCall?.[1] as () => void;
    await changeContext({ mode: "reply" });
    await run(submit);
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(other);
  });

  it("does not reactivate an old draft Undo when returning to its original mode", async () => {
    await run(() => ai.draft());
    await changeContext({ mode: "reply" });
    await changeContext({ mode: "note" });
    await run(undoToast);
    expect(editor.getHTML()).toBe(other);
  });

  it("ignores streamed text and cancellation from a previous ticket", async () => {
    let cancel!: (reason: unknown) => void;
    mocks.rewrite.mockReturnValue(new Promise((_resolve, reject) => { cancel = reject; }));
    await run(() => ai.rewrite("shorter"));
    const handlers = mocks.rewrite.mock.lastCall?.[1] as StreamHandlers;
    expect(ai.busy?.kind).toBe("rewrite");
    await changeContext({ ticketId: "ticket-2" });
    expect(handlers.signal?.aborted).toBe(true);
    await run(() => {
      handlers.onDelta?.("Private content", "Private content");
      cancel(new DOMException("Aborted", "AbortError"));
    });
    expect(editor.getHTML()).toBe(other);
    expect(ai.busy).toBeNull();
    expect(ai.review).toBeNull();
  });

  it("ignores a late translation result from a previous ticket", async () => {
    let complete!: (result: { html: string }) => void;
    mocks.translate.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    context.mode = "reply";
    await render();
    await run(() => ai.translate());
    await changeContext({ ticketId: "ticket-2" });
    await run(() => complete({ html: generated }));
    expect(editor.getHTML()).toBe(other);
    expect(ai.busy).toBeNull();
    expect(ai.review).toBeNull();
  });
});
