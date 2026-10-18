import { uiText } from "@/i18n/text";
import { useTranslation } from "react-i18next";
// Settings > Security > Passkeys: list, add, rename and remove.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Cloud, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ListRow, Section } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Field, TextInput } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ReauthNotice, isReauthError } from "@/components/settings/ReauthNotice";
import { errorMessage, isApiError } from "@/lib/api/client";
import { addPasskey, isPasskeyCancel, passkeyApi, passkeysSupported, type Passkey } from "@/lib/api/passkeys";
import { cn } from "@/lib/cn";
import { relLong, shortDate } from "@/lib/format";
import { tone } from "@/lib/tones";

const key = ["me", "passkeys"] as const;
// The offline demo (VITE_MOCK) has no WebAuthn relying party; it shows an empty list.
const mock = import.meta.env.VITE_MOCK === "1";
const listPasskeys = () => (mock ? Promise.resolve({ data: [] as Passkey[], next_cursor: null }) : passkeyApi.list());

function guessName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(uiText(" on ")) || uiText("Passkey");
}

export function PasskeysSection() {
  const { t: uiText } = useTranslation("interface");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const reduce = useReducedMotion();
  const supported = passkeysSupported() && !mock;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: key, queryFn: listPasskeys, select: (r) => r.data });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => passkeyApi.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ data: Passkey[]; next_cursor: string | null }>(key);
      qc.setQueryData<{ data: Passkey[]; next_cursor: string | null }>(key, (old) => old && { ...old, data: old.data.filter((p) => p.id !== id) });
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e);
    },
    onSuccess: () => toast.success(uiText("Passkey removed")),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const list = data ?? [];

  return (
    <Section
      title={uiText("Passkeys")}
      description={uiText("Sign in with your fingerprint, face or device PIN instead of a password. A passkey counts as two-factor.")}
      flush
      actions={
        supported ? (
          <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
            {uiText("Add a passkey")}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : isError ? (
        <EmptyState compact lit={3} title={uiText("Passkeys couldn't load")} action={<Button onClick={() => void refetch()}>{uiText("Retry")}</Button>} />
      ) : !list.length ? (
        <EmptyState
          compact
          lit={1}
          icon={
            <span className={cn("flex size-10 items-center justify-center rounded-lg", tone.violet.chip)}>
              <KeyRound className="size-[18px]" />
            </span>
          }
          title={uiText("No passkeys yet")}
          description={supported ? uiText("Add one to sign in faster and safer on this device.") : mock ? uiText("Passkeys aren't available in the demo.") : uiText("This browser doesn't support passkeys.")}
          action={
            supported ? (
              <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
                {uiText("Add a passkey")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <AnimatePresence initial={false}>
          {list.map((p) => (
            <motion.div
              key={p.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 42 }}
            >
              <ListRow>
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tone.violet.chip)}>
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="truncate">{p.name}</span>
                    {p.backed_up && (
                      <Tooltip content={uiText("Synced with your password manager or cloud keychain")}>
                        <span>
                          <Badge tone="blue">
                            <Cloud className="size-3" />
                            {uiText("Synced")}
                          </Badge>
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
                    <span>{uiText("Added")} {shortDate(p.created_at)}</span>
                    <span aria-hidden>·</span>
                    <span>{p.last_used_at ? uiText("Last used {{date}}", { date: relLong(p.last_used_at) }) : uiText("Never used")}</span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" square aria-label={uiText("Rename {{name}}", { name: p.name })} icon={<Pencil />} onClick={() => setRenaming(p)} />
                <Button
                  size="sm"
                  variant="ghost"
                  square
                  aria-label={uiText("Remove {{name}}", { name: p.name })}
                  icon={<Trash2 />}
                  onClick={() =>
                    confirm.show(uiText('You will no longer be able to sign in with "{{name}}".', { name: p.name }), () => remove.mutateAsync(p.id), {
                      title: uiText("Remove this passkey?"),
                      confirmLabel: uiText("Remove"),
                      danger: true,
                    })
                  }
                />
              </ListRow>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} />}
      {renaming && <RenameDialog passkey={renaming} onClose={() => setRenaming(null)} />}
    </Section>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const { t: uiText } = useTranslation("interface");
  const qc = useQueryClient();
  const [name, setName] = useState(guessName);
  const add = useMutation({
    mutationFn: () => addPasskey(name.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success(uiText("Passkey added"), { description: uiText("Use it next time you sign in.") });
      onClose();
    },
  });
  const err = add.error;
  const message = !err || isPasskeyCancel(err) || isReauthError(err)
    ? null
    : isApiError(err, "passkey_exists")
      ? uiText("This device already has a passkey for your account.")
      : isApiError(err, "passkey_limit")
        ? uiText("You have the most passkeys an account can hold. Remove one first.")
        : isApiError(err, "invalid_passkey")
          ? uiText("That passkey couldn't be verified. Try again.")
          : errorMessage(err);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={uiText("Add a passkey")}
      description={uiText("Your browser will ask you to confirm with your fingerprint, face, device PIN or security key.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {uiText("Cancel")}
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()} disabled={name.trim().length > 64}>
            {uiText("Continue")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label={uiText("Name")} hint={uiText("So you can tell your passkeys apart.")}>
          {({ id }) => <TextInput id={id} autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder={uiText("Chrome on Mac")} />}
        </Field>
        {isReauthError(err) && <ReauthNotice error={err} />}
        {message && (
          <p role="alert" className="text-xs text-danger-fg">
            {message}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function RenameDialog({ passkey, onClose }: { passkey: Passkey; onClose: () => void }) {
  const { t: uiText } = useTranslation("interface");
  const qc = useQueryClient();
  const [name, setName] = useState(passkey.name);
  const save = useMutation({
    mutationFn: () => passkeyApi.rename(passkey.id, name.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success(uiText("Passkey renamed"));
      onClose();
    },
  });
  const invalid = !name.trim() || name.trim().length > 64;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={uiText("Rename passkey")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {uiText("Cancel")}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            {uiText("Save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
      >
        <Field label={uiText("Name")}>
          {({ id }) => <TextInput id={id} autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {save.isError && (
          <p role="alert" className="mt-2 text-xs text-danger-fg">
            {isApiError(save.error, "invalid_name") ? uiText("Use 1 to 64 characters.") : errorMessage(save.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
