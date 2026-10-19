import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { draftApi, draftIdentity, draftKey } from "@/lib/api/drafts";
import { SharedDraftStateMachine } from "./sharedDraftState";

export function useSharedDraft(ticketId: string, enabled: boolean) {
  const qc = useQueryClient();
  const machine = useMemo(() => new SharedDraftStateMachine(async (server, content, request_id) => {
    await qc.cancelQueries({ queryKey: draftKey(ticketId), exact: true });
    const result = server
      ? await draftApi.update(ticketId, { ...content, ...draftIdentity(server) })
      : await draftApi.create(ticketId, { ...content, request_id });
    await qc.cancelQueries({ queryKey: draftKey(ticketId), exact: true });
    qc.setQueryData(draftKey(ticketId), result);
    return result.draft;
  }), [ticketId, qc]);
  const state = useSyncExternalStore(machine.subscribe, machine.snapshot);
  const query = useQuery({ queryKey: draftKey(ticketId), queryFn: () => draftApi.get(ticketId), enabled });
  useEffect(() => { if (query.data) machine.receive(query.data.draft); }, [machine, query.data]);
  useEffect(() => () => { if (enabled) void machine.flush().catch(() => {}); }, [machine, enabled]);
  useBlocker({
    shouldBlockFn: async () => {
      if (!enabled || !machine.state.dirty) return false;
      try { await machine.flush(); return false; } catch { return true; }
    },
    enableBeforeUnload: () => enabled && machine.state.dirty,
  });
  return { ...state, query, machine };
}
