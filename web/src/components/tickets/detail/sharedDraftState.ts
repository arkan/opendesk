import { draftContent, emptyDraftContent, type DraftContent, type TicketDraft } from "@/lib/api/drafts";

export type SharedDraftState = {
  server: TicketDraft | null; content: DraftContent; dirty: boolean; saving: boolean;
  loaded: boolean; conflict: boolean; error: unknown;
};
type DraftWriter = (server: TicketDraft | null, content: DraftContent, requestId: string) => Promise<TicketDraft>;
const same = (a: DraftContent, b: DraftContent) => JSON.stringify(a) === JSON.stringify(b);

/** One serialized writer; an acknowledged save never replaces edits made while it was in flight. */
export class SharedDraftStateMachine {
  state: SharedDraftState = { server: null, content: emptyDraftContent(), dirty: false, saving: false, loaded: false, conflict: false, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<TicketDraft | null> | null = null;
  private requestId = crypto.randomUUID();
  private creation: DraftContent | null = null;
  private deferred: TicketDraft | null | undefined;
  constructor(private write: DraftWriter) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(patch: Partial<SharedDraftState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }
  receive(server: TicketDraft | null) {
    if (server && this.state.server?.id === server.id && server.revision < this.state.server.revision) return;
    if (this.state.saving) { this.deferred = server; return; }
    if (this.state.dirty) {
      if (server?.id !== this.state.server?.id || server?.revision !== this.state.server?.revision) this.set({ conflict: true });
      return;
    }
    this.set({ server, content: server ? draftContent(server) : emptyDraftContent(), loaded: true, error: null, conflict: false });
  }
  edit(patch: Partial<DraftContent>) {
    const content = { ...this.state.content, ...patch };
    if (same(content, this.state.content)) return;
    this.set({ content, dirty: true, error: null });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 400);
  }
  async flush(): Promise<TicketDraft | null> {
    clearTimeout(this.timer);
    if (this.running) { await this.running; return this.flush(); }
    if (this.state.conflict) throw new Error("The shared draft changed. Review the latest version before saving.");
    if (!this.state.dirty) return this.state.server;
    if (!this.state.loaded) throw new Error("The shared draft has not loaded yet.");
    this.running = this.save();
    try { return await this.running; } finally { this.running = null; }
  }
  private async save(): Promise<TicketDraft | null> {
    const content = this.state.content;
    const server = this.state.server;
    // A lost creation response must retry the original payload with the original durable key.
    if (!server) this.creation ??= content;
    const submitted = server ? content : this.creation!;
    this.set({ saving: true, error: null });
    try {
      const saved = await this.write(server, submitted, this.requestId);
      if (saved.state !== "draft") throw Object.assign(new Error("This draft has already ended. Reload the shared draft."), { status: 409 });
      const dirty = !same(this.state.content, submitted);
      this.creation = null;
      this.set({ server: saved, content: dirty ? this.state.content : draftContent(saved), dirty, saving: false });
      const deferred = this.deferred;
      this.deferred = undefined;
      if (deferred !== undefined && (deferred === null || deferred.id !== saved.id || deferred.revision > saved.revision)) this.receive(deferred);
      if (dirty && !this.state.conflict) return this.save();
      return saved;
    } catch (error) {
      this.set({ saving: false, error, conflict: typeof error === "object" && error !== null && "status" in error && error.status === 409 });
      throw error;
    }
  }
  reload(server: TicketDraft | null) {
    clearTimeout(this.timer);
    this.requestId = crypto.randomUUID(); this.creation = null; this.deferred = undefined;
    this.set({ dirty: false, conflict: false }); this.receive(server);
  }
  /** Explicit replacement uses the revision the agent just reviewed, never an unchecked overwrite. */
  replace(server: TicketDraft | null) {
    this.requestId = crypto.randomUUID(); this.creation = null; this.deferred = undefined;
    this.set({ server, conflict: false, error: null, dirty: true });
    return this.flush();
  }
}
