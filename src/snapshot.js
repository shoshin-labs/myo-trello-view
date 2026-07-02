// Snapshot of Myo's live board.db into a friendly JSON shape.
// Runs on every /api/board and /api/refresh.

import sqlite3 from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.MYO_BOARD_DB
  || '/var/lib/hermes-agent/.hermes/state/myo-board/board.db';

let db;
function getDb() {
  if (!db) {
    try {
      db = new sqlite3(DB_PATH, { readonly: true, fileMustExist: true });
    } catch (err) {
      throw new Error(`Cannot open board.db at ${DB_PATH}: ${err.message}`);
    }
  }
  return db;
}

export async function snapshotBoard() {
  const conn = getDb();
  const sections = conn.prepare('SELECT * FROM sections ORDER BY level, parent_key, order_index').all();
  const cards    = conn.prepare('SELECT * FROM cards ORDER BY section_key, order_index').all();
  const events   = conn.prepare('SELECT * FROM card_events ORDER BY order_index DESC LIMIT 20').all();

  const parent = Object.fromEntries(sections.map((s) => [s.key, s.parent_key]));
  const title  = Object.fromEntries(sections.map((s) => [s.key, s.title]));
  function pathFor(k) {
    const chain = [];
    let cur = k;
    while (cur) {
      chain.push(title[cur] || cur);
      cur = parent[cur];
    }
    return chain.reverse().join(' / ');
  }

  const grouped = {};
  for (const s of sections) {
    grouped[s.key] = {
      key: s.key,
      title: s.title,
      level: s.level,
      parent_key: s.parent_key,
      order_index: s.order_index,
      path: pathFor(s.key),
      preamble: s.preamble,
      cards: [],
    };
  }
  for (const c of cards) {
    if (grouped[c.section_key]) {
      grouped[c.section_key].cards.push({
        id: c.id,
        order_index: c.order_index,
        body: c.body,
        synthetic_id: !!c.synthetic_id,
      });
    }
  }

  return {
    meta: {
      title: 'Myo live board',
      source_db: DB_PATH,
      snapshot_at: new Date().toISOString(),
      card_count: cards.length,
      section_count: sections.length,
    },
    sections: sections.map((s) => grouped[s.key]),
    events,
  };
}
