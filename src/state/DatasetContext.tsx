import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { buildDemoDataset } from '../data/demoDataset.ts';
import { IngestError, ingestRows } from '../data/ingest.ts';
import { CsvParseError, parseCsvFile, type ParseProgress } from '../data/parseCsv.ts';
import {
  combineEnabledGames,
  combineStats,
  mergeImportedYears,
  sortYears,
  splitGamesByYear,
} from '../data/years.ts';
import { refreshDataDragonVersion } from '../domain/champions.ts';
import { MetaIndex } from '../meta/patchMeta.ts';
import { computeAvailability, type Availability } from '../quiz/generator.ts';
import {
  clearAllYears,
  loadStoredYears,
  removeYear as removeStoredYear,
  saveYear,
  setYearEnabled as persistYearEnabled,
  type StorageBackend,
} from '../storage/datasetStore.ts';
import type { Dataset, YearDataset } from '../domain/types.ts';

export interface ImportProgress {
  /** File currently being read. */
  fileName: string;
  fileIndex: number;
  fileCount: number;
  rows: number;
  fraction: number | null;
  phase: 'reading' | 'normalizing' | 'saving';
}

export interface ImportResult {
  /** Years the import touched, newest first. */
  years: YearDataset[];
  /** Games kept, across every year in this import. */
  gamesKept: number;
  rowsParsed: number;
  rejectedByCompetition: number;
  rejectedIncomplete: number;
  label: string;
}

export interface DatasetContextValue {
  /** Combined view of the enabled years — what the quiz plays from. */
  dataset: Dataset | null;
  status: 'loading' | 'ready';
  /** True while the app is showing the bundled synthetic dataset. */
  isDemo: boolean;
  /** Every imported year, enabled or not, newest first. */
  years: YearDataset[];
  availability: Availability;
  metaIndex: MetaIndex;
  /** Import CSVs, merging them into the per-year store rather than replacing. */
  importFiles: (
    files: File[],
    onProgress?: (progress: ImportProgress) => void,
  ) => Promise<ImportResult>;
  /** Switch a year in or out of the quiz pool without deleting it. */
  setYearEnabled: (year: string, enabled: boolean) => void;
  /** Delete a year's games entirely. */
  removeYear: (year: string) => Promise<void>;
  /** Delete every imported year and return to the demo data. */
  resetToDemo: () => Promise<void>;
  /** Where imported years are being persisted. */
  backend: StorageBackend;
  /** False when the last save could not be persisted anywhere. */
  persisted: boolean;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

const EMPTY_AVAILABILITY: Availability = {
  total: 0,
  perCompetition: {
    LCK: 0,
    LEC: 0,
    LCS: 0,
    LPL: 0,
    WORLDS: 0,
    MSI: 0,
    FIRST_STAND: 0,
    EWC: 0,
  },
};

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<YearDataset[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [backend, setBackend] = useState<StorageBackend>('memory');
  const [persisted, setPersisted] = useState(true);
  const [demo] = useState(() => buildDemoDataset());

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // Non-blocking: art still resolves against the pinned fallback version.
    void refreshDataDragonVersion(controller.signal);

    void (async () => {
      const loaded = await loadStoredYears();
      if (cancelled) return;
      setYears(loaded.years);
      setBackend(loaded.backend);
      setStatus('ready');
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const importFiles = useCallback(
    async (files: File[], onProgress?: (progress: ImportProgress) => void): Promise<ImportResult> => {
      if (files.length === 0) throw new CsvParseError('No file selected.');

      const headers = new Set<string>();
      const rows: Record<string, string>[] = [];

      for (const [index, file] of files.entries()) {
        const report = (progress: ParseProgress) =>
          onProgress?.({
            fileName: file.name,
            fileIndex: index,
            fileCount: files.length,
            rows: rows.length + progress.rows,
            fraction: progress.fraction,
            phase: 'reading',
          });

        const parsed = await parseCsvFile(file, report);
        for (const header of parsed.headers) headers.add(header);
        rows.push(...parsed.rows);
      }

      const label = files.map((file) => file.name).join(', ');
      onProgress?.({
        fileName: label,
        fileIndex: files.length - 1,
        fileCount: files.length,
        rows: rows.length,
        fraction: 1,
        phase: 'normalizing',
      });
      // Yield a frame so the progress UI paints before the synchronous ingest.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const { games, stats } = ingestRows(rows, [...headers]);
      if (games.length === 0) {
        throw new IngestError(
          'No usable games found in this file.',
          stats.rejectedByCompetition > 0
            ? `${stats.rejectedByCompetition} games were outside the eight configured competitions (LCK, LEC, LCS, LPL, Worlds, First Stand, MSI, EWC), and ${stats.rejectedIncomplete} had incomplete drafts.`
            : `${stats.rejectedIncomplete} games had incomplete drafts or no recorded winner.`,
        );
      }

      onProgress?.({
        fileName: label,
        fileIndex: files.length - 1,
        fileCount: files.length,
        rows: rows.length,
        fraction: 1,
        phase: 'saving',
      });

      // Merge into whatever is already loaded; only the touched years change.
      const touchedYears = new Set(splitGamesByYear(games).keys());
      const merged = mergeImportedYears(years, games, { label });

      let savedAnywhere = false;
      for (const year of merged) {
        if (!touchedYears.has(year.year)) continue;
        const where = await saveYear(year);
        if (where) {
          savedAnywhere = true;
          setBackend(where);
        }
      }

      setYears(merged);
      setPersisted(savedAnywhere);

      const touched = merged.filter((year) => touchedYears.has(year.year));
      return {
        years: touched,
        gamesKept: games.length,
        rowsParsed: stats.rowsParsed,
        rejectedByCompetition: stats.rejectedByCompetition,
        rejectedIncomplete: stats.rejectedIncomplete,
        label,
      };
    },
    [years],
  );

  const setYearEnabled = useCallback((year: string, enabled: boolean) => {
    setYears((current) =>
      current.map((entry) => (entry.year === year ? { ...entry, enabled } : entry)),
    );
    void persistYearEnabled(year, enabled);
  }, []);

  const removeYear = useCallback(async (year: string) => {
    await removeStoredYear(year);
    setYears((current) => current.filter((entry) => entry.year !== year));
  }, []);

  const resetToDemo = useCallback(async () => {
    await clearAllYears(years.map((year) => year.year));
    setYears([]);
    setPersisted(true);
  }, [years]);

  const enabledGames = useMemo(() => combineEnabledGames(years), [years]);

  /* With nothing imported (or every year switched off) the demo data stands in. */
  const dataset = useMemo<Dataset | null>(() => {
    if (years.length === 0) return demo;
    if (enabledGames.length === 0) {
      return {
        games: [],
        source: { kind: 'csv', label: 'No years enabled' },
        importedAt: sortYears(years)[0]?.importedAt ?? new Date().toISOString(),
        stats: combineStats(years, []),
      };
    }
    const enabled = years.filter((year) => year.enabled);
    return {
      games: enabledGames,
      source: {
        kind: 'csv',
        label: `${enabled.map((year) => year.year).join(', ')} · ${enabled.length} season${enabled.length === 1 ? '' : 's'}`,
      },
      importedAt: sortYears(enabled)[0]?.importedAt ?? new Date().toISOString(),
      stats: combineStats(years, enabledGames),
    };
  }, [years, enabledGames, demo]);

  const availability = useMemo(
    () => (dataset ? computeAvailability(dataset.games) : EMPTY_AVAILABILITY),
    [dataset],
  );

  const metaIndex = useMemo(() => new MetaIndex(dataset?.games ?? []), [dataset]);

  const value = useMemo<DatasetContextValue>(
    () => ({
      dataset,
      status,
      isDemo: dataset?.source.kind === 'demo',
      years: sortYears(years),
      availability,
      metaIndex,
      importFiles,
      setYearEnabled,
      removeYear,
      resetToDemo,
      backend,
      persisted,
    }),
    [
      dataset,
      status,
      years,
      availability,
      metaIndex,
      importFiles,
      setYearEnabled,
      removeYear,
      resetToDemo,
      backend,
      persisted,
    ],
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDataset must be used inside a <DatasetProvider>.');
  return context;
}
