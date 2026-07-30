import React from 'react';

declare const animations: {
    easeOut: (t: number) => number;
    linear: (t: number) => number;
    easeInQuad: (t: number) => number;
    easeOutQuad: (t: number) => number;
    easeInOutQuad: (t: number) => number;
    easeInCubic: (t: number) => number;
    easeOutCubic: (t: number) => number;
    easeInOutCubic: (t: number) => number;
    easeInQuart: (t: number) => number;
    easeOutQuart: (t: number) => number;
    easeInOutQuart: (t: number) => number;
    easeInQuint: (t: number) => number;
    easeOutQuint: (t: number) => number;
    easeInOutQuint: (t: number) => number;
};

type DeepNonNullable<T> = T extends (...args: any[]) => any ? T : T extends any[] ? DeepNonNullableArray<T[number]> : T extends object ? DeepNonNullableObject<T> : T;
type DeepNonNullableArray<T> = Array<DeepNonNullable<NonNullable<T>>>;
type DeepNonNullableObject<T> = {
    [P in keyof T]-?: DeepNonNullable<NonNullable<T[P]>>;
};

declare const zoomIn: (contextInstance: ReactZoomPanPinchContext) => (step?: number, animationTime?: number, animationType?: keyof typeof animations) => void;
declare const zoomOut: (contextInstance: ReactZoomPanPinchContext) => (step?: number, animationTime?: number, animationType?: keyof typeof animations) => void;
declare const setTransform: (contextInstance: ReactZoomPanPinchContext) => (newPositionX: number, newPositionY: number, newScale: number, animationTime?: number, animationType?: keyof typeof animations) => void;
declare const resetTransform: (contextInstance: ReactZoomPanPinchContext) => (animationTime?: number, animationType?: keyof typeof animations) => void;
declare const centerView: (contextInstance: ReactZoomPanPinchContext) => (scale?: number, animationTime?: number, animationType?: keyof typeof animations) => void;
declare const zoomToElement: (contextInstance: ReactZoomPanPinchContext) => (node: HTMLElement | string, scale?: number, animationTime?: number, animationType?: keyof typeof animations, offsetX?: number, offsetY?: number) => void;

type StartCoordsType = {
    x: number;
    y: number;
} | null;
declare class ZoomPanPinch {
    props: ReactZoomPanPinchProps;
    mounted: boolean;
    state: ReactZoomPanPinchState;
    setup: LibrarySetup;
    observer?: ResizeObserver;
    onChangeCallbacks: Set<(ctx: ReactZoomPanPinchRef) => void>;
    onInitCallbacks: Set<(ctx: ReactZoomPanPinchRef) => void>;
    onTransformCallbacks: Set<(data: {
        scale: number;
        positionX: number;
        positionY: number;
        previousScale: number;
        ref: ReactZoomPanPinchRef;
    }) => void>;
    wrapperComponent: HTMLDivElement | null;
    contentComponent: HTMLDivElement | null;
    isInitialized: boolean;
    bounds: BoundsType | null;
    previousWheelEvent: WheelEvent | null;
    wheelStopEventTimer: ReturnType<typeof setTimeout> | null;
    wheelAnimationTimer: ReturnType<typeof setTimeout> | null;
    isPanning: boolean;
    isWheelPanning: boolean;
    startCoords: StartCoordsType;
    panStartPosition: {
        x: number;
        y: number;
    } | null;
    lastTouch: number | null;
    isPinching: boolean;
    distance: null | number;
    lastDistance: null | number;
    pinchStartDistance: null | number;
    pinchStartScale: null | number;
    pinchMidpoint: null | PositionType;
    pinchPreviousCenter: null | PositionType;
    doubleClickStopEventTimer: ReturnType<typeof setTimeout> | null;
    velocity: VelocityType | null;
    velocityTime: number | null;
    lastMousePosition: PositionType | null;
    isAnimating: boolean;
    animation: AnimationType | null;
    pressedKeys: {
        [key: string]: boolean;
    };
    constructor(props: ReactZoomPanPinchProps);
    mount: () => void;
    unmount: () => void;
    update: (newProps: ReactZoomPanPinchProps) => void;
    initializeWindowEvents: () => void;
    cleanupWindowEvents: () => void;
    handleInitializeWrapperEvents: (wrapper: HTMLDivElement) => void;
    handleInitialize: (contentComponent: HTMLDivElement) => void;
    onWheelZoom: (event: WheelEvent) => void;
    onWheelPanning: (event: WheelEvent) => void;
    onPanningStart: (event: MouseEvent) => void;
    onPanning: (event: MouseEvent) => void;
    onPanningStop: (event: MouseEvent | TouchEvent) => void;
    onPinchStart: (event: TouchEvent) => void;
    onPinch: (event: TouchEvent) => void;
    onPinchStop: (event: TouchEvent) => void;
    onTouchPanningStart: (event: TouchEvent) => void;
    onTouchPanning: (event: TouchEvent) => void;
    onTouchPanningStop: (event: TouchEvent) => void;
    onDoubleClick: (event: MouseEvent | TouchEvent) => void;
    clearPanning: (event: MouseEvent) => void;
    handleWindowBlur: () => void;
    syncModifierKeys: (event: MouseEvent | WheelEvent | TouchEvent) => void;
    setKeyPressed: (e: KeyboardEvent) => void;
    setKeyUnPressed: (e: KeyboardEvent) => void;
    isPressingKeys: (keys: string[] | ((keys: string[]) => boolean)) => boolean;
    setCenter: () => void;
    handleTransformStyles: (x: number, y: number, scale: number) => string;
    getContext: () => ReactZoomPanPinchRef;
    applyTransformation: () => void;
    setState: (scale: number, positionX: number, positionY: number) => void;
    /**
     * Hooks
     */
    onTransform: (callback: (data: {
        scale: number;
        positionX: number;
        positionY: number;
        previousScale: number;
        ref: ReactZoomPanPinchRef;
    }) => void) => () => void;
    onChange: (callback: (ref: ReactZoomPanPinchRef) => void) => () => void;
    onInit: (callback: (ref: ReactZoomPanPinchRef) => void) => () => void;
    /**
     * Initialization
     */
    init: (wrapperComponent: HTMLDivElement, contentComponent: HTMLDivElement) => void;
}

type ReactZoomPanPinchContext = typeof ZoomPanPinch.prototype;
type ReactZoomPanPinchContextState = {
    instance: ReactZoomPanPinchContext;
    state: ReactZoomPanPinchState;
};
type ReactZoomPanPinchContentRef = {
    instance: ReactZoomPanPinchContext;
    state: ReactZoomPanPinchState;
} & ReactZoomPanPinchHandlers;
type ReactZoomPanPinchRef = ReactZoomPanPinchContextState & ReactZoomPanPinchHandlers;
type ReactZoomPanPinchState = {
    previousScale: number;
    scale: number;
    positionX: number;
    positionY: number;
};
type ReactZoomPanPinchHandlers = {
    zoomIn: ReturnType<typeof zoomIn>;
    zoomOut: ReturnType<typeof zoomOut>;
    setTransform: ReturnType<typeof setTransform>;
    resetTransform: ReturnType<typeof resetTransform>;
    centerView: ReturnType<typeof centerView>;
    zoomToElement: ReturnType<typeof zoomToElement>;
};
type ReactZoomPanPinchRefProps = {
    setRef: (context: ReactZoomPanPinchRef) => void;
} & Omit<ReactZoomPanPinchProps, "ref">;
type ReactZoomPanPinchProps = {
    children?: React.ReactNode | ((ref: ReactZoomPanPinchContentRef) => React.ReactNode);
    ref?: React.Ref<ReactZoomPanPinchRef>;
    detached?: boolean;
    initialScale?: number;
    initialPositionX?: number;
    initialPositionY?: number;
    disabled?: boolean;
    minPositionX?: null | number;
    maxPositionX?: null | number;
    minPositionY?: null | number;
    maxPositionY?: null | number;
    minScale?: number;
    maxScale?: number;
    limitToBounds?: boolean;
    centerZoomedOut?: boolean;
    centerOnInit?: boolean;
    disablePadding?: boolean;
    customTransform?: (x: number, y: number, scale: number) => string;
    smooth?: boolean;
    wheel?: {
        step?: number;
        disabled?: boolean;
        wheelDisabled?: boolean;
        touchPadDisabled?: boolean;
        activationKeys?: string[] | ((keys: string[]) => boolean);
        excluded?: string[];
    };
    panning?: {
        disabled?: boolean;
        velocityDisabled?: boolean;
        lockAxisX?: boolean;
        lockAxisY?: boolean;
        allowLeftClickPan?: boolean;
        allowMiddleClickPan?: boolean;
        allowRightClickPan?: boolean;
        activationKeys?: string[] | ((keys: string[]) => boolean);
        excluded?: string[];
    };
    pinch?: {
        step?: number;
        disabled?: boolean;
        allowPanning?: boolean;
        excluded?: string[];
    };
    trackPadPanning?: {
        disabled?: boolean;
        velocityDisabled?: boolean;
        lockAxisX?: boolean;
        lockAxisY?: boolean;
        activationKeys?: string[] | ((keys: string[]) => boolean);
        excluded?: string[];
    };
    doubleClick?: {
        disabled?: boolean;
        step?: number;
        mode?: "zoomIn" | "zoomOut" | "reset" | "toggle";
        animationTime?: number;
        animationType?: keyof typeof animations;
        excluded?: string[];
    };
    zoomAnimation?: {
        disabled?: boolean;
        size?: number;
        animationTime?: number;
        animationType?: keyof typeof animations;
    };
    autoAlignment?: {
        disabled?: boolean;
        sizeX?: number;
        sizeY?: number;
        animationTime?: number;
        velocityAlignmentTime?: number;
        animationType?: keyof typeof animations;
    };
    velocityAnimation?: {
        disabled?: boolean;
        sensitivityTouch?: number;
        sensitivityMouse?: number;
        maxStrengthMouse?: number;
        maxStrengthTouch?: number;
        inertia?: number;
        animationTime?: number;
        maxAnimationTime?: number;
        animationType?: keyof typeof animations;
    };
    onWheelStart?: (ref: ReactZoomPanPinchRef, event: WheelEvent) => void;
    onWheel?: (ref: ReactZoomPanPinchRef, event: WheelEvent) => void;
    onWheelStop?: (ref: ReactZoomPanPinchRef, event: WheelEvent) => void;
    onPanningStart?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onPanning?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onPanningStop?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onPinchStart?: (ref: ReactZoomPanPinchRef, event: TouchEvent) => void;
    onPinch?: (ref: ReactZoomPanPinchRef, event: TouchEvent) => void;
    onPinchStop?: (ref: ReactZoomPanPinchRef, event: TouchEvent) => void;
    onZoomStart?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onZoom?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onZoomStop?: (ref: ReactZoomPanPinchRef, event: TouchEvent | MouseEvent) => void;
    onTransform?: (ref: ReactZoomPanPinchRef, state: {
        scale: number;
        positionX: number;
        positionY: number;
    }) => void;
    onInit?: (ref: ReactZoomPanPinchRef) => void;
};
type ReactZoomPanPinchComponentHelpers = {
    setComponents: (wrapper: HTMLDivElement, content: HTMLDivElement) => void;
};
type LibrarySetup = Pick<ReactZoomPanPinchProps, "minPositionX" | "maxPositionX" | "minPositionY" | "maxPositionY"> & DeepNonNullable<Omit<ReactZoomPanPinchProps, "ref" | "initialScale" | "initialPositionX" | "initialPositionY" | "minPositionX" | "maxPositionX" | "minPositionY" | "maxPositionY" | "children" | "defaultPositionX" | "defaultPositionY" | "defaultScale" | "wrapperClass" | "contentClass" | "onWheelStart" | "onWheel" | "onWheelStop" | "onPanningStart" | "onPanning" | "onPanningStop" | "onPinchStart" | "onPinch" | "onPinchStop" | "onZoomStart" | "onZoom" | "onZoomStop" | "onTransform" | "onInit" | "customTransform">>;
type ReactZoomPanPinchBaseClasses = {
    wrapperClass: string;
    contentClass: string;
};

type SizeType = {
    width: number;
    height: number;
};
type PositionType = {
    x: number;
    y: number;
};
type StateType = {
    scale: number;
    positionX: number;
    positionY: number;
};
type VelocityType = {
    velocityX: number;
    velocityY: number;
    total: number;
};
type BoundsType = {
    minPositionX: number;
    maxPositionX: number;
    minPositionY: number;
    maxPositionY: number;
    scaleWidthFactor: number;
    scaleHeightFactor: number;
};
type AnimationType = () => void | number;
declare enum DeviceType {
    TRACK_PAD = "track_pad",
    MOUSE = "mouse",
    TOUCH = "touch"
}

declare const useControls: () => ReactZoomPanPinchContentRef;

declare const useTransformInit: (callback: (ref: ReactZoomPanPinchContextState) => void | (() => void)) => void;

declare const useTransformEffect: (callback: (ref: ReactZoomPanPinchContextState) => void | (() => void)) => void;

declare const useTransformContext: () => ZoomPanPinch;

declare function useTransformComponent<T>(callback: (state: ReactZoomPanPinchContextState) => T): T;

declare const KeepScale: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;

type MiniMapProps = {
    children: React.ReactNode;
    width?: number;
    height?: number;
    borderColor?: string;
    /** Merged onto the viewport indicator (`.rzpp-minimap-preview`). */
    previewStyle?: React.CSSProperties;
    /** Extra class name(s) appended to `.rzpp-minimap-wrapper`. */
    wrapperClassName?: string;
    /** Extra class name(s) appended to `.rzpp-minimap-preview`. */
    previewClassName?: string;
    panning?: boolean;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
declare const MiniMap: React.FC<MiniMapProps>;

type Props = {
    children: React.ReactNode;
    wrapperClass?: string;
    contentClass?: string;
    wrapperStyle?: React.CSSProperties;
    contentStyle?: React.CSSProperties;
    wrapperProps?: React.HTMLAttributes<HTMLDivElement>;
    contentProps?: React.HTMLAttributes<HTMLDivElement>;
    /**
     * When true, renders an infinite dot-grid background behind the content
     * that scales and pans in sync with the transform. Pair with
     * `limitToBounds={false}` on TransformWrapper for full effect.
     */
    infinite?: boolean;
};
declare const TransformComponent: React.FC<Props>;

declare const Context: React.Context<ZoomPanPinch>;
declare const TransformWrapper: React.ForwardRefExoticComponent<Omit<ReactZoomPanPinchProps, "ref"> & React.RefAttributes<ReactZoomPanPinchContentRef>>;

type VirtualizeProps = {
    /** Horizontal position of the element in content (unscaled) space. */
    x: number;
    /** Vertical position of the element in content (unscaled) space. */
    y: number;
    /** Width of the element in content (unscaled) space. */
    width: number;
    /** Height of the element in content (unscaled) space. */
    height: number;
    /**
     * Extra pixels around the viewport that still count as "visible".
     * Positive values mount children before they scroll into view,
     * acting like `IntersectionObserver`'s `rootMargin`.
     * @default 0
     */
    margin?: number;
    /**
     * Fraction of the element area (0-1) that must overlap the (expanded)
     * viewport for the children to be mounted.
     *
     * - `0` — any overlap is enough (default).
     * - `1` — the element must be fully inside the viewport.
     * @default 0
     */
    threshold?: number;
    /**
     * Content rendered in place of children when the element is outside
     * the viewport.  Defaults to `null` (nothing rendered).
     */
    placeholder?: React.ReactNode;
    /** Fires when the element enters the viewport and children are mounted. */
    onShow?: () => void;
    /** Fires when the element leaves the viewport and children are unmounted. */
    onHide?: () => void;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
};
declare const Virtualize: React.ForwardRefExoticComponent<VirtualizeProps & React.RefAttributes<HTMLDivElement>>;

/** Drop binary float noise on scale (e.g. 1.5000000000000002) without clipping real zoom values. */
declare const roundScaleForTransform: (scale: number) => number;
declare const getTransformStyles: (x: number, y: number, scale: number) => string;
declare const getMatrixTransformStyles: (x: number, y: number, scale: number) => string;
declare const getCenterPosition: (scale: number, wrapperComponent: HTMLDivElement, contentComponent: HTMLDivElement) => StateType;

export { type AnimationType, type BoundsType, Context, DeviceType, KeepScale, type LibrarySetup, MiniMap, type MiniMapProps, type PositionType, type ReactZoomPanPinchBaseClasses, type ReactZoomPanPinchComponentHelpers, type ReactZoomPanPinchContentRef, type ReactZoomPanPinchContext, type ReactZoomPanPinchContextState, type ReactZoomPanPinchHandlers, type ReactZoomPanPinchProps, type ReactZoomPanPinchRef, type ReactZoomPanPinchRefProps, type ReactZoomPanPinchState, type SizeType, type StateType, TransformComponent, TransformWrapper, type VelocityType, Virtualize, type VirtualizeProps, getCenterPosition, getMatrixTransformStyles, getTransformStyles, roundScaleForTransform, useControls, useTransformComponent, useTransformContext, useTransformEffect, useTransformInit };
