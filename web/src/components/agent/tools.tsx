import { appText } from "@/i18n/text";
// Company tools for the agent (contracts/agent.md "MCP connections"): the
// add/edit connection dialog and the panel that runs a tool once with a form
// built from its input schema. Secrets are write-only: a stored one shows as
// "Set" with a way to replace it, never its value.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { continueInBrowser } from "@/components/desktop/InBrowser";
import { isDesktop } from "@/lib/desktop";
import { Braces, KeyRound, ListChecks, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import type { McpAuthInput, McpAuthKind, McpServer, McpTool, McpToolResult } from "@/lib/api/types";
import { qk } from "@/lib/queries";
import { cn } from "@/lib/cn";
import { tone } from "@/lib/tones";

/** Header names the server refuses: hop-by-hop, Host, Cookie and Content-*. */
const BAD_HEADER = /^(host|cookie|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-.*)$/i;
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function urlProblem(v: string): "empty" | "invalid" | null {
  const s = v.trim();
  if (!s) return "empty";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? null : "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Starts the OAuth flow: the browser leaves for the authorization server and comes back to /settings/ai/tools.
 * The desktop app opens that page in the browser instead (contracts/native.md).
 */
export async function startOAuth(id: string) {
  if (isDesktop) return continueInBrowser("/settings/ai/tools");
  const { url } = await api.ai.mcp.oauthStart(id);
  window.location.assign(url);
}

export function ServerDialog({ server, onClose, onSaved }: { server: McpServer | null; onClose: () => void; onSaved?: (s: McpServer) => void }) {
  const { t } = useTranslation("agent");
  const qc = useQueryClient();
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [kind, setKind] = useState<McpAuthKind>(server?.auth.kind ?? "none");
  const [token, setToken] = useState("");
  const [headerName, setHeaderName] = useState(server?.auth.header_name ?? "");
  const [headerValue, setHeaderValue] = useState("");
  // Replacing a stored secret is explicit; until then the stored one is kept.
  const stored = !!server?.auth.has_secret && server.auth.kind === kind;
  const [replacing, setReplacing] = useState(!stored);
  const [tried, setTried] = useState(false);

  const nameBad = !name.trim() || name.trim().length > 60;
  const urlBad = urlProblem(url);
  const headerBad = kind === "header" && (!HEADER_TOKEN.test(headerName.trim()) || BAD_HEADER.test(headerName.trim()));
  const secretMissing = (kind === "bearer" && replacing && !token.trim()) || (kind === "header" && replacing && !headerValue.trim());
  const invalid = nameBad || !!urlBad || headerBad || secretMissing;

  const save = useMutation({
    mutationFn: async () => {
      let auth: McpAuthInput | undefined = { kind };
      if (kind === "bearer" && replacing) auth.token = token.trim();
      if (kind === "header") {
        auth.header_name = headerName.trim();
        if (replacing) auth.header_value = headerValue;
      }
      // Editing without touching the connection keeps it as it is.
      if (server && kind === server.auth.kind && !replacing && (kind !== "header" || headerName.trim() === server.auth.header_name)) auth = undefined;
      if (!server) return api.ai.mcp.create({ name: name.trim(), url: url.trim(), auth: auth! });
      return api.ai.mcp.update(server.id, { name: name.trim(), url: url.trim(), auth });
    },
    onSuccess: (s) => {
      qc.setQueryData<McpServer[]>(qk.mcpServers, (rows) => (rows ? (rows.some((r) => r.id === s.id) ? rows.map((r) => (r.id === s.id ? s : r)) : [...rows, s]) : [s]));
      onSaved?.(s);
      onClose();
    },
    onError: (e) => toast.error(e, t("tools.saveError")),
  });

  const secretField = (label: string, value: string, set: (v: string) => void, placeholder: string) =>
    !replacing ? (
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-fg">{label}</span>
        <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-sunken pl-2.5 pr-1">
          <KeyRound className="size-3.5 text-fg-3" />
          <span className={cn("inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium", tone.green.chip)}>{t("tools.secretSet")}</span>
          <span className="flex-1 text-xs text-fg-3">{t("tools.secretHidden")}</span>
          <Button size="xs" variant="ghost" onClick={() => setReplacing(true)}>
            {t("tools.replace")}
          </Button>
        </div>
      </div>
    ) : (
      <Field label={label} error={tried && !value.trim() ? t("tools.secretRequired") : null} hint={stored ? t("tools.replaceHint") : t("tools.secretHint")}>
        {(p) => (
          <TextInput {...p} type="password" autoComplete="off" spellCheck={false} className="mono" placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} />
        )}
      </Field>
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={server ? t("tools.editTitle") : t("tools.addTitle")}
      description={t("tools.addDescription")}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" type="submit" form="mcp-form" loading={save.isPending}>
            {server ? t("save") : kind === "oauth" ? t("tools.addAndConnect") : t("tools.addSubmit")}
          </Button>
        </>
      }
    >
      <form
        id="mcp-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!invalid) save.mutate();
        }}
      >
        <Field label={t("tools.name")} hint={t("tools.nameHint")} error={tried && nameBad ? t("tools.nameInvalid") : null}>
          {(p) => <TextInput {...p} autoFocus maxLength={60} placeholder={appText("Shop")} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("tools.url")} hint={t("tools.urlHint")} error={tried && urlBad ? t(`tools.url_${urlBad}`) : null}>
          {(p) => (
            <TextInput {...p} className="mono" inputMode="url" placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-fg">{t("tools.auth")}</span>
          <Segmented<McpAuthKind>
            value={kind}
            onChange={(k) => {
              setKind(k);
              setReplacing(!(server?.auth.has_secret && server.auth.kind === k));
            }}
            options={[
              { value: "none", label: t("tools.authKind.none") },
              { value: "bearer", label: t("tools.authKind.bearer") },
              { value: "header", label: t("tools.authKind.header") },
              { value: "oauth", label: t("tools.authKind.oauth") },
            ]}
            className="self-start"
          />
          <p className="text-xs text-fg-3">{t(`tools.authHint.${kind}`)}</p>
        </div>
        {kind === "bearer" && secretField(t("tools.token"), token, setToken, "sk_live_…")}
        {kind === "header" && (
          <>
            <Field label={t("tools.headerName")} error={tried && headerBad ? t("tools.headerInvalid") : null}>
              {(p) => <TextInput {...p} className="mono" placeholder="X-Api-Key" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />}
            </Field>
            {secretField(t("tools.headerValue"), headerValue, setHeaderValue, "")}
          </>
        )}
      </form>
    </Dialog>
  );
}

// ---------- Test a tool ----------

type Prop = { type?: string | string[]; description?: string; enum?: unknown[]; default?: unknown; title?: string };

function propType(p: Prop): string {
  const t = Array.isArray(p.type) ? p.type.find((x) => x !== "null") : p.type;
  return t ?? "string";
}

/** The simple top-level fields of a schema, or null when a form can't express it. */
function formFields(schema: Record<string, unknown>): { name: string; prop: Prop; required: boolean }[] | null {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const req = new Set((schema.required as string[] | undefined) ?? []);
  const out = Object.entries(props).map(([name, prop]) => ({ name, prop, required: req.has(name) }));
  return out.every((f) => ["string", "number", "integer", "boolean"].includes(propType(f.prop))) ? out : null;
}

function fromForm(fields: { name: string; prop: Prop }[], values: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    const ty = propType(f.prop);
    if (ty === "boolean") {
      if (v !== undefined) out[f.name] = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      out[f.name] = ty === "number" || ty === "integer" ? Number(v) : v;
    }
  }
  return out;
}

export function ToolTest({ server, tool }: { server: McpServer; tool: McpTool }) {
  const { t } = useTranslation("agent");
  const fields = useMemo(() => formFields(tool.input_schema), [tool.input_schema]);
  const [mode, setMode] = useState<"form" | "json">(fields ? "form" : "json");
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [raw, setRaw] = useState(() => JSON.stringify(fields ? {} : exampleArgs(tool.input_schema), null, 2));
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<McpToolResult | null>(null);

  let args: Record<string, unknown> | null = null;
  let jsonError: string | null = null;
  if (mode === "form" && fields) args = fromForm(fields, values);
  else {
    try {
      const v = JSON.parse(raw || "{}");
      if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
      else jsonError = t("tools.test.notObject");
    } catch {
      jsonError = t("tools.test.badJson");
    }
  }
  const missing = mode === "form" && fields ? fields.filter((f) => f.required && args?.[f.name] === undefined).map((f) => f.name) : [];

  const run = useMutation({
    mutationFn: () =>
      api.ai.mcp.testTool(server.id, tool.name, {
        arguments: args ?? {},
        visitor: verified || email.trim() ? { verified, email: email.trim() || undefined } : undefined,
      }),
    onSuccess: setResult,
    onError: (e) => toast.error(e, t("tools.test.error")),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3">
      <div className="flex items-center gap-2">
        <span className="label-caps flex-1">{t("tools.test.title")}</span>
        {fields && (
          <Segmented<"form" | "json">
            size="xs"
            value={mode}
            onChange={(m) => {
              if (m === "json" && args) setRaw(JSON.stringify(args, null, 2));
              setMode(m);
            }}
            options={[
              { value: "form", label: t("tools.test.form"), icon: <ListChecks /> },
              { value: "json", label: t("tools.test.json"), icon: <Braces /> },
            ]}
          />
        )}
      </div>
      {mode === "form" && fields ? (
        fields.length === 0 ? (
          <p className="text-xs text-fg-3">{t("tools.test.noArgs")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const ty = propType(f.prop);
              const label = (
                <span className="inline-flex items-center gap-1">
                  <span className="mono text-[12px]">{f.name}</span>
                  {f.required && <span className="text-danger-fg">*</span>}
                </span>
              );
              if (ty === "boolean")
                return (
                  <label key={f.name} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
                    <span className="min-w-0">
                      {label}
                      {f.prop.description && <span className="block truncate text-[11px] text-fg-3">{f.prop.description}</span>}
                    </span>
                    <Switch checked={values[f.name] === true} onCheckedChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} aria-label={f.name} />
                  </label>
                );
              if (f.prop.enum?.length)
                return (
                  <Field key={f.name} label={label} hint={f.prop.description}>
                    {(p) => (
                      <Select
                        id={p.id}
                        size="sm"
                        value={(values[f.name] as string) || undefined}
                        onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
                        options={f.prop.enum!.map((x) => ({ value: String(x), label: String(x) }))}
                        placeholder={t("tools.test.choose")}
                        aria-label={f.name}
                      />
                    )}
                  </Field>
                );
              return (
                <Field key={f.name} label={label} hint={f.prop.description}>
                  {(p) => (
                    <TextInput
                      {...p}
                      inputSize="sm"
                      inputMode={ty === "string" ? undefined : "decimal"}
                      className={cn(ty !== "string" && "mono")}
                      value={(values[f.name] as string) ?? ""}
                      onChange={(e) => {
                        const v = ty === "string" ? e.target.value : e.target.value.replace(ty === "integer" ? /[^\d-]/g : /[^\d.-]/g, "");
                        setValues((s) => ({ ...s, [f.name]: v }));
                      }}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        )
      ) : (
        <Field error={jsonError} hint={!fields ? t("tools.test.jsonOnly") : undefined}>
          {(p) => <Textarea {...p} rows={6} spellCheck={false} className="mono text-[12px]" value={raw} onChange={(e) => setRaw(e.target.value)} aria-label={t("tools.test.json")} />}
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
        <TextInput
          inputSize="sm"
          type="email"
          className="w-[200px]"
          placeholder={t("tools.test.visitorEmail")}
          aria-label={t("tools.test.visitorEmail")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="flex items-center gap-2 text-[12px] text-fg-2">
          <Switch checked={verified} onCheckedChange={setVerified} aria-label={t("tools.test.verified")} />
          {t("tools.test.verified")}
        </label>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          icon={<Play className="size-3" />}
          loading={run.isPending}
          disabled={!args || missing.length > 0}
          onClick={() => run.mutate()}
        >
          {t("tools.test.run")}
        </Button>
      </div>
      {tool.destructive && <p className="text-[11.5px] text-tone-amber">{t("tools.test.destructiveNote")}</p>}
      {result && (
        <div className="animate-rise-in overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5">
            <span className={cn("size-1.5 rounded-full", result.is_error ? tone.red.solid : tone.green.solid)} aria-hidden />
            <span className="text-[12px] font-medium text-fg">{result.is_error ? t("tools.test.failed") : t("tools.test.ok")}</span>
            <span className="mono ml-auto text-[11px] text-fg-4">{result.ms} ms</span>
          </div>
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11.5px] leading-[17px] text-fg-2">{pretty(result.content)}</pre>
        </div>
      )}
    </div>
  );
}

/** Pretty-prints JSON content; other text stays as it is. */
function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Placeholders for every top-level property, for the raw JSON editor. */
function exampleArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) {
    const ty = propType(p);
    out[k] = p.default ?? (ty === "number" || ty === "integer" ? 0 : ty === "boolean" ? false : ty === "array" ? [] : ty === "object" ? {} : "");
  }
  return out;
}
