// Myo Trello view — vanilla JS frontend
// Two views:
//   - Studio (default): curated 5-column projection of current work
//   - All: full board (every section in board.db)
//
// Click a card → /card.html?id=… (full-screen markdown reader).

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  view: 'studio',                      // 'studio' | 'all'
  cards: {},                            // id -> { id, listId, title, body, labels, due, members, listTitle, listPath }
  lists: [],                            // ordered list definitions for current view
  meta: null,
  snapshot: null,
  filter: '',
  hideEmpty: true,
  editingCardId: null,
};

const STATUS = $('#status');
function setStatus(msg, kind = '') {
  STATUS.textContent = msg || '';
  STATUS.className = 'status' + (kind ? ' ' + kind : '');
  if (msg && kind === 'ok') {
    setTimeout(() => { STATUS.textContent = ''; STATUS.className = 'status'; }, 2000);
  }
}

// ---------- view preference -------------------------------------------------

function loadViewPref() {
  try { return localStorage.getItem('myo.view') || 'studio'; } catch { return 'studio'; }
}
function saveViewPref(v) {
  try { localStorage.setItem('myo.view', v); } catch {}
}
function setView(v) {
  state.view = v;
  saveViewPref(v);
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.id === `view-${v}`));
  loadAndRender();
}

// ---------- network ---------------------------------------------------------

async function loadStudio() {
  const r = await fetch('/api/studio');
  if (!r.ok) throw new Error(`load studio failed: ${r.status}`);
  const data = await r.json();
  state.cards = {};
  state.lists = [];
  for (const col of data.columns) {
    state.lists.push({
      id: col.id,
      title: col.title,
      path: col.title,
      virtual: true,
      description: col.description,
    });
    for (const card of col.cards) {
      state.cards[card.id] = {
        id: card.id,
        listId: col.id,
        title: card.id,
        body: card.body,
        labels: card.synthetic_id ? [{ name: 'synthetic', class: 'synthetic' }] : [],
        listTitle: col.title,
        listPath: card.sectionPath || card.sectionTitle,
      };
    }
  }
  state.meta = data.meta;
  state.snapshot = data;
}

async function loadAll() {
  const r = await fetch('/api/board');
  if (!r.ok) throw new Error(`load board failed: ${r.status}`);
  const data = await r.json();
  state.cards = {};
  state.lists = [];
  for (const section of data.sections) {
    state.lists.push({
      id: section.key,
      title: section.title,
      path: section.path,
      virtual: false,
    });
    for (const card of section.cards || []) {
      state.cards[card.id] = {
        id: card.id,
        listId: section.key,
        title: card.id,
        body: card.body,
        labels: card.synthetic_id ? [{ name: 'synthetic', class: 'synthetic' }] : [],
        listTitle: section.title,
        listPath: section.path,
      };
    }
  }
  state.meta = data.meta;
  state.snapshot = data;
}

async function loadAndRender() {
  setStatus('Loading…');
  try {
    if (state.view === 'studio') await loadStudio();
    else await loadAll();
    render();
    setStatus(
      state.view === 'studio'
        ? `Studio · ${Object.keys(state.cards).length} active cards`
        : `All · ${Object.keys(state.cards).length} cards / ${state.lists.length} lists`,
      'ok'
    );
  } catch (e) {
    setStatus('Load failed: ' + e.message, 'err');
  }
}

// ---------- rendering -------------------------------------------------------

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

  if (list.description) {
    const sub = document.createElement('p');
    sub.className = 'list-subtitle';
    sub.textContent = list.description;
    wrap.append(sub);
  }

  const ul = document.createElement('ul');
  ul.className = 'cards';
  ul.dataset.listId = list.id;
  attachDnD(ul);

  if (!cardIds.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing here.';
    ul.append(empty);
  } else {
    for (const cid of cardIds) ul.append(cardEl(state.cards[cid]));
  }
  wrap.append(ul);

  return wrap;
}

function cardsForList(listId) {
  return Object.values(state.cards)
    .filter((c) => c.listId === listId)
    .filter(matchesFilter)
    .map((c) => c.id);
}

function matchesFilter(card) {
  if (!state.filter) return true;
  const f = state.filter.toLowerCase();
  return (
    (card.title || '').toLowerCase().includes(f) ||
    (card.listTitle || '').toLowerCase().includes(f) ||
    (card.listPath || '').toLowerCase().includes(f) ||
    (card.body || '').toLowerCase().includes(f)
  );
}

function cardEl(card) {
  const li = document.createElement('li');
  li.className = 'card';
  li.dataset.cardId = card.id;

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
    p.textContent = stripMd(card.body).slice(0, 220);
    li.append(p);
  }

  // Studio view: open in full-screen reader (not the small modal).
  // All view: small inline edit feels more apt when you're reorganising.
  li.addEventListener('click', () => {
    if (state.view === 'studio') {
      location.href = `/card.html?id=${encodeURIComponent(card.id)}`;
    } else {
      openCardModal(card.id);
    }
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
  const meta = state.meta || {};
  const stamp = formatDate(meta.snapshot_at || meta.snapshot);
  $('#board-meta').textContent =
    `${Object.keys(state.cards).length} cards · ${shown}/${total} lists` +
    (stamp ? ` · snapshot ${stamp}` : '');
}

function formatDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

// ---------- card modal (only used in "All" view for quick edits) ------------

const modal = $('#card-modal');
const backdrop = $('#modal-backdrop');

function openCardModal(cardId, listId) {
  state.editingCardId = cardId;
  let card = cardId ? state.cards[cardId] : null;

  if (!card) {
    const id = 'NEW-' + Date.now().toString(36).toUpperCase();
    card = { id, title: '', body: '', listId: listId, labels: [] };
  }

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

$('#card-labels-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (!v) return;
    const chip = makeLabelChip({ name: v });
    $('#card-labels').append(chip);
    e.target.value = '';
  }
});

$('#card-body').addEventListener('input', (e) => {
  $('#card-body-preview').innerHTML = marked.parse(e.target.value || '');
});

// "Open fullscreen" inside the modal
$('#card-open-fullscreen').addEventListener('click', () => {
  if (state.editingCardId) {
    location.href = `/card.html?id=${encodeURIComponent(state.editingCardId)}`;
  }
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
  }
}

// Modal Save only persists client-side state in memory (this app doesn't
// write to board.db — read-only projection). Save just closes.
$('#card-save').addEventListener('click', () => {
  readModalIntoCard();
  render();
  closeCardModal();
});

$('#card-cancel').addEventListener('click', closeCardModal);
backdrop.addEventListener('click', closeCardModal);

// ---------- topbar bindings -------------------------------------------------

$('#view-studio').addEventListener('click', () => setView('studio'));
$('#view-all').addEventListener('click',    () => setView('all'));

$('#search').addEventListener('input', (e) => {
  state.filter = e.target.value.trim();
  render();
});

$('#hide-empty').addEventListener('change', (e) => {
  state.hideEmpty = e.target.checked;
  render();
});

$('#refresh').addEventListener('click', loadAndRender);

$('#add-list').addEventListener('click', () => {
  // Only meaningful in All view (Studio is curated)
  if (state.view !== 'all') {
    alert('Virtual lists can only be added in the All view. Switch to All to reorganise.');
    return;
  }
  const title = prompt('New list title?');
  if (!title) return;
  const id = 'LIST-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)
    + '-' + Math.random().toString(36).slice(2, 6);
  state.lists.push({ id, title, path: title, virtual: true });
  render();
});

// ---------- Drag & drop (only meaningful in All view) -----------------------

function attachDnD(ul) {
  ul.addEventListener('dragover', (e) => {
    if (state.view !== 'all') return;
    e.preventDefault();
    ul.classList.add('drop-target');
  });
  ul.addEventListener('dragleave', () => ul.classList.remove('drop-target'));
  ul.addEventListener('drop', (e) => {
    if (state.view !== 'all') return;
    e.preventDefault();
    ul.classList.remove('drop-target');
    // Note: move is presentation-only because we don't write to board.db.
    const cardId = e.dataTransfer.getData('text/card-id');
    if (!cardId || !state.cards[cardId]) return;
    state.cards[cardId].listId = ul.dataset.listId;
    render();
  });
}

// Add card-row level draggable for All view only
const cardObserver = new MutationObserver(() => {
  if (state.view !== 'all') {
    $$('.card').forEach((li) => li.draggable = false);
    return;
  }
  $$('.card').forEach((li) => {
    li.draggable = true;
    if (!li._wired) {
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/card-id', li.dataset.cardId);
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li._wired = true;
    }
  });
});
cardObserver.observe($('#board'), { childList: true, subtree: true });

// ---------- init ------------------------------------------------------------

(async function init() {
  state.view = loadViewPref();
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.id === `view-${state.view}`));
  document.getElementById('hide-empty').checked = state.hideEmpty;
  await loadAndRender();
})();
