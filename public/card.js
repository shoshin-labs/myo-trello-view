// Full-screen card page. Loads /api/studio to get the full card ordering, then
// pulls /api/card/:id for the current one. Renders markdown in a generous
// reader layout with ←/→ navigation, f for fullscreen, Esc back.

const $ = (s) => document.querySelector(s);

const qs = new URLSearchParams(location.search);
const initialId = qs.get('id') || (() => {
  // Fallback: last segment after /card/
  const m = location.pathname.match(/\/card\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
})();

let studioOrder = []; // array of card objects in studio projection order
let currentIdx = -1;

async function loadStudio() {
  const r = await fetch('/api/studio');
  const data = await r.json();
  studioOrder = [];
  for (const col of data.columns) {
    for (const card of col.cards) {
      studioOrder.push({ id: card.id, listId: col.id, listTitle: col.title });
    }
  }
}

function navigate(delta) {
  if (!studioOrder.length) return;
  const next = currentIdx + delta;
  if (next < 0 || next >= studioOrder.length) return;
  const card = studioOrder[next];
  location.href = `/card.html?id=${encodeURIComponent(card.id)}`;
}

async function loadCard(id) {
  $('#card-status').textContent = '';
  try {
    const r = await fetch(`/api/card/${encodeURIComponent(id)}`);
    if (!r.ok) {
      $('#card-article').hidden = true;
      $('#card-error').hidden = false;
      $('#card-error').textContent = r.status === 404
        ? `Card not found: ${id}`
        : `Failed to load card (HTTP ${r.status})`;
      document.title = `Not found · Myo board`;
      return;
    }
    const { card, meta } = await r.json();

    currentIdx = studioOrder.findIndex((c) => c.id === card.id);

    document.title = `${card.id} · Myo board`;
    $('#card-h1').textContent = card.id;

    const parts = (card.sectionPath || card.sectionTitle || '').split(' / ').filter(Boolean);
    const crumbs = parts.length
      ? parts.map((p, i) => {
          const sep = i ? `<span class="crumb-sep">›</span>` : '';
          return `${sep}<span>${escapeHtml(p)}</span>`;
        }).join('')
      : '<span>(uncategorised)</span>';
    $('#card-breadcrumb').innerHTML = crumbs;

    $('#card-meta-line').innerHTML = [
      `<span>${escapeHtml(card.sectionTitle || '')}</span>`,
      `<span class="dot">•</span>`,
      card.synthetic_id
        ? `<span class="label-chip synthetic">synthetic</span>`
        : '',
      `<span class="dot">•</span>`,
      `<span>${formatDate(meta.snapshot_at)}</span>`,
    ].join('');

    $('#card-labels').innerHTML = '';
    if (card.synthetic_id) {
      const chip = document.createElement('span');
      chip.className = 'label-chip synthetic';
      chip.textContent = 'synthetic';
      $('#card-labels').append(chip);
    }

    $('#card-body').innerHTML = marked.parse(card.body || '');

    $('#card-article').hidden = false;
    $('#card-error').hidden = true;

    // Update prev/next button enable state
    $('#prev-card').disabled = currentIdx <= 0;
    $('#next-card').disabled = currentIdx < 0 || currentIdx >= studioOrder.length - 1;
  } catch (e) {
    $('#card-article').hidden = true;
    $('#card-error').hidden = false;
    $('#card-error').textContent = 'Error: ' + e.message;
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (e) {
    console.error('fullscreen failed', e);
  }
}

document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
});

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

$('#prev-card').addEventListener('click', () => navigate(-1));
$('#next-card').addEventListener('click', () => navigate(+1));
$('#toggle-fullscreen').addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else history.back(); }
  else if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(+1);
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});

(async function init() {
  if (!initialId) {
    $('#card-error').hidden = false;
    $('#card-error').textContent = 'No card id supplied.';
    return;
  }
  await loadStudio();
  await loadCard(initialId);
})();
