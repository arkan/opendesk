import { uiText } from "@/i18n/text";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthField, FieldError, Notice } from "@/components/auth/parts";
import { Turnstile, type TurnstileHandle } from "@/components/auth/Turnstile";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";

const schema = z.object({ email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address.") });
type Values = z.infer<typeof schema>;

export default function Forgot() {
  useTranslation("interface");
  const [token, setToken] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const submit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api.auth.forgot(email.trim(), token ?? undefined);
      setSent(true);
    } catch (err) {
      turnstile.current?.reset();
      // The answer is the same for every address; only transport problems surface.
      if (isApiError(err, "rate_limited") || isApiError(err, "network_error") || isApiError(err, "captcha_failed")) setError(errorMessage(err));
      else setSent(true);
    }
  });

  if (sent)
    return (
      <div>
        <span className={cn("mb-5 flex size-10 animate-indicator-in items-center justify-center rounded-lg", tone.blue.chip)}>
          <MailCheck className="size-[18px]" />
        </span>
        <AuthHeading title={uiText("Check your email")} subtitle={<>{uiText("If an account exists for")} <span className="font-medium text-fg">{getValues("email").trim()}</span>{uiText(", we sent a link to reset its password. It expires in an hour.")}</>} />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/login">{uiText("Back to log in")}</Link>
        </Button>
        <button type="button" onClick={() => setSent(false)} className="mt-4 w-full text-center text-[12.5px] text-fg-3 hover:text-fg">
          {uiText("Use a different email")}
        </button>
      </div>
    );

  return (
    <div>
      <AuthHeading title={uiText("Reset your password")} subtitle={uiText("Enter the email you use for opendesk and we'll send you a reset link.")} />
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label={uiText("Email")}>
          {(id) => (
            <div className="flex flex-col gap-1.5">
              <TextInput id={id} inputSize="lg" type="email" autoComplete="email" autoFocus placeholder="you@company.com" invalid={!!errors.email} {...register("email")} />
              <FieldError message={errors.email?.message} />
            </div>
          )}
        </AuthField>
        <Turnstile ref={turnstile} onToken={setToken} action="password_reset" />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>
          {uiText("Send reset link")}
        </Button>
      </form>
      <p className="mt-7 text-center text-[12.5px] text-fg-3">
         {uiText("Remembered it?")}{" "}
        <Link to="/login" className="font-medium text-fg hover:underline">
          {uiText("Log in")}
        </Link>
      </p>
    </div>
  );
}
