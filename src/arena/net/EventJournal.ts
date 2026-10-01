import type { GameEvent } from '../Simulation';

/** One presentation event tied to the simulation tick that produced it. */
export interface JournalEntry {
  id: string;
  tick: number;
  index: number;
  event: GameEvent;
}

/**
 * Frame-stamped presentation events.
 * Replay replaces the unconfirmed suffix. Confirmed entries are drained once and then left alone.
 */
export class EventJournal {
  private entries: JournalEntry[] = [];
  private drained = 0;

  add(tick: number, events: readonly GameEvent[], matchId: string, epoch: number) {
    events.forEach((event, index) => {
      this.entries.push({ id: `${matchId}:${epoch}:${tick}:${index}`, tick, index, event: { ...event } });
    });
  }

  /** Drop outcomes produced after `tick`. `tick` itself stays: it was reached by the previous, still-valid input. */
  truncate(tick: number) {
    let end = this.entries.length;
    while (end > 0 && this.entries[end - 1].tick > tick) end--;
    this.entries.length = end;
    if (this.drained > this.entries.length) this.drained = this.entries.length;
  }

  /** Events whose tick is now fully confirmed and that have not been returned before. */
  drain(confirmedTick: number): JournalEntry[] {
    const out: JournalEntry[] = [];
    while (this.drained < this.entries.length && this.entries[this.drained].tick <= confirmedTick) {
      out.push(this.entries[this.drained]);
      this.drained++;
    }
    return out;
  }

  get length() { return this.entries.length; }
  get pending() { return this.entries.length - this.drained; }
}
