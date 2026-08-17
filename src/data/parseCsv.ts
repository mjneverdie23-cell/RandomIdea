/**
 * CSV reading.
 *
 * Oracle's Elixir yearly exports are large — the 2026 file is 58 MB, 90k rows
 * and 165 columns — so files are read incrementally and each row is immediately
 * slimmed down to the ~25 columns this app actually uses. Keeping whole rows
 * would cost an order of magnitude more memory for no gain.
 *
 * Headers are normalized here rather than through papaparse's `transformHeader`
 * hook, memoized per raw header name so it costs one map lookup per cell rather
 * than a regex.
 */

import Papa from 'papaparse';
import { isKeptColumn, normalizeHeader, type RawRow } from './oracleSchema.ts';

export interface ParsedCsv {
  /** Normalized header names, in file order. */
  headers: string[];
  rows: RawRow[];
}

export interface ParseProgress {
  rows: number;
  /** 0-1 when the total size is known, otherwise `null`. */
  fraction: number | null;
}

export class CsvParseError extends Error {
  /** When true, retrying on the main thread would fail the same way. */
  readonly fatal: boolean = false;

  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** Marks errors that shouldn't trigger the non-worker retry. */
class FatalCsvParseError extends CsvParseError {
  override readonly fatal = true;
}

/** raw header -> normalized name, or `null` for columns we discard. */
const headerMap = new Map<string, string | null>();

function mapHeader(raw: string): string | null {
  const cached = headerMap.get(raw);
  if (cached !== undefined) return cached;
  const normalized = normalizeHeader(raw);
  const mapped = isKeptColumn(normalized) ? normalized : null;
  headerMap.set(raw, mapped);
  return mapped;
}

/** Reduce a parsed row to the columns used downstream, under normalized keys. */
function slimRow(row: Record<string, unknown>): RawRow {
  const slim: RawRow = {};
  for (const key in row) {
    const mapped = mapHeader(key);
    if (!mapped) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    slim[mapped] = typeof value === 'string' ? value : String(value);
  }
  return slim;
}

/** Synchronous parse for small inputs: the demo dataset and unit tests. */
export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (result.errors.length && result.data.length === 0) {
    const first = result.errors[0];
    throw new CsvParseError('Could not read the CSV.', first?.message);
  }
  return {
    headers: (result.meta.fields ?? []).map(normalizeHeader),
    rows: result.data.map(slimRow),
  };
}

/**
 * Bytes read and parsed per turn of the event loop.
 *
 * papaparse defaults to 10 MB for a local file, which parses in one long
 * synchronous burst and visibly freezes the page several times during a big
 * import. Smaller chunks cost a little throughput and buy a UI that keeps
 * painting its progress bar the whole way through.
 */
const CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * Stream a `File` from an `<input type="file">` / drop event.
 *
 * Deliberately parses on the main thread rather than in a worker. papaparse
 * builds its worker by stringifying its own module factory
 * (`moduleFactory.toString()`) into a blob URL, and a bundler's minifier
 * rewrites that factory so the copy running in the worker no longer matches the
 * scope it was compiled against. On a real 58 MB Oracle's Elixir export it died
 * inside papaparse's own header handling with `charCodeAt is not a function` —
 * and because an uncaught throw inside the worker reaches neither the `error`
 * nor the `complete` callback, the import spinner ran forever with nothing to
 * report. Measured on that file: worker path 26.8s (with a stall watchdog to
 * escape the hang), main thread 16.7s and no error at all.
 *
 * The file is still read incrementally, so memory stays flat and progress is
 * reported throughout.
 */
export function parseCsvFile(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    const rows: RawRow[] = [];
    let headers: string[] = [];
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: 'greedy',
        chunkSize: CHUNK_BYTES,
        chunk: (results, parser) => {
          if (settled) {
            parser.abort();
            return;
          }
          if (!headers.length && results.meta.fields) {
            headers = results.meta.fields.map(normalizeHeader);
          }
          for (const row of results.data) rows.push(slimRow(row));
          onProgress?.({
            rows: rows.length,
            fraction: file.size > 0 ? Math.min(1, results.meta.cursor / file.size) : null,
          });
        },
        error: (error: Error) => fail(new CsvParseError('Could not read the CSV file.', error.message)),
        complete: () => {
          if (settled) return;
          if (!headers.length) {
            fail(new FatalCsvParseError('The file appears to be empty or has no header row.'));
            return;
          }
          settled = true;
          resolve({ headers, rows });
        },
      });
    } catch (cause) {
      fail(
        new CsvParseError(
          'Could not read the CSV file.',
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    }
  });
}
