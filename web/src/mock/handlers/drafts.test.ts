import { beforeAll, describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/api/types";
import type { DraftPreview, TicketDraft } from "@/lib/api/drafts";
import { installMock } from "../index";
import { db } from "../db";
import { dispatch } from "../router";

async function call(method: string, path: string, body?: unknown) {
  const response = await dispatch(`http://mock${path}`, { method, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

describe("mock shared email drafts", () => {
  beforeAll(() => { localStorage.clear(); installMock(); });
  it("saves without sending, refuses stale edits, previews and explicitly sends one reviewed revision", async () => {
    const tickets = (await call("GET", "/v1/tickets")).body.data as Ticket[];
    const ticket = tickets.find((t) => t.channel === "email" && t.contact?.email && t.mailbox_id)!;
    const path = `/v1/tickets/${ticket.id}/draft`;
    const before = db.workspaces[0].messages.filter((m) => m.ticket_id === ticket.id).length;
    expect((await call("GET", path)).body.draft).toBeNull();
    const input = { request_id: "order-1", body_html: "<p>Prepared order</p>", cc: [], bcc: [], attachment_ids: [], mailbox_id: null };
    const created = await call("POST", path, input);
    expect(created.status).toBe(201);
    let draft = created.body.draft as TicketDraft;
    expect(db.workspaces[0].messages.filter((m) => m.ticket_id === ticket.id)).toHaveLength(before);
    const replay = await call("POST", path, input);
    expect(replay.status).toBe(200); expect(replay.body.draft.id).toBe(draft.id);
    const updated = await call("PATCH", path, { draft_id: draft.id, expected_revision: draft.revision, body_html: "<p>Reviewed order</p>" });
    expect(updated.status).toBe(200); draft = updated.body.draft;
    expect((await call("PATCH", path, { draft_id: draft.id, expected_revision: 1, body_html: "Stale edit" })).status).toBe(409);
    const identity = { draft_id: draft.id, expected_revision: draft.revision };
    const preview = (await call("POST", `${path}/preview`, identity)).body as DraftPreview;
    expect(preview.body_html).toBe("<p>Reviewed order</p>");
    expect(preview.to).toEqual([ticket.contact!.email]);
    const sent = await call("POST", `${path}/send`, { ...identity, review_token: preview.review_token, status: "pending" });
    expect(sent.status).toBe(201); expect(sent.body.status).toBe("pending");
    const repeated = await call("POST", `${path}/send`, { ...identity, review_token: preview.review_token, status: "pending" });
    expect(repeated.status).toBe(200); expect(repeated.body.message_id).toBe(sent.body.message_id);
    expect(db.workspaces[0].messages.filter((m) => m.ticket_id === ticket.id)).toHaveLength(before + 1);
    expect((await call("GET", path)).body.draft).toBeNull();
  });
});
