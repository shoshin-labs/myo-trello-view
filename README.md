# Myo board — Trello view

A small Trello-style live view of Tom's Myo Kanban board.

**Source of truth:** `~/.hermes/state/myo-board/board.db` (live SQLite, written by `myo/tools/board_cli.py`).
**Host:** Hermes, served on Tailscale at `http://100.95.71.67:18714/`.
**GitHub:** [shoshin-labs/myo-trello-view](https://github.com/shoshin-labs/myo-trello-view).

## What it does

- Pulls the live Myo board (151 cards / 34 sections at last snapshot) on every Refresh click.
- Renders all lists horizontally with full Trello-style interactivity:
  - Click a card → edit modal with title, markdown body, labels, list selector, delete.
  - Drag a card → drop into another list to move it; persists across reloads.
  - `＋ Add a card` per list, `+ List` to create new lists.
  - Filter box (fuzzy over title/body), hide-empty toggle.
- Backend persists writes to `data/state.json` (atomically). Original board.db is **never written** — reads only.
- Refresh merges any new cards from board.db into the writable state without losing local edits.

## Tech

- Node 20+, Express 4, `better-sqlite3`, `marked` (markdown preview).
- Frontend: vanilla ESM, no build step. One HTML, one CSS, one JS.

## Run

```bash
npm install
PORT=18714 npm start
# open http://localhost:18714/
```

`MYO_BOARD_DB` env var overrides the source DB path (default above).

## Files

```
src/
  server.js     Express app + state I/O
  snapshot.js   read-only SQLite reader (board.db -> JSON)
public/
  index.html    single-page UI
  styles.css    Trello-inspired dark theme
  app.js        vanilla frontend (drag/drop, modal, filter)
data/
  state.json    working board (lists + cards + labels, auto-created)
```

## Reset

Delete `data/state.json`; the next start re-seeds from board.db.
