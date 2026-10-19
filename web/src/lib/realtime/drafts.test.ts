import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Envelope } from "../api/types";
import { draftKey } from "../api/drafts";
import { applyEnvelope } from "./apply";
import { forgetTicket } from "../ticketCache";

const envelope = (type: string, data: Record<string, unknown>) => ({ type, data } as Envelope);
describe("shared draft realtime cache", () => {
  it.each(["created", "updated", "sent", "discarded"])("invalidates the affected draft on %s", (verb) => {
    const client = new QueryClient();
    client.setQueryData(draftKey("t1"), { draft: { id: "d1", revision: 1 } });
    client.setQueryData(draftKey("t2"), { draft: null });
    applyEnvelope(client, envelope(`ticket_draft.${verb}`, { ticket_id: "t1", draft_id: "d1", revision: 2, state: "draft" }), { me: "u1" });
    expect(client.getQueryState(draftKey("t1"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(draftKey("t2"))?.isInvalidated).toBe(false);
  });
  it("drops shared content when ticket visibility is revoked", () => {
    const client = new QueryClient();
    client.setQueryData(draftKey("t1"), { draft: { body_html: "Private order" } });
    forgetTicket(client, "t1");
    expect(client.getQueryData(draftKey("t1"))).toBeUndefined();
  });
});
