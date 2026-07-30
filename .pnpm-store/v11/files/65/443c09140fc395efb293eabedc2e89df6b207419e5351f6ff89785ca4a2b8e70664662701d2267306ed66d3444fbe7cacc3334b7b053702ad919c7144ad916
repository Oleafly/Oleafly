import React from 'react';
import type { FullTheme } from "./styles/index.js";
import type { StoreType, PanelSettingsType, InputContextProps } from "./types/index.js";
export declare const InputContext: React.Context<{}>;
export declare function useInputContext<T = {}>(): InputContextProps & T;
type ThemeContextProps = {
    theme: FullTheme;
    className: string;
};
export declare const ThemeContext: React.Context<ThemeContextProps | null>;
export declare const StoreContext: React.Context<StoreType | null>;
export declare const PanelSettingsContext: React.Context<PanelSettingsType | null>;
export declare function useStoreContext(): StoreType;
export declare function usePanelSettingsContext(): PanelSettingsType;
type LevaStoreProviderProps = {
    children: React.ReactNode;
    store: StoreType;
};
export declare function LevaStoreProvider({ children, store }: LevaStoreProviderProps): React.JSX.Element;
export {};
