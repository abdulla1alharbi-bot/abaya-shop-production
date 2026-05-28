/**
 * Phase 3 F4: Minimal SVG sparkline. No chart library needed.
 * Renders a small inline polyline showing a trend across N values.
 */
type Props = {
  values: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  showDots?: boolean;
};

export function Sparkline({
  values,
  width = 120,
  height = 36,
  strokeColor = "currentColor",
  fillColor,
  showDots = true,
}: Props) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    );
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * innerW;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return { x, y, v };
  });

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `M ${points[0]?.x ?? 0},${height - padding} L ${polyline} L ${points[points.length - 1]?.x ?? width - padding},${height - padding} Z`
      : "";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {fillColor ? <path d={areaPath} fill={fillColor} opacity={0.3} /> : null}
      <polyline points={polyline} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {showDots
        ? points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 2.5 : 1.5} fill={strokeColor} />
          ))
        : null}
    </svg>
  );
}
