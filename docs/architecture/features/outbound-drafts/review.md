# Shared email drafts: independent architecture review

Technical gate: PASS after round 2. The user approved the file-origin amendment on 2026-10-19; specification/design gates are complete.

The user approved the functional scope, tests, architecture and reconciled target data contract on 2026-10-19.
This task covers specification and design only. No implementation or deployment is authorized.

Round 1: fresh-context, read-only review by `/root/architecture_reviewer`.
Evidence: [specification](../../../specs/outbound-drafts.md), [architecture](architecture.md),
[schema](schema-proposal.json), [API contracts](api-contract-proposal.json), API snapshots and affected repository code/migrations.
Baseline: `eb66ca2556419cf46942f507196b26418821cb22`. No live database or provider was inspected.
Informix parity is not applicable because this feature has no Informix integration.

## Round 1 findings

1. **BLOCKER R1:** Every draft/preparation replay must enforce current authorization. Specify feature-route and enclosing MCP response-cache behavior before relying on durable identities.
   Evidence: `internal/idempotency/idempotency.go:131`, `internal/app/app.go:168`, architecture replay requirements.
   Required test: repeat after role/team change, deletion and merge; no cached draft/file/result disclosure.
2. **BLOCKER R2:** Complete the exact used-field contract for recipient selection, sender permissions and replay storage.
   Evidence: `internal/email/outbound.go:421`, `internal/domain/visibility.go:164`, migrations `000001`, `000601`, `000621`.
   Required correction: document `messages.reply_to/auth_failed`, sender inputs, and exact scoped idempotency columns/types across both dictionaries and schema JSON.
3. **WARNING R3:** Define required terminal response values and current-versus-original send replay statuses unambiguously.
   Evidence: architecture Draft/result definitions and retained `message_id`.
4. **WARNING R4:** Specify draft-file authorization before signed-link handling, including after discard/removal, and bound any prior storage-URL lifetime.
   Evidence: `internal/helpdesk/widget/attachments.go:141`, `internal/domain/load.go:37`, storage redirects in the download handler.

The reviewer confirmed matching names/types for all 34 new columns and structurally feasible state/reservation/rollout constraints.
This was a design review only; no implementation, runtime race, live schema or provider delivery was verified.

## Corrections submitted for targeted re-review

- **R1:** Draft POSTs and preparation-enabled ticket creation bypass raw response caching; current handler authorization always runs before durable lookup. The outer MCP envelope also bypasses caching; legacy inner writes retain their existing behavior. The new MCP upload wrapper checks current agent/write permission before calling the existing upload route. Add same-key replay tests after access and lifecycle changes.
- **R2:** Complete exact recipient, mailbox/alias/sender, visibility and replay-store field contracts across schema JSON and both Markdown dictionaries. No new credential projection is introduced; existing template loading remains inside its current module.
- **R3:** Terminal Draft members remain present with empty body/arrays and null mailbox. Send replay returns a stable message identity with current authorized status/delivery values.
- **R4:** Add nullable attachments.draft_ticket_id for origin checks after removal/discard. Authenticate and resolve origin visibility before any signed-link branch. Stream marked files with no-store and no new external redirect; document the maximum five-minute lifetime of pre-association storage redirects.

The extra file-origin column and authenticated-streaming policy formed a material data-contract amendment.
The user approved it after the independent technical re-review. Implementation remains outside this task.

## Round 2 independent result

Fresh-context reviewer: `/root/architecture_reviewer_round2`. Technical gate: **PASS**.

- **R1 closed:** Feature cache bypass executes current authorization before durable lookup; outer MCP bypass precedes hashing. New MCP uploads perform a current agent/write precheck.
- **R2 closed:** Both dictionaries agree with schema JSON and all 34 new-table columns are present. Reused recipient/sender/visibility/replay fields have exact properties. The reviewer independently checked the corrected brands.id default against migration 000621.
- **R3 closed:** Terminal members have explicit empty/null values. Send replay returns stable identity with current authorized status/delivery values.
- **R4 closed:** Retained origin controls authorization before generic signatures, including after removal/discard. Draft-origin files use authenticated no-store streaming without new external redirects; earlier storage redirects retain a documented maximum of five minutes.

Source checks: architecture replay/response/file policy sections; `internal/idempotency/idempotency.go:112`,
`internal/app/app.go:168`, `internal/email/outbound.go:421`, `internal/helpdesk/widget/attachments.go:142`,
migrations `000601` and `000621`; schema and API proposal JSON.

No new substantive design contradiction was found. Runtime behavior, live schema and provider delivery remain unverified.
The user subsequently approved the material file-origin column and authenticated-streaming amendment.
No remaining design finding or approval blocks the completed specification dossier.
