import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/endpoints";
import type { Attachment } from "@/lib/api/types";
import type { TicketDraft } from "@/lib/api/drafts";
import { SharedDraftStateMachine } from "./sharedDraftState";
import { useComposerUploads } from "./useComposerUploads";

vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const file = () => new File(["image"], "photo.png", { type: "image/png" });
const attachment: Attachment = { id: "file-1", filename: "photo.png", content_type: "image/png", size_bytes: 5, url: "/v1/attachments/file-1", inline: false };
const savedDraft = (attachments: Attachment[]): TicketDraft => ({
  id: "draft-1", ticket_id: "ticket-1", state: "draft", revision: 1, body_html: "", mailbox_id: null, cc: [], bcc: [], attachments,
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
let machine: SharedDraftStateMachine;
let uploads: ReturnType<typeof useComposerUploads>;
let mounted: boolean;

function Harness({ shared = true }: { shared?: boolean }) {
  uploads = useComposerUploads(shared, machine);
  return null;
}
async function run(action: () => void) { await act(async () => action()); }

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:preview");
    static revokeObjectURL = vi.fn();
  });
  machine = new SharedDraftStateMachine(vi.fn());
  machine.receive(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  await run(() => root.render(<Harness />));
});

afterEach(async () => {
  await run(() => {
    machine.reload(null);
    if (mounted) root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer upload ownership", () => {
  it("releases preview URLs when navigating away after a completed upload", async () => {
    vi.spyOn(api.attachments, "upload").mockResolvedValue(attachment);
    await run(() => uploads.upload([file()]));
    expect(uploads.uploads[0].status).toBe("done");
    await run(() => { root.unmount(); mounted = false; });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("ignores an upload response after its composer was unmounted", async () => {
    const pending = deferred<Attachment>();
    vi.spyOn(api.attachments, "upload").mockReturnValue(pending.promise);
    await run(() => uploads.upload([file()]));
    await run(() => { root.unmount(); mounted = false; });
    await run(() => pending.resolve(attachment));
    expect(machine.state.content.attachment_ids).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("keeps shared and local uploads bound to the mode in which they started", async () => {
    const sharedFile = deferred<Attachment>();
    const localFile = deferred<Attachment>();
    vi.spyOn(api.attachments, "upload").mockReturnValueOnce(sharedFile.promise).mockReturnValueOnce(localFile.promise);
    await run(() => uploads.upload([file()]));
    await run(() => root.render(<Harness shared={false} />));
    expect(uploads.uploads).toEqual([]);
    await run(() => uploads.upload([file()]));
    await run(() => sharedFile.resolve(attachment));
    expect(machine.state.content.attachment_ids).toEqual(["file-1"]);
    expect(uploads.uploads[0].status).toBe("uploading");
    await run(() => localFile.resolve({ ...attachment, id: "local-file" }));
    expect(uploads.attachmentIds).toEqual(["local-file"]);
    expect(machine.state.content.attachment_ids).toEqual(["file-1"]);
    await run(() => root.render(<Harness />));
    expect(uploads.attachmentIds).toEqual(["file-1"]);
  });

  it("releases completed files after remote termination while keeping an in-flight upload", async () => {
    const pending = deferred<Attachment>();
    vi.spyOn(api.attachments, "upload").mockResolvedValueOnce(attachment).mockReturnValueOnce(pending.promise);
    await run(() => uploads.upload([file(), file()]));
    await run(() => machine.reload(savedDraft([attachment])));
    expect(uploads.uploads).toHaveLength(2);
    await run(() => machine.receive(null));
    expect(uploads.uploads).toHaveLength(1);
    expect(uploads.uploads[0].status).toBe("uploading");
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    await run(() => pending.resolve({ ...attachment, id: "later-file" }));
    expect(machine.state.content.attachment_ids).toEqual(["later-file"]);
  });

  it("ignores removed and reset uploads without clearing the other mode's files", async () => {
    const removed = deferred<Attachment>();
    const reset = deferred<Attachment>();
    vi.spyOn(api.attachments, "upload").mockReturnValueOnce(removed.promise).mockReturnValueOnce(reset.promise).mockResolvedValueOnce({ ...attachment, id: "local-file" });
    await run(() => uploads.upload([file(), file()]));
    await run(() => uploads.remove(uploads.uploads[0]));
    await run(() => root.render(<Harness shared={false} />));
    await run(() => uploads.upload([file()]));
    await run(() => uploads.clearShared());
    await run(() => { removed.resolve(attachment); reset.resolve(attachment); });
    expect(machine.state.content.attachment_ids).toEqual([]);
    expect(uploads.attachmentIds).toEqual(["local-file"]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    await run(() => uploads.clearLocal());
    expect(uploads.uploads).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    await run(() => { root.unmount(); mounted = false; });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});
