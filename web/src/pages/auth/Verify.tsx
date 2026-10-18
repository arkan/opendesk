import { uiText } from "@/i18n/ui";
import { useTranslation } from "react-i18next";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Check, MailCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Notice } from "@/components/auth/parts";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import { bootSession, useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";

const route = getRouteApi("/auth/verify");

export default function Verify() {
  useTranslation("interface");
  const { token } = route.useSearch();
  const status = useSession((s) => s.status);
  const email = useSession((s) => s.user?.email);
  const [state, setState] = useState<"working" | "ok" | "failed">("working");
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    void bootSession();
  }, []);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api.auth
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((e) => {
        setError(errorMessage(e, "This link has expired or was already used."));
        setState("failed");
      });
  }, [token]);

  const resend = async () => {
    setResending(true);
    try {
      await api.auth.resendVerification();
      toast.success(uiText("Verification email sent"));
    } catch (e) {
      toast.error(e);
    } finally {
      setResending(false);
    }
  };

  const resendBlock =
    status === "authed" ? (
      <Button variant="secondary" size="lg" className="w-full" loading={resending} onClick={resend}>
        {uiText("Send a new link")}
      </Button>
    ) : (
      <Button variant="secondary" size="lg" className="w-full" asChild>
        <Link to="/login" search={{ next: "/verify" }}>
          {uiText("Log in to resend")}
        </Link>
      </Button>
    );

  if (!token)
    return (
      <div>
        <Glyph hue="blue"><MailCheck className="size-[18px]" /></Glyph>
        <AuthHeading title={uiText("Verify your email")} subtitle={<>{uiText("We sent a link to")} {email ? <span className="font-medium text-fg">{email}</span> : uiText("your inbox")}{uiText(". Open it to confirm your address.")}</>} />
        {resendBlock}
      </div>
    );

  if (state === "working")
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-[13px] text-fg-3" aria-live="polite">
        <Spinner />
        {uiText("Verifying your email")}
      </div>
    );

  if (state === "ok")
    return (
      <div>
        <Glyph solid><Check className="size-[18px]" strokeWidth={2.5} /></Glyph>
        <AuthHeading title={uiText("Email verified")} subtitle={uiText("Thanks. Your address is confirmed.")} />
        <Button variant="primary" size="lg" className="w-full" asChild>
          <Link to="/">{uiText("Continue")}</Link>
        </Button>
      </div>
    );

  return (
    <div>
      <Glyph hue="red"><X className="size-[18px]" /></Glyph>
      <AuthHeading title={uiText("That link didn't work")} />
      {error && <Notice className="mb-5">{error}</Notice>}
      {resendBlock}
    </div>
  );
}

function Glyph({ children, solid, hue }: { children: React.ReactNode; solid?: boolean; hue?: Tone }) {
  return (
    <span className={cn("mb-5 flex size-10 animate-indicator-in items-center justify-center rounded-lg", tone[hue ?? (solid ? "green" : "gray")].chip)}>
      {children}
    </span>
  );
}
