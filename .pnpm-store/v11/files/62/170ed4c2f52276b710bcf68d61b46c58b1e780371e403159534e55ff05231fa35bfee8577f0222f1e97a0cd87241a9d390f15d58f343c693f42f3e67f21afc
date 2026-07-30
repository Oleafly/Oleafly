import { DecorationItem } from "../types.js";
import { ChangeObject } from "diff";

//#region src/utils/parseDiffDecorations.d.ts
interface CreateDiffSpanDecorationProps {
  line: number;
  spanStart: number;
  spanLength: number;
}
declare function createDiffSpanDecoration({
  line,
  spanStart,
  spanLength
}: CreateDiffSpanDecorationProps): DecorationItem;
interface PushOrJoinSpanProps {
  item: ChangeObject<string>;
  arr: [0 | 1, string][];
  enableJoin: boolean;
  isNeutral?: boolean;
  isLastItem?: boolean;
}
declare function pushOrJoinSpan({
  item,
  arr,
  enableJoin,
  isNeutral,
  isLastItem
}: PushOrJoinSpanProps): void;
//#endregion
export { createDiffSpanDecoration, pushOrJoinSpan };
//# sourceMappingURL=parseDiffDecorations.d.ts.map