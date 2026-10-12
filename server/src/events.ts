export interface CheckEvent {
  type: 'check';
  monitorId: number;
  ok: boolean;
  status: 'up' | 'down';
  latencyMs: number | null;
  checkedAt: number;
}

type Listener = (event: CheckEvent) => void;

/** In-process pub/sub so the scheduler can push check results to open dashboards (via SSE). */
export class EventHub {
  private listeners = new Map<number, Set<Listener>>();

  subscribe(userId: number, listener: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  emit(userId: number, event: CheckEvent): void {
    for (const listener of this.listeners.get(userId) ?? []) listener(event);
  }

  get subscriberCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
