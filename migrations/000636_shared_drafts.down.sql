DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ticket_drafts) OR EXISTS(SELECT 1 FROM ticket_preparations) OR EXISTS(SELECT 1 FROM attachments WHERE draft_ticket_id IS NOT NULL) OR EXISTS(SELECT 1 FROM messages WHERE recipient_locked) THEN
  RAISE EXCEPTION 'Shared draft data must be migrated before rollback';
 END IF;
END $$;
DROP TABLE ticket_draft_attachments;
DROP TABLE ticket_drafts;
DROP TABLE ticket_preparations;
ALTER TABLE attachments DROP COLUMN draft_ticket_id;
ALTER TABLE messages DROP COLUMN recipient_locked;
ALTER TABLE attachments DROP CONSTRAINT attachments_workspace_id_id_key;
ALTER TABLE tickets DROP CONSTRAINT tickets_workspace_id_id_key;
