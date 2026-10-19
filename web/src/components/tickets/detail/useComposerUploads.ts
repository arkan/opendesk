import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/endpoints";
import type { Attachment } from "@/lib/api/types";
import { toast } from "@/components/ui/toast";
import type { SharedDraftStateMachine } from "./sharedDraftState";

type Scope = "local" | "shared";
type Upload = { key: string; scope: Scope; file: File; preview?: string } & (
  | { status: "uploading" | "error" }
  | { status: "done"; attachment: Attachment }
);

/** Own queued files and their preview URLs until removal, reset or composer teardown. */
export function useComposerUploads(sharedReply: boolean, machine: SharedDraftStateMachine) {
  const { t } = useTranslation("inbox");
  const shared = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const [queued, setQueued] = useState<Upload[]>([]);
  const resources = useRef(new Map<string, { scope: Scope; preview?: string }>());
  const scope: Scope = sharedReply ? "shared" : "local";
  const uploads = queued.filter((item) => item.scope === scope);
  const busyShared = queued.some((item) => item.scope === "shared" && item.status === "uploading");

  const release = useCallback((key: string) => {
    const resource = resources.current.get(key);
    if (resource?.preview) URL.revokeObjectURL(resource.preview);
    resources.current.delete(key);
  }, []);

  useEffect(() => {
    const owned = resources.current;
    return () => {
      for (const resource of owned.values()) if (resource.preview) URL.revokeObjectURL(resource.preview);
      owned.clear();
    };
  }, []);

  useEffect(() => {
    if (shared.dirty || !shared.loaded) return;
    const removed = queued.filter((item) => item.scope === "shared" && item.status === "done" && !shared.content.attachment_ids.includes(item.attachment.id));
    if (!removed.length) return;
    const keys = new Set(removed.map((item) => item.key));
    removed.forEach((item) => release(item.key));
    setQueued((items) => items.filter((item) => !keys.has(item.key)));
  }, [queued, shared.loaded, shared.dirty, shared.content.attachment_ids, release]);

  useBlocker({
    shouldBlockFn: () => {
      if (busyShared) toast.error("Wait for the attachments to finish uploading before leaving.");
      return busyShared;
    },
    enableBeforeUnload: () => busyShared,
  });

  const clear = (target: Scope) => {
    for (const [key, resource] of resources.current) if (resource.scope === target) release(key);
    setQueued((items) => items.filter((item) => item.scope !== target));
  };

  const upload = (files: FileList | File[]) => {
    if (sharedReply && !machine.state.loaded) return;
    let count = machine.state.content.attachment_ids.length + uploads.filter((item) => item.status === "uploading").length;
    for (const file of Array.from(files)) {
      if (sharedReply && count >= 20) {
        toast.error("A shared draft can contain up to 20 attachments.");
        break;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error(t("composer.tooLarge", { name: file.name }));
        continue;
      }
      count++;
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const item = { key, scope, file, preview };
      resources.current.set(key, { scope, preview });
      setQueued((items) => [...items, { ...item, status: "uploading" }]);
      api.attachments.upload(file).then((attachment) => {
        if (!resources.current.has(key)) return;
        setQueued((items) => items.map((entry) => entry.key === key ? { ...item, status: "done", attachment } : entry));
        if (scope === "shared") machine.edit({ attachment_ids: [...machine.state.content.attachment_ids, attachment.id] });
      }).catch((e) => {
        if (!resources.current.has(key)) return;
        setQueued((items) => items.map((entry) => entry.key === key ? { ...item, status: "error" } : entry));
        toast.error(e, t("composer.uploadFailed", { name: file.name }));
      });
    }
  };

  return {
    uploads,
    busy: uploads.some((item) => item.status === "uploading"),
    savedAttachments: sharedReply ? (shared.server?.attachments ?? []).filter((attachment) =>
      shared.content.attachment_ids.includes(attachment.id) && !uploads.some((item) => item.status === "done" && item.attachment.id === attachment.id),
    ) : [],
    attachmentIds: uploads.flatMap((item) => item.status === "done" ? [item.attachment.id] : []),
    upload,
    remove: (item: Upload) => {
      release(item.key);
      setQueued((items) => items.filter((entry) => entry.key !== item.key));
      if (item.scope === "shared" && item.status === "done") {
        machine.edit({ attachment_ids: machine.state.content.attachment_ids.filter((id) => id !== item.attachment.id) });
      }
    },
    removeSaved: (id: string) => machine.edit({ attachment_ids: machine.state.content.attachment_ids.filter((entry) => entry !== id) }),
    clearLocal: () => clear("local"),
    clearShared: () => clear("shared"),
  };
}
