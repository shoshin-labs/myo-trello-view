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

// North Star card — the single top objective
// Parses the body to extract a clean Definition of Done list + metadata so the
// frontend can render it as a hero card without re-parsing markdown.
app.get('/api/north-star', async (_req, res) => {
  const snap = await snapshotBoard();
  const nsSection = snap.sections.find((s) => s.key === 'north_star_current_objective');
  if (!nsSection || !nsSection.cards?.length) {
    return res.json({ present: false });
  }
  // First card in the section is the active north star (matches canon)
  const raw = nsSection.cards[0];
  const { title, owner, expectedArtifact, dod, boundaries, definitionOfValue } = parseNorthStarBody(raw.body);

  res.json({
    present: true,
    card: {
      id: raw.id,
      listId: nsSection.key,
      sectionPath: nsSection.path,
      sectionTitle: nsSection.title,
      body: raw.body,
    },
    parsed: { title, owner, expectedArtifact, dod, boundaries, definitionOfValue },
    meta: snap.meta,
  });
});

// Light markdown extractor for the north-star card.
// The Myo convention varies — sometimes **Owner:** is inline with the title,
// sometimes on its own line. We use the canonical "label followed by colon
// inside **bold**" anchors and split the title-line on those.
//
//   **MYO-70 — Head of Development starter pack.** **Owner:** Henry, ...
//   **This is the single current objective; every safe card should advance it.**
//
//   **Definition of done** — <intro>
//     1. <item>
//     ...
//   **Definition of value** — <text>
//   **Boundaries unchanged:** <text>
function parseNorthStarBody(body) {
  const rawLines = (body || '').split('\n');
  const lines = rawLines.map((l) => l.trim());

  // Title = the bold-leading run on line 0 before any other "**Label:**" anchor
  const firstLine = lines[0] || '';
  // Strip any trailing inline **Label:** ... **Label:** ... etc.
  // We treat the entire first line as the title unless we can confidently split.
  const inlineLabelPattern = /\*\*([A-Z][^*]{0,40}:)\*\*\s*/g;
  const labelStarts = [];
  let m;
  while ((m = inlineLabelPattern.exec(firstLine)) !== null) {
    labelStarts.push({ at: m.index, len: m[0].length, label: m[1] });
  }
  let title = firstLine;
  if (labelStarts.length) {
    const first = labelStarts[0];
    title = firstLine.slice(0, first.at).trim();
  }

// Extract inline (line 0) **Owner:** ... **Expected artifact:** ... **This is the single...**
// We anchor by label name. Owner/Expected always precede "This is the single..." or the line end.
function extractFromFirstLine(label) {
  const m = firstLine.match(new RegExp(`\\*\\*${label}\\*\\*\\s+(.+?)(?=\\s*\\*\\*(?:Owner|Expected artifact|This is the single|$))`, 'i'));
  if (!m) return '';
  // stop at next **Label:**
  return stripMd(m[1].replace(/\s*$/, '')).trim().replace(/[.,;]$/, '');
}

  // Try the inline form first (matches MYO-70 body shape), fall back to
  // dedicated-line form for future cards that separate Owner onto its own line.
function findLabel(label, regex) {
  for (const ln of lines) {
    const m = ln.match(regex);
    if (m) return stripMd(m[1]).trim().replace(/[.,;]$/, '');
  }
  return '';
}

const ownerVal   = findLabel('Owner',   /^\*\*Owner:\*\*\s+(.+)$/i)
                || extractFromFirstLine('Owner:');
const expectedVal = findLabel('Expected artifact', /^\*\*Expected artifact:\*\*\s+(.+)$/i)
                || extractFromFirstLine('Expected artifact:');

  // Definition of done
  const dodIdx = lines.findIndex((l) => /^\*\*Definition of done\*\*/i.test(l));
  const dod = [];
  if (dodIdx >= 0) {
    for (let i = dodIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\d+\.\s+(.+)$/);
      if (m) dod.push(stripMd(m[1]).trim());
      else if (/^\*\*/.test(lines[i])) break;
    }
  }

  // Definition of value — find the bold "Definition of value" anchor (often
  // on its own line at the end of the preamble). Don't confuse with "Definition
  // of done".
  const dovIdx = lines.findIndex((l) => /^\*\*Definition of value\*\*/i.test(l));
  let definitionOfValue = '';
  if (dovIdx >= 0) {
    // Take the text between "Definition of value" and the next " ** " anchor or end.
    const line = lines[dovIdx];
    const after = line.replace(/^\*\*Definition of value\*\*\s*—\s*/, '')
                       .replace(/^\*\*Definition of value\*\*\s*:\s*/, '');
    definitionOfValue = stripMd(after);
  } else {
    // Fall back: try to capture the "single current objective" sentence that
    // often follows the title block.
    const preamble = lines.find((l) => /single current objective/i.test(l) && !/Definition/.test(l));
    if (preamble) definitionOfValue = stripMd(preamble);
  }

  // Boundaries — usually the last bold-ended block, single line
  const bndIdx = lines.findIndex((l) => /\*\*Boundaries unchanged/i.test(l));
  let boundaries = '';
  if (bndIdx >= 0) {
    const ln = lines[bndIdx];
    const after = ln.replace(/^\*\*Boundaries unchanged:\*\*\s*/, '')
                    .replace(/^\*\*Boundaries unchanged:\*\*\s*/, '');
    boundaries = stripMd(after).trim();
    // Optional continuation lines (rare)
    for (let i = bndIdx + 1; i < lines.length; i++) {
      if (!/^\*\*/.test(lines[i])) break;
    }
  }

  return {
    title: stripMd(title),
    owner: ownerVal,
    expectedArtifact: expectedVal,
    dod,
    boundaries,
    definitionOfValue,
  };
}

function stripMd(s) {
  return (s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .trim();
}

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
