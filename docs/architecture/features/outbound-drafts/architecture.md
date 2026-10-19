# Shared email drafts: architecture proposal

Status: Approved, including the file-provenance amendment, on 2026-10-19. Independent technical review PASS. Implemented as a local patch on 2026-10-19.
Functional scope, tests and sharing of manually started email drafts are approved.
Canonical specification: [shared email drafts](../../../specs/outbound-drafts.md).

## Boundaries and alternatives

**New:** durable draft identities, active file reservations and preparation references in PostgreSQL.
**Modified:** ticket creation, email reply composer, file access/cleanup, explicit send, MCP catalog and outbound recipient handling.
**Reused:** `domain.CreateTicket`, `domain.AddMessage`, templates, River, outbox, NATS, permissions and provider connections.
**Unchanged:** internal-note/chat composer persistence, existing immediate-send defaults, plans and hosting model.

Keep orchestration in `internal/helpdesk/tickets`, with focused draft API, state and preview files.
Extract one prepared-reply builder from `postMessage`; draft send and immediate send share validation and normal rendering.
Reuse the narrow `internal/email.replyDestination` helper through `ResolveDraftAddress`, shared by preview, draft send and the existing worker.
This helper preserves the current authenticated same-domain Reply-To rules; it owns no delivery or credentials.
Do not make draft handlers call HTTP handlers internally. MCP continues calling the public API in process.

Separate drafts from `messages` because message creation publishes events, changes conversation counters and can queue delivery.
Retain terminal draft identities to prevent a retry from sending again after the 24-hour HTTP replay window.
Represent preparation protection with unreleased `ticket_preparations` rows; no new ticket status or ticket JSON field is needed.

## Public API proposal

All routes use existing bearer/session authentication, workspace resolution, private-team visibility and error conventions.
Path `{id}` uses existing UUID/number references. Hidden and missing tickets return `404 not_found` before draft/reference disclosure.
Unknown request members remain invalid. New JSON payloads contain file IDs, never file bytes.

| Operation | Full feature-specific input | Success |
| --- | --- | --- |
| Existing `POST /v1/tickets` | Add optional `preparation: {namespace, reference}`. Namespace: 1..100 chars; reference: 1..255 chars; both case-sensitive. Existing ticket fields remain unchanged. Preparation requires an email contact and mailbox; omitted kind becomes `note`, explicit `reply` is rejected. | Existing `Ticket` shape; 201 on creation, 200 on durable replay; no new fields. |
| `GET /v1/tickets/{id}/draft` | No body. | 200 `{draft: Draft \| null}` for the current active draft. Viewer+ and `tickets:read`. |
| `POST /v1/tickets/{id}/draft` | Required `request_id` string 1..255. Optional `body_html` default empty, `mailbox_id` UUID/null default inherit, `cc`/`bcc` default empty, `attachment_ids` default empty. | 201 `{draft: Draft}`; 200 for the same creation key and original input, including a terminal identity. Agent+ and `tickets:write`. |
| `PATCH /v1/tickets/{id}/draft` | Required `draft_id` UUID, `expected_revision` integer >=1. Optional `body_html`, `mailbox_id`, `cc`, `bcc`, `attachment_ids`; omissions keep current values. `mailbox_id:null` restores inheritance. | 200 `{draft: Draft}`. Agent+ and `tickets:write`. |
| `DELETE /v1/tickets/{id}/draft` | JSON `{draft_id, expected_revision}`. | 204; same discarded identity repeats safely; a sent identity conflicts. Agent+ and `tickets:write`. |
| `POST /v1/tickets/{id}/draft/preview` | JSON `{draft_id, expected_revision}`. | 200 `DraftPreview`; agent+ and `tickets:read`. No delivery or public message. |
| `POST /v1/tickets/{id}/draft/send` | JSON `{draft_id, expected_revision, review_token, status?}`. Optional status uses the existing ticket-status enum and solve-field validation. | 201 `{message_id, ticket_id, status, delivery_status}`; 200 with the same result for a sent identity. Agent+ and `tickets:write`. |

Draft saves allow empty content while composing. Explicit send requires text, an inline image or a file, as normal replies do.
HTML has the existing 500,000-character maximum. Cc/Bcc each allow 20 valid addresses; attachment IDs allow 20 distinct files.
Feature draft POSTs and preparation-enabled ticket creation use their durable identities instead of raw response replay.
Exclude `/v1/tickets/{id}/draft` and its preview/send subroutes from response caching before a cached answer can be returned.
For `POST /v1/tickets`, a bounded top-level preparation-object check selects this bypass; legacy requests keep their existing replay behavior.
Every feature retry enters its handler, resolves current role/scope/visibility and then returns the authorized current result.
Retain optional Idempotency-Key syntax validation, but do not store/replay feature response bodies at this transport layer.
Draft bodies are sanitized on save. Template variables are filled once when constructing the explicit outgoing message.

`Draft` always contains: `id`, `ticket_id`, `state`, `revision`, `body_html`, `mailbox_id`, `cc`, `bcc`, `attachments`,
`created_by`, `updated_by`, `created_at`, `updated_at`, `ended_at`, `message_id`.
UUID references/timestamps are strings; `mailbox_id`, `ended_at`, `message_id` are nullable.
`created_by` and `updated_by` are `{type: "user"|"api", id: UUID|null}`; principal deletion leaves a typed null identity.
`attachments` uses the existing full `Attachment` shape. `state` is `draft`, `sent` or `discarded`.
All listed Draft members remain present in terminal responses: body_html is empty, mailbox_id is null, cc/bcc/attachments are empty arrays.
Identity, state, revision, actor/timestamp fields and nullable message_id retain their declared values; ended_at is non-null.
Returning a sent result also verifies visibility of the message's current ticket after any merge.
Send replay guarantees the same message_id and reads its current ticket_id/status/delivery_status after current visibility checks.
It does not replay an immutable acceptance snapshot. A reopened ticket or failed delivery is reflected in the returned current values.

`DraftPreview` contains `draft_id`, `revision`, `subject`, `from: {email,name}`, `to`, `cc`, `bcc`,
`body_html`, `signature_html`, `attachments` and `review_token`.
Recipients, rendered content and signature are computed through the normal addressing/template rules for the reviewing principal.
The preview is not a new public message and is not stored as draft content.

| Failure | HTTP/code | Behavior |
| --- | --- | --- |
| Hidden/missing ticket or draft identity | 404 `not_found` | No identity/visibility disclosure. |
| Wrong role/scope/sender access | 403 `forbidden` | Existing permission behavior. |
| Bad file, contact, HTML, mailbox or request | 422 `validation_failed`; existing `mailbox_cannot_send` when applicable | No mutation or enqueue. |
| Another active draft | 409 `draft_exists` | Explicit update is required. |
| Creation key/reference reused with changed input | 409 `draft_request_conflict` / `preparation_conflict` | Compare original normalized input, not mutable content. |
| Stale revision or changed review context | 409 `draft_revision_conflict` / `draft_context_changed` | Preserve edits; reload and review. |
| Discarded or sent state conflicts with requested operation | 409 `draft_not_active` | No implicit new draft or resend. |
| Deleted preparation/send result | 410 `preparation_result_gone` / `draft_result_gone` | Do not recreate or resend. |
| Merge with an active draft | 409 `draft_merge_conflict` | Explicitly send or discard first; never silently move/replace a draft. |

Use the standard problem body: `status`, `title`, `code`, `detail` and request ID when middleware provides it.
MCP preserves its existing tool-error envelope rather than inventing an HTTP response inside a tool result.

## MCP proposal

Extend `create_ticket` with the same optional preparation object; existing calls preserve their defaults.
Add `get_ticket_draft`, `create_ticket_draft`, `update_ticket_draft`, `discard_ticket_draft`, `preview_ticket_draft` and `upload_attachment`.
Tool arguments use `ticket` as the existing ticket reference. Draft writes accept `body` markdown instead of `body_html`.
Convert markdown through the current converter before calling the same HTTP API.
Allow an omitted/empty create body and an explicitly empty update body; bypass the existing nonempty-message wrapper for those composing states.
Create/update/discard require `tickets:write`; read/preview require `tickets:read` and the API's role checks.
No new send tool is included; existing immediate-send tools remain explicit sends.
Read/create/update tools return the corresponding API JSON. Discard returns `{discarded:true}` after the API's 204 result.

`upload_attachment` requires `{filename, content_base64}` and returns the existing `Attachment` object.
Decode standard base64 with no data-URL prefix, at most 26,214,400 decoded bytes and 34,952,536 encoded characters.
Supply bytes as bounded multipart to the existing attachment route with the same principal; do not accept paths or remote URLs.
The current MCP HTTP body cap is 1 MiB (`server.go`), so explicitly raise it to 36 MiB for this transport.
Exclude the outer `/mcp` endpoint from raw response caching before body hashing, so every tool call authenticates and checks current tool permissions.
Existing legacy write tools retain derived idempotency on their inner API calls; draft/preparation inner calls use the same feature bypass as HTTP clients.
The MCP upload wrapper explicitly verifies current agent role and tickets:write before its existing upload API call, including any inner upload replay.
The outer idempotency middleware's existing 32 MiB bound stays unchanged; bypassing `/mcp` before it allows bounded 36 MiB MCP parsing.
Preserve authentication, rate limiting, origin checks and cancellation before bounded parsing/decoding.
Clients with lower limits can upload over HTTP using the same principal and pass resulting IDs through MCP.
Do not log tool arguments, file bytes or encoded content.

## State, concurrency and review

Lifecycle: missing → draft; draft → draft on edit; draft → sent or discarded on explicit terminal action.
Sending/discarding clears content and reservations but retains the original creation identity and terminal result.
A later reply uses a new draft ID and creation key. Automatic expiration is not introduced.

Use a consistent lock order: visible ticket row, draft row, then attachment rows sorted by UUID.
Reference creation claims `(workspace_id,namespace,reference)` in the same transaction before committing a ticket result.
On retry, read the existing reference without locking it ahead of the ticket; recheck current ticket visibility before comparing the fingerprint or returning its result.
Fingerprint validated canonical caller input, preserving a versioned normalizer. Do not fingerprint mutable loaded contact/ticket state.
Use domain-separated HMAC with the existing instance secret; hash rotation/migration follows instance-secret changes, not user API-key rotation.
If secret rotation is introduced later, migrate or retain the fingerprint key version before accepting new retries.

Creation keys and original input hashes survive edits and terminal transitions.
PATCH is atomic: stale revisions change nothing; identical replacement values can return the current revision without another event.
A retry after an uncertain PATCH outcome reads the current draft and reconciles; it never retries with an invented new revision.

Before send, obtain a preview of the saved revision.
Its opaque `review_token` is an HMAC binding workspace, ticket, draft ID/revision, reviewing principal and effective send context.
Context includes contact/validated Reply-To, mailbox/from selection, subject, latest public-message identity, rendered body/signature and file identities.
Send locks the ticket/draft, loads current context once, validates the token, then uses those same values to construct the message.
Changes to contact, sender, subject, latest public message or template preview require a fresh review.
Signature/layout rendering at eventual provider delivery keeps the existing worker behavior; the preview is not a frozen MIME artifact.

The worker currently resolves Reply-To again during delivery. Reviewed draft sends must freeze their validated To/Cc/Bcc at queue acceptance.
Add internal `messages.recipient_locked boolean NOT NULL DEFAULT false`; draft sends set true, legacy sends retain false.
The normal worker skips late recipient re-resolution only for that flag. No new arbitrary-recipient override is exposed.

## Preparation and send transactions

**Ticket preparation:** validate identity/input → claim durable reference → create ticket/internal note through domain helpers → record result → commit events/jobs.
Ticket and draft remain separate calls/transactions. A failed upload/draft call leaves a safe context-only ticket.
An unreleased preparation row blocks all ticket-driven customer emails, including automation, AI, auto-replies and CSAT.
Check the guard in producer paths and at the domain outgoing-message boundary. Scheduled ticket-email workers also recheck it.
Normal SLA/assignment/internal notifications can run; they do not constitute approval to send customer email.
An existing direct reply endpoint counts as an explicit send after its current permission checks; it can release preparation protection.
Legacy immediate sends do not consume or discard a shared draft implicitly; their new public message invalidates that draft's prior review context.
Never release protection merely because the draft is saved/discarded or the ticket is marked solved.

**Draft send:** verify visibility/current write permission → lock draft → return an existing sent result if authorized → check revision/review token →
validate exactly its reserved files → create the normal message with `domain.AddMessage` → link all reserved files → record terminal result →
release preparation rows → apply requested status → publish events and insert jobs → commit.
Treat file-link row-count mismatches as rollback errors. One draft may create only one message.
Retain uploader provenance; add a narrowly scoped reservation-aware link path rather than relaxing all upload ownership checks.
Existing ordinary message sends reject reserved files, including files uploaded by that same caller.
The internal message input carries a draft identity for reservation checks and an explicit preparation-approval flag.
Neither field is accepted from public message JSON. Only permission-checked send handlers set the approval flag.

## Composer and realtime

Email reply mode uses server drafts for every origin. Note/chat modes retain their existing behavior.
This lifecycle starts after a ticket exists. The existing unsaved new-ticket form retains its explicit creation behavior.
Debounce shared saves by 400 ms; serialize mutations per ticket and flush pending saves before preview/send or navigation.
Display saving/saved/failure state. Only acknowledged saves are guaranteed after browser closure.
While saving fails or conflicts, preserve the local text and files and disable sending stale server content.
On a clean editor, realtime invalidation reloads the shared draft. On a dirty editor, offer reload or explicit replacement after reviewing the conflict.
Keep one active editor lifecycle per ticket; never append a new draft over an existing one.
Ollie's suggestions remain separate suggestions. Inserting one is an explicit composer edit with the same revision checks.
Do not auto-copy suggestions into a draft or replace draft content because a suggestion arrives.

Publish `ticket_draft.created`, `.updated`, `.sent` and `.discarded` as agents-only outbox events.
Data is `{ticket_id,draft_id,revision,state}`; always set `events.Event.TicketID` for private-team routing.
Events invalidate draft queries; they do not broadcast body text, Bcc lists, file contents or review tokens.
Use existing assignment/label views initially; a new draft-list/filter feature is outside this architecture.

## File and ticket lifecycle proposals requiring approval

- Explicit discard is available through UI, API and MCP with revision checks. It is not an undo/history feature.
- Removing/discarding files releases reservations. Unattached files return to the existing 24-hour cleanup policy; do not delete a shared storage object inline.
- Persist attachments.draft_ticket_id when an upload first joins a draft. It records the file's current draft-origin ticket even after removal/discard.
- Active reservations still control retention/linking; provenance alone does not prevent the existing stale-upload cleanup.
- For an unsent file with draft_ticket_id, check a current authenticated member/key and visible, non-deleted originating ticket before any legacy signed-link branch.
- Existing generic upload signatures never authorize this draft-origin path. Draft/preview Attachment.url is the protected unsigned API URL.
- The browser fetches file bytes with its normal access authorization and uses local blob URLs for previews/downloads; it does not embed bearer tokens in URLs.
- Stream draft-origin files through the authorized API with private,no-store. Do not issue new external storage redirects for them.
- A storage URL issued before draft association can remain valid for its existing maximum of five minutes. Already delivered bytes cannot be recalled.
- Removal/discard preserves draft_ticket_id until the file is purged or explicitly linked to a normal message. Ordinary reuse checks uploader ownership, origin visibility and destination visibility.
- Linking to a committed message clears draft_ticket_id in the same transaction; the existing message-based access policy then owns the file.
- Cleanup locks and rechecks both message linkage and reservation before deletion, including its final claim query.
- Soft-deleted tickets expose no draft/file reads or writes. Physical deletion cascades draft identities/memberships.
- Durable preparation references become tombstones after physical ticket deletion and remain until workspace deletion.
- Reject merges while either ticket has an active draft. With no active drafts, merge redirects preparation references to the survivor, preserving unreleased protection.
- Terminal draft identities stay with their original ticket. Repeated send-result reads also verify visibility of a message moved by merge.

## Migration and release

Use paired up/down migrations numbered above 000635; recheck the highest number immediately before implementation.
Add the three tables, existing-table composite unique indexes, internal messages.recipient_locked with default false, and nullable attachments.draft_ticket_id.
Use a tenant-safe FK for draft_ticket_id to tickets(workspace_id,id), cascading file rows on physical ticket deletion; index workspace_id/draft_ticket_id.
Workspace deletion already collects stored-file keys before removing workspace rows. Any hard-ticket deletion path must also collect draft-origin file keys before cascade.
No existing unsent browser content can be backfilled from server data; it currently exists only in the client process.
Deploy schema first, then backend/MCP, then the email composer. Keep new routes unavailable until their migration exists.
Existing sends retain default behavior; no change to public Ticket or Message JSON is required.

An old backend does not honor file reservations or preparation protection.
For self-hosted role=all, stop the old process before starting the new binary, as normal maintenance.
For hosted split roles, stop/replace old workers and drain old API tasks before enabling preparation/draft writes on the new version.
Use the process-local SHARED_DRAFTS_ENABLED instance rollout switch, default off for hosted promotion and on for self-hosts.
Expose no workspace/plan feature gate. Enable it after draining old API/workers, then release the updated composer.
Do not allow mixed-version workers to purge uploads referenced by new drafts.
The down migration refuses to run while any draft identity, reservation, preparation reference, draft-origin file or locked-recipient message remains.
This prevents a rollback from silently discarding draft state or retry guarantees. Use forward fixes after enabling writes.

## Verification and approval

Use the approved API/MCP integration seams and browser flow.
Add races for create/create, update/update, send/send, send/discard, reservation/ordinary-send and reservation/purge.
Test durable creation after 24 hours; reference lookup after edits/deletion/merge; current permissions after role/team changes.
Verify no automatic email before first explicit send, including ticket status changes and CSAT.
Repeat HTTP/MCP feature calls with the same transport key after role/private-team changes, deletion and merge; current authorization must still run.
Test draft-origin file access with old generic signatures after reservation, removal, discard, soft deletion and team/role changes.
Verify the draft file handler streams without an external redirect; separately document the bounded lifetime of any pre-association storage redirect.
Verify reviewed Reply-To remains unchanged if another inbound message arrives after queue acceptance.
Verify manual email autosave/reload, stale edits and Ollie insertion; preserve note/chat and immediate-send regressions.
Check migration reversibility on an empty feature state and intentional refusal on populated feature state.

Baseline architecture approval was given on 2026-10-19, including the lifecycle and migration choices.
The review correction adds durable draft-file provenance and authenticated streaming; the user approved this amendment on 2026-10-19.
Targeted independent design review passed; [review record](review.md).
The user subsequently authorized implementation as a local patch. See [implementation verification](verification.md).
Local PostgreSQL migration behavior is verified. Production schema and provider delivery remain unverified. Informix is not involved.

## Target data contract

Status: Approved target data contract, including attachments.draft_ticket_id; independent technical review PASS. Not implemented or live-verified.

### Table map

| Table | Grain, owner and lifecycle |
| --- | --- |
| `ticket_drafts` (new) | One draft identity, retained after sending or discarding; at most one active draft per ticket. Owner: helpdesk/tickets. No automatic expiration. Terminal identities remain with the ticket; physical ticket/workspace deletion cascades. Send/discard clears body, Cc/Bcc and mailbox selection and removes active attachment reservations; keep identity, original hash, attribution and committed message result. |
| `ticket_draft_attachments` (new) | One currently reserved file in one active draft. Owner: helpdesk/tickets. Remove reservation on removal, discard or committed send. Existing cleanup handles genuinely unattached/unreserved files after its existing threshold. |
| `ticket_preparations` (new) | One durable creation reference in a workspace and caller-chosen namespace. Owner: helpdesk/tickets. Retain until workspace deletion, including after 24-hour HTTP replay expiry. A NULL ticket result is a tombstone and returns 410; never recreate it automatically. |

Relationships: workspace → tickets → draft identities; active draft → reserved attachments; preparation reference → ticket; sent draft → outgoing message; unsent draft-origin file → its ticket.

Draft→ticket and membership→draft/file use tenant-safe physical FKs. attachments.draft_ticket_id uses the same tenant-safe ticket key. Preparation→ticket and sent-draft→message use global UUID FKs plus workspace-checked writes.

### ticket_drafts

| Column / exact type | Null/default/key rules | Meaning and source | Writer / moment | Reader / use |
| --- | --- | --- | --- | --- |
| `id uuid` | PK; required; application-generated UUIDv7; no SQL default | Identity generated at creation; never reused. | create | all draft operations and retry lookup |
| `workspace_id uuid` | required; FK workspaces ON DELETE CASCADE | Principal workspace; never supplied by client. | create | all tenant-scoped operations |
| `ticket_id uuid` | required; composite FK (workspace_id,ticket_id) to tickets(workspace_id,id) ON DELETE CASCADE | Visible email ticket supplied by caller. | create | composer, API/MCP and access checks |
| `creation_key text` | required; length 1..255; unique with workspace_id,ticket_id | Caller request_id; browser generates a stable UUID for initial save. | create only | durable create replay |
| `creation_hash bytea` | required; octet_length=32 | Domain-separated HMAC of canonical original create input, including ordered attachment IDs. | create only | same-key/different-input detection; not derived from mutable draft |
| `hash_version smallint` | required; default 1; CHECK=1 | Canonicalization/HMAC format version. | create only | replay comparison across future versions |
| `state text` | required; default 'draft'; CHECK IN ('draft','sent','discarded') | Active draft, consumed outgoing message, or explicitly discarded draft. | create/send/discard | active lookup and terminal retry protection |
| `revision bigint` | required; default 1; CHECK >=1 | Server version incremented on each edit or terminal transition. | update/send/discard | optimistic concurrency |
| `body_html text` | required; default ''; <=500000 characters by validator | Sanitized caller HTML; MCP markdown converts before validation. Templates stay unfilled until explicit send. | create/update | editor, preview and normal reply rendering |
| `mailbox_id uuid` | nullable; FK mailboxes ON DELETE SET NULL; default NULL | Selected sending mailbox; NULL inherits the current ticket mailbox. Workspace/brand/send checks apply. | create/update | preview and send |
| `cc_emails text[]` | required; default '{}'; <=20 entries | Validated, normalized caller Cc list; order preserved. | create/update | preview and message creation |
| `bcc_emails text[]` | required; default '{}'; <=20 entries | Validated, normalized caller Bcc list; order preserved. | create/update | preview and message creation |
| `created_by_type text` | required; CHECK IN ('user','api') | Principal kind at creation, preserved if its referenced principal is deleted. | create | attribution |
| `created_by_user_id uuid` | nullable; FK users ON DELETE SET NULL | Authenticated user for browser/OAuth creation, otherwise NULL. | create | attribution |
| `created_by_api_key_id uuid` | nullable; FK api_keys ON DELETE SET NULL | API key for key-authenticated creation, otherwise NULL. | create | upload provenance and attribution |
| `updated_by_type text` | required; CHECK IN ('user','api') | Principal kind of the latest edit or terminal action. | create/update/send/discard | shared change attribution |
| `updated_by_user_id uuid` | nullable; FK users ON DELETE SET NULL | Latest authenticated user actor, otherwise NULL. | create/update/send/discard | attribution |
| `updated_by_api_key_id uuid` | nullable; FK api_keys ON DELETE SET NULL | Latest API key actor, otherwise NULL. | create/update/send/discard | attribution |
| `message_id uuid` | nullable; FK messages ON DELETE SET NULL; default NULL | Committed outgoing message for state=sent; NULL before send or if the message was physically purged. | send only | repeat-send result without re-enqueueing |
| `created_at timestamptz` | required; default now() | Server creation time in UTC. | create | metadata |
| `updated_at timestamptz` | required; default now() | Server time of latest successful mutation. | create/update/send/discard | metadata |
| `ended_at timestamptz` | nullable; default NULL; NULL iff state=draft | Server time of send acceptance or discard, not provider delivery time. | send/discard | terminal lifecycle |

- UNIQUE(workspace_id,id) for tenant-safe membership references.
- UNIQUE(workspace_id,ticket_id,creation_key) retains durable creation identity.
- Partial UNIQUE(workspace_id,ticket_id) WHERE state='draft' permits only one active shared draft.
- Actor kind rejects a non-NULL reference of the other kind; deletion can leave both principal references NULL.
- Only state=sent may have a non-NULL message_id. A sent row with a deleted message remains terminal.

### ticket_draft_attachments

| Column / exact type | Null/default/key rules | Meaning and source | Writer / moment | Reader / use |
| --- | --- | --- | --- | --- |
| `workspace_id uuid` | required | Principal workspace, copied from the locked draft. | create/update | tenant scoping |
| `draft_id uuid` | required; composite FK (workspace_id,draft_id) to ticket_drafts(workspace_id,id) ON DELETE CASCADE | The active draft reserving the file. | create/update | draft reads, access and cleanup exclusion |
| `attachment_id uuid` | required; composite FK (workspace_id,attachment_id) to attachments(workspace_id,id) ON DELETE CASCADE | Validated fresh upload or existing reservation on this draft. | create/update | normal stored bytes and final message attachment |
| `position smallint` | required; CHECK BETWEEN 0 AND 19 | Zero-based position in caller attachment_ids, without duplicates. | create/update | stable preview/send attachment order |

- PRIMARY KEY(draft_id,attachment_id).
- UNIQUE(attachment_id) reserves a file for at most one active draft.
- UNIQUE(draft_id,position).
- Membership changes lock the draft and attachment rows. Ordinary message linking excludes reserved uploads.

### ticket_preparations

| Column / exact type | Null/default/key rules | Meaning and source | Writer / moment | Reader / use |
| --- | --- | --- | --- | --- |
| `workspace_id uuid` | required; FK workspaces ON DELETE CASCADE | Workspace from principal. | create | all reference lookups |
| `namespace text` | required; length 1..100 | Stable integration namespace from preparation.namespace, for example weekly-orders. | create only | reference uniqueness across key rotations and API/MCP callers |
| `reference text` | required; length 1..255 | Stable caller order/creation identifier from preparation.reference; case-sensitive. | create only | durable duplicate detection |
| `request_hash bytea` | required; octet_length=32 | Domain-separated HMAC of canonical original ticket-creation input; excludes the preparation identity itself. | create only | detect changed original input without comparing agent-edited content |
| `hash_version smallint` | required; default 1; CHECK=1 | Version of normalization and hashing. | create only | stable retry comparison |
| `ticket_id uuid` | nullable; FK tickets ON DELETE SET NULL | Created ticket, set before creation transaction commits; NULL means physically deleted result. Writes verify the same workspace. | create; merge redirects to surviving ticket | repeat creation result and preparation guard |
| `created_at timestamptz` | required; default now() | Server time of first creation. | create | provenance |
| `released_at timestamptz` | nullable; default NULL | First explicit outgoing send releases preparation protection; discard or status change does not release it. | explicit send only | outbound automation guard |

- PRIMARY KEY(workspace_id,namespace,reference).
- Partial INDEX(workspace_id,ticket_id) WHERE released_at IS NULL AND ticket_id IS NOT NULL.
- Reference ownership is the workspace, not a particular API key. Every result lookup rechecks current ticket visibility.

### Existing tables: focused changes and uses

| Table | Used fields and evidence | Change and impact |
| --- | --- | --- |
| `tickets` | id uuid PK default gen_random_uuid(); workspace_id uuid NOT NULL FK workspaces CASCADE; number bigint NOT NULL; subject text NOT NULL default ''; channel text NOT NULL CHECK email/chat/api/portal; status text NOT NULL default open CHECK open/pending/on_hold/solved/closed; contact_id/mailbox_id/assignee_id/team_id nullable UUID FKs SET NULL; brand_id uuid NOT NULL FK brands RESTRICT; received_at text NOT NULL default ''; deleted_at timestamptz nullable; merged_into_id uuid nullable FK tickets SET NULL. number and received_at supply subject/thread/alias context. Evidence: `migrations/000001_init.up.sql; internal/helpdesk/tickets/tickets.go; internal/domain/types.go; migrations/000621_teams_brands.up.sql`. | Add UNIQUE(workspace_id,id) as a target for the draft composite FK; no new columns or response fields. Existing JSON shape/defaults stay unchanged; preparation protection is derived from ticket_preparations. |
| `attachments` | id uuid PK default gen_random_uuid(); workspace_id uuid NOT NULL FK workspaces CASCADE; message_id uuid nullable FK messages CASCADE; filename text NOT NULL (no default); content_type text NOT NULL default application/octet-stream; storage_key text NOT NULL (no default); size_bytes bigint NOT NULL (no default); inline boolean NOT NULL default false; uploaded_by/uploaded_by_api_key_id/uploaded_by_contact_id nullable UUID FKs SET NULL; created_at timestamptz NOT NULL default now(). Added draft_ticket_id uuid nullable default NULL, composite FK (workspace_id,draft_ticket_id) to tickets(workspace_id,id) ON DELETE CASCADE. Evidence: `migrations/000001_init.up.sql; migrations/000622_scoping.up.sql; internal/helpdesk/hd/attachments.go; internal/helpdesk/widget/attachments.go; migrations/000301_helpdesk.up.sql`. | Add draft_ticket_id uuid NULL for durable unsent-file provenance, UNIQUE(workspace_id,id) for reservations, and an index on (workspace_id,draft_ticket_id) WHERE draft_ticket_id IS NOT NULL. Draft association writes the origin from the visible ticket. Removal/discard retains it; cleanup still uses active reservations. Current origin visibility is required before any signed-link branch; stream these files with no-store and no new storage redirect. Normal message linking clears origin atomically and takes over file access. |
| `messages` | id uuid PK default gen_random_uuid(); workspace_id uuid NOT NULL FK workspaces CASCADE; ticket_id uuid NOT NULL FK tickets CASCADE; kind text NOT NULL CHECK reply/note; direction text NOT NULL CHECK inbound/outbound; body_html/body_text/subject/from_email/from_name text NOT NULL default ''; to_emails/cc_emails/bcc_emails text[] NOT NULL default '{}'; mailbox_id uuid nullable FK mailboxes SET NULL; author_user_id uuid nullable FK users SET NULL; reply_to text NOT NULL default ''; auth_failed boolean NOT NULL default false; delivery_status text NOT NULL default none CHECK none/pending/sent/failed/bounced; delivery_error text NOT NULL default ''; created_at timestamptz NOT NULL default now(). Proposed recipient_locked boolean NOT NULL DEFAULT false (internal, not JSON). reply_to/from_email/auth_failed and latest created_at select the current validated Reply-To; author_user_id selects normal sender attribution. Evidence: `migrations/000001_init.up.sql; internal/domain/write.go; internal/helpdesk/tickets/messages.go; migrations/000621_teams_brands.up.sql`. | Add recipient_locked boolean NOT NULL DEFAULT false, written true only for reviewed draft sends. Existing creation/linking adds a narrow authorization path for reserved draft files. domain.AddMessage remains the creation boundary. Reviewed recipients are stored once; the worker skips late Reply-To re-resolution when recipient_locked=true. Existing immediate sends keep false and preserve their behavior. |
| `contacts and mailboxes` | contacts.id uuid PK default gen_random_uuid(), workspace_id uuid NOT NULL FK workspaces CASCADE, email citext nullable, name text NOT NULL default '', blocked boolean NOT NULL default false. mailboxes.id uuid PK default gen_random_uuid(), workspace_id uuid NOT NULL FK workspaces CASCADE, name text NOT NULL, email citext NOT NULL, display_name text NOT NULL default '', status text NOT NULL default active CHECK active/error/disabled, team_id uuid nullable FK teams SET NULL, brand_id uuid NOT NULL FK brands RESTRICT, inbound_kind text NOT NULL CHECK forwarding/imap/google/microsoft, outbound_kind text NOT NULL CHECK smtp/google/microsoft/system, forwarding_token text NOT NULL UNIQUE, aliases text[] NOT NULL default '{}', from_name_format text NOT NULL default '{agent} at {mailbox}'. These select contact eligibility, sender name/address, alias, capability and private sending permission; no credentials are projected. mailboxes.created_at timestamptz NOT NULL default now() orders the existing oldest eligible mailbox fallback. Evidence: `migrations/000001_init.up.sql; migrations/000621_teams_brands.up.sql; internal/email/outbound.go:loadTicketInfo/addressing/replyDestination; internal/email/mailbox.go:alias/displayName; internal/domain/visibility.go:CanSendFrom; internal/domain/write.go:CheckMailboxSending`. | No schema change; reuse current workspace-scoped recipient and sending-address resolution. Preview and send resolve the same current contact, latest Reply-To and mailbox rules; credentials stay server-side. |
| `idempotency_keys` | id uuid PK default gen_random_uuid(); workspace_id uuid nullable FK workspaces CASCADE; user_id uuid nullable FK users CASCADE; api_key_id uuid nullable FK api_keys CASCADE; CHECK exactly one of user_id/api_key_id non-null; key text NOT NULL length 1..255; method/path text NOT NULL; request_hash bytea NOT NULL; status integer nullable; content_type/location text NOT NULL default ''; body_enc bytea nullable; created_at timestamptz NOT NULL default now(); completed_at timestamptz nullable. Unique normalized workspace/principal/key expression index; created_at cleanup index. Cached status/content_type/location/body_enc represent a completed legacy transport response. Evidence: `migrations/000601_core_idempotency.up.sql; internal/idempotency/idempotency.go`. | No schema or TTL change. Bypass response caching for draft POSTs, preparation-enabled ticket creation and the outer /mcp envelope before serving a cached response. Every feature retry executes current handler authorization and resolves its durable identity. Legacy inner API writes retain existing replay behavior. Outer /mcp bypass runs before its 32 MiB hashing bound; MCP itself enforces 36 MiB. |
| `users, teams and brands (sender projection)` | users.id uuid PK default gen_random_uuid(), users.name text NOT NULL default ''; teams.id uuid PK default gen_random_uuid(), teams.workspace_id uuid NOT NULL FK workspaces CASCADE, teams.name text NOT NULL, teams.private boolean NOT NULL default false; brands.id uuid PK default gen_random_uuid(), brands.workspace_id uuid NOT NULL FK workspaces CASCADE, brands.name text NOT NULL. Sender formatting uses the reviewing user name and ticket team/brand names; teams.private selects existing visibility rules. Evidence: `migrations/000001_init.up.sql; migrations/000621_teams_brands.up.sql; internal/email/outbound.go:loadTicketInfo; internal/email/sender.go:fromName; internal/domain/visibility.go`. | Schema unchanged. New addressing helper projects only these non-secret identity/name inputs; template variable/signature loading remains inside the unchanged templates module. Preserve the current sender naming and private-team rules. No password, token or connection secret is copied into preview/draft data. |
| `team_members and api_keys (existing visibility checks)` | team_members.team_id/user_id uuid NOT NULL FKs teams/users CASCADE, composite PK(team_id,user_id); api_keys.id uuid PK default gen_random_uuid(), workspace_id uuid NOT NULL FK workspaces CASCADE, scopes text[] NOT NULL default '{}', private_team_ids uuid[] NOT NULL default '{}'. Membership/key grants control private visibility; scopes control available operations. Role resolution remains the existing auth boundary. Evidence: `migrations/000001_init.up.sql; migrations/000621_teams_brands.up.sql; internal/domain/visibility.go; internal/auth`. | Schema unchanged; reuse existing domain.CanSee/CanSendFrom. Read current membership/grants per request, including all durable feature retries and draft-origin file fetches. |

The unchanged templates module continues to own its catalog, variable lookups and signature selection through contracts/templates.md. The new addressing helper uses only the explicit non-secret projection above.
