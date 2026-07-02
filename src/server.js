// Myo Trello view — backend
// - GET  /api/board       read live snapshot (read-only view of board.db, refreshed on demand)
// - GET  /api/state       read writable board state (board.json inside workspace)
// - PUT  /api/state       replace writable board state
// - POST /api/refresh     re-pull snapshot from board.db
// - GET  /*               static frontend

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotBoard } from './snapshot.js';
import { projectStudio } from './studio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'state.json');
const PORT = parseInt(process.env.PORT || '18714', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '4mb' }));

// --- writable scratch state --------------------------------------------------

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

let writeLock = Promise.resolve();
async function withLock(fn) {
  const prev = writeLock;
  let release;
  writeLock = new Promise((res) => { release = res; });
  try { return await fn(); } finally {
    release();
    await prev;
  }
}

async function writeState(state) {
  await withLock(async () => {
    const tmp = STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_PATH);
  });
}

async function ensureStateFromSnapshot() {
  const existing = readState();
  if (existing) return existing;
  const snap = await snapshotBoard();
  const initial = {
    title: snap.meta?.title || 'Myo board',
    cards: {},     // id -> { id, listId, title, body, labels, due, members }
    lists: [],     // ordered list ids (snapshot order)
    snapshots: snap,
    meta: { created: new Date().toISOString() },
  };
  // seed lists from snapshot
  for (const s of snap.sections) {
    initial.lists.push({ id: s.key, title: s.title, path: s.path, virtual: false });
    for (const c of s.cards) {
      const id = c.id;
      if (!initial.cards[id]) {
        initial.cards[id] = {
          id,
          listId: s.key,
          title: c.id,
          body: c.body,
          labels: c.synthetic_id ? ['synthetic'] : [],
          members: [],
          due: null,
          createdAt: new Date().toISOString(),
        };
      }
    }
  }
  await writeState(initial);
  return initial;
}

// --- routes ------------------------------------------------------------------

app.get('/api/board', async (_req, res) => {
  const snap = await snapshotBoard();
  res.json(snap);
});

// Studio: curated current-state projection
app.get('/api/studio', async (_req, res) => {
  const snap = await snapshotBoard();
  const projection = projectStudio(snap);
  res.json({
    ...projection,
    meta: {
      title: 'Studio — Myo board',
      source_db: snap.meta.source_db,
      snapshot_at: snap.meta.snapshot_at,
    },
  });
});

// Full-screen card data (uses last studio projection + state)
app.get('/api/card/:id', async (req, res) => {
  const snap = await snapshotBoard();
  const cardId = decodeURIComponent(req.params.id);
  for (const section of snap.sections) {
    for (const card of section.cards || []) {
      if (card.id === cardId) {
        return res.json({
          card: { ...card, sectionKey: section.key, sectionTitle: section.title, sectionPath: section.path },
          meta: snap.meta,
        });
      }
    }
  }
  res.status(404).json({ error: 'card not found', id: cardId });
});

// Browse flat card list (All view)
app.get('/api/cards', async (_req, res) => {
  const snap = await snapshotBoard();
  const flat = [];
  for (const section of snap.sections) {
    for (const card of section.cards || []) {
      flat.push({
        id: card.id,
        listId: section.key,
        listTitle: section.title,
        listPath: section.path,
        body: card.body,
        synthetic: !!card.synthetic_id,
      });
    }
  }
  res.json({ meta: snap.meta, cards: flat });
});

// All section paths (for breadcrumb)
app.get('/api/sections', async (_req, res) => {
  const snap = await snapshotBoard();
  res.json({ sections: snap.sections.map((s) => ({ key: s.key, title: s.title, path: s.path, level: s.level })) });
});

app.get('/api/state', async (_req, res) => {
  const state = await ensureStateFromSnapshot();
  res.json(state);
});

app.put('/api/state', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'invalid body' });
  }
  await writeState(req.body);
  res.json({ ok: true });
});

app.post('/api/refresh', async (_req, res) => {
  const snap = await snapshotBoard();
  // merge new cards into state without dropping existing edits
  const state = (await readState()) || (await ensureStateFromSnapshot());
  for (const s of snap.sections) {
    if (!state.lists.find((l) => l.id === s.key)) {
      state.lists.push({ id: s.key, title: s.title, path: s.path, virtual: false });
    } else {
      const l = state.lists.find((l) => l.id === s.key);
      l.title = s.title; l.path = s.path;
    }
    for (const c of s.cards) {
      const id = c.id;
      if (!state.cards[id]) {
        state.cards[id] = {
          id, listId: s.key, title: c.id, body: c.body,
          labels: c.synthetic_id ? ['synthetic'] : [],
          members: [], due: null, createdAt: new Date().toISOString(),
        };
      }
    }
  }
  state.snapshots = snap;
  await writeState(state);
  res.json({ ok: true, cards: Object.keys(state.cards).length });
});

// static frontend
app.use(express.static(path.join(ROOT, 'public')));

// --- boot --------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[myo-trello] listening on http://${HOST}:${PORT}`);
  console.log(`[myo-trello] state path: ${STATE_PATH}`);
});
