export type DiagramHandle = "t" | "r" | "b" | "l";

export interface DiagramPoint {
  x: number;
  y: number;
}

const directions: Record<DiagramHandle, DiagramPoint> = {
  t: { x: 0, y: -1 },
  r: { x: 1, y: 0 },
  b: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
};

function direction(
  source: DiagramPoint,
  sourceHandle: DiagramHandle,
  target: DiagramPoint,
) {
  if (sourceHandle === "l" || sourceHandle === "r") {
    return source.x < target.x ? directions.r : directions.l;
  }
  return source.y < target.y ? directions.b : directions.t;
}

type DiagramAxis = "x" | "y";

interface RouteGeometry {
  source: DiagramPoint;
  target: DiagramPoint;
  sourceHandle: DiagramHandle;
  targetHandle: DiagramHandle;
  sourceDir: DiagramPoint;
  targetDir: DiagramPoint;
  sourceGapped: DiagramPoint;
  targetGapped: DiagramPoint;
  axis: DiagramAxis;
  currentSign: number;
  offset: number;
  stepPosition: number;
}

interface RouteLeg {
  points: DiagramPoint[];
  label: DiagramPoint;
  sourceGapOffset: DiagramPoint;
  targetGapOffset: DiagramPoint;
}

function facingLeg(g: RouteGeometry): RouteLeg {
  const { axis, sourceDir, currentSign, sourceGapped, targetGapped, stepPosition } = g;
  const center = {
    x:
      axis === "x"
        ? sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition
        : (sourceGapped.x + targetGapped.x) / 2,
    y:
      axis === "y"
        ? sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition
        : (sourceGapped.y + targetGapped.y) / 2,
  };
  const vertical = [
    { x: center.x, y: sourceGapped.y },
    { x: center.x, y: targetGapped.y },
  ];
  const horizontal = [
    { x: sourceGapped.x, y: center.y },
    { x: targetGapped.x, y: center.y },
  ];
  const useVertical = (sourceDir[axis] === currentSign) === (axis === "x");
  return {
    points: useVertical ? vertical : horizontal,
    label: center,
    sourceGapOffset: { x: 0, y: 0 },
    targetGapOffset: { x: 0, y: 0 },
  };
}

function applySameHandleGap(
  g: RouteGeometry,
  sourceGapOffset: DiagramPoint,
  targetGapOffset: DiagramPoint,
): void {
  const { axis, source, target, sourceDir, currentSign, sourceGapped, targetGapped, offset } = g;
  const diff = Math.abs(source[axis] - target[axis]);
  if (diff > offset) {
    return;
  }
  const gapOffset = Math.min(offset - 1, offset - diff);
  if (sourceDir[axis] === currentSign) {
    sourceGapOffset[axis] = (sourceGapped[axis] > source[axis] ? -1 : 1) * gapOffset;
  } else {
    targetGapOffset[axis] = (targetGapped[axis] > target[axis] ? -1 : 1) * gapOffset;
  }
}

function shouldFlipLeg(g: RouteGeometry): boolean {
  const { axis, sourceDir, targetDir, sourceGapped, targetGapped } = g;
  const otherAxis: DiagramAxis = axis === "x" ? "y" : "x";
  const sameDirection = sourceDir[axis] === targetDir[otherAxis];
  const sourceAbove = sourceGapped[otherAxis] > targetGapped[otherAxis];
  const sourceBelow = sourceGapped[otherAxis] < targetGapped[otherAxis];
  if (sourceDir[axis] === 1) {
    return (!sameDirection && sourceAbove) || (sameDirection && sourceBelow);
  }
  return (!sameDirection && sourceBelow) || (sameDirection && sourceAbove);
}

function sideLeg(g: RouteGeometry): RouteLeg {
  const { axis, sourceDir, currentSign, sourceGapped, targetGapped, sourceHandle, targetHandle } = g;
  const sourceTarget = [{ x: sourceGapped.x, y: targetGapped.y }];
  const targetSource = [{ x: targetGapped.x, y: sourceGapped.y }];
  const alongAxis = (sourceDir[axis] === currentSign) === (axis === "x");
  let points = alongAxis ? targetSource : sourceTarget;

  const sourceGapOffset = { x: 0, y: 0 };
  const targetGapOffset = { x: 0, y: 0 };
  if (sourceHandle === targetHandle) {
    applySameHandleGap(g, sourceGapOffset, targetGapOffset);
  } else if (shouldFlipLeg(g)) {
    points = axis === "x" ? sourceTarget : targetSource;
  }

  const sourceGap = gapPoint(sourceGapped, sourceGapOffset);
  const targetGap = gapPoint(targetGapped, targetGapOffset);
  const maxX = Math.max(
    Math.abs(sourceGap.x - points[0].x),
    Math.abs(targetGap.x - points[0].x),
  );
  const maxY = Math.max(
    Math.abs(sourceGap.y - points[0].y),
    Math.abs(targetGap.y - points[0].y),
  );
  const label =
    maxX >= maxY
      ? { x: (sourceGap.x + targetGap.x) / 2, y: points[0].y }
      : { x: points[0].x, y: (sourceGap.y + targetGap.y) / 2 };
  return { points, label, sourceGapOffset, targetGapOffset };
}

function gapPoint(gapped: DiagramPoint, gapOffset: DiagramPoint): DiagramPoint {
  return { x: gapped.x + gapOffset.x, y: gapped.y + gapOffset.y };
}

export function orthogonalRoute(
  source: DiagramPoint,
  target: DiagramPoint,
  sourceHandle: DiagramHandle = "b",
  targetHandle: DiagramHandle = "t",
  offset = 20,
  stepPosition = 0.5,
): { points: DiagramPoint[]; label: DiagramPoint } {
  const sourceDir = directions[sourceHandle];
  const targetDir = directions[targetHandle];
  const sourceGapped = {
    x: source.x + sourceDir.x * offset,
    y: source.y + sourceDir.y * offset,
  };
  const targetGapped = {
    x: target.x + targetDir.x * offset,
    y: target.y + targetDir.y * offset,
  };
  const currentDir = direction(sourceGapped, sourceHandle, targetGapped);
  const axis: DiagramAxis = currentDir.x !== 0 ? "x" : "y";
  const geometry: RouteGeometry = {
    source,
    target,
    sourceHandle,
    targetHandle,
    sourceDir,
    targetDir,
    sourceGapped,
    targetGapped,
    axis,
    currentSign: currentDir[axis],
    offset,
    stepPosition,
  };
  const facing = sourceDir[axis] * targetDir[axis] === -1;
  const leg = facing ? facingLeg(geometry) : sideLeg(geometry);
  const { points, label } = leg;

  const sourceGap = gapPoint(sourceGapped, leg.sourceGapOffset);
  const targetGap = gapPoint(targetGapped, leg.targetGapOffset);
  const lastPoint = points.at(-1) ?? points[0];
  const routed = [
    source,
    ...(sourceGap.x !== points[0].x || sourceGap.y !== points[0].y
      ? [sourceGap]
      : []),
    ...points,
    ...(targetGap.x !== lastPoint.x || targetGap.y !== lastPoint.y ? [targetGap] : []),
    target,
  ];
  return {
    points: routed.filter(
      (point, index) =>
        index === 0 ||
        point.x !== routed[index - 1].x ||
        point.y !== routed[index - 1].y,
    ),
    label,
  };
}
