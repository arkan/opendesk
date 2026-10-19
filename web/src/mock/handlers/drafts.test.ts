import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Ticket } from "@/lib/api/types";
import type { DraftPreview, TicketDraft } from "@/lib/api/drafts";
import { installMock } from "../index";
import { db } from "../db";
import { dispatch } from "../router";
import * as gateway from "../gateway";
import { pauseLive } from "../live";
import { isRecord } from "../util";

async function call(method: string, path: string, body?: unknown) {
  const response = await dispatch(`http://mock${path}`, { method, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

describe("mock shared email drafts", () => {
  beforeAll(() => { localStorage.clear(); installMock(); pauseLive(); });
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

  it.each([
    { name: "invalid mailbox type", change: { mailbox_id: 42 } },
    { name: "unknown mailbox", change: { mailbox_id: "missing-mailbox" } },
    { name: "too many attachments", change: { attachment_ids: Array.from({ length: 21 }, (_, i) => `file-${i}`) } },
  ])("preserves every saved field when a patch contains $name", async ({ name, change }) => {
    const tickets = (await call("GET", "/v1/tickets")).body.data as Ticket[];
    const ticket = tickets.find((t) => t.channel === "email" && t.contact?.email && t.mailbox_id)!;
    const path = `/v1/tickets/${ticket.id}/draft`;
    const created = await call("POST", path, {
      request_id: `atomic-${name}`, body_html: "<p>Original order</p>",
      mailbox_id: ticket.mailbox_id, cc: ["original@example.com"], bcc: [], attachment_ids: [],
    });
    expect(created.status).toBe(201);
    const saved = created.body.draft as TicketDraft;
    const identity = { draft_id: saved.id, expected_revision: saved.revision };
    const publish = vi.spyOn(gateway, "publish");
    try {
      const rejected = await call("PATCH", path, {
        ...identity, body_html: "<p>Rejected order</p>", mailbox_id: null,
        cc: ["changed@example.com"], bcc: ["private@example.com"], ...change,
      });
      expect(rejected.status).toBe(422);
      expect((await call("GET", path)).body.draft).toEqual(saved);
      expect(publish.mock.calls.filter(([, type]) => type.startsWith("ticket_draft."))).toEqual([]);
    } finally {
      publish.mockRestore();
      await call("DELETE", path, identity);
    }
  });

  it("requires a fresh review for an identical replacement draft", async () => {
    const tickets = (await call("GET", "/v1/tickets")).body.data as Ticket[];
    const ticket = tickets.find((t) => t.channel === "email" && t.contact?.email && t.mailbox_id)!;
    const path = `/v1/tickets/${ticket.id}/draft`;
    const input = { body_html: "<p>Identical order</p>", cc: [], bcc: [], attachment_ids: [], mailbox_id: null };
    const first = (await call("POST", path, { ...input, request_id: "review-first" })).body.draft as TicketDraft;
    const firstIdentity = { draft_id: first.id, expected_revision: first.revision };
    const preview = (await call("POST", `${path}/preview`, firstIdentity)).body as DraftPreview;
    expect((await call("DELETE", path, firstIdentity)).status).toBe(204);
    const replacement = (await call("POST", path, { ...input, request_id: "review-replacement" })).body.draft as TicketDraft;
    const identity = { draft_id: replacement.id, expected_revision: replacement.revision };
    const before = db.workspaces[0].messages.filter((m) => m.ticket_id === ticket.id).length;
    try {
      const rejected = await call("POST", `${path}/send`, { ...identity, review_token: preview.review_token });
      expect(rejected.status).toBe(409);
      expect((await call("GET", path)).body.draft).toEqual(replacement);
      expect(db.workspaces[0].messages.filter((m) => m.ticket_id === ticket.id)).toHaveLength(before);
    } finally {
      await call("DELETE", path, identity);
    }
  });

  it.each(["source", "destination"])("refuses merging with an active draft on the %s without changing either ticket", async (side) => {
    const listed = (await call("GET", "/v1/tickets")).body.data as Ticket[];
    const sample = listed.find((t) => t.channel === "email" && t.contact?.email && t.mailbox_id)!;
    const input = { mailbox_id: sample.mailbox_id, contact_id: sample.contact!.id, kind: "note", body_html: "<p>Internal context</p>" };
    const source = (await call("POST", "/v1/tickets", { ...input, subject: `Merge ${side} source` })).body as Ticket;
    const destination = (await call("POST", "/v1/tickets", { ...input, subject: `Merge ${side} destination` })).body as Ticket;
    const owner = side === "source" ? source : destination;
    const path = `/v1/tickets/${owner.id}/draft`;
    const created = await call("POST", path, { request_id: `merge-${side}`, body_html: "<p>Order awaiting review</p>" });
    expect(created.status).toBe(201);
    const saved = created.body.draft as TicketDraft;
    const ws = db.workspaces[0];
    const ids = [source.id, destination.id];
    const state = () => ({
      tickets: ws.tickets.filter((t) => ids.includes(t.id)),
      messages: ws.messages.filter((m) => ids.includes(m.ticket_id)),
      activities: ws.activities.filter((a) => ids.includes(a.ticket_id)),
    });
    const before = structuredClone(state());
    const publish = vi.spyOn(gateway, "publish");
    try {
      const rejected = await call("POST", `/v1/tickets/${source.id}/merge`, { into_id: destination.id });
      expect(rejected.status).toBe(409);
      expect(rejected.body.code).toBe("draft_merge_conflict");
      expect(state()).toEqual(before);
      expect((await call("GET", path)).body.draft).toEqual(saved);
      expect(publish.mock.calls.filter(([, , data]) =>
        ids.includes(String(data.ticket_id)) || isRecord(data.ticket) && ids.includes(String(data.ticket.id)),
      )).toEqual([]);
    } finally {
      publish.mockRestore();
      await call("DELETE", path, { draft_id: saved.id, expected_revision: saved.revision });
    }
    const merged = await call("POST", `/v1/tickets/${source.id}/merge`, { into_id: destination.id });
    expect(merged.status).toBe(201);
    expect(merged.body.id).toBe(destination.id);
    expect(ws.tickets.find((t) => t.id === source.id)?.status).toBe("closed");
  });
});
