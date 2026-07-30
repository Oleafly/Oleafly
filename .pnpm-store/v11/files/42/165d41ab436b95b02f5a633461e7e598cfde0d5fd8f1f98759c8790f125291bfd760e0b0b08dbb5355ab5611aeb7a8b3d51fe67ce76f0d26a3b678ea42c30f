import * as React from 'react';
export interface ErrorBoundaryProps {
    title?: React.ReactNode;
    /**
     * @deprecated please use `title` instead.
     */
    message?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    id?: string;
}
export interface ErrorBoundaryStates {
    error?: Error | null;
    info?: React.ErrorInfo;
}
declare class ErrorBoundary extends React.PureComponent<ErrorBoundaryProps, ErrorBoundaryStates> {
    state: ErrorBoundaryStates;
    componentDidCatch(error: Error, info: React.ErrorInfo): void;
    render(): string | number | bigint | boolean | Iterable<React.ReactNode> | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | React.JSX.Element | null | undefined;
}
export default ErrorBoundary;
