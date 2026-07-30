import React from 'react';
import type { ArgsProps, GlobalConfigProps } from './interface';
import PureList from './PureList';
import PurePanel from './PurePanel';
import useNotification from './useNotification';
export type { ArgsProps };
interface BaseMethods {
    open: (config: ArgsProps) => void;
    destroy: (key?: React.Key) => void;
    config: (config: GlobalConfigProps) => void;
    useNotification: typeof useNotification;
    /** @private Internal Component. Do not use in your production. */
    _InternalPanelDoNotUseOrYouWillBeFired: typeof PurePanel;
    /** @private Internal Component. Do not use in your production. */
    _InternalListDoNotUseOrYouWillBeFired: typeof PureList;
}
type StaticFn = (config: ArgsProps) => void;
interface NoticeMethods {
    success: StaticFn;
    info: StaticFn;
    warning: StaticFn;
    error: StaticFn;
}
declare const staticMethods: NoticeMethods & BaseMethods;
declare const actWrapper: (wrapper: (fn: () => void) => void) => void;
export { actWrapper };
declare const actDestroy: () => void;
export { actDestroy };
export default staticMethods;
