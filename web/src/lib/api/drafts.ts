import { http, requestBlob } from "./client";
import type { Attachment, TicketStatus } from "./types";

export type TicketDraft = {
  id: string; ticket_id: string; state: "draft" | "sent" | "discarded"; revision: number;
  body_html: string; mailbox_id: string | null; cc: string[]; bcc: string[]; attachments: Attachment[];
  created_by: { type: "user" | "api"; id: string | null }; updated_by: { type: "user" | "api"; id: string | null };
  created_at: string; updated_at: string; ended_at: string | null; message_id: string | null;
};
export type DraftContent = { body_html: string; mailbox_id: string | null; cc: string[]; bcc: string[]; attachment_ids: string[] };
export type DraftIdentity = { draft_id: string; expected_revision: number };
export type DraftPreview = {
  draft_id: string; revision: number; subject: string; from: { email: string; name: string };
  to: string[]; cc: string[]; bcc: string[]; body_html: string; signature_html: string;
  attachments: Attachment[]; review_token: string;
};
const path = (id: string) => `/v1/tickets/${encodeURIComponent(id)}/draft`;
export const draftApi = {
  get: (id: string) => http.get<{ draft: TicketDraft | null }>(path(id)),
  create: (id: string, body: DraftContent & { request_id: string }) => http.post<{ draft: TicketDraft }>(path(id), body),
  update: (id: string, body: DraftContent & DraftIdentity) => http.patch<{ draft: TicketDraft }>(path(id), body),
  discard: (id: string, body: DraftIdentity) => http.del(path(id), body),
  preview: (id: string, body: DraftIdentity) => http.post<DraftPreview>(`${path(id)}/preview`, body),
  send: (id: string, body: DraftIdentity & { review_token: string; status?: TicketStatus }) =>
    http.post<{ message_id: string; ticket_id: string; status: TicketStatus; delivery_status: string }>(`${path(id)}/send`, body),
  attachment: (id: string) => requestBlob(`/v1/attachments/${encodeURIComponent(id)}`),
};
export const draftKey = (id: string) => ["tickets", "draft", id] as const;
export const draftIdentity = (draft: TicketDraft): DraftIdentity => ({ draft_id: draft.id, expected_revision: draft.revision });
export const draftContent = (draft: TicketDraft): DraftContent => ({
  body_html: draft.body_html, mailbox_id: draft.mailbox_id, cc: draft.cc, bcc: draft.bcc,
  attachment_ids: draft.attachments.map((a) => a.id),
});
export const emptyDraftContent = (): DraftContent => ({ body_html: "", mailbox_id: null, cc: [], bcc: [], attachment_ids: [] });
