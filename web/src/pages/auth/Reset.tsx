import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { AuthField, FieldError, Notice, PasswordInput, StrengthMeter } from "@/components/auth/parts";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import { tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

const route = getRouteApi("/auth/reset");

const createSchema = (a: TFunction<"auth">) => z
  .object({
    password: z
      .string()
      .refine((s) => [...s].length >= 12, a("useAtLeast12Characters"))
      .refine((s) => [...s].length <= 128, a("useAtMost128Characters")),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: a("thePasswordsDontMatch"), path: ["confirm"] });
type Values = z.infer<ReturnType<typeof createSchema>>;

export default function Reset() {
  const { t: a } = useTranslation("auth");
  const schema = createSchema(a);
  const { token } = route.useSearch();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const password = watch("password");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token)
    return (
      <div>
        <AuthHeading title={a("thisLinkIsIncomplete")} subtitle={a("openTheResetLinkFromYourEmailAgain")} />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/forgot">{a("requestANewLink")}</Link>
        </Button>
      </div>
    );

  if (done)
    return (
      <div>
        <span className={cn("mb-5 flex size-10 animate-indicator-in items-center justify-center rounded-lg", tone.green.chip)}>
          <Check className="size-[18px]" strokeWidth={2.5} />
        </span>
        <AuthHeading title={a("passwordUpdated")} subtitle={a("youWereSignedOutEverywhereLogInWith")} />
        <Button variant="primary" size="lg" className="w-full" asChild>
          <Link to="/login">{a("logIn")}</Link>
        </Button>
      </div>
    );

  const submit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api.auth.reset(token, password);
      setDone(true);
    } catch (err) {
      if (isApiError(err) && (err.code === "invalid_token" || err.code === "not_found")) setError(a("thisResetLinkHasExpiredOrWasAlready"));
      else setError(errorMessage(err));
    }
  });

  return (
    <div>
      <AuthHeading title={a("chooseANewPassword")} subtitle={a("use12OrMoreCharactersAShortSentence")} />
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label={a("newPassword")}>
          {(id) => (
            <div className="flex flex-col gap-2">
              <PasswordInput id={id} autoFocus autoComplete="new-password" invalid={!!errors.password} {...register("password")} />
              {errors.password ? <FieldError message={errors.password.message} /> : <StrengthMeter password={password} />}
            </div>
          )}
        </AuthField>
        <AuthField label={a("confirmPassword")}>
          {(id) => (
            <div className="flex flex-col gap-1.5">
              <PasswordInput id={id} autoComplete="new-password" invalid={!!errors.confirm} {...register("confirm")} />
              <FieldError message={errors.confirm?.message} />
            </div>
          )}
        </AuthField>
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={isSubmitting}>
          {a("updatePassword")}
        </Button>
      </form>
    </div>
  );
}
