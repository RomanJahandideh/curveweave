/** Bounded undo/redo stack of immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(
    private present: T,
    private limit = 100,
  ) {}
  get current(): T {
    return this.present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }
  undo(): T {
    if (this.past.length) {
      this.future.push(this.present);
      this.present = this.past.pop()!;
    }
    return this.present;
  }
  redo(): T {
    if (this.future.length) {
      this.past.push(this.present);
      this.present = this.future.pop()!;
    }
    return this.present;
  }
}
