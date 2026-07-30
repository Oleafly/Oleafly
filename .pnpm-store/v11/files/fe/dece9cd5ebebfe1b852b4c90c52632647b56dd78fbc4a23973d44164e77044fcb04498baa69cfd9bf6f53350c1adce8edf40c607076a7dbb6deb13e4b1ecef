import { convertDataToEntities } from '@rc-component/tree';
import type { DefaultOptionType, InternalFieldNames } from '../Cascader';
export type DataEntity = ReturnType<typeof convertDataToEntities>['keyEntities'][string];
export interface OptionsInfo {
    keyEntities: Record<string, DataEntity>;
    pathKeyEntities: Record<string, DataEntity>;
}
export type GetEntities = () => OptionsInfo['pathKeyEntities'];
/** Lazy parse options data into conduct-able info to avoid perf issue in single mode */
declare const _default: (options: DefaultOptionType[], fieldNames: InternalFieldNames) => GetEntities;
export default _default;
