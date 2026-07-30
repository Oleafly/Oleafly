import type { Root, Element, ElementContent } from 'hast';
export interface IAlert {
    keyword: string;
    icon: string | Element;
    title: string;
}
export type DefaultBuildType = (alertOptions: IAlert, originalChildren: ElementContent[]) => ElementContent | null;
export interface IOptions {
    alerts?: IAlert[];
    supportLegacy?: boolean;
    build?: DefaultBuildType;
}
export declare const rehypeGithubAlerts: (options: IOptions) => (tree: Root) => void;
export declare const defaultBuild: DefaultBuildType;
