import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftApi, type DraftPreview, type TicketDraft } from "@/lib/api/drafts";
import { toast } from "@/components/ui/toast";
import { SharedDraftStateMachine } from "./sharedDraftState";
import { SharedDraftDialogs } from "./SharedDraftDialogs";
import { useSharedDraftActions, type SharedDraftActions } from "./useSharedDraftActions";

const draft = (revision = 1): TicketDraft => ({
  id: "draft-1", ticket_id: "ticket-1", state: "draft", revision, body_html: "<p>Order details</p>",
  mailbox_id: null, cc: [], bcc: ["buyer@example.com"], attachments: [],
  created_by: { type: "user", id: "user-1" }, updated_by: { type: "user", id: "user-1" },
  created_at: "2026-01-01", updated_at: "2026-01-01", ended_at: null, message_id: null,
});
const preview: DraftPreview = {
  draft_id: "draft-1", revision: 1, subject: "Purchase order", from: { name: "Support", email: "support@example.com" },
  to: ["customer@example.com"], cc: [], bcc: ["buyer@example.com"], body_html: "<p>Order details</p>",
  signature_html: "", attachments: [], review_token: "test-review-token",
};

let root: Root;
let host: HTMLDivElement;
let qc: QueryClient;
let machine: SharedDraftStateMachine;
let actions: SharedDraftActions;
const onReset = vi.fn();

function Harness() {
  useSyncExternalStore(machine.subscribe, machine.snapshot);
  actions = useSharedDraftActions("ticket-1", machine, onReset);
  return <SharedDraftDialogs actions={actions} />;
}

async function run(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  onReset.mockReset();
  vi.spyOn(toast, "error").mockImplementation(() => "toast");
  vi.spyOn(draftApi, "preview").mockResolvedValue(preview);
  vi.spyOn(draftApi, "get").mockResolvedValue({ draft: draft(2) });
  vi.spyOn(draftApi, "send").mockResolvedValue({ message_id: "message-1", ticket_id: "ticket-1", status: "solved", delivery_status: "pending" });
  machine = new SharedDraftStateMachine(async (_server, content) => ({ ...draft(2), ...content }));
  machine.receive(draft());
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  machine.reload(null);
  qc.clear();
  host.remove();
  vi.restoreAllMocks();
});

describe("shared draft review lifecycle", () => {
  it("sends only the explicitly reviewed revision and clears the consumed draft", async () => {
    await run(() => actions.review("solved"));
    expect(actions.dialog?.kind).toBe("review");
    expect(draftApi.send).not.toHaveBeenCalled();
    await run(() => actions.confirm());
    expect(draftApi.send).toHaveBeenCalledWith("ticket-1", {
      draft_id: "draft-1", expected_revision: 1, review_token: preview.review_token, status: "solved",
    });
    expect(machine.state.server).toBeNull();
    expect(onReset).toHaveBeenCalledOnce();
    expect(actions.dialog).toBeNull();
  });

  it("refuses a stale review even when the replacement draft has the same revision", async () => {
    await run(() => actions.review());
    await run(() => machine.receive({ ...draft(), id: "draft-2" }));
    expect(actions.canConfirm).toBe(false);
    await run(() => actions.confirm());
    expect(draftApi.send).not.toHaveBeenCalled();
    expect(machine.state.server?.id).toBe("draft-2");
    expect(onReset).not.toHaveBeenCalled();
  });

  it("preserves the draft and refreshes the conversation after an uncertain send", async () => {
    vi.mocked(draftApi.send).mockRejectedValueOnce(new Error("Connection lost"));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await run(() => actions.review());
    await run(() => actions.confirm());
    expect(machine.state.server).toEqual(draft());
    expect(onReset).not.toHaveBeenCalled();
    expect(actions.dialog).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tickets", "draft", "ticket-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tickets", "messages", "ticket-1"] });
  });

  it("keeps a pending discard dialog open until its reviewed revision is discarded", async () => {
    let complete!: () => void;
    const discarded = new Promise<void>((resolve) => { complete = resolve; });
    vi.spyOn(draftApi, "discard").mockReturnValue(discarded);
    await run(() => actions.discard());
    expect(actions.dialog?.kind).toBe("discard");
    expect(draftApi.discard).not.toHaveBeenCalled();
    await run(() => actions.confirm());
    expect(actions.busy).toBe(true);
    await run(() => actions.close());
    expect(actions.dialog?.kind).toBe("discard");
    expect(machine.state.server).toEqual(draft());
    await run(complete);
    expect(draftApi.discard).toHaveBeenCalledWith("ticket-1", { draft_id: "draft-1", expected_revision: 1 });
    expect(actions.dialog).toBeNull();
    expect(onReset).toHaveBeenCalledOnce();
    expect(machine.state.server).toBeNull();
  });

  it("preserves local content when a concurrent edit makes discard fail", async () => {
    vi.spyOn(draftApi, "discard").mockRejectedValueOnce(Object.assign(new Error("Draft changed"), { status: 409 }));
    await run(() => actions.discard());
    await run(() => actions.confirm());
    expect(actions.dialog?.kind).toBe("discard");
    expect(machine.state.server).toEqual(draft());
    expect(onReset).not.toHaveBeenCalled();
    await run(() => actions.close());
    expect(actions.dialog).toBeNull();
  });

  it("masks conflict content and replaces only the remote version the agent inspected", async () => {
    const write = vi.fn(async (_server: TicketDraft | null, content) => ({ ...draft(3), ...content }));
    machine = new SharedDraftStateMachine(write);
    machine.receive(draft());
    machine.edit({ body_html: "<p>Local order</p>" });
    machine.receive(draft(2));
    await act(async () => root.render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>));
    await run(() => actions.inspectConflict());
    const protectedContent = document.querySelector('[role="dialog"] .ph-no-capture[data-ph-mask]');
    expect(protectedContent?.textContent).toContain("buyer@example.com");
    expect(protectedContent?.textContent).toContain("Order details");
    await run(() => actions.confirm());
    expect(write.mock.calls[0][0]?.revision).toBe(2);
    expect(write.mock.calls[0][1].body_html).toBe("<p>Local order</p>");
    expect(actions.dialog).toBeNull();
    expect(machine.state.conflict).toBe(false);
  });
});
