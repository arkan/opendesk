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
| Shared composer | Full web suite: 68 files, 450 tests; TypeScript and production build pass; browser mock autosave/navigation retains acknowledged content | Verified |
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

Production schema, live provider delivery and coordinated deployment remain unverified.
Enable `SHARED_DRAFTS_ENABLED` only after replacing old API/worker processes, then release the matching frontend runtime setting.
The patch does not validate a mixed-version rollout or guarantee provider-level exactly-once delivery after an ambiguous provider response.
