import { HTMLAttributes, Ref } from "react";
import { Application, SplineEvent } from "@splinetool/runtime";
//#region src/awesome/Spline/type.d.ts
interface SplineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onLoad' | 'onMouseDown' | 'onMouseUp' | 'onMouseHover' | 'onKeyDown' | 'onKeyUp' | 'onWheel'> {
  onFollow?: (e: SplineEvent) => void;
  onKeyDown?: (e: SplineEvent) => void;
  onKeyUp?: (e: SplineEvent) => void;
  onLoad?: (e: Application) => void;
  onLookAt?: (e: SplineEvent) => void;
  onMouseDown?: (e: SplineEvent) => void;
  onMouseHover?: (e: SplineEvent) => void;
  onMouseUp?: (e: SplineEvent) => void;
  onStart?: (e: SplineEvent) => void;
  onWheel?: (e: SplineEvent) => void;
  ref?: Ref<HTMLDivElement>;
  renderOnDemand?: boolean;
  scene: string;
}
//#endregion
export { SplineProps };
//# sourceMappingURL=type.d.mts.map