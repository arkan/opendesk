# Shared email drafts: architecture proposal

Stage: complete. Functional scope, tests, architecture and amended target data contract approved on 2026-10-19.
The user subsequently authorized a local implementation patch on 2026-10-19. Deployment remains outside this task.
Implementation evidence: [independent verification](verification.md).
Independent targeted review passed. The user approved the subsequent draft-file provenance and access-policy amendment.

Canonical scope and decisions: [functional specification](../../../specs/outbound-drafts.md).
The earlier interview outline has been consolidated into that specification.

## Existing behavior

- Ticket creation and replies use `domain.CreateTicket` and `domain.AddMessage`.
- Creating an email reply queues delivery. Creating an internal note can still trigger ticket-created automations.
- The composer holds its drafts in browser memory and handles file uploads separately.
- Unattached uploads expire after 24 hours. Upload ownership currently prevents another principal from attaching them to a message.
- HTTP idempotency keys expire after 24 hours; MCP forwards writes through the API with derived keys.
- The MCP catalog has ticket creation and immediate replies, but no shared-draft or file-upload tool.

## Material changes to design

1. Preserve shared drafts across clients with revision checks and realtime visibility enforcement.
2. Protect preparation from outbound side effects before a draft exists, including between separate API calls.
3. Associate uploaded files with drafts, preserving provenance and granting access through the ticket.
4. Add durable preparation identity and retry-safe consumption; preserve the reviewed recipients while reusing normal delivery.
5. Specify MCP draft operations and file transfer through the API's authorization boundary.

## Contracts and evidence

- [API/MCP impact report](api-lineage.html): affected operations, proposed interfaces and compatibility effects.
- [Data impact report](data-lineage.html): exact proposed fields, relationships, retention changes and source evidence.

These reports compare repository behavior at `eb66ca2556419cf46942f507196b26418821cb22` with a Draft proposal.
They do not establish deployed behavior or approve a physical schema.
Informix mapping is not applicable because no Informix flow is involved.

Confirmed: manually started email replies use the same shared server-side draft lifecycle.
The [architecture proposal](architecture.md) defines exact operations, storage, file transfer, conflict handling and lifecycle proposals.
The specification and architecture contain the same complete target field dictionary from [schema-proposal.json](schema-proposal.json).
The specification/design workflow is complete. The independent technical review is PASS.
Review status and findings: [independent review](review.md).
