// Studio view = curated projection of board.db into ~4-5 columns of "what
// matters now". Card membership is decided by the board.db section path.
//
// Easy to tweak: edit STUDIO_COLUMNS below. Anything in board.db can be
// scooped up; section keys / parent prefixes are checked in order.

export const STUDIO_COLUMNS = [
  {
    id: 'triage',
    title: 'Triage',
    description: 'Inbox / discovery / workstreams — needs human triage before it becomes work.',
    sectionPrefixes: ['backlog/', 'named_workstreams/'],
  },
  {
    id: 'ready',
    title: 'Ready',
    description: 'Executable cards awaiting an owner.',
    sectionPrefixes: ['ready/'],
    sectionExact: ['ready'],
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    description: 'Active delivery.',
    sectionExact: ['in_progress'],
    sectionPrefixes: ['in_progress/'],
  },
  {
    id: 'blocked',
    title: 'Blocked',
    description: 'Parked / paused / Hazel-blocked.',
    sectionPrefixes: ['blocked/'],
    sectionExact: ['approved_with_caveats_paused_by_tom'],
  },
  {
    id: 'done',
    title: 'Done',
    description: 'Recently completed.',
    sectionExact: ['done'],
    maxCards: 30,
  },
];

/**
 * Build Studio projection from a snapshot.
 * @param {{sections: Array}} snapshot
 * @returns {{ columns: Array, cards: Array }}
 */
export function projectStudio(snapshot) {
  // Map section_key -> section
  const byKey = new Map(snapshot.sections.map((s) => [s.key, s]));

  // Flatten every card with its section reference.
  const allCards = [];
  for (const section of snapshot.sections) {
    for (const card of section.cards || []) {
      allCards.push({ ...card, sectionKey: section.key, sectionTitle: section.title, sectionPath: section.path });
    }
  }

  const columns = STUDIO_COLUMNS.map((col) => ({
    id: col.id,
    title: col.title,
    description: col.description || '',
    cards: [],
  }));
  const columnsById = Object.fromEntries(columns.map((c) => [c.id, c]));

  for (const card of allCards) {
    for (const col of STUDIO_COLUMNS) {
      const exact = (col.sectionExact || []).includes(card.sectionKey);
      const prefix = (col.sectionPrefixes || []).some((p) => card.sectionKey.startsWith(p));
      if (exact || prefix) {
        columnsById[col.id].cards.push(card);
        break;
      }
    }
  }

  // Cap Done column
  const doneCol = columnsById.done;
  if (doneCol && doneCol.cards.length > (STUDIO_COLUMNS.find((c) => c.id === 'done').maxCards || 30)) {
    doneCol.cards = doneCol.cards.slice(0, STUDIO_COLUMNS.find((c) => c.id === 'done').maxCards);
  }

  // Total counts
  const totalInStudio = columns.reduce((n, c) => n + c.cards.length, 0);

  return {
    description: 'Studio — curated current-state projection of the Myo board',
    columns,
    total: totalInStudio,
    totalAll: allCards.length,
  };
}
