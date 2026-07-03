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

// --- docs surface (Control Centre artifacts) ---------------------------------
// Read-only index of hand-picked files from docs/. Listed inline here (not in
// a separate file) so the surface is one grep away.

const DOCS_DIR = path.join(ROOT, 'docs');

const DOC_INDEX = [
  {
    file: 'CONTROL_CENTRE_FABLE_LIVE.html',
    title: 'Fable 5 · live design (recommended)',
    blurb: 'Interactive successor with live crew strip, Chat-to-Henry wire, + New card spawn modal, thread drawer on every card click. Wires to /api/agents/status, /api/chat/henry, /api/spawn, /api/threads. This is the one to open.',
    icon: '⚡',
  },
  {
    file: 'CONTROL_CENTRE_FABLE.html',
    title: 'Fable 5 polished design (v1)',
    blurb: 'First Fable pass. Beautiful static design — interrupt-budget gauge, trust ledger, specialist mood cards, slash palette. Read-only.',
    icon: '✨',
  },
  {
    file: 'CONTROL_CENTRE_CONCEPT.html',
    title: 'Henry\u2019s concept mockup',
    blurb: 'Self-contained first pass. 4 views (Control / Board / People / Timeline / Live), command palette, working click handlers, live activity stream, right-pane Needs Tom.',
    icon: '🎨',
  },
  {
    file: 'CONTROL_CENTRE_ARCHITECTURE_SPEC.md',
    title: 'Architecture spec',
    blurb: '2,100-word spec. 3 signature features, full 10-feature set, rail-first hybrid IA, phased build plan, data model additions, the ONE missing question, and tonight\u2019s Tom-only decisions.',
    icon: '📐',
  },
  {
    file: 'CONTROL_CENTRE_ONE_PAGER.md',
    title: 'Who we are (one-pager)',
    blurb: 'Myo is X, does Y, is not Z, is improving via W. Distilled from the existing material into one place.',
    icon: '🧭',
  },
];

app.get('/docs', (_req, res) => {
  const rows = DOC_INDEX.map((d) => `
    <li>
      <a class="card" href="/docs/${encodeURIComponent(d.file)}">
        <div class="ico">${d.icon}</div>
        <div>
          <h3>${d.title}</h3>
          <p>${d.blurb}</p>
          <span class="file">${d.file}</span>
        </div>
      </a>
    </li>`).join('');

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Myo Control Centre · docs</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2300B8D9'/%3E%3Crect x='6' y='8' width='6' height='18' rx='2' fill='white'/%3E%3Crect x='14' y='8' width='6' height='14' rx='2' fill='white' opacity='.7'/%3E%3Crect x='22' y='8' width='4' height='10' rx='2' fill='white' opacity='.5'/%3E%3C/svg%3E" />
  <style>
    :root{--accent:#00B8D9;--accent-2:#4FC3F7;--bg:#0e1217;--bg-elev:#161b22;--panel:#1e242c;--panel-2:#262d36;--border:#2f3942;--text:#b6c2cf;--text-strong:#e7edf3;--muted:#8a96a4}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif;background:radial-gradient(1200px 800px at 90% -10%,rgba(0,184,217,.08),transparent 60%),radial-gradient(1100px 700px at -10% 90%,rgba(79,195,247,.06),transparent 55%),var(--bg);color:var(--text);font-size:14px;line-height:1.5;min-height:100vh}
    .wrap{max-width:920px;margin:0 auto;padding:48px 24px 80px}
    .crumb{font-size:12px;color:var(--muted);margin-bottom:12px}
    .crumb a{color:var(--accent);text-decoration:none}
    h1{font-size:28px;font-weight:700;color:var(--text-strong);letter-spacing:-.015em;margin:0 0 8px}
    .lede{font-size:15px;color:var(--text);margin:0 0 36px;max-width:680px}
    .lede b{color:var(--text-strong)}
    ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:14px}
    .card{display:flex;gap:18px;padding:20px 22px;background:var(--panel);border:1px solid var(--border);border-radius:12px;text-decoration:none;color:inherit;transition:all .15s}
    .card:hover{border-color:var(--accent);background:var(--panel-2);transform:translateY(-1px)}
    .ico{font-size:28px;line-height:1;flex-shrink:0;width:48px;height:48px;display:grid;place-items:center;background:var(--bg-elev);border:1px solid var(--border);border-radius:10px}
    h3{margin:0 0 6px;font-size:15.5px;font-weight:600;color:var(--text-strong);letter-spacing:-.01em}
    p{margin:0 0 8px;font-size:13px;color:var(--text)}
    .file{font-family:'SF Mono',Menlo,monospace;font-size:11.5px;color:var(--muted);background:var(--bg-elev);border:1px solid var(--border);padding:2px 8px;border-radius:4px;display:inline-block}
    .footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
    .footer code{font-family:'SF Mono',Menlo,monospace;background:var(--panel);padding:1px 6px;border-radius:4px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="crumb"><a href="/">\u2190 Myo Trello</a> \u00b7 <a href="/api/board">board.json</a></div>
    <h1>Control Centre \u00b7 docs</h1>
    <p class="lede">Five artifacts in the Control Centre conversation, served read-only from <b>docs/</b> in the repo. Click any card to open in-browser. The <b>live design</b> at the top wires to real API endpoints \u2014 click around and try it.</p>
    <ul>${rows}</ul>
    <div class="footer">
      Served on Tailscale from <code>100.95.71.67:18714</code>. Source files live at <code>/var/lib/hermes-agent/work/myo-trello-view/docs/</code>.
    </div>
  </div>
</body>
</html>`);
});

app.get('/docs/:file', (req, res) => {
  const requested = req.params.file;
  const entry = DOC_INDEX.find((d) => d.file === requested);
  if (!entry) {
    return res.status(404).type('text/plain').send(`not found: ${requested}\nallowed: ${DOC_INDEX.map(d => d.file).join(', ')}`);
  }
  const abs = path.join(DOCS_DIR, entry.file);
  if (!abs.startsWith(DOCS_DIR + path.sep)) {
    return res.status(400).type('text/plain').send('bad path');
  }
  res.sendFile(abs);
});

// --- live action surface ------------------------------------------------------
// Action endpoints that Fable's CONTROL_CENTRE_FABLE_LIVE.html wires to.
// Keep them minimal — Fable does the design; this is just plumbing.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
const execFileP = promisify(execFile);

const KANBAN_DB = process.env.MYO_KANBAN_DB || '/var/lib/hermes-agent/.hermes/kanban.db';
const HENRY_CHAT_DIR = path.join(ROOT, 'data', 'henry_chat');  // per-session log files (one per id)
const HENRY_INBOX = path.join(ROOT, 'data', 'henry_inbox.jsonl');
const HENRY_OUTBOX = path.join(ROOT, 'data', 'henry_outbox.jsonl');
const HERMES_BIN = '/opt/hermes-agent/venv/bin/hermes';
const SAFE_ASSIGNEES = new Set(['henry', 'holly', 'hazel', 'hannah']);

function ensureFile(p) { try { fs.accessSync(p, fs.constants.F_OK); } catch { fs.writeFileSync(p, ''); } }
ensureFile(HENRY_INBOX);
ensureFile(HENRY_OUTBOX);
try { fs.mkdirSync(HENRY_CHAT_DIR, { recursive: true }); } catch {}

function appendJsonl(p, obj) { fs.appendFileSync(p, JSON.stringify({ ...obj, _ts: Date.now() }) + '\n'); }
function readJsonlTail(p, sinceMs = 0, limit = 50) {
  try {
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    const out = [];
    for (const line of lines) {
      try { const o = JSON.parse(line); if ((o._ts || 0) > sinceMs) out.push(o); } catch {}
    }
    return out.slice(-limit);
  } catch { return []; }
}

// /api/agents/status
app.get('/api/agents/status', (_req, res) => {
  let db;
  try { db = new Database(KANBAN_DB, { readonly: true, fileMustExist: true }); }
  catch (e) { return res.status(500).json({ error: 'kanban db unavailable', detail: String(e) }); }
  const nowSec = Math.floor(Date.now() / 1000);
  const out = {};
  for (const a of ['henry','holly','hazel','hannah']) {
    const latest = db.prepare(`
      SELECT t.id, t.title, t.status, t.assignee, t.created_at, t.started_at, t.completed_at,
             (? - t.created_at)/60 AS age_min,
             (SELECT MAX(COALESCE(te.created_at,0)) FROM task_events te WHERE te.task_id = t.id) AS last_event_at
      FROM tasks t WHERE t.assignee = ?
      ORDER BY CASE WHEN t.status IN ('running','pending','scheduled','blocked') THEN 0 ELSE 1 END,
               COALESCE(t.started_at, t.created_at) DESC LIMIT 1
    `).get(nowSec, a);
    const last3 = db.prepare(`
      SELECT te.kind AS event, te.created_at, substr(te.payload, 1, 200) AS summary
      FROM task_events te JOIN tasks t ON t.id = te.task_id WHERE t.assignee = ?
      ORDER BY te.created_at DESC LIMIT 3
    `).all(a);
    const recent_done = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE assignee = ? AND status='done' AND completed_at > ?`).get(a, nowSec - 24*3600).n;
    let state = 'idle';
    if (latest) {
      if (latest.status === 'running') state = 'working';
      else if (latest.status === 'blocked') state = 'blocked';
      else if (['pending','scheduled'].includes(latest.status)) state = 'waiting';
      else if (latest.status === 'done') state = 'idle';
    }
    out[a] = {
      state,
      current: latest ? { id: latest.id, title: latest.title, status: latest.status, age_min: Math.round(latest.age_min) } : null,
      recent_actions: last3.map(e => ({ event: e.event, summary: e.summary, at: e.created_at })),
      done_24h: recent_done,
      heartbeat_at: latest?.last_event_at || null,
    };
  }
  db.close();
  res.json({ at: nowSec, agents: out });
});

// /api/spawn
app.post('/api/spawn', async (req, res) => {
  const { title, body = '', assignee = 'henry', parent = null, idempotency_key = null } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title required' });
  if (!SAFE_ASSIGNEES.has(assignee)) return res.status(400).json({ error: `assignee must be one of: ${[...SAFE_ASSIGNEES].join(', ')}` });
  try {
    const args = ['kanban', 'create', title.trim(), '--assignee', assignee, '--json'];
    if (body) args.push('--body', body);
    if (parent) args.push('--parent', parent);
    if (idempotency_key) args.push('--idempotency-key', idempotency_key);
    const { stdout: created } = await execFileP(HERMES_BIN, args, { timeout: 30000 });
    let task; try { task = JSON.parse(created); } catch { task = { raw: created }; }
    try { await execFileP(HERMES_BIN, ['kanban', 'dispatch', '--max', '1', '--json'], { timeout: 30000 }); } catch {}
    appendJsonl(HENRY_INBOX, { kind: 'spawn', title: title.trim(), assignee, task_id: task?.id, parent });
    res.json({ ok: true, task, title, assignee });
  } catch (e) {
    res.status(500).json({ error: 'spawn failed', detail: String(e), stdout: e.stdout?.toString(), stderr: e.stderr?.toString() });
  }
});

// /api/chat/henry (POST) — async message to Henry, runs `hermes chat -q` per message.
// Each session writes to its own file (data/henry_chat/<id>.log) so concurrent
// captures don't race. On exit, we parse that single session's log for the reply.
app.post('/api/chat/henry', (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
  const id = `hmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
  appendJsonl(HENRY_INBOX, { kind: 'chat', id, message: message.trim() });

  // Per-session log: race-free even with concurrent sessions.
  const sessionLogPath = path.join(HENRY_CHAT_DIR, `${id}.log`);
  appendJsonl(HENRY_INBOX, { kind: 'session_log_path', id, path: sessionLogPath });

  const outFd = fs.openSync(sessionLogPath, 'a');
  const child = spawn(HERMES_BIN, ['chat', '-q', message.trim(), '--source', `web:${id}`], {
    cwd: '/var/lib/hermes-agent',
    detached: true,
    stdio: ['ignore', outFd, outFd],
  });
  child.unref();

  // On exit, parse this session's own log file for the reply. Race-free.
  child.on('exit', (code, signal) => {
    try {
      const raw = fs.readFileSync(sessionLogPath, 'utf-8');
      const reply_text = extractHenryReply(raw);
      appendJsonl(HENRY_OUTBOX, { kind: 'chat_reply', id, reply_text, exit_code: code, signal });
    } catch (e) {
      appendJsonl(HENRY_OUTBOX, { kind: 'chat_reply', id, reply_text: '', exit_code: code, signal, error: String(e) });
    }
  });

  res.json({ ok: true, queued: id, session_log: sessionLogPath });
});

/**
 * Extract Henry's actual reply from a `hermes chat -q` session log.
 *
 * A session log looks like:
 *   ─  ⚕ Hermes  ────────...──
 *
 *   <reply text — possibly multi-line, indented>
 *
 *   ─────────────────────────...
 *
 *   Resume this session with:
 *     hermes --resume 20260702_...
 *
 *   Session: ...
 *   Duration: ...
 *   Messages: ...
 *   <possibly: Query: ...>     <-- next message (rare in our flow)
 *   <possibly: Initializing agent...>
 *
 * Strategy: find the FIRST `⚕ Hermes` banner (the actual reply block), then
 * everything between that banner and the NEXT `Resume this session` line is
 * the reply. Strip leading/trailing blank lines, trailing whitespace, and
 * strip the ASCII banner rules for a clean rendering.
 */
function extractHenryReply(raw) {
  if (!raw) return '';
  const lines = raw.split('\n');

  // Find first "⚕ Hermes" banner — that's the start of the reply block.
  let start = lines.findIndex((l) => l.includes('⚕ Hermes') || l.includes('⚕Hermes') || /Hermes\s*─/.test(l));
  if (start < 0) {
    // Fallback: no banner found. Take whatever isn't session metadata.
    return stripReplyNoise(raw).slice(0, 4000);
  }
  // The actual reply starts ~3 lines after the banner (skip blank line after the rule).
  let from = start + 1;
  while (from < lines.length && /^\s*$/.test(lines[from])) from++;
  // Strip the trailing banner rule.
  while (from < lines.length && /^[ \t]*─+\s*$/.test(lines[from])) from++;

  // The reply ends at the "Resume this session" line.
  let end = lines.findIndex((l, i) => i >= from && /Resume this session/i.test(l));
  if (end < 0) end = lines.length;

  // Trim trailing blank lines / rule lines.
  while (end > from && (/^\s*$/.test(lines[end - 1]) || /^[ \t]*─+\s*$/.test(lines[end - 1]))) end--;

  const reply = lines.slice(from, end).join('\n').trim();

  // Hard cap so a runaway session doesn't blow out the panel.
  return reply.slice(0, 4000);
}

function stripReplyNoise(s) {
  // Last-resort cleanup: remove the resume footer + session metadata block.
  const cut = s.split(/\nResume this session:/i)[0] || s;
  return cut.trim();
}

// /api/chat/henry/poll (GET) — long-poll up to 5s
app.get('/api/chat/henry/poll', async (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const deadline = Date.now() + 5000;
  let messages;
  while (true) {
    messages = readJsonlTail(HENRY_OUTBOX, since, 50).filter(m => m.kind === 'chat_reply');
    if (messages.length > 0) break;
    if (Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 250));
  }
  res.json({ at: Date.now(), messages });
});

// /api/chat/henry/history (GET)
app.get('/api/chat/henry/history', (_req, res) => {
  const inbox = readJsonlTail(HENRY_INBOX, 0, 50).filter(m => m.kind === 'chat');
  const outbox = readJsonlTail(HENRY_OUTBOX, 0, 50).filter(m => m.kind === 'chat_reply');
  const outboxById = Object.fromEntries(outbox.map(m => [m.id, m]));
  const thread = inbox.map(m => ({
    id: m.id, ts: m._ts, user: m.message,
    henry: outboxById[m.id]?.reply_text || null,
    pending: !outboxById[m.id],
  })).reverse();
  res.json({ thread });
});

// /api/threads/:card_id
app.get('/api/threads/:card_id', (req, res) => {
  const cardId = decodeURIComponent(req.params.card_id);
  let events = [];
  try {
    const db = new Database('/var/lib/hermes-agent/.hermes/state/myo-board/board.db', { readonly: true, fileMustExist: true });
    events = db.prepare(`SELECT id, event_date AS ts, body, substr(body, 1, 600) AS summary FROM card_events WHERE body LIKE ? ORDER BY id DESC LIMIT 30`).all(`%${cardId}%`);
    db.close();
  } catch {}
  const inbox = readJsonlTail(HENRY_INBOX, 0, 200).filter(m => m.kind === 'chat' && (m.message.includes(cardId) || m.message.includes('#' + cardId)));
  const outbox = readJsonlTail(HENRY_OUTBOX, 0, 200).filter(m => m.kind === 'chat_reply' && inbox.some(i => i.id === m.id));
  const chat = inbox.map(i => {
    const reply = outbox.find(o => o.id === i.id);
    return { ts: i._ts, user: i.message, henry: reply?.reply_text || null, pending: !reply };
  });
  let sends = [];
  try {
    const audit = fs.readFileSync('/var/lib/hermes-agent/.hermes/state/myo-engagement/audit.jsonl', 'utf-8');
    sends = audit.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(x => x && JSON.stringify(x).includes(cardId)).slice(-20);
  } catch {}
  const participants = new Set();
  for (const e of events) {
    const m = (e.body || '').match(/\*\*Assignee:\*\*\s*([^*\n]+)/i);
    if (m) participants.add(m[1].trim().toLowerCase());
  }
  for (const c of chat) participants.add('henry');
  res.json({ card_id: cardId, participants: [...participants], events, chat, sends });
});

// --- boot --------------------------------------------------------------------

app.listen(PORT, HOST, () => {
  console.log(`[myo-trello] listening on http://${HOST}:${PORT}`);
  console.log(`[myo-trello] state path: ${STATE_PATH}`);
});
