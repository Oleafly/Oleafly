type AnimationFrameId = number;
export declare class AnimationFrame {
  static create(): AnimationFrame;
  static request(fn: FrameRequestCallback): number;
  static cancel(id: AnimationFrameId): void;
  currentId: AnimationFrameId | null;
  /**
   * Executes `fn` after `delay`, clearing any previously scheduled call.
   */
  request(fn: Function): void;
  cancel: () => void;
  disposeEffect: () => () => void;
}
/**
 * A `requestAnimationFrame` with automatic cleanup and guard.
 */
export declare function useAnimationFrame(): AnimationFrame;
export {};