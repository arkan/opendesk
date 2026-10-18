import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { errorMessage, isApiError } from "@/lib/api/client";
import { signOut, useSession } from "@/lib/session";

/** Owner-level operations need a session that passed 2FA and is less than 12 hours old. */
export function isReauthError(e: unknown) {
  return isApiError(e, "mfa_required") || isApiError(e, "reauth_required");
}

export function ReauthNotice({ error }: { error: unknown }) {
  const { t: appText } = useTranslation("app");
  const navigate = useNavigate();
  if (!error) return null;
  if (!isReauthError(error)) return <p className="text-xs text-danger-fg">{errorMessage(error)}</p>;
  const mfa = isApiError(error, "mfa_required");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-sunken px-3 py-2.5">
      <p className="text-[12.5px] text-fg-2">
        {mfa ? appText("Turn on two-factor and sign in again to do this.") : appText("Sign in again to confirm it's you.")}
      </p>
      <Button
        size="xs"
        variant="secondary"
        onClick={async () => {
          const next = location.pathname + location.search;
          const email = useSession.getState().user?.email;
          // Only this account signs out; others in this browser stay signed in.
          await signOut();
          void navigate({ to: "/login", search: { next, email, add: "1" } });
        }}
      >

        {appText("Sign in again")}
      </Button>
    </div>
  );
}
