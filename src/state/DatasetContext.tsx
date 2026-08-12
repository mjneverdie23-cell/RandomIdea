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
import { refreshDataDragonVersion } from '../domain/champions.ts';
import { MetaIndex } from '../meta/patchMeta.ts';
import { computeAvailability, type Availability } from '../quiz/generator.ts';
import { clearStoredDataset, loadStoredDataset, saveDataset } from '../storage/datasetStore.ts';
import type { Dataset } from '../domain/types.ts';

export interface ImportProgress {
  /** File currently being read. */
  fileName: string;
  fileIndex: number;
  fileCount: number;
  rows: number;
  fraction: number | null;
  phase: 'reading' | 'normalizing' | 'saving';
}

export interface DatasetContextValue {
  dataset: Dataset | null;
  status: 'loading' | 'ready';
  /** True while the app is showing the bundled synthetic dataset. */
  isDemo: boolean;
  availability: Availability;
  metaIndex: MetaIndex;
  /** Import one or more Oracle's Elixir CSVs, replacing the current dataset. */
  importFiles: (
    files: File[],
    onProgress?: (progress: ImportProgress) => void,
  ) => Promise<Dataset>;
  /** Discard an imported dataset and go back to the demo data. */
  resetToDemo: () => Promise<void>;
  /** True when the last import could not be persisted (quota/private mode). */
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
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [persisted, setPersisted] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // Non-blocking: art still resolves against the pinned fallback version.
    void refreshDataDragonVersion(controller.signal);

    void (async () => {
      const stored = await loadStoredDataset();
      if (cancelled) return;
      setDataset(stored ?? buildDemoDataset());
      setStatus('ready');
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const importFiles = useCallback(
    async (files: File[], onProgress?: (progress: ImportProgress) => void): Promise<Dataset> => {
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

      onProgress?.({
        fileName: files.map((f) => f.name).join(', '),
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

      const next: Dataset = {
        games,
        stats,
        source: {
          kind: 'csv',
          label: files.map((file) => file.name).join(', '),
        },
        importedAt: new Date().toISOString(),
      };

      onProgress?.({
        fileName: next.source.label,
        fileIndex: files.length - 1,
        fileCount: files.length,
        rows: rows.length,
        fraction: 1,
        phase: 'saving',
      });

      setPersisted(await saveDataset(next));
      setDataset(next);
      return next;
    },
    [],
  );

  const resetToDemo = useCallback(async () => {
    await clearStoredDataset();
    setPersisted(true);
    setDataset(buildDemoDataset());
  }, []);

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
      availability,
      metaIndex,
      importFiles,
      resetToDemo,
      persisted,
    }),
    [dataset, status, availability, metaIndex, importFiles, resetToDemo, persisted],
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDataset must be used inside a <DatasetProvider>.');
  return context;
}
