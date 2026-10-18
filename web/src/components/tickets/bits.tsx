// Ticket indicators live in components/indicators so they read as one family.
// This module keeps the old import path working.

import { cn } from "@/lib/cn";

export {
  ChannelIcon,
  PriorityIcon,
  PriorityPill,
  SentimentIcon,
  SeverityChip,
  SeverityPill,
  SlaPill,
  SlaPill as SlaBadge,
  SpamIcon,
  StatusIcon,
  StatusPill,
  channelLabelKey,
  priorityLabelKey,
  priorityOrder,
  sentimentLabelKey,
  severityHintKey,
  severityLabelKey,
  severityOrder,
  slaState,
  statusLabelKey,
  statusOrder,
} from "@/components/indicators";

export function TicketNumber({ n, className }: { n: number; className?: string }) {
  return <span className={cn("mono text-[11.5px] text-fg-3 tabular-nums", className)}>#{n}</span>;
}
