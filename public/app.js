// Myo Trello view — vanilla JS frontend
// Talks to the small Express backend, renders lists + cards, supports drag-drop,
// add/edit/move/delete, label chips, markdown preview, filter.

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  lists: [],
  cards: {},
  meta: null,
  snapshot: null,
  filter: '',
  editingCardId: null,
  hideEmpty: false,
};

const STATUS = $('#status');
function setStatus(msg, kind = '') {
  STATUS.textContent = msg || '';
  STATUS.className = 'status' + (kind ? ' ' + kind : '');
  if (msg && kind === 'ok') {
    setTimeout(() => { STATUS.textContent = ''; STATUS.className = 'status'; }, 2000);
  }
}

// ---------- network ----------------------------------------------------------

async function loadState() {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error(`load state failed: ${r.status}`);
  const data = await r.json();
  state.lists = data.lists || [];
  state.cards = data.cards || {};
  state.meta  = data.meta || {};
  state.snapshot = data.snapshots || {};
}

async function persistState() {
  const body = {
    title: 'Myo board',
    lists: state.lists,
    cards: state.cards,
    snapshots: state.snapshot,
    meta: state.meta,
  };
  await fetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function refreshFromBoard() {
  setStatus('Refreshing…');
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (!r.ok) throw new Error(r.statusText);
    const r2 = await fetch('/api/state');
    const data = await r2.json();
    state.lists = data.lists || [];
    state.cards = data.cards || {};
    state.meta = data.meta || {};
    state.snapshot = data.snapshots || {};
    render();
    setStatus(`Refreshed — ${Object.keys(state.cards).length} cards`, 'ok');
  } catch (e) {
    setStatus('Refresh failed: ' + e.message, 'err');
  }
}

// ---------- rendering --------------------------------------------------------

function listEl(list) {
  const wrap = document.createElement('section');
  wrap.className = 'list';
  wrap.dataset.listId = list.id;
  wrap.dataset.path = list.path || '';

  const header = document.createElement('div');
  header.className = 'list-header';
  const h2 = document.createElement('h2');
  h2.textContent = list.title;
  h2.title = list.path || list.title;
  const path = document.createElement('span');
  path.className = 'path';
  path.textContent = list.path ? list.path.split('/').slice(0, -1).join(' / ') : '';
  path.title = list.path;
  const count = document.createElement('span');
  count.className = 'count';
  const cardIds = cardsForList(list.id);
  count.textContent = cardIds.length;
  header.append(path, h2, count);
  wrap.append(header);

  const ul = document.createElement('ul');
  ul.className = 'cards';
  ul.dataset.listId = list.id;
  attachDnD(ul);

  if (!cardIds.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No cards yet.';
    ul.append(empty);
  } else {
    for (const cid of cardIds) ul.append(cardEl(state.cards[cid]));
  }
  wrap.append(ul);

  const footer = document.createElement('div');
  footer.className = 'list-footer';
  const add = document.createElement('button');
  add.className = 'add-card';
  add.textContent = '＋ Add a card';
  add.onclick = () => openCardModal(null, list.id);
  footer.append(add);
  wrap.append(footer);

  return wrap;
}

function cardsForList(listId) {
  return Object.values(state.cards)
    .filter((c) => c.listId === listId)
    .filter(matchesFilter)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((c) => c.id);
}

function matchesFilter(card) {
  if (!state.filter) return true;
  const f = state.filter.toLowerCase();
  return (
    (card.title || '').toLowerCase().includes(f) ||
    (card.body   || '').toLowerCase().includes(f)
  );
}

function cardEl(card) {
  const li = document.createElement('li');
  li.className = 'card';
  li.dataset.cardId = card.id;
  li.draggable = true;
  attachCardDnD(li);

  const h = document.createElement('h3');
  h.textContent = card.title || '(untitled)';
  li.append(h);

  if (card.labels?.length) {
    const row = document.createElement('div');
    row.className = 'label-row';
    for (const l of card.labels) {
      const chip = document.createElement('span');
      chip.className = 'label-chip ' + (l.class || '');
      chip.textContent = l.name;
      row.append(chip);
    }
    li.append(row);
  }

  if (card.body) {
    const p = document.createElement('div');
    p.className = 'card-body';
    // tiny plain-text excerpt (markdown stripped lightly for safety in card cells)
    p.textContent = stripMd(card.body).slice(0, 220);
    li.append(p);
  }

  li.addEventListener('click', (e) => {
    openCardModal(card.id);
  });

  return li;
}

function stripMd(s) {
  return (s || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function render() {
  const board = $('#board');
  board.innerHTML = '';
  const total = state.lists.length;
  let shown = 0;
  for (const list of state.lists) {
    const visible = cardsForList(list.id).length > 0 || !state.hideEmpty;
    if (!visible) continue;
    board.append(listEl(list));
    shown += 1;
  }
  const meta = state.snapshot?.meta || state.meta || {};
  const stamp = formatDate(meta.snapshot_at || meta.snapshot);
  $('#board-meta').textContent =
    `${Object.keys(state.cards).length} cards · ${shown}/${total} lists` +
    (stamp ? ` · snapshot ${stamp}` : '');
}

function formatDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

// ---------- card modal -------------------------------------------------------

const modal = $('#card-modal');
const backdrop = $('#modal-backdrop');

function openCardModal(cardId, listId) {
  state.editingCardId = cardId;
  let card = cardId ? state.cards[cardId] : null;

  if (!card) {
    const id = 'CARD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    card = { id, title: '', body: '', listId: listId, labels: [] };
  }

  // populate
  $('#card-title').value = card.title || '';
  $('#card-body').value  = card.body  || '';
  $('#card-body-preview').innerHTML = marked.parse(card.body || '');
  const sel = $('#card-list');
  sel.innerHTML = '';
  for (const l of state.lists) {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.title;
    if (l.id === card.listId) o.selected = true;
    sel.append(o);
  }

  // labels
  const chipRow = $('#card-labels');
  chipRow.innerHTML = '';
  for (const l of card.labels) chipRow.append(makeLabelChip(l));
  $('#card-labels-input').value = '';

  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  setTimeout(() => $('#card-title').focus(), 50);
}

function closeCardModal() {
  state.editingCardId = null;
  modal.classList.add('hidden');
  backdrop.classList.add('hidden');
}

function makeLabelChip(label) {
  const chip = document.createElement('span');
  chip.className = 'label-chip ' + (label.class || '');
  chip.textContent = label.name;
  chip.style.cursor = 'pointer';
  chip.title = 'click to remove';
  chip.onclick = () => chip.remove();
  return chip;
}

const PRESET_LABEL_COLORS = ['warn', 'danger', 'green', '', 'synthetic'];

function addLabel(label) {
  if (!label || !label.name) return null;
  label.class = label.class || PRESET_LABEL_COLORS[Math.floor(Math.random() * PRESET_LABEL_COLORS.length)];
  $('#card-labels').append(makeLabelChip(label));
  return label;
}

$('#card-labels-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (!v) return;
    addLabel({ name: v });
    e.target.value = '';
  }
});

$('#card-body').addEventListener('input', (e) => {
  $('#card-body-preview').innerHTML = marked.parse(e.target.value || '');
});

function readModalIntoCard() {
  const tEl = $('#card-title');
  const title = tEl.value.trim();
  if (!title) tEl.value = title || 'Untitled';

  const labels = $$('#card-labels .label-chip').map((el) => ({
    name: el.textContent,
    class: el.className.replace(/^label-chip\s*/, ''),
  }));

  const id = state.editingCardId;
  const listId = $('#card-list').value;
  const body = $('#card-body').value;
  if (id && state.cards[id]) {
    Object.assign(state.cards[id], { title: $('#card-title').value.trim(), body, listId, labels });
  } else {
    const newId = 'NEW-' + Date.now().toString(36).toUpperCase();
    state.cards[newId] = {
      id: newId, title: $('#card-title').value.trim(), body, listId, labels,
      members: [], due: null, createdAt: new Date().toISOString(),
    };
    if (!state.lists.find((l) => l.id === listId)) {
      // safety net
    }
  }
}

$('#card-save').addEventListener('click', async () => {
  readModalIntoCard();
  await persistState();
  render();
  closeCardModal();
});

$('#card-cancel').addEventListener('click', closeCardModal);
$('#card-delete').addEventListener('click', async () => {
  if (!state.editingCardId) return;
  if (state.editingCardId in state.cards) {
    if (!confirm('Delete this card?')) return;
    delete state.cards[state.editingCardId];
    await persistState();
    render();
    closeCardModal();
  }
});
backdrop.addEventListener('click', closeCardModal);

// ---------- add list ---------------------------------------------------------

$('#add-list').addEventListener('click', async () => {
  const title = prompt('New list title?');
  if (!title) return;
  const id = 'LIST-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)
    + '-' + Math.random().toString(36).slice(2, 6);
  state.lists.push({ id, title, path: title, virtual: true });
  await persistState();
  render();
});

// ---------- filter / hide-empty ----------------------------------------------

$('#search').addEventListener('input', (e) => {
  state.filter = e.target.value.trim();
  render();
});

$('#hide-empty').addEventListener('change', (e) => {
  state.hideEmpty = e.target.checked;
  render();
});

$('#refresh').addEventListener('click', refreshFromBoard);

// ---------- drag and drop ----------------------------------------------------

function attachDnD(ul) {
  ul.addEventListener('dragover', (e) => {
    e.preventDefault();
    ul.classList.add('drop-target');
  });
  ul.addEventListener('dragleave', () => ul.classList.remove('drop-target'));
  ul.addEventListener('drop', async (e) => {
    e.preventDefault();
    ul.classList.remove('drop-target');
    const cardId = e.dataTransfer.getData('text/card-id');
    if (!cardId || !state.cards[cardId]) return;
    state.cards[cardId].listId = ul.dataset.listId;
    // recompute order: drop at end
    const sib = cardsForList(ul.dataset.listId).filter((id) => id !== cardId);
    let order = 1;
    for (const id of sib) {
      state.cards[id].order = order++;
      state.cards[cardId].order = order;
    }
    await persistState();
    render();
  });
}

function attachCardDnD(li) {
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/card-id', li.dataset.cardId);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
    dragMoved.add(li.dataset.cardId);
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
}

// Track cards whose drag actually moved so a click after a tiny drag doesn't open the modal.
const dragMoved = new Set();
document.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  if (dragMoved.has(card.dataset.cardId)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    dragMoved.delete(card.dataset.cardId);
  }
}, true);

// ---------- init -------------------------------------------------------------

(async function init() {
  try {
    await loadState();
    render();
    setStatus('Loaded', 'ok');
  } catch (e) {
    setStatus('Failed to load: ' + e.message, 'err');
  }
})();
