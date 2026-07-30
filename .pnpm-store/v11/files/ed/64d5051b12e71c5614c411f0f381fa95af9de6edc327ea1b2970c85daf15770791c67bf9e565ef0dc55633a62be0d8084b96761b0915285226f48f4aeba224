import Tree from '@rc-component/tree';
import * as React from 'react';
interface RefOptionListProps {
    onKeyDown: React.KeyboardEventHandler;
    onKeyUp: React.KeyboardEventHandler;
    scrollTo?: (args: unknown) => void;
}
type ScrollTo = NonNullable<React.ComponentRef<typeof Tree>['scrollTo']>;
type ReviseRefOptionListProps = Omit<RefOptionListProps, 'scrollTo'> & {
    scrollTo: ScrollTo;
};
declare const RefOptionList: React.ForwardRefExoticComponent<React.RefAttributes<ReviseRefOptionListProps>>;
export default RefOptionList;
