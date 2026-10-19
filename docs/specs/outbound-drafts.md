# Shared email drafts

Status: Approved, including the reviewed file-origin amendment, on 2026-10-19. Independent technical review PASS.
Current stage: specification and architecture complete. Implementation and deployment are outside this task.

## Problem and solution

Weekly purchase orders currently pass through an internal inbox and Power Automate before Sylvia reviews Outlook drafts.
opendesk must support preparing these emails through its API and public MCP server.
The same feature must prepare a reply on an existing email ticket.

The caller creates a ticket with internal context, uploads files, and creates the outgoing draft through separate calls.
For an existing ticket, the caller only uploads any new files and creates or explicitly updates the draft.
Sylvia reviews the shared draft in opendesk, then uses the existing send-and-resolve action.

## Terms

- **Shared draft:** one saved, unsent outgoing email attached to a ticket and shared by authorized teammates.
- **Internal context:** a ticket note for teammates. It is excluded from the outgoing email.
- **Preparation reference:** a caller-supplied identifier used to recognize a repeated ticket-creation request.
- **Revision:** a version used to detect a draft changed since the caller last read it.

## Scope and decisions

Confirmed in the conversation:

- Create tickets and drafts through separate API calls. No email-ingestion workflow is required.
- Support new email tickets and reply drafts on existing email tickets.
- Keep one shared draft per ticket, with files, rather than private drafts for each agent.
- Expose creation, reading and explicit modification through API and MCP.
- Upload file bytes first. Reference the resulting attachment IDs when creating or updating a draft.
- Reject stale edits and conflicting preparation requests instead of replacing existing work.
- Preserve the existing send-and-resolve action. No command-specific resolution automation is required.
- All manually started email reply drafts also use shared server-side persistence, confirmed after functional-scope approval.

Sylvia is the motivating assignee, not a hardcoded user or permission exception.
Purchase orders are an example, not a new order-management domain.

## User stories and acceptance criteria

### 1. Create a ticket with internal context

As an API or MCP caller, I can create an email ticket before preparing its outgoing email.

- **AC1.1:** The ticket identifies its contact, subject, sending mailbox and optional assignee using existing ticket rules.
- **AC1.2:** Context is stored as an internal note. It does not become the outgoing draft body automatically.
- **AC1.3:** Creating a ticket for this preparation flow sends no email, including through ticket-created automations or AI actions.
- **AC1.4:** Preparation mode is explicit before ticket creation commits. A later draft call cannot retroactively prevent a creation-triggered email.
- **AC1.5:** Repeating creation with the same preparation reference and equivalent creation input returns the existing ticket without changing it.
- **AC1.6:** Reusing that reference with different creation input produces a conflict. Compare the original request, not subsequent agent edits.
- **AC1.7:** Duplicate protection survives the existing 24-hour HTTP idempotency window. Reference namespace and retention rules require architecture reconciliation.
- **AC1.8:** If draft creation fails later, the ticket and internal note remain available. Retrying uses that ticket instead of creating another.

### 2. Prepare an outgoing draft

As an API or MCP caller, I can prepare an email on a new or existing email ticket.

- **AC2.1:** Create the missing shared draft with a message body and optional uploaded attachment IDs.
- **AC2.2:** Return its identity, current revision and saved content so the caller can read or modify it later.
- **AC2.3:** A creation request cannot replace an existing draft. A repeated identical creation is safe; different content requires an explicit update.
- **AC2.4:** The user can inspect the recipient, mailbox, subject, body and files before sending.
- **AC2.5:** Draft preparation sends no email, publishes no public reply and does not count as a response to the contact.
- **AC2.6:** Creating or updating a draft does not itself trigger outbound automations, auto-replies or AI sends.
- **AC2.7:** Internal context stays internal. A caller supplies outgoing text explicitly.
- **AC2.8:** Existing ticket visibility, contact and reply-address rules still apply. Arbitrary recipient overrides are not introduced by this specification.

### 3. Share, edit and review

As an authorized teammate, I can review and edit the saved draft in the ticket composer.

- **AC3.1:** All email reply drafts, including manually started replies, use shared server-side persistence. Acknowledged saves survive reloads, browser closure and switching devices.
- **AC3.2:** Authorized teammates see the same draft. Sylvia's assignment does not make it private.
- **AC3.3:** Teammates can edit outgoing text, manage files and use the existing mailbox and Cc/Bcc controls.
- **AC3.4:** Explicit API and MCP updates include the expected revision. A stale revision produces a conflict without changing saved content.
- **AC3.5:** Browser conflicts preserve unsaved local edits and offer recovery. An incoming saved draft cannot silently overwrite local work.
- **AC3.6:** Draft changes reach other viewers through realtime events with the ticket's visibility restrictions.
- **AC3.7:** Viewers can read drafts only where ticket visibility permits; only authorized agents or write-scoped callers can modify them.

### 4. Keep attachments until review

As an automation caller, I can upload a PDF that Sylvia later sends without uploading it again.

- **AC4.1:** Reuse the existing upload API, its file validation, and its 25 MB per-file limit.
- **AC4.2:** Preserve the existing maximum of 20 attachments per outgoing message.
- **AC4.3:** Attaching a fresh upload requires the caller's workspace and upload ownership checks.
- **AC4.4:** Once attached to a draft, authorized teammates can read and send its files through that ticket.
- **AC4.5:** A file on a saved draft survives unattached-upload cleanup, including after 24 hours.
- **AC4.6:** Draft access does not grant access to unrelated uploads or another workspace's files.
- **AC4.7:** MCP provides a documented way to supply file bytes and obtain attachment IDs. A server-local path is not sufficient.
- **AC4.8:** API reads of unsent draft-origin files require current origin-ticket visibility, including after removal/discard and when an old generic signature is supplied.
- **AC4.9:** Draft-origin files stream through the authenticated API without new storage redirects. A storage URL issued before association retains at most its existing five-minute lifetime.

### 5. Send after review

As Sylvia or another authorized teammate, I can send the reviewed draft and finish the ticket.

- **AC5.1:** Preparing or saving a draft never sends it. Sending is a distinct, explicit action.
- **AC5.2:** The existing send-and-resolve control consumes the saved draft and requests the existing solved status transition.
- **AC5.3:** Verify the draft revision and current sending permission before consuming it. Reject a revision changed since review.
- **AC5.4:** Concurrent send requests or retries create at most one outgoing message for the consumed draft. Replays return that message identity with current authorized ticket/delivery status values.
- **AC5.5:** After acceptance, sending uses the normal email queue, delivery reporting and failure handling.
- **AC5.6:** Queued delivery is distinct from successful provider delivery. This feature does not change the existing resolution timing or promise exactly-once provider delivery.
- **AC5.7:** A failed send request preserves the draft unless an outgoing message was committed. Recovery must identify the committed result.
- **AC5.8:** A consumed draft cannot be sent again. A later reply requires a new draft identity.

### 6. Prepare through MCP

As an assistant connected to opendesk MCP, I can prepare the same work as an HTTP API caller.

- **AC6.1:** Create the ticket with internal context, obtain its reference, upload files, then create its shared draft.
- **AC6.2:** Read, create or explicitly update a reply draft on an existing email ticket.
- **AC6.3:** Reuse the API's authorization, validation, conflict and duplicate-prevention behavior.
- **AC6.4:** Describe draft operations as preparation without sending. Return actionable conflicts without discarding existing work.
- **AC6.5:** Existing immediate-send tools retain their behavior. The new draft tools do not implicitly invoke them.

## Proposed interface changes

The [architecture proposal](../architecture/features/outbound-drafts/architecture.md) defines the target operations, payloads and error behavior.
The user approved the target contracts on 2026-10-19; existing public contracts are unchanged in code.
The [API/MCP report](../architecture/features/outbound-drafts/api-lineage.html) compares these targets with repository evidence.

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

Detailed origins and schema comparison: [data report](../architecture/features/outbound-drafts/data-lineage.html).

## Validation approach

Approved with the functional scope on 2026-10-19.

- Use the existing HTTP integration-test seam and test database for the API lifecycle and persisted results.
- Exercise the public MCP transport against the same API, including files and revision conflicts.
- Check observable results: saved drafts, notes, retained files, message counts and queued outbound work.
- Run configured ticket-created automations in preparation tests to prove zero outbound work before approval.
- Test duplicate preparation after the 24-hour replay window, stale revisions, concurrent sends and workspace/private-team isolation.
- Exercise browser reload, API-created files, shared edits and the existing send-and-resolve control.
- Use the existing test transport or a controlled fake mail provider; no editor receives a test email.
- Check that existing immediate-send routes/tools preserve their behavior.
- Repeat protected HTTP/MCP calls with the same transport key after role/team changes, deletion and merge; verify current authorization before returning results.
- Check file-origin access before signed-link handling, including after removal/discard; test the explicit pre-association storage-URL lifetime boundary.

## Boundaries and open decisions

Outside this specification: email ingestion, Outlook draft synchronization, PDF generation, scheduled sending, bulk approval and multiple simultaneous drafts per ticket.
No new MCP sending capability, plan restriction or provider-specific persistence feature is required.
No production deployment, external publication or tracker issue is authorized by this document.

The architecture now proposes the physical schema, exact operations, MCP file transfer, discard, deletion, merge and review rules.
The user approved the architecture and subsequent file-origin amendment on 2026-10-19. Independent review is PASS.
A dedicated draft-list/filter remains outside scope; existing assignment and labels provide the initial workflow.

No Informix integration is present in this feature's affected flow. Informix parity and legacy mapping are not applicable.
The baseline is the existing opendesk API, composer, attachment cleanup and MCP behavior.

## Approval record

- Confirmed decisions: separate ticket/draft calls; shared draft; existing-ticket replies; API updates; MCP; uploads; conflict protection; existing completion action.
- Functional-scope approval: approved by the user's "oui" on 2026-10-19, following presentation of this document and scope summary.
- Validation-approach approval: approved in the same response.
- Shared persistence for all manually started email replies: approved by the subsequent "oui".
- Architecture/data approval: approved by the user's latest "oui" on 2026-10-19, including discard, merge, review-context and rollout choices.
- Independent architecture review: PASS after targeted round 2; see the architecture review record. Implementation remains outside the requested specification work.
- Round-1 replay/field-contract blockers and terminal/file-access warnings are closed at design level.
- File-origin amendment: approved by the user's latest "oui" on 2026-10-19, including nullable attachments.draft_ticket_id, authenticated streaming and retained origin checks after removal/discard.
- Specification/design workflow: complete. No functional code, database migration or deployment was performed.
