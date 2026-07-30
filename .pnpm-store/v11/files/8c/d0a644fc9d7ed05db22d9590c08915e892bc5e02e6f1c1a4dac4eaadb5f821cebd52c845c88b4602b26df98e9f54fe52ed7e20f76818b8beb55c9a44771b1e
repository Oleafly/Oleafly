import { DependencyList } from 'react';
import { JSX } from 'react';
import { ReactNode } from 'react';
import { RefCallback } from 'react';

declare type EventListenerOptions_2 = {
    capture?: boolean;
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
} | boolean;

declare type FormTags = 'input' | 'textarea' | 'select' | 'INPUT' | 'TEXTAREA' | 'SELECT' | 'searchbox' | 'slider' | 'spinbutton' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' | 'option' | 'radio' | 'textbox';

declare type Hotkey = KeyboardModifiers & {
    keys?: readonly string[];
    scopes?: Scopes;
    description?: string;
    isSequence?: boolean;
    hotkey: string;
    metadata?: Record<string, unknown>;
};

export declare type HotkeyCallback = (keyboardEvent: KeyboardEvent, hotkeysEvent: HotkeysEvent) => void;

declare type HotkeysContextType = {
    hotkeys: ReadonlyArray<Hotkey>;
    activeScopes: string[];
    toggleScope: (scope: string) => void;
    enableScope: (scope: string) => void;
    disableScope: (scope: string) => void;
};

declare type HotkeysEvent = Hotkey;

export declare const HotkeysProvider: ({ initiallyActiveScopes, children }: Props) => JSX.Element;

export declare function isHotkeyPressed(key: string | readonly string[], delimiter?: string): boolean;

declare type KeyboardModifiers = {
    alt?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    mod?: boolean;
    useKey?: boolean;
};

export declare type Keys = string | readonly string[];

export declare type Options = {
    enabled?: Trigger;
    enableOnFormTags?: readonly FormTags[] | boolean;
    enableOnContentEditable?: boolean;
    ignoreEventWhen?: (e: KeyboardEvent) => boolean;
    splitKey?: string;
    delimiter?: string;
    scopes?: Scopes;
    keyup?: boolean;
    keydown?: boolean;
    preventDefault?: Trigger;
    description?: string;
    document?: Document;
    ignoreModifiers?: boolean;
    eventListenerOptions?: EventListenerOptions_2;
    useKey?: boolean;
    sequenceTimeoutMs?: number;
    sequenceSplitKey?: string;
    metadata?: Record<string, unknown>;
};

declare type OptionsOrDependencyArray = Options | DependencyList;

declare interface Props {
    initiallyActiveScopes?: string[];
    children: ReactNode;
}

declare type Scopes = string | readonly string[];

declare type Trigger = boolean | ((keyboardEvent: KeyboardEvent, hotkeysEvent: HotkeysEvent) => boolean);

export declare function useHotkeys<T extends HTMLElement>(keys: Keys, callback: HotkeyCallback, options?: OptionsOrDependencyArray, dependencies?: OptionsOrDependencyArray): RefCallback<T | null>;

export declare const useHotkeysContext: () => HotkeysContextType;

export declare function useRecordHotkeys(useKey?: boolean, blacklist?: string[]): readonly [Set<string>, {
    readonly start: () => void;
    readonly stop: () => void;
    readonly resetKeys: () => void;
    readonly isRecording: boolean;
}];

export { }
