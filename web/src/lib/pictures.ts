import { appText } from "@/i18n/text";
// Picture uploads, availability and the auto-away heartbeat
// (contracts/api.md "Profile pictures and logos" and "Assignment").

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api/endpoints";
import type { Availability, Company, Contact, Member, WorkspaceImageSlot } from "./api/types";
import { qk } from "./queries";
import { updateUser, updateWorkspace, useSession } from "./session";

export const MAX_IMAGE_BYTES = 5 << 20;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** For `<input type="file" accept>`. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Checks a picked file before upload; the server checks the bytes again. */
export function imageFileError(file: File): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return appText("Use a PNG, JPEG, GIF or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) return appText("Images can be at most 5 MB.");
  return null;
}

function patchMember(qc: ReturnType<typeof useQueryClient>, m: Member) {
  qc.setQueryData<Member[]>(qk.members, (old) => old?.map((x) => (x.user.id === m.user.id ? m : x)));
}

/** Upload or remove your own picture. */
export function useMyAvatar() {
  const qc = useQueryClient();
  const done = (u: Awaited<ReturnType<typeof api.me.uploadAvatar>>) => {
    updateUser(u);
    qc.setQueryData<Member[]>(qk.members, (old) =>
      old?.map((m) => (m.user.id === u.id ? { ...m, user: { ...m.user, avatar_url: u.avatar_url, avatar_source: u.avatar_source } } : m)),
    );
    void qc.invalidateQueries({ queryKey: qk.onboarding });
  };
  return {
    upload: useMutation({ mutationFn: (file: File | Blob) => api.me.uploadAvatar(file), onSuccess: done }),
    remove: useMutation({ mutationFn: () => api.me.removeAvatar(), onSuccess: done }),
  };
}

/** Upload or remove the workspace logo (`logo`) or a brand image. Admin. */
export function useWorkspaceImage() {
  const qc = useQueryClient();
  const done = (w: Awaited<ReturnType<typeof api.workspaces.uploadImage>>) => {
    updateWorkspace(w);
    qc.setQueryData(qk.workspace, w);
  };
  return {
    upload: useMutation({
      mutationFn: (v: { slot: "logo" | WorkspaceImageSlot; file: File | Blob }) => api.workspaces.uploadImage(v.slot, v.file),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (slot: "logo" | WorkspaceImageSlot) => api.workspaces.removeImage(slot), onSuccess: done }),
  };
}

/** Upload, remove or refresh a contact's picture. An upload always wins over automatic sources. */
export function useContactAvatar() {
  const qc = useQueryClient();
  const done = (c: Contact) => {
    qc.setQueryData(qk.contact(c.id), c);
    void qc.invalidateQueries({ queryKey: qk.contactLists });
  };
  return {
    upload: useMutation({ mutationFn: (v: { id: string; file: File | Blob }) => api.contacts.uploadAvatar(v.id, v.file), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.contacts.removeAvatar(id), onSuccess: done }),
    refresh: useMutation({ mutationFn: (id: string) => api.contacts.refreshAvatar(id) }),
  };
}

/** Upload, remove or refresh a company's logo. */
export function useCompanyAvatar() {
  const qc = useQueryClient();
  const done = (c: Company) => {
    qc.setQueryData(qk.company(c.id), c);
    void qc.invalidateQueries({ queryKey: qk.companyLists });
  };
  return {
    upload: useMutation({ mutationFn: (v: { id: string; file: File | Blob }) => api.companies.uploadAvatar(v.id, v.file), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.companies.removeAvatar(id), onSuccess: done }),
    refresh: useMutation({ mutationFn: (id: string) => api.companies.refreshAvatar(id) }),
  };
}

/** Set availability (yours with "me") or, as an admin, anyone's and their assignment cap. */
export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; availability?: Availability; max_open_tickets?: number | null }) =>
      api.members.setAvailability(v.userId, { availability: v.availability, max_open_tickets: v.max_open_tickets }),
    onMutate: (v) => {
      const prev = qc.getQueryData<Member[]>(qk.members);
      const me = useSession.getState().user?.id;
      const id = v.userId === "me" ? me : v.userId;
      if (v.availability && id)
        qc.setQueryData<Member[]>(qk.members, (old) =>
          old?.map((m) => (m.user.id === id ? { ...m, availability: v.availability!, presence: v.availability! } : m)),
        );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.members, ctx.prev);
    },
    onSuccess: (m) => patchMember(qc, m),
  });
}

/** Hide the setup checklist for yourself. */
export function useDismissOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.onboarding.dismiss(),
    onMutate: () => {
      qc.setQueryData(qk.onboarding, (old: Awaited<ReturnType<typeof api.onboarding.get>> | undefined) => (old ? { ...old, dismissed: true } : old));
    },
  });
}

export const HEARTBEAT_MS = 2 * 60_000;
const ACTIVE_GAP_MS = 60_000;

/**
 * Tells the API you are around, so auto-away does not mark you away while you
 * work: on mount, every two minutes while the tab is visible, and on the first
 * interaction after a quiet minute. Mount once in the signed-in app shell.
 */
export function useHeartbeat(enabled = true) {
  const authed = useSession((s) => s.status === "authed");
  useEffect(() => {
    if (!enabled || !authed || typeof document === "undefined") return;
    let last = 0;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      api.me.heartbeat().catch(() => {
        /* best effort */
      });
    };
    const onActivity = () => {
      if (Date.now() - last > ACTIVE_GAP_MS) beat();
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onActivity);
    window.addEventListener("focus", onActivity);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onActivity);
      window.removeEventListener("focus", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [enabled, authed]);
}
