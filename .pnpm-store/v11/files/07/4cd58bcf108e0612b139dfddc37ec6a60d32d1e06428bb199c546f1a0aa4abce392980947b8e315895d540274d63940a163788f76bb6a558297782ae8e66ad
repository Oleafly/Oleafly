import type { Selector } from 'reselect';
type Fn = (...args: any[]) => any;
/**
 * The NoOptionalParams type is a utility type that checks if a function has optional or default parameters.
 * If the function has optional or default parameters, it returns a string literal type with an error message.
 * Otherwise, it returns the original function type.
 *
 * This is used to enforce that the combiner function passed to createSelector does not have optional or default parameters,
 * as memoization relies on the Function.length property, which does not account for optional or default parameters.
 */
type NoOptionalParams<F extends Fn> = Parameters<F> extends Required<Parameters<F>> ? F : 'Combiner cannot have optional or default parameters because memoization relies on Function.length';
export type CreateSelectorFunction = <const Args extends any[], const Selectors extends ReadonlyArray<Selector<any>>, const Combiner extends (...args: readonly [...ReturnTypes<Selectors>, ...Args]) => any>(...items: [...Selectors, NoOptionalParams<Combiner>]) => (...args: Selectors['length'] extends 0 ? MergeParams<ReturnTypes<Selectors>, Parameters<Combiner>> : [StateFromSelectorList<Selectors>, ...MergeParams<ReturnTypes<Selectors>, Parameters<Combiner>>]) => ReturnType<Combiner>;
type StateFromSelectorList<Selectors extends readonly any[]> = Selectors extends [f: infer F, ...other: infer R] ? StateFromSelector<F> extends StateFromSelectorList<R> ? StateFromSelector<F> : StateFromSelectorList<R> : {};
type StateFromSelector<T> = T extends ((first: infer F, ...args: any[]) => any) ? F : never;
type DropFirst<T> = T extends [any, ...infer Xs] ? Xs : [];
type ReturnTypes<FunctionsArray extends readonly Fn[]> = { [Index in keyof FunctionsArray]: FunctionsArray[Index] extends FunctionsArray[number] ? ReturnType<FunctionsArray[Index]> : never };
type MergeParams<STypes extends readonly unknown[], CTypes extends readonly unknown[]> = STypes['length'] extends 0 ? CTypes : MergeParams<DropFirst<STypes>, DropFirst<CTypes>>;
/**
 * Creates a selector function that can be used to derive values from the store's state.
 *
 * The combiner function can have up to three additional parameters, but it **cannot have optional or default parameters**.
 *
 * This function accepts up to six functions and combines them into a single selector function.
 * The resulting selector will take the state from the combined selectors and any additional parameters required by the combiner.
 *
 * The return type of the resulting selector is determined by the return type of the combiner function.
 *
 * @example
 * const selector = createSelector(
 *  (state) => state.disabled
 * );
 *
 * @example
 * const selector = createSelector(
 *   (state) => state.disabled,
 *   (state) => state.open,
 *   (disabled, open) => ({ disabled, open })
 * );
 */
export declare const createSelector: CreateSelectorFunction;
export {};