import { useMediaQuery } from './use-media-query';
const QUERY = '(prefers-reduced-motion: reduce)';
export function usePrefersReducedMotion(): boolean {
    return useMediaQuery(QUERY);
}
