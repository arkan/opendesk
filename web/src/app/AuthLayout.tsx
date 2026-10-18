import { appText } from "@/i18n/text";
import { AgentLanguageSelect } from "@/components/AgentLanguageSelect";
import { Link, Outlet } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lockup, Mark } from "@/components/brand";
import { PriorityIcon, SlaPill, StatusIcon } from "@/components/indicators";
import { Avatar } from "@/components/ui/avatar";
import { TagChip } from "@/components/ui/badge";
import type { Priority, TicketStatus } from "@/lib/api/types";
import { desktop } from "@/lib/desktop";

/**
 * Sign-in flows and onboarding: the same layered surfaces as the app, a white
 * card on the grey chrome. On wide screens the card opens up a quiet preview
 * of a shared inbox filling in live.
 */
export function AuthLayout() {
  useTranslation("app");
  if (desktop) return <DesktopAuthLayout />;
  return (
    <div className="relative flex min-h-dvh flex-col bg-frame">
      {/* In the desktop app this strip is the title bar: it drags the window and clears its controls. */}
      <header className="window-drag relative flex h-14 items-center px-6 desktop-glass:h-12 desktop-mac:pl-(--window-inset-left) desktop-win:pr-[max(1.5rem,var(--window-inset-right))]">
        <Link to="/" aria-label={appText("opendesk home")} className="text-fg">
          <Lockup className="h-[18px]" />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-12 pt-[5vh] md:items-center md:pt-0">
        <div className="grid w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-surface shadow-float animate-rise-in lg:max-w-[960px] lg:grid-cols-[minmax(0,1fr)_480px]">
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <div className="mx-auto w-full max-w-[360px]">
              <Outlet />
            </div>
          </div>
          <InboxPreview />
        </div>
      </main>
      <footer className="relative flex min-h-12 flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2 text-xs text-fg-4">
        <a href="https://opendesk.sh" className="hover:text-fg-2">opendesk.sh</a>
        <a href="https://docs.opendesk.sh" className="hover:text-fg-2">{appText("Docs")}</a>
        <a href="https://opendesk.sh/privacy" className="hover:text-fg-2">{appText("Privacy")}</a>
        <AgentLanguageSelect />
      </footer>
    </div>
  );
}

/**
 * The desktop app: an app window, not a web page. One quiet column on a plain surface,
 * the mark above it, nothing in the title bar but the window controls, and which server
 * this window is signed in to (with a way to change it) at the foot.
 */
function DesktopAuthLayout() {
  const { t } = useTranslation("shell");
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface">
      <header aria-hidden className="window-drag h-12 shrink-0" />
      <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-6">
        <div className="w-full max-w-[340px] animate-rise-in motion-reduce:animate-none">
          <div className="group mb-6 flex justify-center">
            <Mark turn className="size-9 text-fg" />
          </div>
          <Outlet />
        </div>
      </main>
      <footer className="flex h-12 shrink-0 items-center justify-center gap-1.5 text-[12px] text-fg-4">
        <AgentLanguageSelect />
        <span className="mono">{location.host}</span>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => desktop?.switchServer()} className="font-medium text-fg-3 transition-colors hover:text-fg">
          {t("desktop.changeServer")}
        </button>
      </footer>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-7 desktop:mb-6 desktop:text-center">
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-fg desktop:text-[20px]">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13px] leading-5 text-fg-3">{subtitle}</p>}
    </div>
  );
}

type Row = { id: number; who: string; subject: string; status: TicketStatus; priority: Priority; tag: string; sla?: number };

const ROWS: Row[] = [
  { id: 1, who: "Mia Chen", subject: "Export stuck at 0%", status: "open", priority: "urgent", tag: "bug", sla: 18 },
  { id: 2, who: "Lukas Weber", subject: "Frage zur Rechnung", status: "pending", priority: "normal", tag: "billing" },
  { id: 3, who: "Priya Shah", subject: "Invoice shows the wrong company", status: "open", priority: "high", tag: "billing", sla: 140 },
  { id: 4, who: "Sam Okafor", subject: "Dark mode for the dashboard", status: "on_hold", priority: "low", tag: "feature" },
  { id: 5, who: "Ana Souza", subject: "How do I add a teammate?", status: "solved", priority: "normal", tag: "question" },
  { id: 6, who: "Jordan Lee", subject: "Can't sign in after reset", status: "open", priority: "high", tag: "account", sla: 45 },
  { id: 7, who: "Noah Fischer", subject: "Webhook retries look stuck", status: "pending", priority: "normal", tag: "api" },
  { id: 8, who: "Elena Rossi", subject: "Grazie per l'aiuto", status: "solved", priority: "low", tag: "thanks" },
];

/** Decorative: a few tickets arriving and getting solved. Hidden from assistive tech. */
function InboxPreview() {
  useTranslation("app");
  const reduce = useReducedMotion();
  const [n, setN] = useState(4);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setN((x) => (x + 1) % (ROWS.length * 2)), 2600);
    return () => clearInterval(t);
  }, [reduce]);
  // Rotate through the rows so one arrives at the top every few seconds.
  const shown = Array.from({ length: 7 }, (_, i) => ROWS[(n + ROWS.length - i) % ROWS.length]);
  const now = Date.now();

  return (
    <div aria-hidden className="relative hidden flex-col border-l border-line bg-sunken lg:flex">
      <div className="flex items-center justify-between px-7 pb-4 pt-9">
        <div>
          <p className="label-caps">{appText("Shared inbox")}</p>
          <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-fg">{appText("Every conversation, one calm queue")}</p>
        </div>
      </div>
      <div className="mx-7 overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((r, i) => (
            <motion.div
              key={`${r.id}-${Math.floor((n - i + ROWS.length * 4) / ROWS.length)}`}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              className="flex h-11 items-center gap-2.5 border-b border-line-soft px-3 last:border-b-0"
            >
              <StatusIcon status={r.status} />
              <PriorityIcon priority={r.priority} muted={r.priority === "low"} />
              <Avatar name={r.who} size="sm" />
              <span className="w-[86px] shrink-0 truncate text-[12px] font-medium text-fg">{r.who}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{r.subject}</span>
              {r.sla ? (
                <SlaPill
                  ticket={{
                    status: r.status,
                    first_responded_at: null,
                    sla: { first_response_due_at: new Date(now + r.sla * 60000).toISOString(), resolution_due_at: null, breached: false },
                  }}
                />
              ) : (
                <TagChip name={r.tag} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-auto grid grid-cols-3 gap-px border-t border-line bg-line">
        {[
          [appText("Live"), appText("Updates land for everyone at once")],
          [appText("Email and chat"), appText("One queue for every channel")],
          [appText("Open source"), appText("Hosted or on your own servers")],
        ].map(([k, v]) => (
          <div key={k} className="bg-sunken px-5 py-4">
            <p className="text-[12px] font-medium text-fg">{k}</p>
            <p className="mt-0.5 text-[11.5px] leading-4 text-fg-3">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
