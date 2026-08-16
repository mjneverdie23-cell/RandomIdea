/**
 * Dev/preview middleware that persists filtered datasets to the project folder.
 *
 * A browser page can't write to disk on its own, so the Vite server exposes a
 * tiny endpoint and the app mirrors every imported year into `data/<year>.json`
 * as it is saved. That means the filtered data survives clearing browser
 * storage, can be copied between machines, and is inspectable as plain JSON.
 *
 * Only the normalized, competition-filtered games are written — never the
 * source CSV. When the app is served as static files this endpoint isn't
 * there, and it falls back to IndexedDB on its own.
 *
 *   GET    /__draftcall/datasets          -> { years: YearSummary[] }
 *   GET    /__draftcall/datasets/:year    -> YearDataset
 *   PUT    /__draftcall/datasets/:year    -> write data/<year>.json
 *   PATCH  /__draftcall/datasets/:year    -> { enabled } switch only
 *   DELETE /__draftcall/datasets/:year    -> remove the file
 */

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const ROUTE = '/__draftcall/datasets';
/** Years are four digits; nothing else may become a file name. */
const YEAR_PATTERN = /^\d{4}$/;
/** A full season of eight competitions is a few MB of JSON; leave headroom. */
const MAX_BODY_BYTES = 256 * 1024 * 1024;

export function dataFolderPlugin({ dir = 'data' } = {}) {
  let root = process.cwd();
  const resolveDir = () => path.resolve(root, dir);

  const middleware = async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(ROUTE)) return next();

    const rest = url.pathname.slice(ROUTE.length).replace(/^\//, '');
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };

    try {
      const target = resolveDir();
      await mkdir(target, { recursive: true });

      if (!rest) {
        if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
        return send(200, { years: await readIndex(target) });
      }

      if (!YEAR_PATTERN.test(rest)) return send(400, { error: 'year must be four digits' });
      const file = path.join(target, `${rest}.json`);

      if (req.method === 'GET') {
        const raw = await readFile(file, 'utf8').catch(() => null);
        if (raw === null) return send(404, { error: 'not found' });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        return res.end(raw);
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed?.games)) return send(400, { error: 'missing games array' });
        await writeFile(file, JSON.stringify(parsed));
        await writeIndex(target);
        return send(200, { ok: true, year: rest, games: parsed.games.length });
      }

      if (req.method === 'PATCH') {
        const parsed = JSON.parse(await readBody(req));
        const raw = await readFile(file, 'utf8').catch(() => null);
        if (raw === null) return send(404, { error: 'not found' });
        const dataset = JSON.parse(raw);
        dataset.enabled = Boolean(parsed?.enabled);
        await writeFile(file, JSON.stringify(dataset));
        await writeIndex(target);
        return send(200, { ok: true, year: rest, enabled: dataset.enabled });
      }

      if (req.method === 'DELETE') {
        await rm(file, { force: true });
        await writeIndex(target);
        return send(200, { ok: true, year: rest });
      }

      return send(405, { error: 'method not allowed' });
    } catch (error) {
      return send(500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    name: 'draftcall-data-folder',
    configResolved(config) {
      root = config.root ?? process.cwd();
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

/** Reads the small index rather than every year file. */
async function readIndex(dir) {
  const raw = await readFile(path.join(dir, 'index.json'), 'utf8').catch(() => null);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.years)) return parsed.years;
    } catch {
      // Fall through and rebuild it from the files on disk.
    }
  }
  return rebuildIndex(dir);
}

/** Summaries only — the games stay in their own files. */
async function rebuildIndex(dir) {
  const names = await readdir(dir).catch(() => []);
  const years = [];
  for (const name of names) {
    const match = name.match(/^(\d{4})\.json$/);
    if (!match) continue;
    try {
      const dataset = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      years.push({
        year: match[1],
        label: dataset.label ?? name,
        games: Array.isArray(dataset.games) ? dataset.games.length : 0,
        importedAt: dataset.importedAt ?? null,
        enabled: dataset.enabled !== false,
        dateRange: dataset.stats?.dateRange ?? null,
        perCompetition: dataset.stats?.perCompetition ?? {},
      });
    } catch {
      // A half-written or hand-edited file shouldn't break the listing.
    }
  }
  years.sort((a, b) => b.year.localeCompare(a.year));
  return years;
}

async function writeIndex(dir) {
  const years = await rebuildIndex(dir);
  await writeFile(path.join(dir, 'index.json'), `${JSON.stringify({ years }, null, 2)}\n`);
  return years;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('dataset too large to save'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
