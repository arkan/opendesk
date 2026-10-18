import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, useMatches, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { pageview } from "@/lib/analytics";
import { queryClient } from "@/lib/queryClient";
import { onAccountFallback } from "@/lib/session";
import { useDesktopNavigation } from "./useDesktopBridge";

function useRouteTitle() {
  const { i18n } = useTranslation("app");
  const matches = useMatches();
  const title = [...matches].reverse().find((m) => m.staticData?.title)?.staticData.title;
  useEffect(() => {
    document.title = title ? `${appText(title)} · opendesk` : "opendesk";
  }, [title, i18n.language]);
}

function usePageviews() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => pageview(path), [path]);
}

/**
 * When the active account's session ends on its own (revoked elsewhere, expired),
 * another signed-in account takes over: start it fresh from its inbox, or go to
 * sign-in when none is left.
 */
function useAccountFallback() {
  const navigate = useNavigate();
  useEffect(
    () =>
      onAccountFallback((s) => {
        if (s.status === "authed") void navigate({ to: s.workspaceId ? "/" : "/onboarding" });
        else void navigate({ to: "/login", search: { next: location.pathname + location.search } });
      }),
    [navigate],
  );
}

export function RootLayout() {
  useRouteTitle();
  usePageviews();
  useAccountFallback();
  useDesktopNavigation();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        <ConfirmProvider>
          <Outlet />
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** Set a page-specific tab title (a ticket subject, an article). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · opendesk`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
