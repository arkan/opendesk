import { uiText } from "@/i18n/ui";
import { useTranslation } from "react-i18next";
// Cloudflare Turnstile, loaded on demand. Renders nothing when no site key is
// configured, in which case no token is sent.

import { useQuery } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { config } from "@/lib/config";
import { q } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(uiText("Turnstile failed to load"))));
    s.onerror = () => {
      loading = null;
      reject(new Error(uiText("Turnstile failed to load")));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** The site key: /v1/auth/config first, then runtime config. Empty = disabled. */
export function useTurnstileSiteKey(): string {
  const { data } = useQuery(q.authConfig());
  return data?.turnstile_site_key || config.turnstileSiteKey || "";
}

export type TurnstileHandle = { reset: () => void };

export const Turnstile = forwardRef<TurnstileHandle, { onToken: (t: string | null) => void; action?: string }>(function Turnstile(
  { onToken, action },
  ref,
) {
  const { i18n } = useTranslation("interface");
  const language = i18n.resolvedLanguage ?? "en";
  const siteKey = useTurnstileSiteKey();
  const { dark } = useTheme();
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      cb.current(null);
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  }));

  useEffect(() => {
    if (!siteKey || !el.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !el.current) return;
        widget.current = t.render(el.current, {
          sitekey: siteKey,
          language,
          theme: dark ? "dark" : "light",
          size: "flexible",
          action,
          callback: (token: string) => cb.current(token),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, dark, action, language]);

  if (!siteKey) return null;
  return <div ref={el} className="min-h-[65px] w-full overflow-hidden rounded-md" />;
});
