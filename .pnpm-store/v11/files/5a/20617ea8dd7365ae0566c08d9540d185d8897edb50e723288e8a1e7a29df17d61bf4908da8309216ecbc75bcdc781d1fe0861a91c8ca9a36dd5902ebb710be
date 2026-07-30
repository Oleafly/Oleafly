import * as React from 'react';
import type { UploadProps } from './interface';
import type { UploadRef } from './Upload';
export type DraggerProps<T = any> = UploadProps<T> & {
    height?: number;
};
type DraggerType = (<T = any>(props: DraggerProps<T> & React.RefAttributes<UploadRef<T>>) => React.ReactElement | null) & {
    displayName?: string;
};
declare const Dragger: DraggerType;
export default Dragger;
