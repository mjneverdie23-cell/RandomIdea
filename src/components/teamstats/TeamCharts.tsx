import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { formatDate, formatDuration } from '../../lib/format.ts';
import type { DurationSummary, GameLength, GoldMark, LengthBucket } from '../../predictor/teamStats.ts';

/*
 * Charts for the Team Stat page, drawn as inline SVG.
 *
 * One accent hue (`--viz-accent`) for the data the chart is about and one
 * context gray (`--viz-context`) for what it is compared against — emphasis
 * rather than a categorical palette, because every chart here has one story.
 * Marks are thin, gridlines are solid hairlines, values sit on the marks that
 * matter, and every mark has a hover/focus tooltip plus a table equivalent, so
 * nothing is readable by colour or hover alone. The SVG is laid out at the
 * container's measured width so text stays at reading size on a phone.
 */

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function useWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(260, Math.floor(node.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface TipLine {
  value: string;
  label: string;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: TipLine[];
}

/** One tooltip per chart, placed above the hovered or focused mark. */
function useTip(container: React.RefObject<HTMLDivElement | null>) {
  const [tip, setTip] = useState<Tip | null>(null);
  const at = useCallback(
    (clientX: number, clientY: number, title: string, lines: TipLine[]) => {
      const box = container.current?.getBoundingClientRect();
      if (!box) return;
      setTip({ x: clientX - box.left, y: clientY - box.top, title, lines });
    },
    [container],
  );
  const handlers = useCallback(
    (title: string, lines: TipLine[]) => ({
      tabIndex: 0,
      role: 'img' as const,
      'aria-label': `${title}: ${lines.map((l) => `${l.label} ${l.value}`).join(', ')}`,
      onPointerMove: (event: PointerEvent<SVGElement>) => at(event.clientX, event.clientY, title, lines),
      onPointerLeave: () => setTip(null),
      onFocus: (event: FocusEvent<SVGElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        at(box.left + box.width / 2, box.top, title, lines);
      },
      onBlur: () => setTip(null),
    }),
    [at],
  );
  return { tip, handlers };
}

function ChartTip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  // Kept inside the chart: a tooltip that runs off the card is unreadable.
  const left = Math.min(Math.max(tip.x, 90), width - 90);
  return (
    <div className="viz-tip" style={{ left, top: tip.y }} role="status">
      <div className="viz-tip-title">{tip.title}</div>
      {tip.lines.map((line) => (
        <div key={line.label} className="viz-tip-row">
          <strong>{line.value}</strong>
          <span>{line.label}</span>
        </div>
      ))}
    </div>
  );
}

function Figure({
  title,
  caption,
  legend,
  children,
  table,
}: {
  title: string;
  caption?: string;
  legend?: ReactNode;
  children: ReactNode;
  /** The chart's table equivalent; omit when the page already shows one beside it. */
  table?: ReactNode;
}) {
  return (
    <figure className="viz">
      <figcaption>
        <span className="viz-title">{title}</span>
        {caption && <span className="viz-caption">{caption}</span>}
        {legend}
      </figcaption>
      {children}
      {table && (
        <details className="viz-table">
          <summary>Show as table</summary>
          {table}
        </details>
      )}
    </figure>
  );
}

/** Clean axis ticks: 1, 2, 5 or 10 × a power of ten, about `count` of them. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

const versus = (game: GameLength | null) =>
  game ? `vs ${game.opponent}, ${formatDate(game.date)}` : '';

/* ------------------------------------------------------------------ */
/* Game time: shortest — average — longest                             */
/* ------------------------------------------------------------------ */

const RANGE_ROW = 46;
/** Pixels a minute tick needs so its label never touches the next one. */
const MIN_TICK_GAP = 44;

/**
 * A range per row — shortest to longest game, with the average marked — for
 * all games, the wins and the losses, on one shared minute axis.
 */
export function GameTimeRange({ rows }: { rows: { label: string; summary: DurationSummary }[] }) {
  const [ref, width] = useWidth();
  const { tip, handlers } = useTip(ref);
  const present = rows.filter((row) => row.summary.shortest && row.summary.longest);
  if (present.length === 0) return null;

  const minMinutes = Math.min(...present.map((r) => r.summary.shortest!.seconds / 60));
  const maxMinutes = Math.max(...present.map((r) => r.summary.longest!.seconds / 60));
  const lo = Math.floor(minMinutes / 5) * 5;
  const hi = Math.max(lo + 5, Math.ceil(maxMinutes / 5) * 5);
  // Narrower gutters on a phone, so the plot keeps most of the width.
  const narrow = width < 520;
  const labelWidth = narrow ? 70 : 84;
  const pad = narrow ? 42 : 48;
  const plotLeft = labelWidth + pad;
  const plotRight = width - pad;
  const x = (seconds: number) => plotLeft + ((seconds / 60 - lo) / (hi - lo)) * (plotRight - plotLeft);
  const height = rows.length * RANGE_ROW + 30;
  // Every 5 minutes when there is room, else every 10, so tick labels never collide.
  const tickStep = ((plotRight - plotLeft) / (hi - lo)) * 5 >= MIN_TICK_GAP ? 5 : 10;
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / tickStep) * tickStep; m <= hi; m += tickStep) ticks.push(m);

  return (
    <Figure
      title="Game time"
      caption="shortest to longest, with the average marked"
      legend={
        <span className="viz-legend">
          <span className="viz-key viz-key--hollow" aria-hidden="true" /> shortest / longest
          <span className="viz-key viz-key--dot" aria-hidden="true" /> average
        </span>
      }
      table={
        <table className="team-stat-table">
          <thead>
            <tr>
              <th scope="col">Games</th>
              <th scope="col">Average</th>
              <th scope="col">Shortest</th>
              <th scope="col">Longest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, summary }) => (
              <tr key={label}>
                <th scope="row">
                  {label} ({summary.sample})
                </th>
                <td>{formatDuration(summary.average)}</td>
                <td>
                  {formatDuration(summary.shortest?.seconds ?? null)} <span className="dim">{versus(summary.shortest)}</span>
                </td>
                <td>
                  {formatDuration(summary.longest?.seconds ?? null)} <span className="dim">{versus(summary.longest)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} className="viz-svg">
          {ticks.map((m) => (
            <g key={m}>
              <line className="viz-grid" x1={x(m * 60)} x2={x(m * 60)} y1={4} y2={height - 24} />
              <text className="viz-tick" x={x(m * 60)} y={height - 8} textAnchor="middle">
                {m}m
              </text>
            </g>
          ))}
          {rows.map(({ label, summary }, index) => {
            const cy = index * RANGE_ROW + RANGE_ROW / 2 + 4;
            const { shortest, longest, average } = summary;
            const lines: TipLine[] = [
              { value: formatDuration(average), label: 'average' },
              { value: formatDuration(shortest?.seconds ?? null), label: `shortest ${versus(shortest)}` },
              { value: formatDuration(longest?.seconds ?? null), label: `longest ${versus(longest)}` },
            ];
            return (
              <g key={label} className="viz-row" {...handlers(`${label} · ${summary.sample} games`, lines)}>
                {/* The whole row is the hit target, not the 2px line. */}
                <rect className="viz-hit" x={0} y={cy - RANGE_ROW / 2} width={width} height={RANGE_ROW} />
                <text className="viz-label" x={0} y={cy + 4}>
                  {label}
                </text>
                {shortest && longest && average !== null ? (
                  <>
                    <line className="viz-range" x1={x(shortest.seconds)} x2={x(longest.seconds)} y1={cy} y2={cy} />
                    <circle className="viz-end" cx={x(shortest.seconds)} cy={cy} r={4} />
                    <circle className="viz-end" cx={x(longest.seconds)} cy={cy} r={4} />
                    <circle className="viz-avg" cx={x(average)} cy={cy} r={6} />
                    <text className="viz-value" x={x(shortest.seconds) - 9} y={cy + 4} textAnchor="end">
                      {formatDuration(shortest.seconds)}
                    </text>
                    <text className="viz-value" x={x(longest.seconds) + 9} y={cy + 4}>
                      {formatDuration(longest.seconds)}
                    </text>
                    <text className="viz-value viz-value--strong" x={x(average)} y={cy - 11} textAnchor="middle">
                      {formatDuration(average)}
                    </text>
                  </>
                ) : (
                  <text className="viz-tick" x={plotLeft} y={cy + 4}>
                    no games
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <ChartTip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* Wins and losses by game length                                      */
/* ------------------------------------------------------------------ */

const bucketLabel = (bucket: LengthBucket) =>
  bucket.from === null ? `under ${bucket.to}` : bucket.to === null ? `${bucket.from}+` : `${bucket.from}–${bucket.to}`;
const winShare = (bucket: LengthBucket) => {
  const games = bucket.wins + bucket.losses;
  return games ? `${Math.round((bucket.wins / games) * 100)}%` : '—';
};

/**
 * Games per length bucket with the wins at the baseline, so the win counts
 * compare straight across buckets, and the losses stacked above in gray.
 */
export function WinsByLength({ buckets }: { buckets: LengthBucket[] }) {
  const [ref, width] = useWidth();
  const { tip, handlers } = useTip(ref);
  const top = Math.max(1, ...buckets.map((b) => b.wins + b.losses));
  const step = niceStep(top, 4);
  const yMax = Math.ceil(top / step) * step;
  const plotTop = 22;
  const plotBottom = 190;
  const left = 34;
  const right = width - 8;
  const slot = (right - left) / buckets.length;
  const barWidth = Math.min(24, slot * 0.5);
  const y = (count: number) => plotBottom - (count / yMax) * (plotBottom - plotTop);
  const height = plotBottom + 46;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);

  return (
    <Figure
      title="Wins and losses by game length"
      caption="minutes · win rate under each bar"
      legend={
        <span className="viz-legend">
          <span className="viz-key viz-key--accent" aria-hidden="true" /> Wins
          <span className="viz-key viz-key--context" aria-hidden="true" /> Losses
        </span>
      }
      table={
        <table className="team-stat-table">
          <thead>
            <tr>
              <th scope="col">Minutes</th>
              <th scope="col">Wins</th>
              <th scope="col">Losses</th>
              <th scope="col">Won</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucketLabel(bucket)}>
                <th scope="row">{bucketLabel(bucket)}</th>
                <td>{bucket.wins}</td>
                <td>{bucket.losses}</td>
                <td>{winShare(bucket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} className="viz-svg">
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'viz-axis' : 'viz-grid'} x1={left} x2={right} y1={y(v)} y2={y(v)} />
              <text className="viz-tick" x={left - 6} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {buckets.map((bucket, index) => {
            const cx = left + slot * index + slot / 2;
            const games = bucket.wins + bucket.losses;
            const winTop = y(bucket.wins);
            const lossTop = y(games);
            // A 2px surface gap between the two segments; only the top one is rounded.
            const gap = bucket.wins > 0 && bucket.losses > 0 ? 2 : 0;
            const label = bucketLabel(bucket);
            return (
              <g
                key={label}
                className="viz-col"
                {...handlers(`${label} min · ${games} games`, [
                  { value: String(bucket.wins), label: 'wins' },
                  { value: String(bucket.losses), label: 'losses' },
                  { value: winShare(bucket), label: 'won' },
                ])}
              >
                <rect className="viz-hit" x={cx - slot / 2} y={plotTop - 18} width={slot} height={height - plotTop + 18} />
                {bucket.wins > 0 && (
                  <path className="viz-bar viz-bar--accent" d={barPath(cx - barWidth / 2, winTop, barWidth, plotBottom - winTop, bucket.losses === 0)} />
                )}
                {bucket.losses > 0 && (
                  <path className="viz-bar viz-bar--context" d={barPath(cx - barWidth / 2, lossTop, barWidth, winTop - lossTop - gap, true)} />
                )}
                {games > 0 && (
                  <text className="viz-value" x={cx} y={lossTop - 6} textAnchor="middle">
                    {bucket.wins}–{bucket.losses}
                  </text>
                )}
                <text className="viz-tick viz-tick--strong" x={cx} y={plotBottom + 18} textAnchor="middle">
                  {label}
                </text>
                <text className="viz-tick" x={cx} y={plotBottom + 36} textAnchor="middle">
                  {games ? `won ${winShare(bucket)}` : 'no games'}
                </text>
              </g>
            );
          })}
        </svg>
        <ChartTip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/** A bar with a 4px rounded data-end and a square base. */
function barPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  if (h <= 0) return '';
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** The same with the rounded end at the bottom, for bars that grow downward. */
function barPathDown(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
}

/* ------------------------------------------------------------------ */
/* Gold lead or deficit by minute                                      */
/* ------------------------------------------------------------------ */

const signedGold = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString()}`;

/** Average gold lead (up) or deficit (down) at each mark, from a zero baseline. */
export function GoldLeadChart({ marks }: { marks: GoldMark[] }) {
  const [ref, width] = useWidth();
  const { tip, handlers } = useTip(ref);
  const present = marks.filter((m) => m.diff !== null);
  if (present.length === 0) return null;

  const extent = Math.max(100, ...present.map((m) => Math.abs(m.diff!)));
  const step = niceStep(extent, 2);
  const yMax = Math.ceil(extent / step) * step;
  const plotTop = 24;
  const plotBottom = 184;
  const zero = (plotTop + plotBottom) / 2;
  const left = 56;
  const right = width - 8;
  const slot = (right - left) / marks.length;
  const barWidth = Math.min(24, slot * 0.5);
  const scale = (plotBottom - plotTop) / 2 / yMax;
  const height = plotBottom + 30;
  const ticks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];

  return (
    <Figure title="Gold lead by minute" caption="average lead (up) or deficit (down) against the opponent">
      <div className="viz-plot" ref={ref}>
        <svg width={width} height={height} className="viz-svg">
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'viz-axis' : 'viz-grid'} x1={left} x2={right} y1={zero - v * scale} y2={zero - v * scale} />
              <text className="viz-tick" x={left - 6} y={zero - v * scale + 4} textAnchor="end">
                {v === 0 ? '0' : signedGold(v)}
              </text>
            </g>
          ))}
          {marks.map((mark, index) => {
            const cx = left + slot * index + slot / 2;
            const diff = mark.diff;
            return (
              <g
                key={mark.minute}
                className="viz-col"
                {...handlers(`${mark.minute} minutes · ${mark.sample} games`, [
                  { value: diff === null ? '—' : signedGold(diff), label: diff !== null && diff < 0 ? 'average deficit' : 'average lead' },
                  { value: mark.gold === null ? '—' : Math.round(mark.gold).toLocaleString(), label: 'team gold' },
                ])}
              >
                <rect className="viz-hit" x={cx - slot / 2} y={plotTop - 20} width={slot} height={height - plotTop + 20} />
                {diff !== null && diff >= 0 && (
                  <path className="viz-bar viz-bar--accent" d={barPath(cx - barWidth / 2, zero - diff * scale, barWidth, diff * scale, true)} />
                )}
                {diff !== null && diff < 0 && (
                  <path className="viz-bar viz-bar--accent" d={barPathDown(cx - barWidth / 2, zero, barWidth, -diff * scale)} />
                )}
                {diff !== null && (
                  <text
                    className="viz-value viz-value--strong"
                    x={cx}
                    y={diff >= 0 ? zero - diff * scale - 7 : zero - diff * scale + 15}
                    textAnchor="middle"
                  >
                    {signedGold(diff)}
                  </text>
                )}
                <text className="viz-tick viz-tick--strong" x={cx} y={plotBottom + 22} textAnchor="middle">
                  {mark.minute} min
                </text>
              </g>
            );
          })}
        </svg>
        <ChartTip tip={tip} width={width} />
      </div>
    </Figure>
  );
}
