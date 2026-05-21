const TYPE_GLYPH = { add: '+', change: '~', unlink: '−' };
const DRIFT_THRESHOLDS = { warn: 5, alert: 10 };

let currentRoot = null;
let queueDepth = 0;

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function updateDrift() {
  const badge = document.getElementById('drift');
  if (!badge) return;
  const countEl = document.getElementById('drift-count');
  if (countEl) countEl.textContent = String(queueDepth);
  badge.dataset.level =
    queueDepth === 0
      ? 'idle'
      : queueDepth >= DRIFT_THRESHOLDS.alert
        ? 'alert'
        : queueDepth >= DRIFT_THRESHOLDS.warn
          ? 'warn'
          : 'live';
  badge.setAttribute(
    'title',
    queueDepth === 0
      ? 'In sync — no unacked changes'
      : `${queueDepth} unacked change${queueDepth === 1 ? '' : 's'}`
  );
}

function renderEmptyState() {
  const queue = document.getElementById('queue');
  if (!queue) return;
  if (queue.querySelector('.queue-row')) return;
  if (queue.querySelector('.queue-empty')) return;
  const row = document.createElement('div');
  row.className = 'queue-empty';
  row.textContent = 'In sync — no unacked changes.';
  queue.append(row);
}

function buildRow(change) {
  const row = document.createElement('div');
  row.className = `queue-row queue-row--${change.type}`;
  row.dataset.id = change.id;

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = TYPE_GLYPH[change.type] || '?';

  const pathEl = document.createElement('span');
  pathEl.className = 'path';
  pathEl.textContent = change.relPath;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(change.ts);

  const ack = document.createElement('button');
  ack.className = 'ack';
  ack.type = 'button';
  ack.textContent = '✓';
  ack.title = 'Ack — remove from queue';
  ack.addEventListener('click', () => ackRow(row, change.id));

  row.append(glyph, pathEl, time, ack);
  return row;
}

function ackRow(row, id) {
  if (currentRoot) window.cockpit.ack(currentRoot, id);
  row.classList.add('queue-row--acking');
  setTimeout(() => {
    row.remove();
    queueDepth = Math.max(0, queueDepth - 1);
    updateDrift();
    renderEmptyState();
  }, 120);
}

window.cockpit.onChain((chain) => {
  currentRoot = chain.root;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('mode', chain.mode || '—');
  set('focus', chain.focus || '(no active focus)');
  set('active-child', chain.activeChild || '(leaf)');
  set('root', chain.root || '');
  set('lore', chain.lorePath || '');
});

window.cockpit.onRestore((data) => {
  const queue = document.getElementById('queue');
  if (!queue) return;
  const empty = queue.querySelector('.queue-empty');
  if (empty) empty.remove();
  // Iterate oldest → newest, prepend each, so DOM ends with newest on top.
  for (const entry of data.queue) {
    queue.prepend(buildRow(entry));
  }
  queueDepth = data.queue.length;
  updateDrift();
  renderEmptyState();
});

window.cockpit.onChange((change) => {
  const queue = document.getElementById('queue');
  if (!queue) return;
  const empty = queue.querySelector('.queue-empty');
  if (empty) empty.remove();
  if (change.replaces) {
    const oldRow = queue.querySelector(`[data-id="${change.replaces}"]`);
    if (oldRow) {
      oldRow.remove();
      queueDepth = Math.max(0, queueDepth - 1);
    }
  }
  queue.prepend(buildRow(change));
  queueDepth += 1;
  updateDrift();
});

document.addEventListener('DOMContentLoaded', () => {
  updateDrift();
  renderEmptyState();

  const ackAllBtn = document.getElementById('ack-all');
  if (ackAllBtn) {
    ackAllBtn.addEventListener('click', () => {
      if (!currentRoot) return;
      window.cockpit.ackAll(currentRoot);
      document.querySelectorAll('.queue-row').forEach((row) => {
        row.classList.add('queue-row--acking');
      });
      setTimeout(() => {
        document.querySelectorAll('.queue-row').forEach((row) => row.remove());
        queueDepth = 0;
        updateDrift();
        renderEmptyState();
      }, 120);
    });
  }
});
