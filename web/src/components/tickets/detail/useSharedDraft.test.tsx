import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftApi, draftKey, type TicketDraft } from "@/lib/api/drafts";
import { useSharedDraft } from "./useSharedDraft";

vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));

const draft = (revision = 1, body_html = "<p>Original</p>"): TicketDraft => ({
  id: "draft-1", ticket_id: "ticket-1", state: "draft", revision, body_html,
  mailbox_id: null, cc: [], bcc: [], attachments: [],
  created_by: { type: "user", id: "user-1" }, updated_by: { type: "user", id: "user-1" },
  created_at: "2026-01-01", updated_at: "2026-01-01", ended_at: null, message_id: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: Root;
let host: HTMLDivElement;
let qc: QueryClient;
let shared: ReturnType<typeof useSharedDraft>;

function Harness() {
  shared = useSharedDraft("ticket-1", true);
  return null;
}

async function run(action: () => void | Promise<unknown>) {
  await act(async () => {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(draftKey("ticket-1"), { draft: draft() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>));
});

afterEach(() => {
  act(() => {
    shared.machine.reload(null);
    root.unmount();
  });
  qc.clear();
  host.remove();
  vi.restoreAllMocks();
});

describe("shared draft query synchronization", () => {
  it("ignores an old GET that resolves after its cancellation by a save", async () => {
    const oldRead = deferred<{ draft: TicketDraft | null }>();
    vi.spyOn(draftApi, "get").mockReturnValueOnce(oldRead.promise).mockResolvedValue({ draft: draft(2, "<p>Saved</p>") });
    vi.spyOn(draftApi, "update").mockResolvedValue({ draft: draft(2, "<p>Saved</p>") });
    await run(() => { void qc.invalidateQueries({ queryKey: draftKey("ticket-1") }); });
    await run(() => {
      shared.machine.edit({ body_html: "<p>Saved</p>" });
      return shared.machine.flush();
    });
    await run(() => oldRead.resolve({ draft: draft() }));
    expect(shared.server?.revision).toBe(2);
    expect(shared.content.body_html).toBe("<p>Saved</p>");
    expect(qc.getQueryData(draftKey("ticket-1"))).toEqual({ draft: draft(2, "<p>Saved</p>") });
  });

  it.each([
    { state: "sent", latest: null },
    { state: "replaced", latest: { ...draft(), id: "draft-2" } },
  ])("does not resurrect a draft $state by a teammate before a delayed save acknowledgement", async ({ latest }) => {
    const update = deferred<{ draft: TicketDraft }>();
    vi.spyOn(draftApi, "update").mockReturnValue(update.promise);
    vi.spyOn(draftApi, "get").mockResolvedValue({ draft: latest });
    let saving!: Promise<TicketDraft | null>;
    await run(() => {
      shared.machine.edit({ body_html: "<p>Saved</p>" });
      saving = shared.machine.flush();
    });
    await run(() => qc.invalidateQueries({ queryKey: draftKey("ticket-1") }));
    await run(async () => {
      update.resolve({ draft: draft(2, "<p>Saved</p>") });
      await saving;
    });
    expect(shared.server).toEqual(latest);
    expect(shared.content.body_html).toBe(latest?.body_html ?? "");
    expect(qc.getQueryData(draftKey("ticket-1"))).toEqual({ draft: latest });
  });

  it("preserves newer local edits when reconciliation discovers a remotely ended draft", async () => {
    const currentRead = deferred<{ draft: TicketDraft | null }>();
    vi.spyOn(draftApi, "get").mockReturnValue(currentRead.promise);
    const update = vi.spyOn(draftApi, "update").mockResolvedValue({ draft: draft(2, "<p>Saved</p>") });
    await run(() => {
      shared.machine.edit({ body_html: "<p>Saved</p>" });
      return shared.machine.flush();
    });
    await run(() => shared.machine.edit({ body_html: "<p>New local edit</p>", attachment_ids: ["local-file"] }));
    await run(() => currentRead.resolve({ draft: null }));
    await vi.waitFor(async () => {
      await run(() => {});
      expect(shared.conflict).toBe(true);
    });
    expect(shared.content.body_html).toBe("<p>New local edit</p>");
    expect(shared.content.attachment_ids).toEqual(["local-file"]);
    expect(shared.dirty).toBe(true);
    expect(shared.conflict).toBe(true);
    await expect(shared.machine.flush()).rejects.toThrow("shared draft changed");
    expect(update).toHaveBeenCalledOnce();
  });
});
