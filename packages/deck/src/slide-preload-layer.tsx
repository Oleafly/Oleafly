import { useEffect, useRef, useState } from 'react';
import { type DesignSystem, designToCssVars } from './design';
import { SlidePageProvider } from './page-context';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type Page } from './sdk';
import { type StepController, StepHost } from './step-context';
const PAGES_PER_FRAME = 2;
const SETTLE_TIMEOUT_MS = 15000;
export type SlideWarmup = 'all' | 'neighbours';
type Props = {
    pages: Page[];
    index: number;
    design?: DesignSystem;
    warmup?: SlideWarmup;
};
function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function waitForImages(root: HTMLElement): Promise<unknown> {
    const pending = Array.from(root.querySelectorAll('img'))
        .filter((img) => !img.complete)
        .map((img) => new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
    }));
    return Promise.all(pending);
}
function saveDataEnabled(): boolean {
    if (typeof navigator === 'undefined')
        return false;
    const connection = (navigator as Navigator & {
        connection?: {
            saveData?: boolean;
        };
    }).connection;
    return connection?.saveData === true;
}
function computeWarmupOrder(total: number, index: number, warmup: SlideWarmup): number[] {
    if (saveDataEnabled() || total === 0)
        return [];
    const start = Math.max(0, Math.min(total - 1, index));
    if (warmup === 'neighbours')
        return [start + 1, start - 1].filter((page) => page >= 0 && page < total);
    const result: number[] = [];
    for (let step = 1; step < total; step++) {
        result.push((start + step) % total);
    }
    return result;
}
export function SlidePreloadLayer({ pages, index, design, warmup = 'all' }: Readonly<Props>) {
    const [deck, setDeck] = useState(pages);
    const [order, setOrder] = useState<number[]>(() => computeWarmupOrder(pages.length, index, warmup));
    const [mountedCount, setMountedCount] = useState(0);
    const [done, setDone] = useState(order.length === 0);
    const [warmed, setWarmed] = useState<ReadonlySet<number>>(() => new Set());
    const [warmedAround, setWarmedAround] = useState(index);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<StepController | null>(null);
    const start = (known: ReadonlySet<number>) => {
        const next = computeWarmupOrder(pages.length, index, warmup).filter((page) => !known.has(page));
        setWarmedAround(index);
        setOrder(next);
        setMountedCount(0);
        setDone(next.length === 0);
    };
    if (deck !== pages) {
        setDeck(pages);
        if (pages.length !== deck.length) {
            setWarmed(new Set());
            start(new Set());
        }
        else if (!done) {
            start(warmed);
        }
    }
    else if (done && warmup === 'neighbours' && warmedAround !== index) {
        const shown = new Set([...warmed, warmedAround]);
        setWarmed(shown);
        start(shown);
    }
    useEffect(() => {
        if (done || mountedCount >= order.length)
            return;
        const raf = requestAnimationFrame(() => {
            setMountedCount((n) => Math.min(order.length, n + PAGES_PER_FRAME));
        });
        return () => cancelAnimationFrame(raf);
    }, [done, mountedCount, order.length]);
    useEffect(() => {
        if (done || mountedCount < order.length)
            return;
        let cancelled = false;
        const settle = async () => {
            await nextFrame();
            await nextFrame();
            const root = rootRef.current;
            await Promise.all([
                'fonts' in document ? document.fonts.ready : Promise.resolve(),
                root ? waitForImages(root) : Promise.resolve(),
            ]);
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, SETTLE_TIMEOUT_MS);
        });
        const finish = () => {
            clearTimeout(timer);
            if (cancelled)
                return;
            setWarmed((known) => new Set([...known, ...order]));
            setDone(true);
        };
        Promise.race([settle(), timeout]).then(finish, finish);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [done, mountedCount, order]);
    if (done)
        return null;
    return (<div ref={rootRef} aria-hidden data-osd-freeze-motion="" style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            opacity: 0,
            pointerEvents: 'none',
            ...(design ? designToCssVars(design) : {}),
        }}>
      {order.slice(0, mountedCount).map((pageIndex) => {
            const PageComponent = pages[pageIndex];
            if (!PageComponent)
                return null;
            return (<div key={pageIndex} style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: CANVAS_WIDTH,
                    height: CANVAS_HEIGHT,
                }}>
            <SlidePageProvider index={pageIndex} total={pages.length}>
              <StepHost isActivePage={false} entryDirection="backward" controllerRef={controllerRef}>
                <PageComponent />
              </StepHost>
            </SlidePageProvider>
          </div>);
        })}
    </div>);
}
