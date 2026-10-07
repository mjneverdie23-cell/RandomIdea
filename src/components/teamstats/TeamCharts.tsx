import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { competitionLabel, competitionShort } from '../../domain/competitions.ts';
import type { CompetitionId } from '../../domain/types.ts';
import { formatDate, formatDuration } from '../../lib/format.ts';
import {
  ROLLING_GAMES,
  rollingMean,
  type DurationSummary,
  type GameLength,
  type GoldMark,
  type LengthBucket,
  type TimelineGame,
} from '../../predictor/teamStats.ts';

/*
 * Charts for the Team Stat page, drawn as inline SVG.
 *
 * One accent hue (`--viz-accent`) for the data the chart is about and one
 * context gray (`--viz-context`) for what it is compared against — emphasis
 * rather than a categorical palette, because each bar and line chart here has
 * one story. Only the donuts colour by category: a light-to-dark ramp when the
 * slices have an order (game length, pocket picks), distinct hues when they
 * don't (competitions). Marks are thin, gridlines are solid hairlines, values sit on the marks that
 * matter, and every mark has a hover/focus tooltip plus a table equivalent, so
 * nothing is readable by colour or hover alone. The SVG is laid out at the
 * container's measured width so text stays at reading size on a phone.
 */

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/**
 * The plot box's width, kept current. `attach` is a callback ref, so a chart
 * that first renders nothing (no games yet) still measures once it draws.
 */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  const attach = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    setNode(element);
  }, []);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setWidth(Math.max(260, Math.floor(node.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref, attach, width };
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
  /** Under the mark instead of above it, for marks near the top of a chart. */
  below?: boolean;
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
    <div className={tip.below ? 'viz-tip viz-tip--below' : 'viz-tip'} style={{ left, top: tip.y }} role="status">
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
  const { ref, attach, width } = useWidth();
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
      <div className="viz-plot" ref={attach}>
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
  const { ref, attach, width } = useWidth();
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
      <div className="viz-plot" ref={attach}>
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
  const { ref, attach, width } = useWidth();
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
      <div className="viz-plot" ref={attach}>
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

/* ------------------------------------------------------------------ */
/* Trend over time, read like a stock chart                            */
/* ------------------------------------------------------------------ */

export type TrendMetric = 'form' | 'time' | 'gold';

interface TrendSpec {
  label: string;
  /** What the line measures, for the quote, tooltip and table. */
  noun: string;
  value: (game: TimelineGame) => number | null;
  format: (value: number) => string;
  tick: (value: number) => string;
  /** A change between two averages, unsigned; `null` when it rounds to nothing. */
  change: (change: number) => string | null;
  domain: (values: number[]) => { lo: number; hi: number; step: number };
  /** A level worth a stronger gridline: even form, no gold lead. */
  reference: number | null;
}

/** Bounds that hold every value (and `include`), at least `minSpan` wide, on clean ticks. */
function paddedDomain(values: number[], include: number | null, minSpan: number) {
  let lo = Math.min(...values, include ?? Infinity);
  let hi = Math.max(...values, include ?? -Infinity);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const step = niceStep(hi - lo, 4);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

const TREND: Record<TrendMetric, TrendSpec> = {
  form: {
    label: 'Form',
    noun: 'win rate',
    value: (game) => (game.won ? 100 : 0),
    format: (value) => `${Math.round(value)}%`,
    tick: (value) => `${value}%`,
    change: (change) => (Math.round(Math.abs(change)) ? `${Math.round(Math.abs(change))} pts` : null),
    domain: () => ({ lo: 0, hi: 100, step: 25 }),
    reference: 50,
  },
  time: {
    label: 'Game time',
    noun: 'average game time',
    value: (game) => (game.seconds ? game.seconds / 60 : null),
    format: (value) => formatDuration(value * 60),
    tick: (value) => `${value}m`,
    change: (change) => (Math.abs(change) * 60 >= 1 ? formatDuration(Math.abs(change) * 60) : null),
    domain: (values) => paddedDomain(values, null, 4),
    reference: null,
  },
  gold: {
    label: 'Gold @15',
    noun: 'gold diff at 15 min',
    value: (game) => game.gold15,
    format: signedGold,
    tick: (value) => (value === 0 ? '0' : signedGold(value)),
    change: (change) => (Math.round(Math.abs(change)) ? Math.round(Math.abs(change)).toLocaleString() : null),
    domain: (values) => paddedDomain(values, 0, 1000),
    reference: 0,
  },
};

const TREND_METRICS = Object.keys(TREND) as TrendMetric[];
/** Zoom presets, in games, like a price chart's 1M / 3M buttons. */
const TREND_RANGES = [20, 50];

function shortDate(iso: string, withYear: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(
    undefined,
    withYear ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' },
  );
}

/**
 * A team over time, read like a stock chart: the rolling 10-game average as a
 * line over a light wash, the latest value tagged on the right axis, and one
 * bar per game underneath — up for a win, down for a loss — where a price
 * chart carries its volume. A crosshair follows the pointer, or the arrow keys
 * when the chart has focus, and names the game under it.
 */
export function TrendChart({ games }: { games: TimelineGame[] }) {
  const { attach, width } = useWidth();
  const washId = `trend-wash-${useId().replace(/[^\w-]/g, '')}`;
  const [metric, setMetric] = useState<TrendMetric>('form');
  const [range, setRange] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const spec = TREND[metric];
  const rolling = useMemo(() => rollingMean(games.map(spec.value)), [games, spec]);
  // With a long history the line starts once a full window is in, like a
  // moving average: an average of the first two games swings 0 to 100 and says
  // nothing. A short history draws from the first game so there is a line.
  const warm = games.length >= ROLLING_GAMES * 2 ? ROLLING_GAMES - 1 : 0;
  const drawn = (index: number) => (index < warm ? null : (rolling[index] ?? null));

  const n = games.length;
  if (n < 2) return <p className="team-stat-note dim">Not enough games for a trend yet.</p>;

  // A preset longer than the history means all of it.
  const zoom = range !== null && range < n ? range : null;
  const start = zoom === null ? 0 : n - zoom;
  const shown = n - start;

  const narrow = width < 520;
  const left = 8;
  const gutter = 58;
  const plotRight = width - gutter;
  const slot = (plotRight - left) / shown;
  const x = (index: number) => left + slot * (index - start + 0.5);
  const plotTop = 14;
  const plotBottom = narrow ? 170 : 200;
  const stripHalf = 14;
  const stripMid = plotBottom + 22 + stripHalf;
  const height = stripMid + stripHalf + 30;

  // The y range fits the games on screen, so a zoomed view uses the full height.
  const visible = games
    .map((_, index) => drawn(index))
    .slice(start)
    .filter((value): value is number => value !== null);
  const { lo, hi, step } = visible.length ? spec.domain(visible) : { lo: 0, hi: 1, step: 1 };
  const y = (value: number) => plotBottom - ((value - lo) / (hi - lo)) * (plotBottom - plotTop);
  const yTicks = visible.length ? Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, k) => lo + k * step) : [];

  // The line and its wash, broken wherever a stretch of games has no value.
  let line = '';
  let wash = '';
  let run: string[] = [];
  let runFrom = 0;
  let runTo = 0;
  const flush = () => {
    if (run.length > 0) {
      line += `M${run.join('L')}`;
      wash += `M${runFrom.toFixed(1)},${plotBottom}L${run.join('L')}L${runTo.toFixed(1)},${plotBottom}Z`;
    }
    run = [];
  };
  for (let index = start; index < n; index++) {
    const value = drawn(index);
    if (value === null) {
      flush();
      continue;
    }
    if (run.length === 0) runFrom = x(index);
    runTo = x(index);
    run.push(`${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  }
  flush();

  // Dates under the strip, spaced to fit, with repeats dropped.
  const dateCount = Math.max(2, Math.min(shown, Math.floor((plotRight - left) / (narrow ? 84 : 110))));
  const spanDays = (Date.parse(games[n - 1]!.date) - Date.parse(games[start]!.date)) / 86_400_000;
  const withYear = spanDays > 300;
  const dateTicks: { index: number; label: string }[] = [];
  for (let k = 0; k < dateCount; k++) {
    const index = start + Math.round((k * (shown - 1)) / (dateCount - 1));
    const label = shortDate(games[index]!.date, withYear);
    if (label && label !== dateTicks.at(-1)?.label) dateTicks.push({ index, label });
  }

  const now = rolling[n - 1] ?? null;
  const before = n > ROLLING_GAMES ? (rolling[n - 1 - ROLLING_GAMES] ?? null) : null;
  const change = now !== null && before !== null ? now - before : null;
  const changeText = change === null ? null : spec.change(change);

  const current = active !== null && active >= start && active < n ? active : null;
  const clampIndex = (index: number) => Math.min(n - 1, Math.max(start, index));
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    setActive(clampIndex(start + Math.floor((clientX - box.left - left) / slot)));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const from = current ?? n - 1;
    const next =
      event.key === 'ArrowLeft'
        ? from - 1
        : event.key === 'ArrowRight'
          ? from + 1
          : event.key === 'Home'
            ? start
            : event.key === 'End'
              ? n - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(clampIndex(next));
  };

  let tip: Tip | null = null;
  if (current !== null) {
    const game = games[current]!;
    const value = rolling[current] ?? null;
    const lines: TipLine[] = [{ value: game.won ? 'Won' : 'Lost', label: competitionShort(game.competition) }];
    if (metric === 'time') lines.push({ value: formatDuration(game.seconds), label: 'this game' });
    if (metric === 'gold') lines.push({ value: game.gold15 === null ? '—' : signedGold(game.gold15), label: 'this game' });
    lines.push({
      value: value === null ? '—' : spec.format(value),
      label: `${spec.noun}, last ${Math.min(ROLLING_GAMES, current + 1)}`,
    });
    const onLine = drawn(current);
    const pointY = onLine === null ? plotTop : y(onLine);
    tip = {
      x: x(current),
      y: pointY,
      title: `${formatDate(game.date)} · vs ${game.opponent}`,
      lines,
      below: pointY < 110,
    };
  }

  const barWidth = Math.max(1, Math.min(6, slot * 0.6));
  const newestFirst = games
    .map((game, index) => ({ game, index }))
    .slice(start)
    .reverse();

  return (
    <Figure
      title={spec.label}
      caption={`rolling ${ROLLING_GAMES}-game ${spec.noun} · one bar per game below`}
      legend={
        <span className="viz-legend">
          <span className="viz-key viz-key--line" aria-hidden="true" /> {ROLLING_GAMES}-game average
          <span className="viz-key viz-key--accent" aria-hidden="true" /> Won
          <span className="viz-key viz-key--context" aria-hidden="true" /> Lost
        </span>
      }
      table={
        <table className="team-stat-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Opponent</th>
              <th scope="col">Result</th>
              <th scope="col">Game time</th>
              <th scope="col">Gold @15</th>
              <th scope="col">
                {spec.label}, last {ROLLING_GAMES}
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map(({ game, index }) => (
              <tr key={index}>
                <th scope="row">{formatDate(game.date)}</th>
                <td>{game.opponent}</td>
                <td>{game.won ? 'Won' : 'Lost'}</td>
                <td>{formatDuration(game.seconds)}</td>
                <td>{game.gold15 === null ? '—' : signedGold(game.gold15)}</td>
                <td>{rolling[index] == null ? '—' : spec.format(rolling[index]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="viz-toolbar">
        <div className="chip-row" role="group" aria-label="Measure">
          {TREND_METRICS.map((key) => (
            <button key={key} type="button" className="chip chip-sm" aria-pressed={metric === key} onClick={() => setMetric(key)}>
              {TREND[key].label}
            </button>
          ))}
        </div>
        {n > TREND_RANGES[0]! && (
          <div className="chip-row" role="group" aria-label="Range">
            {TREND_RANGES.filter((preset) => preset < n).map((preset) => (
              <button key={preset} type="button" className="chip chip-sm" aria-pressed={zoom === preset} onClick={() => setRange(preset)}>
                Last {preset}
              </button>
            ))}
            <button type="button" className="chip chip-sm" aria-pressed={zoom === null} onClick={() => setRange(null)}>
              All {n}
            </button>
          </div>
        )}
      </div>

      <div className="viz-quote">
        <strong className="viz-quote-value">{now === null ? '—' : spec.format(now)}</strong>
        <span className="viz-quote-label">
          {spec.noun} · last {Math.min(ROLLING_GAMES, n)} games
        </span>
        {change !== null && (
          <span className="viz-quote-change">
            {changeText ? `${change > 0 ? '▲' : '▼'} ${changeText}` : 'no change'} on the {ROLLING_GAMES} before
          </span>
        )}
      </div>

      <div className="viz-plot" ref={attach}>
        <svg
          width={width}
          height={height}
          className="viz-svg viz-trend"
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`${spec.label} over ${shown} games: rolling ${ROLLING_GAMES}-game ${spec.noun}, now ${
            now === null ? 'not recorded' : spec.format(now)
          }. Left and right arrow keys step through the games.`}
          onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
          onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((index) => index ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <defs>
            <linearGradient id={washId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="viz-wash-stop" stopOpacity={0.2} />
              <stop offset="1" className="viz-wash-stop" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <rect className="viz-hit" x={0} y={0} width={width} height={height} />

          {yTicks.map((value) => (
            <g key={value}>
              <line
                className={value === spec.reference ? 'viz-axis' : 'viz-grid'}
                x1={left}
                x2={plotRight}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="viz-tick" x={plotRight + 8} y={y(value) + 4}>
                {spec.tick(value)}
              </text>
            </g>
          ))}
          {dateTicks.map(({ index, label }, k) => (
            <g key={index}>
              <line className="viz-grid" x1={x(index)} x2={x(index)} y1={plotTop} y2={plotBottom} />
              <text
                className="viz-tick"
                x={x(index)}
                y={height - 6}
                textAnchor={k === 0 ? 'start' : k === dateTicks.length - 1 ? 'end' : 'middle'}
              >
                {label}
              </text>
            </g>
          ))}

          {visible.length === 0 && (
            <text className="viz-tick" x={(left + plotRight) / 2} y={(plotTop + plotBottom) / 2} textAnchor="middle">
              Not recorded for these games
            </text>
          )}
          <path d={wash} fill={`url(#${washId})`} />
          <path d={line} className="viz-line" />

          {/* Results, one bar per game: wins up in the accent, losses down in gray. */}
          <line className="viz-grid" x1={left} x2={plotRight} y1={stripMid} y2={stripMid} />
          <text className="viz-tick" x={plotRight + 8} y={stripMid - 4}>
            won
          </text>
          <text className="viz-tick" x={plotRight + 8} y={stripMid + 12}>
            lost
          </text>
          {games.slice(start).map((game, k) => {
            const index = start + k;
            const cx = x(index);
            const isActive = index === current ? ' is-active' : '';
            return game.won ? (
              <path
                key={index}
                className={`viz-bar viz-bar--accent${isActive}`}
                d={barPath(cx - barWidth / 2, stripMid - 1 - stripHalf, barWidth, stripHalf, true)}
              />
            ) : (
              <path
                key={index}
                className={`viz-bar viz-bar--context${isActive}`}
                d={barPathDown(cx - barWidth / 2, stripMid + 1, barWidth, stripHalf)}
              />
            );
          })}

          {now !== null && (
            <g className="viz-tag">
              <circle className="viz-avg" cx={x(n - 1)} cy={y(now)} r={4} />
              <rect x={plotRight + 3} y={y(now) - 9} width={gutter - 5} height={18} rx={3} />
              <text x={plotRight + 3 + (gutter - 5) / 2} y={y(now) + 4} textAnchor="middle">
                {spec.format(now)}
              </text>
            </g>
          )}

          {current !== null && (
            <g className="viz-cross" aria-hidden="true">
              <line x1={x(current)} x2={x(current)} y1={plotTop} y2={stripMid + stripHalf + 2} />
              {drawn(current) !== null && <circle className="viz-avg" cx={x(current)} cy={y(drawn(current)!)} r={5} />}
            </g>
          )}
        </svg>
        <ChartTip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */
/* Donuts: how the games split                                         */
/* ------------------------------------------------------------------ */

/** Light to dark for slices with an order — each validated as an ordinal ramp on the panel surface. */
const RAMP_5 = ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
const RAMP_3 = ['#86b6ef', '#2a78d6', '#184f95'];
/** Distinct hues for slices with no order, validated as a set on the panel surface. */
const HUES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
/** Everything past the hues, folded into one slice. */
const REST = '#64748f';

const DONUT_SIZE = 168;
const DONUT_OUTER = 80;
const DONUT_INNER = 54;

interface Slice {
  label: string;
  /** A longer name for the tooltip. */
  detail?: string;
  value: number;
  color: string;
}

/** One ring segment, clockwise from `a0` to `a1` (radians); a full turn draws the whole ring. */
function ringPath(a0: number, a1: number): string {
  const c = DONUT_SIZE / 2;
  const at = (radius: number, angle: number) =>
    `${(c + radius * Math.cos(angle)).toFixed(2)},${(c + radius * Math.sin(angle)).toFixed(2)}`;
  const [r, inner] = [DONUT_OUTER, DONUT_INNER];
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // Two circles, the inner one cut out by the even-odd rule.
    return (
      `M${at(r, 0)}A${r},${r} 0 1 1 ${at(r, Math.PI)}A${r},${r} 0 1 1 ${at(r, 0)}Z` +
      `M${at(inner, 0)}A${inner},${inner} 0 1 0 ${at(inner, Math.PI)}A${inner},${inner} 0 1 0 ${at(inner, 0)}Z`
    );
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${at(r, a0)}A${r},${r} 0 ${large} 1 ${at(r, a1)}L${at(inner, a1)}A${inner},${inner} 0 ${large} 0 ${at(inner, a0)}Z`;
}

/**
 * A part-to-whole donut with the total in the middle. The legend beside it is
 * a table of every slice's count and share, so the values never depend on
 * telling colours apart or on hovering.
 */
function Donut({ title, caption, slices, unit }: { title: string; caption?: string; slices: Slice[]; unit: string }) {
  const { ref, attach, width } = useWidth(320);
  const { tip, handlers } = useTip(ref);
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return null;

  const share = (value: number) => `${Math.round((value / total) * 100)}%`;
  const c = DONUT_SIZE / 2;
  let angle = -Math.PI / 2;
  const arcs = slices.map((slice, index) => {
    const a0 = angle;
    angle += (slice.value / total) * Math.PI * 2;
    return { slice, index, a0, a1: angle };
  });

  return (
    <Figure title={title} caption={caption}>
      <div className="viz-plot viz-donut" ref={attach}>
        <svg
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          className="viz-svg"
          role="group"
          aria-label={`${title}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(', ')}`}
        >
          {arcs
            .filter(({ slice }) => slice.value > 0)
            .map(({ slice, index, a0, a1 }) => {
              const on = handlers(slice.detail ?? slice.label, [
                { value: String(slice.value), label: unit },
                { value: share(slice.value), label: `of ${total}` },
              ]);
              return (
                <path
                  key={slice.label}
                  d={ringPath(a0, a1)}
                  fill={slice.color}
                  fillRule="evenodd"
                  className={active !== null && active !== index ? 'viz-slice is-dim' : 'viz-slice'}
                  {...on}
                  onPointerMove={(event) => {
                    on.onPointerMove(event);
                    setActive(index);
                  }}
                  onPointerLeave={() => {
                    on.onPointerLeave();
                    setActive(null);
                  }}
                  onFocus={(event) => {
                    on.onFocus(event);
                    setActive(index);
                  }}
                  onBlur={() => {
                    on.onBlur();
                    setActive(null);
                  }}
                />
              );
            })}
          <text className="viz-donut-total" x={c} y={c + 4} textAnchor="middle">
            {total.toLocaleString()}
          </text>
          <text className="viz-donut-unit" x={c} y={c + 22} textAnchor="middle">
            {unit}
          </text>
        </svg>
        <table className="viz-donut-legend">
          <tbody>
            {slices.map((slice, index) => (
              <tr
                key={slice.label}
                className={active === index ? 'is-active' : undefined}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
              >
                <th scope="row" title={slice.detail}>
                  <span className="viz-swatch" style={{ background: slice.color }} aria-hidden="true" />
                  {slice.label}
                </th>
                <td>{slice.value.toLocaleString()}</td>
                <td>{share(slice.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ChartTip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/** Games by length bucket, shortest (lightest) to longest (darkest). */
export function LengthDonut({ buckets }: { buckets: LengthBucket[] }) {
  return (
    <Donut
      title="Games by length"
      caption="minutes, shortest to longest"
      unit="games"
      slices={buckets.map((bucket, index) => ({
        label: `${bucketLabel(bucket)} min`,
        value: bucket.wins + bucket.losses,
        color: RAMP_5[Math.min(index, RAMP_5.length - 1)]!,
      }))}
    />
  );
}

/** Drafts by how many pocket picks they had, judged on each game's own patch. */
export function PocketDonut({ split }: { split: { allMeta: number; one: number; twoPlus: number } }) {
  return (
    <Donut
      title="Drafts by pocket picks"
      caption="off the meta of each game's patch"
      unit="drafts"
      slices={[
        { label: 'All meta', value: split.allMeta, color: RAMP_3[0]! },
        { label: '1 pocket pick', value: split.one, color: RAMP_3[1]! },
        { label: '2 or more', value: split.twoPlus, color: RAMP_3[2]! },
      ]}
    />
  );
}

/** Games by competition, largest first; past five, the smallest share one gray slice. */
export function CompetitionDonut({ competitions }: { competitions: { id: CompetitionId; games: number }[] }) {
  const named = competitions.length > HUES.length ? competitions.slice(0, HUES.length - 1) : competitions;
  const rest = competitions.slice(named.length);
  const slices: Slice[] = named.map((comp, index) => ({
    label: competitionShort(comp.id),
    detail: competitionLabel(comp.id),
    value: comp.games,
    color: HUES[index]!,
  }));
  if (rest.length > 0) {
    slices.push({
      label: `${rest.length} more`,
      detail: rest.map((comp) => competitionShort(comp.id)).join(', '),
      value: rest.reduce((sum, comp) => sum + comp.games, 0),
      color: REST,
    });
  }
  return <Donut title="Games by competition" unit="games" slices={slices} />;
}
