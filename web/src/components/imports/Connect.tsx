// The credentials an import reads a source with: the source's own fields, each with a
// line on where to find it. Errors the server names (body.credentials.<field>) sit under
// their field.

import { ArrowUpRight, Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, TextInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api/client";
import type { ImportSource } from "@/lib/api/types";
import { credentialFields, sourceName, type CredentialField } from "./sources";

/** The server's per-field messages, by credential key. */
export function credentialErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const x of e.errors ?? []) {
    const m = /^body\.credentials\.(\w+)$/.exec(x.location ?? "");
    if (m?.[1] && x.message) out[m[1]] = x.message;
  }
  return out;
}

/** Whether every required field has a value. Replacing stored credentials needs only the secrets. */
export function credentialsReady(source: Exclude<ImportSource, "csv">, v: Record<string, string>, replacing = false) {
  return credentialFields[source].every((f) => f.optional || f.choices || (replacing && !f.secret) || v[f.key]?.trim());
}

function Secret({ id, value, onChange, invalid, describedBy, autoFocus }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; describedBy?: string; autoFocus?: boolean }) {
  const { t } = useTranslation("imports");
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      id={id}
      aria-describedby={describedBy}
      invalid={invalid}
      autoFocus={autoFocus}
      type={shown ? "text" : "password"}
      autoComplete="off"
      spellCheck={false}
      className="mono"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      trailing={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t("connect.hide") : t("connect.show")}
          className="flex size-6 items-center justify-center rounded text-fg-4 transition-colors hover:bg-hover hover:text-fg"
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      }
    />
  );
}

export function CredentialsForm({
  source,
  value,
  onChange,
  errors,
  autoFocus = true,
  replacing = false,
}: {
  source: Exclude<ImportSource, "csv">;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  errors: Record<string, string>;
  autoFocus?: boolean;
  /** New credentials for an import: fields that are not secret may stay empty and keep their value. */
  replacing?: boolean;
}) {
  const { t } = useTranslation("imports");
  const { t: templateText } = useTranslation("templatesUi");
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  const fields = credentialFields[source];
  const first = fields.find((f) => !f.choices && (!replacing || f.secret))?.key;
  const hint = (f: CredentialField) => (
    <>
      {templateText(f.hint)}
      {f.help && (
        <>
          {" "}
          <a href={f.help} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
            {t("connect.whereToFind")}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </>
      )}
    </>
  );
  return (
    <div className="flex flex-col gap-4">
      {fields.map((f) =>
        f.choices ? (
          <div key={f.key} className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg-2">{templateText(f.label)}</span>
            <Segmented
              className="self-start"
              value={value[f.key] ?? f.choices[0]![0]}
              onChange={(v) => set(f.key, v)}
              options={f.choices.map(([v, label]) => ({ value: v, label: templateText(label) }))}
            />
            <p className="text-xs text-fg-3">{hint(f)}</p>
          </div>
        ) : (
          <Field key={f.key} label={templateText(f.label)} optional={f.optional || (replacing && !f.secret)} error={errors[f.key]} hint={hint(f)}>
            {(p) =>
              f.secret ? (
                <Secret id={p.id} describedBy={p["aria-describedby"]} invalid={p.invalid} value={value[f.key] ?? ""} onChange={(v) => set(f.key, v)} autoFocus={autoFocus && first === f.key} />
              ) : (
                <TextInput
                  {...p}
                  autoFocus={autoFocus && first === f.key}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={replacing ? t("connect.same") : f.placeholder}
                  value={value[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  trailing={f.suffix ? <span className="mono pointer-events-none pr-1 text-[12px] text-fg-4">{f.suffix}</span> : undefined}
                  className={f.suffix ? "[&_input]:pr-[118px]" : undefined}
                />
              )
            }
          </Field>
        ),
      )}
      {!replacing && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2.5 text-[12px] leading-[18px] text-fg-3">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-4" aria-hidden />
          {t("connect.safety", { name: sourceName[source] })}
        </p>
      )}
    </div>
  );
}
