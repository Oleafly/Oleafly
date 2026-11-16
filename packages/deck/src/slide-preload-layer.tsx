import { useEffect, useRef, useState } from 'react';
import { type DesignSystem, designToCssVars } from './design';
import { SlidePageProvider } from './page-context';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type Page } from './sdk';
import { type StepController, StepHost } from './step-context';
const PAGES_PER_FRAME = 2;
const SETTLE_TIMEOUT_MS = 15000;
type Props = {
    pages: Page[];
    index: number;
    design?: DesignSystem;
    includeCurrent?: boolean;
    onDone?: () => void;
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
function computeWarmupOrder(pages: Page[], index: number, includeCurrent: boolean): number[] {
    if (saveDataEnabled())
        return [];
    const start = Math.max(0, Math.min(pages.length - 1, index));
    const result: number[] = [];
    for (let step = includeCurrent ? 0 : 1; step < pages.length; step++) {
        result.push((start + step) % pages.length);
    }
    return result;
}
export function SlidePreloadLayer({ pages, index, design, includeCurrent = false, onDone }: Props) {
    const [deck, setDeck] = useState(pages);
    const [order, setOrder] = useState<number[]>(() => computeWarmupOrder(pages, index, includeCurrent));
    const [mountedCount, setMountedCount] = useState(0);
    const [done, setDone] = useState(order.length === 0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const controllerRef = useRef<StepController | null>(null);
    if (deck !== pages) {
        const nextOrder = computeWarmupOrder(pages, index, includeCurrent);
        setDeck(pages);
        setOrder(nextOrder);
        setMountedCount(0);
        setDone(nextOrder.length === 0);
    }
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;
    useEffect(() => {
        if (done)
            onDoneRef.current?.();
    }, [done]);
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
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS));
        const finish = () => {
            if (!cancelled)
                setDone(true);
        };
        Promise.race([settle(), timeout]).then(finish, finish);
        return () => {
            cancelled = true;
        };
    }, [done, mountedCount, order.length]);
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
