type Visibility = (target: Element) => boolean;

export interface IntersectionObserverStub {
  setVisible(predicate: Visibility): void;
  observed(): Element[];
  restore(): void;
}

export function installIntersectionObserverStub(
  initial: Visibility = () => true,
): IntersectionObserverStub {
  let predicate = initial;
  const observers = new Set<FakeIntersectionObserver>();

  class FakeIntersectionObserver {
    readonly targets = new Set<Element>();

    constructor(
      private readonly callback: (entries: IntersectionObserverEntry[]) => void,
    ) {
      observers.add(this);
    }

    observe(target: Element) {
      this.targets.add(target);
      this.notify([target]);
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    notify(targets: Iterable<Element>) {
      const entries = [...targets].map(
        (target) =>
          ({ target, isIntersecting: predicate(target) }) as IntersectionObserverEntry,
      );
      if (entries.length > 0) this.callback(entries);
    }
  }

  const previous = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: FakeIntersectionObserver,
  });

  return {
    setVisible(next) {
      predicate = next;
      for (const observer of [...observers]) observer.notify(observer.targets);
    },
    observed() {
      return [...observers].flatMap((observer) => [...observer.targets]);
    },
    restore() {
      if (previous) Object.defineProperty(globalThis, "IntersectionObserver", previous);
      else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    },
  };
}
