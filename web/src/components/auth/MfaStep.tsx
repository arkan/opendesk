import { useTranslation } from "react-i18next";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import type { TokenResponse } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthHeading } from "@/app/AuthLayout";
import { Notice } from "./parts";

/** Six boxes over one real input (input-otp): paste, autofill and screen readers just work. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const { t: a } = useTranslation("auth");
  return (
    <OTPInput
      autoFocus
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={(v: string) => onComplete?.(v)}
      disabled={disabled}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label={a("6digitCode")}
      aria-invalid={invalid || undefined}
      containerClassName={cn("flex items-center", invalid && "animate-[shake_260ms_ease-in-out] motion-reduce:animate-none")}
      render={({ slots }) => (
        <div className="flex w-full items-center gap-2">
          {slots.map((s, i) => (
            <div
              key={i}
              className={cn(
                "mono relative flex h-12 flex-1 items-center justify-center rounded-md border bg-surface text-[20px] font-medium tabular-nums transition-[border-color,box-shadow,transform] duration-150",
                invalid ? "border-tone-red-solid" : s.isActive ? "border-focus-line shadow-[0_0_0_3px_var(--focus)]" : s.char ? "border-line-strong" : "border-line",
                i === 2 && "mr-2",
              )}
            >
              {s.char && <span className="animate-indicator-in motion-reduce:animate-none">{s.char}</span>}
              {s.hasFakeCaret && <span className="h-5 w-px animate-pulse-soft bg-fg" />}
            </div>
          ))}
        </div>
      )}
    />
  );
}

export function MfaStep({ mfaToken, onDone, onBack }: { mfaToken: string; onDone: (t: TokenResponse) => void | Promise<void>; onBack: () => void }) {
  const { t: a } = useTranslation("auth");
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recoveryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "recovery") recoveryRef.current?.focus();
  }, [mode]);

  const submit = async (value = code) => {
    const v = value.trim();
    if (mode === "totp" && v.length !== 6) return;
    if (mode === "recovery" && v.length < 8) return setError(a("enterARecoveryCode"));
    setBusy(true);
    setError(null);
    try {
      const tok = await api.auth.mfa({ mfa_token: mfaToken, code: v });
      await onDone(tok);
    } catch (e) {
      setCode("");
      if (isApiError(e, "rate_limited")) setError(a("tooManyAttemptsWaitAMomentAndTry"));
      else if (isApiError(e) && e.status === 401 && e.code !== "invalid_code") setError(a("thisSigninExpiredStartAgain"));
      else setError(mode === "totp" ? a("thatCodeDidntWorkCheckYourAppAnd") : a("thatRecoveryCodeDidntWork"));
      setBusy(false);
    }
  };

  return (
    <div>
      <AuthHeading
        title={a("twofactorAuthentication")}
        subtitle={mode === "totp" ? a("enterThe6digitCodeFromYourAuthenticatorApp") : a("enterOneOfTheRecoveryCodesYouSaved")}
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "totp" ? (
          <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void submit(v)} disabled={busy} invalid={!!error} />
        ) : (
          <TextInput
            ref={recoveryRef}
            inputSize="lg"
            className="mono tracking-[0.04em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            aria-label={a("recoveryCode")}
            autoComplete="off"
            spellCheck={false}
          />
        )}
        {error && <Notice>{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={mode === "totp" && code.length !== 6}>
          {a("verify")}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-[12.5px]">
        <button type="button" onClick={onBack} className="text-fg-3 hover:text-fg">
          {a("back")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "totp" ? "recovery" : "totp");
            setCode("");
            setError(null);
          }}
          className="text-fg-3 underline decoration-line-strong underline-offset-2 hover:text-fg"
        >
          {mode === "totp" ? a("useARecoveryCode") : a("useYourAuthenticatorApp")}
        </button>
      </div>
    </div>
  );
}
