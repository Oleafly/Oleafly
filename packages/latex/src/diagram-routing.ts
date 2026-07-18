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

function edgeCenter(source: DiagramPoint, target: DiagramPoint) {
  return {
    x: source.x + Math.abs(target.x - source.x) / 2,
    y: source.y + Math.abs(target.y - source.y) / 2,
  };
}

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
  const axis = currentDir.x !== 0 ? "x" : "y";
  const currentSign = currentDir[axis];
  const sourceGapOffset = { x: 0, y: 0 };
  const targetGapOffset = { x: 0, y: 0 };
  let points: DiagramPoint[];
  let label = edgeCenter(source, target);

  if (sourceDir[axis] * targetDir[axis] === -1) {
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
    points =
      sourceDir[axis] === currentSign
        ? axis === "x"
          ? vertical
          : horizontal
        : axis === "x"
          ? horizontal
          : vertical;
    label = center;
  } else {
    const sourceTarget = [{ x: sourceGapped.x, y: targetGapped.y }];
    const targetSource = [{ x: targetGapped.x, y: sourceGapped.y }];
    points =
      axis === "x"
        ? sourceDir.x === currentSign
          ? targetSource
          : sourceTarget
        : sourceDir.y === currentSign
          ? sourceTarget
          : targetSource;

    if (sourceHandle === targetHandle) {
      const diff = Math.abs(source[axis] - target[axis]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sourceDir[axis] === currentSign) {
          sourceGapOffset[axis] =
            (sourceGapped[axis] > source[axis] ? -1 : 1) * gapOffset;
        } else {
          targetGapOffset[axis] =
            (targetGapped[axis] > target[axis] ? -1 : 1) * gapOffset;
        }
      }
    }

    if (sourceHandle !== targetHandle) {
      const otherAxis = axis === "x" ? "y" : "x";
      const sameDirection = sourceDir[axis] === targetDir[otherAxis];
      const sourceAbove = sourceGapped[otherAxis] > targetGapped[otherAxis];
      const sourceBelow = sourceGapped[otherAxis] < targetGapped[otherAxis];
      const flip =
        (sourceDir[axis] === 1 &&
          ((!sameDirection && sourceAbove) || (sameDirection && sourceBelow))) ||
        (sourceDir[axis] !== 1 &&
          ((!sameDirection && sourceBelow) || (sameDirection && sourceAbove)));
      if (flip) points = axis === "x" ? sourceTarget : targetSource;
    }

    const sourceGap = {
      x: sourceGapped.x + sourceGapOffset.x,
      y: sourceGapped.y + sourceGapOffset.y,
    };
    const targetGap = {
      x: targetGapped.x + targetGapOffset.x,
      y: targetGapped.y + targetGapOffset.y,
    };
    const maxX = Math.max(
      Math.abs(sourceGap.x - points[0].x),
      Math.abs(targetGap.x - points[0].x),
    );
    const maxY = Math.max(
      Math.abs(sourceGap.y - points[0].y),
      Math.abs(targetGap.y - points[0].y),
    );
    label =
      maxX >= maxY
        ? { x: (sourceGap.x + targetGap.x) / 2, y: points[0].y }
        : { x: points[0].x, y: (sourceGap.y + targetGap.y) / 2 };
  }

  const sourceGap = {
    x: sourceGapped.x + sourceGapOffset.x,
    y: sourceGapped.y + sourceGapOffset.y,
  };
  const targetGap = {
    x: targetGapped.x + targetGapOffset.x,
    y: targetGapped.y + targetGapOffset.y,
  };
  const routed = [
    source,
    ...(sourceGap.x !== points[0].x || sourceGap.y !== points[0].y
      ? [sourceGap]
      : []),
    ...points,
    ...(targetGap.x !== points[points.length - 1].x ||
    targetGap.y !== points[points.length - 1].y
      ? [targetGap]
      : []),
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
