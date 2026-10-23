import { useId, useState, type KeyboardEvent } from 'react';
import type { Game } from '../../domain/types.ts';
import { formatDuration } from '../../lib/format.ts';
import type { GoldPoint, GoldStory } from '../../predictor/tournament.ts';
import { ChartTip, Figure, niceStep, useWidth, type Tip } from '../charts/kit.tsx';

/** `25` -> `25:00`, `32.5` -> `32:30`. */
const clock = (minute: number) => formatDuration(Math.round(minute * 60));

/**
 * One game's gold, the way a broadcast gold graph reads: above the line the
 * blue side is ahead, below it the red side, and the line and its wash take
 * the colour of whoever leads. Only the dots are measured — Oracle's Elixir
 * records 10, 15, 20 and 25 minutes and the end-of-game totals — so the line
 * between them is a straight join, and the caption says so.
 */
export function GoldGraph({ game, story }: { game: Game; story: GoldStory }) {
  const { attach, width } = useWidth(560);
  const uid = useId().replace(/[^\w-]/g, '');
  const [active, setActive] = useState<number | null>(null);
  const { points } = story;
  const blue = game.blue.teamName;
  const red = game.red.teamName;

  const narrow = width < 480;
  const left = 50;
  const right = width - 14;
  const top = 18;
  const bottom = narrow ? 168 : 196;
  const height = bottom + 28;
  const lastMinute = points.at(-1)!.minute;
  const xMax = Math.max(10, Math.ceil(lastMinute / 5) * 5);
  const x = (minute: number) => left + (minute / xMax) * (right - left);
  const extent = Math.max(1000, ...points.map((point) => Math.abs(point.diff)));
  // Four steps of headroom, so a one-sided game still fills most of its half.
  const step = niceStep(extent, 4);
  const yMax = Math.ceil(extent / step) * step;
  const zero = (top + bottom) / 2;
  const y = (diff: number) => zero - (diff / yMax) * (zero - top);
  const yTicks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];
  const xStep = (right - left) / xMax * 5 >= 34 ? 5 : 10;
  const xTicks: number[] = [];
  for (let minute = 0; minute <= xMax; minute += xStep) xTicks.push(minute);

  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.minute).toFixed(1)},${y(point.diff).toFixed(1)}`).join('');
  const area = `${line}L${x(lastMinute).toFixed(1)},${zero}L${x(0)},${zero}Z`;
  const above = `gold-above-${uid}`;
  const below = `gold-below-${uid}`;

  const leaderOf = (point: GoldPoint) => (point.diff > 0 ? blue : point.diff < 0 ? red : null);
  const describe = (point: GoldPoint, index: number) => {
    const end = story.hasEnd && index === points.length - 1;
    const leader = leaderOf(point);
    return {
      title: end ? `End of game · ${clock(point.minute)}` : `${point.minute} minutes`,
      lines: [
        leader
          ? { value: `+${Math.abs(Math.round(point.diff)).toLocaleString()}`, label: `${leader} ahead` }
          : { value: 'Even', label: 'gold level' },
      ],
    };
  };

  // Hover and keyboard move between the measured points; 0:00 is not one.
  const measured = points.map((_, index) => index).slice(1);
  const current = active !== null && measured.includes(active) ? active : null;
  let tip: Tip | null = null;
  if (current !== null) {
    const point = points[current]!;
    const { title, lines } = describe(point, current);
    tip = { x: x(point.minute), y: y(point.diff), title, lines, below: y(point.diff) < 80 };
  }
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const minute = ((clientX - box.left - left) / (right - left)) * xMax;
    let best = measured[0]!;
    for (const index of measured) {
      if (Math.abs(points[index]!.minute - minute) < Math.abs(points[best]!.minute - minute)) best = index;
    }
    setActive(best);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const position = current === null ? measured.length - 1 : measured.indexOf(current);
    const next =
      event.key === 'ArrowLeft' ? position - 1 : event.key === 'ArrowRight' ? position + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? measured.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(measured[Math.min(measured.length - 1, Math.max(0, next))]!);
  };

  // Direct labels on the moments that matter: each side's biggest lead, and the end.
  const labelled = new Set<number>();
  for (const moment of [story.biggestLead.blue, story.biggestLead.red]) {
    if (moment) labelled.add(points.findIndex((point) => point.minute === moment.minute));
  }
  labelled.add(points.length - 1);
  labelled.delete(0);

  return (
    <Figure
      title="Gold"
      caption={`lead at 10, 15, 20, 25 min${story.hasEnd ? ' and at the end' : ''} · straight lines between`}
      legend={
        <span className="viz-legend">
          <span className="viz-key viz-key--blue" aria-hidden="true" /> {blue} ahead
          <span className="viz-key viz-key--red" aria-hidden="true" /> {red} ahead
        </span>
      }
      table={
        <table className="team-stat-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Ahead</th>
              <th scope="col">Lead</th>
            </tr>
          </thead>
          <tbody>
            {points.slice(1).map((point, index) => (
              <tr key={point.minute}>
                <th scope="row">{describe(point, index + 1).title}</th>
                <td>{leaderOf(point) ?? 'Even'}</td>
                <td>{Math.abs(Math.round(point.diff)).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="viz-plot" ref={attach}>
        <svg
          width={width}
          height={height}
          className="viz-svg viz-trend"
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`Gold lead through the game, ${blue} against ${red}. Left and right arrow keys step through the measured points.`}
          onPointerMove={(event) => nearest(event.clientX, event.currentTarget)}
          onPointerDown={(event) => nearest(event.clientX, event.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((index) => index ?? points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <defs>
            <clipPath id={above}>
              <rect x={0} y={0} width={width} height={zero} />
            </clipPath>
            <clipPath id={below}>
              <rect x={0} y={zero} width={width} height={height - zero} />
            </clipPath>
          </defs>
          <rect className="viz-hit" x={0} y={0} width={width} height={height} />

          {yTicks.map((value) => (
            <g key={value}>
              <line className={value === 0 ? 'viz-axis' : 'viz-grid'} x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text className="viz-tick" x={left - 6} y={y(value) + 4} textAnchor="end">
                {Math.abs(value).toLocaleString()}
              </text>
            </g>
          ))}
          {xTicks.map((minute) => (
            <text key={minute} className="viz-tick" x={x(minute)} y={height - 6} textAnchor="middle">
              {minute}m
            </text>
          ))}

          <path d={area} className="gold-wash gold-wash--blue" clipPath={`url(#${above})`} />
          <path d={area} className="gold-wash gold-wash--red" clipPath={`url(#${below})`} />
          <path d={line} className="gold-line gold-line--blue" clipPath={`url(#${above})`} />
          <path d={line} className="gold-line gold-line--red" clipPath={`url(#${below})`} />

          {current !== null && (
            <line className="viz-cross-line" x1={x(points[current]!.minute)} x2={x(points[current]!.minute)} y1={top} y2={bottom} />
          )}

          {points.slice(1).map((point, offset) => {
            const index = offset + 1;
            const tone = point.diff > 0 ? 'blue' : point.diff < 0 ? 'red' : 'even';
            const labelY = point.diff >= 0 ? y(point.diff) - 10 : y(point.diff) + 18;
            const end = index === points.length - 1;
            return (
              <g key={point.minute}>
                <circle
                  className={`gold-dot gold-dot--${tone}${index === current ? ' is-active' : ''}`}
                  cx={x(point.minute)}
                  cy={y(point.diff)}
                  r={index === current ? 6 : 4.5}
                />
                {labelled.has(index) && point.diff !== 0 && (
                  <text
                    className="viz-value viz-value--strong"
                    x={x(point.minute)}
                    y={labelY}
                    textAnchor={end && x(point.minute) > right - 30 ? 'end' : 'middle'}
                  >
                    {`+${(Math.abs(point.diff) / 1000).toFixed(1)}k`}
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
