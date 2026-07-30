import type { ReactNode } from 'react';
import React from 'react';
import type { AnyObject, CustomComponent } from '../_util/type';
import type { AppConfig } from './context';
export interface AppProps<P = AnyObject> extends AppConfig {
    style?: React.CSSProperties;
    className?: string;
    rootClassName?: string;
    prefixCls?: string;
    children?: ReactNode;
    component?: CustomComponent<P> | false;
}
declare const App: React.ForwardRefExoticComponent<AppProps<AnyObject> & React.RefAttributes<HTMLElement>>;
export default App;
