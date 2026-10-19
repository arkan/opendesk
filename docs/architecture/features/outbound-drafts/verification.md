# Shared email drafts: implementation verification

Gate: **PASS**. Independent read-only verifier: `/root/draft_verification`, 2026-10-19.
The user authorized a local implementation patch after approving the specification and architecture.
No deployment, external mailbox delivery or production database change was performed.

## Evidence

| Requirement | Implementation and execution evidence | Result |
| --- | --- | --- |
| Exact data contract | Migration `000636_shared_drafts`: all 34 columns across three tables, tenant FKs, singleton index, origin and recipient-lock fields | Verified |
| Draft lifecycle and races | `tickets/drafts_test.go`: revisions, durable creation replay, terminal clearing, concurrent create/send, actor/context review tokens; focused race-detector run passes | Verified |
| Current permissions on retries | `idempotency/drafts_test.go`, MCP workflow/scope tests and ticket visibility tests; feature cache bypass and upload permission precheck | Verified |
| Preparation protection | Domain guard plus automation, AI, auto-reply, CSAT and delivery checks; preparation tests and `TestEmailAgentSkipsUnreleasedPreparation` | Verified |
| Shared files and cleanup | Reservation/send/discard/purge tests, retained origin, old-signature refusal, private/deleted ticket access and authenticated no-store streaming | Verified |
| Reviewed recipients | Email worker test compares frozen draft recipients with legacy late Reply-To resolution | Verified |
| API and MCP | MCP full suite, including upload/create/update/replay/conflict/preview/discard workflow; no new send tool | Verified |
| Shared composer | Full web suite: 73 files, 506 tests; TypeScript, ESLint, app/widget builds pass; browser mock exercises autosave, review, send and attachment cleanup | Verified |
| Instance rollout | Go config/runtime tests and Pages generator: 16 tests; disabled mode retains existing composer behavior | Verified |
| Physical deletion | Import undo locks tickets before collecting message-linked and draft-origin file keys; `TestUndo` asserts stored bytes are removed | Verified |
| Migration rollback | Separate empty local PostgreSQL database: down/up passes; populated preparation identity intentionally refuses down | Verified |
| Informix | No affected integration or write path | N/A |

Go validation uses installed Go 1.27.2, with the repository's Go 1.27.1 minimum unchanged.
`go build ./...` and `go vet ./...` pass. Affected package suites use isolated local PostgreSQL 18,
with `TEST_DATABASE_URL` and `OPENDESK_TEST_DATABASE_URL` set; database tests were not counted as passing when skipped.
Focused AI email tests pass. Full AI execution exposes existing `TestNoBalance` and `TestOwnKeyOpenRouter` failures.
Both failures reproduce on HEAD using an overlay restoring all changed/new Go files to the original code.
They concern existing billing assertions (200 instead of expected 402), outside this feature.

## Independent findings closed

- **R-V1:** Disabling backend draft routes initially blocked email replies in the new composer.
  Runtime `sharedDrafts` now gates the full shared lifecycle; false preserves the existing local/immediate reply flow.
  The binary emits the exact instance setting. Hosted configuration defaults off until explicit promotion.
- **R-V2:** Import undo initially collected storage keys only through messages, orphaning unsent draft bytes.
  It now locks candidate tickets before classification and includes `attachments.draft_ticket_id` in key collection.
  The existing import-undo policy is unchanged. The independent verifier rechecked both fixes.

The browser check exposed an editor hydration issue: changing editability emitted empty content as an edit.
`RichEditor` suppresses that programmatic update; a component regression test and repeated navigation verify the fix.

## PR #4 quality review

Local review, 2026-10-19. The approved API, schema and product scope remain unchanged.
Independent read-only verification: **PASS**, `/root/verify_pr4_corrections`, including 65 focused web tests on the final patch.

| Invariant | Evidence |
| --- | --- |
| Saved template links survive sanitization and render safely | `tickets/draft_regressions_test.go`: create, update and preview |
| Attachment reservation checks observe commits made while waiting for locks | Same suite: two tickets contend for one upload; the rejected update leaves both drafts intact |
| Preview and delivery share mailbox selection and alias projection | `tickets/draft_preview_test.go`, `email/drafts_test.go`, `email/teams_test.go`; canonical `domain.ReplyMailbox` |
| Draft-origin files require current workspace access | `widget/attachments_test.go`: users, API keys and existing signed URLs |
| Review and conflict dialogs protect private content and act on the displayed identity | `useSharedDraftActions.test.tsx`: exact revision, replacement identity, uncertain send and pending discard |
| Delayed save responses reconcile without losing newer local edits | `useSharedDraft.test.tsx`: canceled reads, ended/replaced drafts, retained text and files |
| Flush completes only after pending edits are saved without conflict | `sharedDraftState.test.ts`: delayed conflicts reject; ended or replaced drafts return their reconciled identity |
| A new draft receives a new durable creation key | `sharedDraftState.test.ts`; browser mock teammate-discard/create check |
| Upload resources belong to their composer and mode | `useComposerUploads.test.tsx`: teardown, late responses, mode isolation and remote removal; ongoing uploads remain active |
| Mock lifecycle matches rejected writes and merge constraints | `mock/handlers/drafts.test.ts`: atomic updates, replacement-draft token rejection and merge refusal on either ticket |
| Configured instances explicitly advertise shared draft support | `config.test.ts`: absent or invalid runtime capability keeps the legacy reply flow, regardless of build settings |
| Composer controls respect loading and send state without blocking notes or chat | `Composer.test.tsx`: recipients, sender, file controls, mode changes and asynchronous edits |
| Deferred AI actions belong to their original ticket and mode | `ComposerAi.test.tsx`: Undo, confirmations, streaming and translation; `Composer.test.tsx`: Reply hydration before generation from Note |

Draft field normalization is pure; routes perform mailbox authorization explicitly before writes.
Address projection is pure and no longer constructs a service to obtain configuration.
Draft actions use one dialog state for review, replacement and discard.
One upload owner replaces separate collections, generation tracking and scattered resource cleanup.
Composer decreases from 894 to 788 lines. No source file newly exceeds 1,000 lines.
Flush owns the save loop and checks the reconciled state before reporting success.
Post-save reconciliation adds one draft read per acknowledged save; it does not poll.
Browser mock checks cover autosave, protected review content, explicit send, editor clearing and preview URL release after file removal.
Affected Go suites pass with the race detector against isolated UTF-8 PostgreSQL.
Final `go build ./...` and `go vet ./...` pass; focused AI email tests pass.
Final Jev means: server 8.01, integrations 8.23, web 8.04. Each scope exceeds 8; no unchanged-score plateau occurred.

Production schema, live provider delivery and coordinated deployment remain unverified.
Enable `SHARED_DRAFTS_ENABLED` only after replacing old API/worker processes, then release the matching frontend runtime setting.
The patch does not validate a mixed-version rollout or guarantee provider-level exactly-once delivery after an ambiguous provider response.
