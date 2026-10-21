import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AuthHeading } from "@/app/AuthLayout";
import { WorkspaceGlyph } from "@/app/Sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/auth/parts";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import { q } from "@/lib/queries";
import { bootSession, reloadSession, selectWorkspace, useSession } from "@/lib/session";
import type { Role } from "@/lib/api/types";

const route = getRouteApi("/auth/invite");

export default function Invite() {
  const { t: a } = useTranslation("auth");
  const roleCopy: Record<Role, string> = {
    owner: a("roleOwner"),
    admin: a("roleAdmin"),
    agent: a("roleAgent"),
    viewer: a("roleViewer"),
  };

  const { token = "" } = route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation("shell");
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.user);
  const lookup = useQuery({ ...q.invitationLookup(token), enabled: !!token });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bootSession();
  }, []);

  const next = `/invite?token=${encodeURIComponent(token)}`;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await api.invitations.accept(token);
      await reloadSession(m.workspace.id);
      selectWorkspace(m.workspace.id);
      qc.clear();
      void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "invitation_email_mismatch"))
        setError(a("invitationMismatch", { email: lookup.data?.email ?? a("anotherAddress") }));
      else setError(errorMessage(e));
    }
  };

  if (!token || lookup.isError)
    return (
      <div>
        <AuthHeading title={a("thisInvitationIsntValid")} subtitle={a("itMayHaveExpiredOrBeenRevokedAsk")} />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/">{a("goToOpendesk")}</Link>
        </Button>
      </div>
    );

  if (lookup.isLoading || status === "loading")
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-4 h-10 rounded-md" />
      </div>
    );

  const inv = lookup.data!;
  const mismatch = status === "authed" && me && me.email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <div>
      <div className="mb-5 [&>span]:size-10 [&>span]:rounded-lg [&>span]:text-[17px]">
        <WorkspaceGlyph name={inv.workspace_name} />
      </div>
      <AuthHeading
        title={a("joinWorkspace", { name: inv.workspace_name })}
        subtitle={
          <Trans ns="auth" i18nKey="invitationBody" values={{ role: roleCopy[inv.role], email: inv.email }} components={{ email: <span className="font-medium text-fg" /> }} />
        }
      />
      {error && <Notice className="mb-4">{error}</Notice>}
      {status === "authed" ? (
        <div className="flex flex-col gap-3">
          {mismatch && (
            <Notice tone="info">
              <Trans ns="auth" i18nKey="signedInMismatch" values={{ email: me.email, invitedEmail: inv.email }} components={{ email: <span className="font-medium text-fg" /> }} />
            </Notice>
          )}
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={accept}>
            {a("acceptInvitation")}
          </Button>
          {mismatch && (
            // Signs in to the invited address beside this account (or switches to it when it is already signed in here).
            <Button variant="ghost" size="lg" className="w-full" asChild>
              <Link to="/login" search={{ next, email: inv.email, add: "1" }}>
                {t("accounts.reauthAs", { email: inv.email })}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link to="/register" search={{ next, email: inv.email }}>
              {a("createAnAccount")}
            </Link>
          </Button>
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <Link to="/login" search={{ next }}>
              {a("iAlreadyHaveAnAccount")}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
