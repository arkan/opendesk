import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedDraftStateMachine } from "./sharedDraftState";
import { draftContent, type DraftContent, type TicketDraft } from "@/lib/api/drafts";

const draft = (revision = 1, body_html = "Shared"): TicketDraft => ({
  id: "d1", ticket_id: "t1", state: "draft", revision, body_html, mailbox_id: null, cc: [], bcc: [], attachments: [],
  created_by: { type: "user", id: "u1" }, updated_by: { type: "user", id: "u1" },
  created_at: "2026-01-01", updated_at: "2026-01-01", ended_at: null, message_id: null,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
afterEach(() => { vi.useRealTimers(); });

describe("shared draft saves", () => {
  it("debounces to 400ms and coalesces editing into one revision-checked save", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_server: TicketDraft | null, content: DraftContent) => ({ ...draft(2), ...content }));
    const state = new SharedDraftStateMachine(write);
    state.receive(draft());
    state.edit({ body_html: "First" });
    await vi.advanceTimersByTimeAsync(300);
    state.edit({ body_html: "Latest" });
    await vi.advanceTimersByTimeAsync(399);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]?.revision).toBe(1);
    expect(state.state.content.body_html).toBe("Latest");
    expect(state.state.dirty).toBe(false);
  });

  it("serializes edits made during a save and never restores the older text", async () => {
    const first = deferred<TicketDraft>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce(async (_server, content) => ({ ...draft(3), ...content }));
    const state = new SharedDraftStateMachine(write);
    state.receive(draft()); state.edit({ body_html: "First" });
    const saving = state.flush();
    state.edit({ body_html: "Latest", attachment_ids: ["file1"] });
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve(draft(2, "First"));
    await saving;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].revision).toBe(2);
    expect(write.mock.calls[1][1].body_html).toBe("Latest");
    expect(write.mock.calls[1][1].attachment_ids).toEqual(["file1"]);
    expect(state.state.content.body_html).toBe("Latest");
    expect(state.state.dirty).toBe(false);
  });

  it("retains the original creation payload and durable key after a lost response", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(draft(1, "First")).mockImplementationOnce(async (_server, content) => ({ ...draft(2), ...content }));
    const state = new SharedDraftStateMachine(write);
    state.receive(null); state.edit({ body_html: "First" });
    await expect(state.flush()).rejects.toThrow("offline");
    state.edit({ body_html: "Second" });
    await state.flush();
    expect(write.mock.calls[1][1]).toEqual(write.mock.calls[0][1]);
    expect(write.mock.calls[1][2]).toBe(write.mock.calls[0][2]);
    expect(write.mock.calls[2][0].id).toBe("d1");
    expect(state.state.content.body_html).toBe("Second");
  });

  it("preserves local text and attachments on concurrent edits until explicit replacement", async () => {
    const write = vi.fn(async (_server: TicketDraft | null, content: DraftContent) => ({ ...draft(3), ...content }));
    const state = new SharedDraftStateMachine(write);
    state.receive(draft()); state.edit({ body_html: "Local", attachment_ids: ["file1"] });
    state.receive(draft(2, "Remote"));
    expect(state.state.conflict).toBe(true);
    expect(state.state.content.body_html).toBe("Local");
    expect(state.state.content.attachment_ids).toEqual(["file1"]);
    await expect(state.flush()).rejects.toThrow("shared draft changed");
    expect(write).not.toHaveBeenCalled();
    await state.replace(draft(2, "Remote"));
    expect(write.mock.calls[0][0]?.revision).toBe(2);
    expect(state.state.content.body_html).toBe("Local");
  });

  it("rejects a flush when an in-flight save discovers conflicting newer local edits", async () => {
    const result = deferred<TicketDraft>();
    const write = vi.fn(() => result.promise);
    const state = new SharedDraftStateMachine(write);
    state.receive(draft());
    state.edit({ body_html: "Submitted" });
    const saving = state.flush();
    state.edit({ body_html: "New local edit", attachment_ids: ["local-file"] });
    state.receive(draft(3, "Teammate edit"));
    result.resolve(draft(2, "Submitted"));
    await expect(saving).rejects.toThrow("shared draft changed");
    expect(state.state.content.body_html).toBe("New local edit");
    expect(state.state.content.attachment_ids).toEqual(["local-file"]);
    expect(state.state.dirty).toBe(true);
    expect(state.state.conflict).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    state.reload(null);
  });

  it.each([
    { name: "ended", current: null },
    { name: "replaced", current: { ...draft(), id: "d2" } },
  ])("returns the current identity when a teammate $name the draft during a save", async ({ current }) => {
    const result = deferred<TicketDraft>();
    const state = new SharedDraftStateMachine(() => result.promise);
    state.receive(draft());
    state.edit({ body_html: "Submitted" });
    const saving = state.flush();
    state.receive(current);
    result.resolve(draft(2, "Submitted"));
    await expect(saving).resolves.toEqual(current);
    expect(state.state.dirty).toBe(false);
  });

  it("refreshes a clean editor but does not interpret its own in-flight event as a conflict", async () => {
    const result = deferred<TicketDraft>();
    const state = new SharedDraftStateMachine(() => result.promise);
    state.receive(draft()); state.receive(draft(2, "Remote"));
    expect(state.state.content.body_html).toBe("Remote");
    state.edit({ body_html: "Local" });
    const saving = state.flush();
    state.receive(draft(3, "Local")); result.resolve(draft(3, "Local"));
    await saving;
    expect(state.state.conflict).toBe(false);
    expect(state.state.dirty).toBe(false);
  });

  it("ignores older snapshots after an acknowledged save, both clean and dirty", async () => {
    const state = new SharedDraftStateMachine(async () => draft(2, "Saved"));
    state.receive(draft()); state.edit({ body_html: "Saved" }); await state.flush();
    state.receive(draft(1, "Old"));
    expect(state.state.content.body_html).toBe("Saved");
    expect(state.state.server?.revision).toBe(2);
    state.edit({ body_html: "New local edit" });
    state.receive(draft(1, "Old"));
    expect(state.state.conflict).toBe(false);
    expect(state.state.content.body_html).toBe("New local edit");
    state.reload(draft(2));
  });

  it("preserves unsaved input and offers conflict recovery when creation replay is terminal", async () => {
    const state = new SharedDraftStateMachine(async () => ({ ...draft(), state: "sent" }));
    state.receive(null); state.edit({ body_html: "Local order", attachment_ids: ["file1"] });
    await expect(state.flush()).rejects.toThrow("already ended");
    expect(state.state.conflict).toBe(true);
    expect(state.state.content.body_html).toBe("Local order");
    expect(state.state.content.attachment_ids).toEqual(["file1"]);
    state.reload(null);
  });

  it("uses an explicit reload to abandon local edits", () => {
    const state = new SharedDraftStateMachine(vi.fn());
    state.receive(draft()); state.edit({ body_html: "Local" });
    state.reload(draft(2, "Remote"));
    expect(state.state.content).toEqual(draftContent(draft(2, "Remote")));
    expect(state.state.dirty).toBe(false);
  });

  it("uses a new creation key after another teammate ends a saved draft", async () => {
    const write = vi.fn(async (_server: TicketDraft | null, content: DraftContent, _requestId: string) => ({ ...draft(), ...content }));
    const state = new SharedDraftStateMachine(write);
    state.receive(null);
    state.edit({ body_html: "First reply" });
    await state.flush();
    state.receive(null);
    state.edit({ body_html: "Next reply" });
    await state.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0][0]).toBeNull();
    expect(write.mock.calls[1][0]).toBeNull();
    expect(write.mock.calls[1][2]).not.toBe(write.mock.calls[0][2]);
  });
});
