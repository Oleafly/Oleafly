import * as React from 'react';
export type Instance = {
  didInitialize: boolean;
};
type HookType = {
  before: (instance: any) => void;
  after: (instance: any) => void;
};
export declare function getInstance(): Instance | undefined;
export declare function setInstance(instance: Instance | undefined): void;
export declare function register(hook: HookType): void;
export declare function fastComponent<P extends object, E extends HTMLElement, R extends React.ReactNode>(fn: (props: P) => R): typeof fn;
export declare function fastComponentRef<P extends object, E extends Element, R extends React.ReactNode>(fn: (props: React.PropsWithoutRef<P>, forwardedRef: React.Ref<E>) => R): React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<E>>;
export {};