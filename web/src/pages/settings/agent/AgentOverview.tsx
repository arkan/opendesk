import { intlLocale } from "@/i18n";
// Settings > AI agent > Overview: how the widget agent did over a range
// (GET /v1/ai/agent/report): conversations, resolutions, handoffs, ratings
// and what it spent, a by-day chart, the tools it called, and the questions it
// couldn't answer, each one a click away from a help article. The setup
// checklist (GET /v1/ai/agent/setup) leads the page until it is complete.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FilePlus2, FlaskConical, SlidersHorizontal, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, Section, SettingsPage } from "@/components/layout";
import { RangePicker } from "@/components/reports/RangePicker";
import { VolumeChart, VolumeLegend, type LineSeries } from "@/components/reports/VolumeChart";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { SummaryStrip } from "@/components/settings2/bits";
import { AgentOffNotice } from "@/components/agent/bits";
import { AgentSetupPanel } from "@/components/agent/SetupChecklist";
import { agentSettings } from "@/components/agent/settings";
import { ReviewQueue } from "@/components/agent/ReviewQueue";
import { useAI } from "@/lib/ai";
import type { AgentReport, ReportsRange } from "@/lib/api/types";
import { formatUsd, number, percent } from "@/lib/format";
import { q } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import { AI_TONE, tone, toneVar } from "@/lib/tones";
import { defaultRange } from "@/router";

type Day = AgentReport["by_day"][number];

export default function AgentOverview() {
  const { t } = useTranslation("agent");
  const admin = atLeast(useRole(), "admin");
  const ai = useAI();
  const [range, setRange] = useState<ReportsRange>(defaultRange);
  const report = useQuery({ ...q.agentReport(range), enabled: admin, placeholderData: keepPreviousData });
  const d = report.data;
  const on = agentSettings(ai.features).widget_answers;

  if (!admin)
    return (
      <SettingsPage title={t("overview.title")}>
        <NoAccess what={t("overview.what")} />
      </SettingsPage>
    );

  return (
    <SettingsPage wide title={t("overview.title")} description={t("overview.description")} actions={<RangePicker value={range} onChange={setRange} />}>
      <AgentSetupPanel />
      {ai.config && !on && <AgentOffNotice className="-mb-3" />}
      {report.isLoading ? (
        <OverviewSkeleton />
      ) : report.isError || !d ? (
        <Section>
          <EmptyState
            compact
            lit={3}
            title={t("overview.error")}
            description={t("overview.errorBody")}
            action={<Button onClick={() => void report.refetch()}>{t("retry")}</Button>}
          />
        </Section>
      ) : d.conversations === 0 && d.replies === 0 ? (
        <Section>
          <EmptyState
            art="ai"
            className="min-h-[340px]"
            title={t("overview.empty")}
            description={t("overview.emptyBody")}
            action={
              <Button asChild variant="primary">
                <Link to="/settings/ai/playground">
                  <FlaskConical className="size-3.5" />
                  {t("overview.tryPlayground")}
                </Link>
              </Button>
            }
            secondary={
              <Button asChild>
                <Link to="/settings/ai/behaviour">
                  <SlidersHorizontal className="size-3.5" />
                  {t("overview.setUp")}
                </Link>
              </Button>
            }
          />
        </Section>
      ) : (
        <div className={cn("flex flex-col gap-9 transition-opacity duration-150", report.isPlaceholderData && "opacity-60")}>
          <Tiles d={d} />
          <ReviewQueue />
          <Trend d={d} />
          <div className="grid grid-cols-1 gap-9 lg:grid-cols-2 lg:gap-6">
            <Tools d={d} />
            <Gaps d={d} />
          </div>
        </div>
      )}
    </SettingsPage>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-[78px] rounded-lg" />
      <Skeleton className="h-[300px] rounded-lg" />
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}

function Tiles({ d }: { d: AgentReport }) {
  const { t } = useTranslation("agent");
  const rated = d.ratings.up + d.ratings.down;
  const rate = (n: number) => (d.conversations ? percent(n / d.conversations) : "–");
  return (
    <SummaryStrip
      items={[
        { label: t("overview.conversations"), value: number(d.conversations), hint: t("overview.replies", { count: d.replies, n: number(d.replies) }), tone: AI_TONE },
        { label: t("overview.resolved"), value: rate(d.resolved), hint: t("overview.resolvedHint", { n: number(d.resolved) }), tone: "green" },
        { label: t("overview.handoffs"), value: number(d.handoffs), hint: t("overview.handoffsHint", { pct: rate(d.handoffs) }), tone: "amber" },
        {
          label: t("overview.ratings"),
          value: rated ? percent(d.ratings.up / rated) : "–",
          hint: (
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="size-3" aria-label={t("overview.up")} />
                {number(d.ratings.up)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ThumbsDown className="size-3" aria-label={t("overview.down")} />
                {number(d.ratings.down)}
              </span>
            </span>
          ),
        },
        { label: t("overview.spent"), value: formatUsd(d.usd, { tiny: true }), hint: t("overview.spentHint") },
      ]}
    />
  );
}

function Trend({ d }: { d: AgentReport }) {
  const { t } = useTranslation("agent");
  const [asTable, setAsTable] = useState(false);
  const lines: LineSeries<Day>[] = [
    { key: "conversations", label: t("overview.conversations"), color: toneVar(AI_TONE) },
    { key: "resolved", label: t("overview.resolvedLine"), color: toneVar("teal") },
    { key: "handoffs", label: t("overview.handoffs"), color: toneVar("amber") },
  ];
  return (
    <Section
      title={t("overview.byDay")}
      description={t("overview.byDayHint")}
      actions={
        <div className="flex items-center gap-3">
          <VolumeLegend series={lines} />
          <Button size="xs" variant="ghost" onClick={() => setAsTable((v) => !v)}>
            {asTable ? t("overview.chart") : t("overview.table")}
          </Button>
        </div>
      }
    >
      <div className="py-4">
        {asTable ? (
          <div className="max-h-[268px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">{t("overview.byDay")}</caption>
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left">
                  <th className="label-caps py-2 font-normal">{t("overview.day")}</th>
                  {lines.map((l) => (
                    <th key={l.key} className="label-caps py-2 text-right font-normal">
                      {l.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...d.by_day].reverse().map((r) => (
                  <tr key={r.date} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 text-fg-2">{dayText(r.date)}</td>
                    {lines.map((l) => (
                      <td key={l.key} className="mono py-1.5 text-right tabular-nums">
                        {number(r[l.key] as number)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <VolumeChart days={d.by_day} series={lines} label={t("overview.chartLabel", { days: d.by_day.length })} />
        )}
      </div>
    </Section>
  );
}

function dayText(ymd: string) {
  return new Intl.DateTimeFormat(intlLocale(), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

/** `shop__lookup_order` reads as "shop · lookup_order". */
function ToolName({ name }: { name: string }) {
  const i = name.indexOf("__");
  if (i < 0) return <span className="mono truncate text-[12px] text-fg">{name}</span>;
  return (
    <span className="mono flex min-w-0 items-center gap-1 text-[12px]">
      <span className="shrink-0 text-fg-3">{name.slice(0, i)}</span>
      <span className="text-fg-4">·</span>
      <span className="truncate text-fg">{name.slice(i + 2)}</span>
    </span>
  );
}

function Tools({ d }: { d: AgentReport }) {
  const { t } = useTranslation("agent");
  const rows = [...d.tools].sort((a, b) => b.calls - a.calls);
  const max = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <Section
      title={t("overview.tools")}
      description={t("overview.toolsHint")}
      flush
      actions={
        <Link to="/settings/ai/tools" className="text-[12.5px] text-fg-3 hover:text-fg">
          {t("overview.manageTools")}
        </Link>
      }
    >
      {!rows.length ? (
        <EmptyState compact icon={<Wrench className="size-5 text-fg-4" />} title={t("overview.noTools")} description={t("overview.noToolsBody")} />
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line-soft text-left">
              <th className="label-caps px-4 py-2 font-normal">{t("overview.tool")}</th>
              <th className="label-caps w-20 px-2 py-2 text-right font-normal">{t("overview.calls")}</th>
              <th className="label-caps w-24 px-4 py-2 text-right font-normal">{t("overview.errors")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const errRate = r.calls ? r.errors / r.calls : 0;
              return (
                <tr key={r.tool} className="border-b border-line-soft last:border-0">
                  <td className="max-w-0 px-4 py-2">
                    <ToolName name={r.tool} />
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-hover">
                      <div
                        className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                        style={{ width: `${(r.calls / max) * 100}%`, background: toneVar(AI_TONE) }}
                      />
                    </div>
                  </td>
                  <td className="mono px-2 py-2 text-right align-top tabular-nums">{number(r.calls)}</td>
                  <td className="px-4 py-2 text-right align-top">
                    {r.errors ? (
                      <Tooltip content={t("overview.errorRate", { pct: percent(errRate, 1) })}>
                        <span className={cn("mono inline-flex h-[18px] items-center rounded-sm px-1.5 text-[10.5px] tabular-nums", errRate >= 0.1 ? tone.red.chip : tone.amber.chip)}>
                          {number(r.errors)}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="mono text-fg-4">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Gaps({ d }: { d: AgentReport }) {
  const { t } = useTranslation("agent");
  return (
    <Section title={t("overview.gaps")} description={t("overview.gapsHint")} flush>
      {!d.gaps.length ? (
        <EmptyState compact art="kb" title={t("overview.noGaps")} description={t("overview.noGapsBody")} />
      ) : (
        <ul>
          {d.gaps.map((g, i) => (
            <li key={`${i}-${g.question}`} className="group flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0">
              <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg" data-ph-mask>
                {g.question}
              </span>
              {g.count > 1 && (
                <Tooltip content={t("overview.askedTimes", { count: g.count })}>
                  <span className="mono shrink-0 rounded-sm bg-hover px-1.5 text-[10.5px] tabular-nums text-fg-3">×{number(g.count)}</span>
                </Tooltip>
              )}
              <Button asChild size="xs" variant="ghost" className="shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100">
                <Link to="/kb/articles/$articleId" params={{ articleId: "new" }} search={{ collection: undefined, title: g.question.slice(0, 200) }}>
                  <FilePlus2 className="size-3" />
                  {t("overview.writeArticle")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
