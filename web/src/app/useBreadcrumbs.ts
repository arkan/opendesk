import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { folderById } from "@/lib/folders";
import { q } from "@/lib/queries";
import { useCrumbStore } from "./shellStore";

export type Crumb = { label: string; to?: string; params?: Record<string, string | undefined> };

/** A page names the last header crumb (a ticket subject, an article) while it is mounted. */
export function usePageCrumb(label: string | null | undefined) {
  useEffect(() => {
    if (!label) return;
    useCrumbStore.setState({ label });
    return () => useCrumbStore.setState({ label: null });
  }, [label]);
}

/** Header breadcrumbs for the current route: section, then page, then the page's own crumb. */
export function useBreadcrumbs(): Crumb[] {
  const { t: appText } = useTranslation("app");
  const matches = useMatches();
  const extra = useCrumbStore((s) => s.label);
  const { data: views } = useQuery(q.views());
  const { data: teams } = useQuery(q.teams());
  const leaf = matches[matches.length - 1];
  const path = leaf?.pathname ?? "";
  const params = (leaf?.params ?? {}) as Record<string, string | undefined>;
  const title = [...matches].reverse().find((m) => m.staticData?.title)?.staticData.title;
  const crumbs: Crumb[] = [];

  if (path.startsWith("/inbox/")) {
    crumbs.push({ label: appText("Inbox"), to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
    const f = folderById(params.folder ?? "");
    if (f) crumbs.push({ label: f.label, to: "/inbox/$folder/{-$ticketId}", params: { folder: f.id, ticketId: undefined } });
  } else if (path.startsWith("/views/")) {
    crumbs.push({ label: appText("Views") });
    const v = views?.find((x) => x.id === params.viewId);
    crumbs.push({ label: v?.name ?? appText("View"), to: "/views/$viewId/{-$ticketId}", params: { viewId: params.viewId, ticketId: undefined } });
  } else if (path.startsWith("/teams/")) {
    crumbs.push({ label: appText("Teams") });
    const name = params.teamId === "mine" ? appText("My teams") : (teams?.find((x) => x.id === params.teamId)?.name ?? appText("Team"));
    crumbs.push({ label: name, to: "/teams/$teamId/{-$ticketId}", params: { teamId: params.teamId, ticketId: undefined } });
  } else if (path.startsWith("/contacts")) {
    crumbs.push({ label: appText("Contacts"), to: "/contacts/{-$contactId}", params: { contactId: undefined } });
  } else if (path.startsWith("/companies")) {
    crumbs.push({ label: appText("Companies"), to: "/companies/{-$companyId}", params: { companyId: undefined } });
  } else if (path.startsWith("/kb")) {
    crumbs.push({ label: appText("Knowledge base"), to: "/kb" });
    if (path.startsWith("/kb/articles/")) crumbs.push({ label: params.articleId === "new" ? appText("New article") : appText("Article") });
  } else if (path.startsWith("/reports")) {
    crumbs.push({ label: appText("Reports"), to: "/reports" });
  } else if (path.startsWith("/settings")) {
    crumbs.push({ label: appText("Settings"), to: "/settings" });
    if (title && title !== "Settings") crumbs.push({ label: appText(title) });
  } else if (title) {
    crumbs.push({ label: appText(title) });
  }

  if (extra) {
    // The page's own crumb replaces a generic leaf ("Article", "Mailbox").
    const last = crumbs[crumbs.length - 1];
    if (last && !last.to) crumbs.pop();
    crumbs.push({ label: extra });
  }
  return crumbs;
}
