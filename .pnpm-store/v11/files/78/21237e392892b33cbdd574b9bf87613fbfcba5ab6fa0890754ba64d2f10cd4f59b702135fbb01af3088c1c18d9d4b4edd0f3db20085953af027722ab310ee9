import type { inCountRange } from './useCount';
type ForcedCountConfig = Parameters<typeof inCountRange>[1];
interface UseCountExceedProps<Element extends HTMLInputElement | HTMLTextAreaElement> {
    countConfig: ForcedCountConfig;
    getTarget: () => Element | null;
}
export default function useCountExceed<Element extends HTMLInputElement | HTMLTextAreaElement>({ countConfig, getTarget }: UseCountExceedProps<Element>): (currentValue: string, isComposing: boolean) => string;
export {};
