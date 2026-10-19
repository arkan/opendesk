ALTER TABLE tickets ADD CONSTRAINT tickets_workspace_id_id_key UNIQUE (workspace_id,id);
ALTER TABLE attachments ADD CONSTRAINT attachments_workspace_id_id_key UNIQUE (workspace_id,id);
ALTER TABLE messages ADD COLUMN recipient_locked boolean NOT NULL DEFAULT false;
ALTER TABLE attachments ADD COLUMN draft_ticket_id uuid;
ALTER TABLE attachments ADD CONSTRAINT attachments_draft_ticket_fk FOREIGN KEY (workspace_id,draft_ticket_id) REFERENCES tickets(workspace_id,id) ON DELETE CASCADE;
CREATE INDEX attachments_draft_ticket_idx ON attachments(workspace_id,draft_ticket_id) WHERE draft_ticket_id IS NOT NULL;
CREATE TABLE ticket_drafts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 ticket_id uuid NOT NULL,
 creation_key text NOT NULL CHECK (length(creation_key) BETWEEN 1 AND 255),
 creation_hash bytea NOT NULL CHECK (octet_length(creation_hash)=32),
 hash_version smallint NOT NULL DEFAULT 1 CHECK (hash_version=1),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sent','discarded')),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
 body_html text NOT NULL DEFAULT '',
 mailbox_id uuid REFERENCES mailboxes ON DELETE SET NULL,
 cc_emails text[] NOT NULL DEFAULT '{}',
 bcc_emails text[] NOT NULL DEFAULT '{}',
 created_by_type text NOT NULL CHECK (created_by_type IN ('user','api')),
 created_by_user_id uuid REFERENCES users ON DELETE SET NULL,
 created_by_api_key_id uuid REFERENCES api_keys ON DELETE SET NULL,
 updated_by_type text NOT NULL CHECK (updated_by_type IN ('user','api')),
 updated_by_user_id uuid REFERENCES users ON DELETE SET NULL,
 updated_by_api_key_id uuid REFERENCES api_keys ON DELETE SET NULL,
 message_id uuid REFERENCES messages ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,ticket_id,creation_key),
 FOREIGN KEY(workspace_id,ticket_id) REFERENCES tickets(workspace_id,id) ON DELETE CASCADE,
 CHECK ((state='draft') = (ended_at IS NULL)),
 CHECK (state='sent' OR message_id IS NULL),
 CHECK ((created_by_type='user' AND created_by_api_key_id IS NULL) OR (created_by_type='api' AND created_by_user_id IS NULL)),
 CHECK ((updated_by_type='user' AND updated_by_api_key_id IS NULL) OR (updated_by_type='api' AND updated_by_user_id IS NULL))
);
CREATE UNIQUE INDEX ticket_drafts_active_idx ON ticket_drafts(workspace_id,ticket_id) WHERE state='draft';
CREATE TABLE ticket_draft_attachments (
 workspace_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 attachment_id uuid NOT NULL UNIQUE,
 position smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
 PRIMARY KEY(draft_id,attachment_id), UNIQUE(draft_id,position),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES ticket_drafts(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,attachment_id) REFERENCES attachments(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE ticket_preparations (
 workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
 namespace text NOT NULL CHECK (length(namespace) BETWEEN 1 AND 100),
 reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 255),
 request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
 hash_version smallint NOT NULL DEFAULT 1 CHECK(hash_version=1),
 ticket_id uuid REFERENCES tickets ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz,
 PRIMARY KEY(workspace_id,namespace,reference)
);
CREATE INDEX ticket_preparations_guard_idx ON ticket_preparations(workspace_id,ticket_id) WHERE released_at IS NULL AND ticket_id IS NOT NULL;
