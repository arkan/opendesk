import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { draftApi, draftIdentity, draftKey, type DraftPreview, type TicketDraft } from "@/lib/api/drafts";
import type { TicketStatus } from "@/lib/api/types";
import { qk } from "@/lib/queries";
import { toast } from "@/components/ui/toast";
import type { SharedDraftStateMachine } from "./sharedDraftState";

type DraftDialog =
  | { kind: "review"; preview: DraftPreview; status?: TicketStatus }
  | { kind: "conflict"; draft: TicketDraft | null }
  | { kind: "discard"; draft: TicketDraft };
type Prepare = { kind: "review"; status?: TicketStatus } | { kind: "conflict" } | { kind: "discard" };

function reviewedVersion(machine: SharedDraftStateMachine, preview: DraftPreview) {
  const { dirty, conflict, server } = machine.state;
  return !dirty && !conflict && server?.id === preview.draft_id && server.revision === preview.revision;
}

/** Review, replacement and terminal actions all refer to the exact version shown in one dialog. */
export function useSharedDraftActions(ticketId: string, machine: SharedDraftStateMachine, onReset: () => void) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<DraftDialog | null>(null);
  const prepare = useMutation({
    mutationFn: async (intent: Prepare): Promise<DraftDialog | null> => {
      if (intent.kind === "conflict") return { kind: "conflict", ...(await draftApi.get(ticketId)) };
      const saved = await machine.flush();
      if (!saved) return null;
      if (intent.kind === "discard") return { kind: "discard", draft: saved };
      const preview = await draftApi.preview(ticketId, draftIdentity(saved));
      if (!reviewedVersion(machine, preview)) throw new Error("The draft changed. Review it again.");
      return { kind: "review", preview, status: intent.status };
    },
    onSuccess: setDialog,
    onError: (e) => toast.error(e, "Could not load the draft for review"),
  });
  const confirm = useMutation({
    mutationFn: async (current: DraftDialog) => {
      if (current.kind === "conflict") {
        await machine.replace(current.draft);
      } else if (current.kind === "discard") {
        await draftApi.discard(ticketId, draftIdentity(current.draft));
      } else {
        if (!reviewedVersion(machine, current.preview)) throw new Error("The draft changed. Review it again before sending.");
        await draftApi.send(ticketId, {
          draft_id: current.preview.draft_id, expected_revision: current.preview.revision,
          review_token: current.preview.review_token, status: current.status,
        });
      }
    },
    onSuccess: (_result, current) => {
      setDialog(null);
      if (current.kind === "conflict") return;
      machine.reload(null);
      onReset();
      void qc.invalidateQueries({ queryKey: draftKey(ticketId), exact: true });
      if (current.kind === "review") {
        for (const key of [qk.ticket(ticketId), qk.messages(ticketId), qk.activities(ticketId), qk.counts]) {
          void qc.invalidateQueries({ queryKey: key });
        }
      }
    },
    onError: (e, current) => {
      if (current.kind === "review") {
        setDialog(null);
        toast.error(e, "Could not confirm the send. Check the conversation before retrying.");
        for (const key of [draftKey(ticketId), qk.messages(ticketId), qk.ticket(ticketId)]) {
          void qc.invalidateQueries({ queryKey: key });
        }
      } else toast.error(e, current.kind === "discard" ? "Could not discard the draft" : "Draft not saved");
    },
  });
  const busy = prepare.isPending || confirm.isPending;
  return {
    dialog,
    busy,
    reviewing: prepare.isPending && prepare.variables?.kind === "review",
    sending: confirm.isPending && confirm.variables?.kind === "review",
    canConfirm: !!dialog && !busy && (dialog.kind !== "review" || reviewedVersion(machine, dialog.preview)),
    review: (status?: TicketStatus) => { if (!busy) prepare.mutate({ kind: "review", status }); },
    inspectConflict: () => { if (!busy) prepare.mutate({ kind: "conflict" }); },
    discard: () => { if (!busy) prepare.mutate({ kind: "discard" }); },
    confirm: () => { if (dialog && !busy) confirm.mutate(dialog); },
    close: () => { if (!busy) setDialog(null); },
    useSharedVersion: () => {
      if (busy || dialog?.kind !== "conflict") return;
      machine.reload(dialog.draft);
      onReset();
      setDialog(null);
    },
  };
}

export type SharedDraftActions = ReturnType<typeof useSharedDraftActions>;
