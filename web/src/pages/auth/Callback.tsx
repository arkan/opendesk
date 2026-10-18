import { useTranslation } from "react-i18next";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MfaStep } from "@/components/auth/MfaStep";
import { AuthField, completeSignIn, Notice, oauthErrorKey, PasswordInput } from "@/components/auth/parts";
import { api } from "@/lib/api/endpoints";
import { takeVerifier } from "@/lib/desktop";
import { errorMessage, isApiError } from "@/lib/api/client";
import type { ExchangeResponse, LinkRequired, TokenResponse } from "@/lib/api/types";
import { track } from "@/lib/analytics";
import { tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

const route = getRouteApi("/auth/auth/callback");

type State =
  | { kind: "working" }
  | { kind: "error"; error: unknown }
  | { kind: "mfa"; token: string; redirect?: string }
  | { kind: "link"; link: LinkRequired };

/** Older servers answer link_required as a 409 problem; read it from either shape. */
function linkFromError(e: unknown): LinkRequired | null {
  if (!isApiError(e, "link_required")) return null;
  const b = (e as unknown as { body?: Record<string, unknown> }).body ?? {};
  if (typeof b.link_token !== "string") return null;
  return { link_required: true, link_token: b.link_token, email: typeof b.email === "string" ? b.email : "", redirect_to: typeof b.redirect_to === "string" ? b.redirect_to : undefined };
}

export default function Callback() {
  const { t: uiText } = useTranslation("interface");
  const search = route.useSearch();
  const router = useRouter();
  const [state, setState] = useState<State>(() =>
    search.error ? { kind: "error", error: oauthErrorKey(search.error) } : search.code ? { kind: "working" } : { kind: "error", error: "This sign-in link is incomplete. Start again." },
  );
  const provider = search.code?.startsWith("mock-") ? search.code.slice(5) : undefined;
  const ran = useRef(false);

  const finish = async (tok: TokenResponse, redirect?: string) => {
    track("login_succeeded", { method: "oauth" });
    router.history.push(await completeSignIn({ ...tok, redirect_to: tok.redirect_to ?? redirect }, search.next));
  };

  const handle = async (r: ExchangeResponse) => {
    if ("link_required" in r) setState({ kind: "link", link: r });
    else if ("mfa_required" in r) setState({ kind: "mfa", token: r.mfa_token, redirect: r.redirect_to });
    else await finish(r);
  };

  useEffect(() => {
    if (!search.code || ran.current) return;
    ran.current = true;
    api.auth
      .oauthExchange(search.code, takeVerifier(search.code))
      .then(handle)
      .catch((e) => {
        const link = linkFromError(e);
        if (link) setState({ kind: "link", link });
        else setState({ kind: "error", error: e });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.code]);

  if (state.kind === "working")
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-[13px] text-fg-3" aria-live="polite">
        <Spinner />
        {uiText("Signing you in")}
      </div>
    );

  if (state.kind === "mfa") return <MfaStep mfaToken={state.token} onDone={(t) => finish(t, state.redirect)} onBack={() => router.history.push("/login")} />;

  if (state.kind === "link") return <LinkAccount link={state.link} provider={provider} onResult={handle} />;

  return (
    <div>
      <AuthHeading title={uiText("Couldn't sign you in")} />
      <Notice className="mb-5">{errorMessage(state.error, "This sign-in link expired. Start again.")}</Notice>
      <Button variant="secondary" size="lg" className="w-full" asChild>
        <Link to="/login">{uiText("Back to log in")}</Link>
      </Button>
    </div>
  );
}

function LinkAccount({ link, provider, onResult }: { link: LinkRequired; provider?: string; onResult: (r: ExchangeResponse) => Promise<void> }) {
  const { t: uiText } = useTranslation("interface");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = { google: "Google", microsoft: "Microsoft", github: "GitHub", oidc: "SSO" }[provider ?? ""] ?? uiText("this sign-in method");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return setError("Enter your password.");
    setBusy(true);
    setError(null);
    try {
      await onResult(await api.auth.oauthLink(link.link_token, password));
    } catch (err) {
      setBusy(false);
      setPassword("");
      if (isApiError(err, "invalid_credentials") || (isApiError(err) && err.status === 401)) setError("That password isn't right.");
      else if (isApiError(err) && (err.code === "invalid_token" || err.status === 410)) setError("This link expired. Start the sign-in again.");
      else setError(err);
    }
  };

  return (
    <div>
      <span className={cn("mb-5 flex size-10 animate-indicator-in items-center justify-center rounded-lg", tone.blue.chip)}>
        <Link2 className="size-[18px]" />
      </span>
      <AuthHeading
        title={uiText("Link your account")}
        subtitle={
          <>
             {uiText("An opendesk account already uses")} {link.email ? <span className="font-medium text-fg">{link.email}</span> : uiText("this email")}{uiText(". Enter its password to link")} {name}{uiText(". Next time you can sign in with either.")} </>
        }
      />
      {error != null && <Notice className="mb-4">{errorMessage(error)}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField
          label={uiText("Password")}
          aside={
            <Link to="/forgot" className="text-xs text-fg-3 hover:text-fg">
              {uiText("Forgot password?")}
            </Link>
          }
        >
          {(id) => <PasswordInput id={id} autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </AuthField>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {uiText("Link and continue")}
        </Button>
      </form>
      <p className="mt-6 text-center text-[12.5px] text-fg-3">
        <Link to="/login" className="hover:text-fg">
          {uiText("Cancel")}
        </Link>
      </p>
    </div>
  );
}
