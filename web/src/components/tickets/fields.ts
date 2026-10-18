import { appText } from "@/i18n/text";
// Labels (with groups) and custom fields (contracts/api.md "Labels and custom
// fields"): small hooks over the shared queries, the workspace display
// overrides, and helpers for values and the 422 errors these writes answer.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { isApiError } from "@/lib/api/client";
import type { CustomField, FieldValue, Priority, Tag, TagGroup, Ticket, TicketPatch, TicketStatus } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { isTone, type Tone } from "@/lib/tones";
import { priorityLabelKey, statusLabelKey } from "./bits";

export type { CustomField, FieldOption, FieldType, FieldValue, FieldValues } from "@/lib/api/types";
export type LabelRef = Tag;
export type LabelGroup = TagGroup;
export type TicketWithFields = Ticket;
export type FieldPatch = TicketPatch;

export function useLabelGroups() {
  return useQuery(q.tagGroups());
}

export function useTicketFields() {
  return useQuery({
    ...q.customFields(),
    select: (d: CustomField[]) => d.filter((f) => !f.archived && f.entity === "ticket").sort((a, b) => a.position - b.position),
  });
}

/** An agent named a label that doesn't exist while only admins may create labels. */
export const isUnknownLabel = (e: unknown) => isApiError(e, "unknown_label");

type Override = { label?: string; color?: string };
type DisplaySettings = { label_creation?: "anyone" | "admins"; status_labels?: Record<string, Override>; priority_labels?: Record<string, Override> };

/** The workspace's display overrides for status and priority names and colours, and who may create labels. */
export function useDisplay() {
  const { t: appText } = useTranslation("app");
  const { data } = useQuery(q.workspace());
  const s = (data?.settings ?? {}) as DisplaySettings;
  return {
    labelCreation: s.label_creation ?? "anyone",
    priorityTone: (v: Priority): Tone | undefined => (isTone(s.priority_labels?.[v]?.color) ? (s.priority_labels![v]!.color as Tone) : undefined),
    status: (v: TicketStatus) => s.status_labels?.[v]?.label || appText(statusLabelKey[v]),
    priority: (v: Priority) => s.priority_labels?.[v]?.label || appText(priorityLabelKey[v]),
    statusTone: (v: TicketStatus): Tone | undefined => (isTone(s.status_labels?.[v]?.color) ? (s.status_labels![v]!.color as Tone) : undefined),
  };
}

export function hasValue(f: CustomField, v: FieldValue | undefined | null): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (f.type === "checkbox") return v === true;
  return true;
}

/** A value as text, for the timeline and filter chips. */
export function fieldText(f: CustomField | undefined, v: unknown, memberName?: (id: string) => string | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (!f) return Array.isArray(v) ? v.join(", ") : String(v);
  const opt = (id: string) => f.options.find((o) => o.id === id)?.label ?? id;
  if (f.type === "select") return opt(String(v));
  if (f.type === "multi_select") return (Array.isArray(v) ? v : String(v).split(",")).map((x) => opt(String(x))).join(", ");
  if (f.type === "checkbox") return v === true || v === "true" ? appText("Yes") : appText("No");
  if (f.type === "user") return memberName?.(String(v)) ?? String(v);
  return String(v);
}

/** The keys a 422 field_required names (errors[].location = body.fields.<key>). */
export function requiredFieldKeys(e: unknown): string[] {
  if (!isApiError(e, "field_required")) return [];
  return (e.errors ?? []).map((x) => x.location?.match(/^body\.fields\.(.+)$/)?.[1]).filter((k): k is string => !!k);
}

/** Asks the ticket sidebar to open a field's editor (after a refused solve). */
export const useFieldFocus = create<{ key: string | null; at: number }>(() => ({ key: null, at: 0 }));
export const focusField = (key: string) => useFieldFocus.setState({ key, at: Date.now() });

/** Required-to-solve fields this ticket leaves empty, checked before a solve. */
export function missingForSolve(fields: CustomField[] | undefined, t: Ticket): CustomField[] {
  return (fields ?? []).filter((f) => f.required_on_solve && !hasValue(f, t.fields?.[f.key]));
}
