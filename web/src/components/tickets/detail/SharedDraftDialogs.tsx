import { useState } from "react";
import { draftApi, type DraftPreview } from "@/lib/api/drafts";
import type { Attachment } from "@/lib/api/types";
import { bytes } from "@/lib/format";
import { sanitizeHtml } from "@/lib/sanitize";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { SharedDraftActions } from "./useSharedDraftActions";

export function DraftAttachment({ attachment }: { attachment: Attachment }) {
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const blob = await draftApi.attachment(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(e, "Could not download the attachment"); }
    finally { setLoading(false); }
  };
  return <button type="button" disabled={loading} className="ph-no-capture min-h-6 max-w-64 truncate underline" data-ph-mask onClick={() => void download()}>{attachment.filename} ({bytes(attachment.size_bytes)})</button>;
}

function DraftReview({ preview }: { preview: DraftPreview }) {
  return <div className="space-y-3 text-sm">
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt>From</dt><dd>{preview.from.name} &lt;{preview.from.email}&gt;</dd>
      <dt>To</dt><dd>{preview.to.join(", ")}</dd>
      {preview.cc.length > 0 && <><dt>Cc</dt><dd>{preview.cc.join(", ")}</dd></>}
      {preview.bcc.length > 0 && <><dt>Bcc</dt><dd>{preview.bcc.join(", ")}</dd></>}
      <dt>Subject</dt><dd>{preview.subject}</dd>
    </dl>
    <div className="prose-od border-t border-line pt-3" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.body_html) }} />
    <div className="prose-od" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.signature_html) }} />
    <div className="flex flex-wrap gap-2">{preview.attachments.map((a) => <DraftAttachment key={a.id} attachment={a} />)}</div>
  </div>;
}

export function SharedDraftDialogs({ actions }: { actions: SharedDraftActions }) {
  const { dialog, busy } = actions;
  if (!dialog) return null;
  const title = dialog.kind === "review" ? "Review email" : dialog.kind === "conflict" ? "Shared draft changed" : "Discard shared draft?";
  const description = dialog.kind === "conflict"
    ? "Your local edits are preserved. Review the latest shared version before choosing which version to keep."
    : dialog.kind === "discard" ? "This removes the draft for everyone on this ticket. This action cannot be undone." : undefined;
  const confirmLabel = dialog.kind === "review"
    ? dialog.status === "solved" ? "Send and resolve" : "Send email"
    : dialog.kind === "conflict" ? "Replace with my edits" : "Discard draft";
  return <Dialog open onOpenChange={(open) => !open && actions.close()} title={title} description={description} size={dialog.kind === "review" ? "lg" : "md"}
    footer={<>
      <Button variant="ghost" onClick={actions.close} disabled={busy}>{dialog.kind === "review" ? "Back to draft" : dialog.kind === "conflict" ? "Keep editing locally" : "Cancel"}</Button>
      {dialog.kind === "conflict" && <Button variant="ghost" onClick={actions.useSharedVersion} disabled={busy}>Use shared version</Button>}
      <Button variant={dialog.kind === "discard" ? "danger-solid" : "secondary"} disabled={!actions.canConfirm} onClick={actions.confirm}>{confirmLabel}</Button>
    </>}>
    <div className="ph-no-capture" data-ph-mask>
      {dialog.kind === "review" && <DraftReview preview={dialog.preview} />}
      {dialog.kind === "conflict" && (dialog.draft ? <div className="space-y-3">
        <p className="text-xs text-fg-3">Cc: {dialog.draft.cc.join(", ") || "None"} · Bcc: {dialog.draft.bcc.join(", ") || "None"}</p>
        <div className="prose-od" dangerouslySetInnerHTML={{ __html: sanitizeHtml(dialog.draft.body_html) }} />
        <div className="flex flex-wrap gap-2">{dialog.draft.attachments.map((a) => <DraftAttachment key={a.id} attachment={a} />)}</div>
      </div> : <p className="text-sm">The shared draft has been sent or discarded.</p>)}
    </div>
  </Dialog>;
}
