import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

/*
 * Pieces shared by the Team Stat and Tournament charts: a width-tracking plot
 * box, one tooltip per chart (hover and keyboard focus alike), the figure
 * frame with its "Show as table" equivalent, clean tick steps and bar paths
 * with a rounded data-end. Charts are inline SVG laid out at the measured
 * width, so text stays at reading size on a phone.
 */

/**
 * The plot box's width, kept current. `attach` is a callback ref, so a chart
 * that first renders nothing (no games yet) still measures once it draws.
 */
export function useWidth(fallback = 640) {
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

export interface TipLine {
  value: string;
  label: string;
}

export interface Tip {
  x: number;
  y: number;
  title: string;
  lines: TipLine[];
  /** Under the mark instead of above it, for marks near the top of a chart. */
  below?: boolean;
}

/** One tooltip per chart, placed above the hovered or focused mark. */
export function useTip(container: React.RefObject<HTMLDivElement | null>) {
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

export function ChartTip({ tip, width }: { tip: Tip | null; width: number }) {
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

export function Figure({
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
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}


/** A bar with a 4px rounded data-end and a square base. */
export function barPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  if (h <= 0) return '';
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** The same with the rounded end at the bottom, for bars that grow downward. */
export function barPathDown(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
}

/** `1234` -> `+1,234`, `-1234` -> `−1,234`. */
export const signedGold = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString()}`;
