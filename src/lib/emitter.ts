export type Listener<Args extends readonly unknown[]> = (...args: Args) => void;

export interface Emitter<Args extends readonly unknown[] = []> {
  readonly subscribe: (listener: Listener<Args>) => () => void;
  readonly emit: (...args: Args) => void;
}

export function createEmitter<Args extends readonly unknown[] = []>(): Emitter<Args> {
  const listeners = new Set<Listener<Args>>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}
