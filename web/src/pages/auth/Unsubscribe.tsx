import { Trans, useTranslation } from "react-i18next";
// The footer link of notification emails (contracts/api.md "Notification preferences
// and emails"). Mail scanners open links on their own, so the page only asks; the
// token is spent on the button, never on load.

import { getRouteApi, useRouter } from "@tanstack/react-router";
import { BellOff, Check, X } from "lucide-react";
import { useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Notice } from "@/components/auth/parts";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";

const route = getRouteApi("/auth/unsubscribe");

type State = { kind: "ask" } | { kind: "done"; workspace: { id: string; name: string } } | { kind: "invalid" } | { kind: "error"; message: string };

export default function Unsubscribe() {
  const { t: a } = useTranslation("auth");
  const { token } = route.useSearch();
  const [state, setState] = useState<State>({ kind: "ask" });
  const [busy, setBusy] = useState(false);

  const unsubscribe = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await api.notifications.unsubscribe(token);
      setState({ kind: "done", workspace: r.workspace });
    } catch (e) {
      setState(isApiError(e, "invalid_token") ? { kind: "invalid" } : { kind: "error", message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!token || state.kind === "invalid")
    return (
      <div>
        <Glyph hue="red">
          <X className="size-[18px]" />
        </Glyph>
        <AuthHeading
          title={a("thisLinkIsNotValidAnyMore")}
          subtitle={a("itMayBeIncompleteOrTooOldYou")}
        />
        <ManageLink />
      </div>
    );

  if (state.kind === "done")
    return (
      <div>
        <Glyph solid>
          <Check className="size-[18px]" strokeWidth={2.5} />
        </Glyph>
        <AuthHeading
          title={a("youAreUnsubscribed")}
          subtitle={
            <Trans ns="auth" i18nKey="unsubscribedBody" values={{ name: state.workspace.name }} components={{ workspace: <span className="font-medium text-fg" /> }} />
          }
        />
        <ManageLink workspaceId={state.workspace.id} />
      </div>
    );

  return (
    <div>
      <Glyph>
        <BellOff className="size-[18px]" />
      </Glyph>
      <AuthHeading
        title={a("stopNotificationEmails")}
        subtitle={a("youWillStopGettingNotificationEmailsFromThis")}
      />
      {state.kind === "error" && <Notice className="mb-5">{state.message}</Notice>}
      <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={unsubscribe}>
        {a("unsubscribe")}
      </Button>
    </div>
  );
}

/** To the settings page, in the workspace the email was about (`?ws=`) when known. */
function ManageLink({ workspaceId }: { workspaceId?: string }) {
  const { t: a } = useTranslation("auth");
  const router = useRouter();
  const href = workspaceId ? `/settings/notifications?ws=${encodeURIComponent(workspaceId)}` : "/settings/notifications";
  return (
    <Button variant="secondary" size="lg" className="w-full" asChild>
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          router.history.push(href);
        }}
      >
        {a("notificationSettings")}
      </a>
    </Button>
  );
}

function Glyph({ children, solid, hue }: { children: React.ReactNode; solid?: boolean; hue?: Tone }) {
  return (
    <span className={cn("mb-5 flex size-10 animate-indicator-in items-center justify-center rounded-lg", tone[hue ?? (solid ? "green" : "gray")].chip)}>
      {children}
    </span>
  );
}
