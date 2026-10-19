interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}

/** A small line of values, drawn in the current text colour. */
export function Sparkline({ values, width = 120, height = 28, label, className }: Readonly<SparklineProps>) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const span = high - low || 1;
  const step = width / (finite.length - 1);
  const points = finite
    .map((value, index) => {
      const x = index * step;
      const y = height - 2 - ((value - low) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      data-testid="research-sparkline"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
