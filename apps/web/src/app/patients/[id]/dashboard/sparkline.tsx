import type { VitalTrend } from "@health-mcp/shared";

import { formatDate, formatNumber } from "@/lib/format";

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 3;

/** A small line chart of a vital's readings over time. Values and times are scaled to fit. */
export function Sparkline({ points, unit }: Pick<VitalTrend, "points" | "unit">) {
  const [first] = points;
  const last = points.at(-1);
  if (!first || !last) return null;

  const times = points.map((p) => Date.parse(p.recordedAt));
  const values = points.map((p) => p.value);
  const [minTime, maxTime] = [Math.min(...times), Math.max(...times)];
  const [minValue, maxValue] = [Math.min(...values), Math.max(...values)];
  const x = (time: number) =>
    maxTime === minTime
      ? WIDTH / 2
      : PAD + ((time - minTime) / (maxTime - minTime)) * (WIDTH - 2 * PAD);
  const y = (value: number) =>
    maxValue === minValue
      ? HEIGHT / 2
      : HEIGHT - PAD - ((value - minValue) / (maxValue - minValue)) * (HEIGHT - 2 * PAD);
  const coordinates = points.map((p, i) => `${x(times[i]!).toFixed(1)},${y(p.value).toFixed(1)}`);

  const label =
    `${points.length} readings ` +
    `from ${formatDate(first.recordedAt)} to ${formatDate(last.recordedAt)}, ` +
    `between ${formatNumber(minValue)} and ${formatNumber(maxValue)} ${unit}`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {points.length > 1 && <polyline points={coordinates.join(" ")} />}
      <circle cx={x(times.at(-1)!)} cy={y(last.value)} r={2.5} />
    </svg>
  );
}
