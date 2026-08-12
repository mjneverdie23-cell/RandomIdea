/**
 * CSV reading.
 *
 * Oracle's Elixir yearly exports are large (hundreds of thousands of rows,
 * ~130 columns), so files are streamed in chunks off the main thread and each
 * row is immediately slimmed down to the ~20 columns this app actually uses.
 * Keeping whole rows would cost an order of magnitude more memory for no gain.
 *
 * Note on headers: papaparse's worker mode posts its config to the worker with
 * `structuredClone`, so function options like `transformHeader` cannot be used
 * there. Header normalization therefore happens on this side, memoized per raw
 * header name so it costs one lookup per cell rather than a regex.
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
 * Stream a `File` from an `<input type="file">` / drop event.
 *
 * Tries a worker first so a 200 MB import doesn't freeze the page; if workers
 * are unavailable (CSP, older browsers) it transparently retries on the main
 * thread, which still reads the file in chunks.
 */
export async function parseCsvFile(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParsedCsv> {
  try {
    return await streamCsv(file, true, onProgress);
  } catch (cause) {
    if (cause instanceof CsvParseError && cause.fatal) throw cause;
    return streamCsv(file, false, onProgress);
  }
}

function streamCsv(
  file: File,
  useWorker: boolean,
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
        worker: useWorker,
        chunk: (results, parser) => {
          if (!headers.length && results.meta.fields) {
            headers = results.meta.fields.map(normalizeHeader);
          }
          for (const row of results.data) rows.push(slimRow(row));
          onProgress?.({
            rows: rows.length,
            fraction: file.size > 0 ? Math.min(1, results.meta.cursor / file.size) : null,
          });
          if (settled) parser.abort();
        },
        error: (error: Error) => fail(new CsvParseError('Could not read the CSV file.', error.message)),
        complete: () => {
          if (settled) return;
          if (!headers.length) {
            fail(
              new FatalCsvParseError('The file appears to be empty or has no header row.'),
            );
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
