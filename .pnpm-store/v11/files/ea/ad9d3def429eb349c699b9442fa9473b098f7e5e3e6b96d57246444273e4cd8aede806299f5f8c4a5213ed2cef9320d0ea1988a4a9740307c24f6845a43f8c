import { CSSProperties } from 'react';
import { default as default_2 } from 'react';

declare const AvatarEditor: default_2.ForwardRefExoticComponent<Props & default_2.RefAttributes<AvatarEditorRef>>;
export default AvatarEditor;

declare interface AvatarEditorConfig {
    width: number
    height: number
    border?: number | [number, number]
    borderRadius?: number
    scale?: number
    rotate?: number
    color?: [number, number, number, number?]
    backgroundColor?: string
    borderColor?: [number, number, number, number?]
    showGrid?: boolean
    gridColor?: string
    disableBoundaryChecks?: boolean
    disableHiDPIScaling?: boolean
    disableCanvasRotation?: boolean
    crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

export declare interface AvatarEditorRef {
    getImage: () => HTMLCanvasElement;
    getImageScaledToCanvas: () => HTMLCanvasElement;
    getCroppingRect: () => {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export declare interface ImageState {
    x: number
    y: number
    width?: number
    height?: number
    resource?: HTMLImageElement
}

export declare interface Position {
    x: number
    y: number
}

export declare interface Props extends AvatarEditorConfig {
    style?: CSSProperties;
    image?: string | File;
    position?: Position;
    onLoadStart?: () => void;
    onLoadFailure?: () => void;
    onLoadSuccess?: (image: ImageState) => void;
    onImageReady?: () => void;
    onImageChange?: () => void;
    onMouseUp?: () => void;
    onMouseMove?: (e: TouchEvent | MouseEvent) => void;
    onPositionChange?: (position: Position) => void;
}

export declare function useAvatarEditor(): {
    ref: default_2.RefObject<AvatarEditorRef | null>;
    getImage: () => HTMLCanvasElement | null;
    getImageScaledToCanvas: () => HTMLCanvasElement | null;
    getCroppingRect: () => {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
};

export { }
