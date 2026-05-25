import { type JSX, useEffect, useState } from 'react';
import type { Shortcut } from '../../../shared/ipc.js';
import { ActionButton } from './ActionButton.js';

type Row = 'project' | 'lore' | 'other';

/**
 * One row of the cockpit header's action toolbar. Row labels match the
 * internal shortcut targets directly:
 *
 *  - **Project** — `target === 'project'` — opens the project root.
 *  - **Lore** — `target === 'lore'` — opens the AI-Lore companion folder.
 *  - **Other** — `target === 'url' || 'terminal'`.
 *
 * Each shortcut renders as an `ActionButton` with its native icon when an app
 * is configured (`iconUrl`), or a glyph fallback (`▸` / `🌐` / `❯`). The label
 * is derived from the shortcut data — `appName(s.app)`, URL host, or command —
 * so a row reads as the row label plus just the thing being opened.
 *
 * The list is kept live via `onShortcutsChanged`.
 */
export function ShortcutButtons({ row }: { row: Row }): JSX.Element {
  const [list, setList] = useState<Shortcut[]>([]);

  useEffect(() => {
    void window.cockpit.shortcutsList().then(setList);
    return window.cockpit.onShortcutsChanged(setList);
  }, []);

  const filtered = list.filter((s) => {
    if (row === 'project') return s.target === 'project';
    if (row === 'lore') return s.target === 'lore';
    return s.target === 'url' || s.target === 'terminal';
  });

  return (
    <>
      {filtered.map((s) => (
        <ActionButton
          key={s.id}
          icon={iconFor(s)}
          label={displayLabel(s)}
          testId="shortcut-run"
          title={shortcutTitle(s)}
          onClick={() => window.cockpit.shortcutsRun(s.id)}
        />
      ))}
    </>
  );
}

/** A small `<img>` for native icons, or a unicode glyph by target. */
function iconFor(s: Shortcut): JSX.Element | string {
  if (s.iconUrl) {
    return (
      <img
        src={s.iconUrl}
        alt=""
        style={{ width: '1.5rem', height: '1.5rem', objectFit: 'contain' }}
      />
    );
  }
  if (s.target === 'url') return '🌐';
  if (s.target === 'terminal') return '❯';
  return '▸';
}

/** Strip the `/Applications/Foo.app` → `Foo`. */
function appName(appPath: string): string {
  return (appPath.split('/').pop() ?? appPath).replace(/\.app$/i, '');
}

/** Best-effort host extract — `https://localhost:4200/foo` → `localhost:4200`. */
function urlHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** What the button shows — terse, derived from the shortcut's data. */
function displayLabel(s: Shortcut): string {
  if (s.target === 'url' && s.url) return urlHost(s.url);
  if (s.target === 'terminal' && s.command) return s.command;
  if (s.app) return appName(s.app);
  return s.label;
}

function shortcutTitle(s: Shortcut): string {
  if (s.target === 'url' && s.url) return `Open ${s.url}`;
  if (s.target === 'terminal' && s.command) return `Run: ${s.command}`;
  if (s.app)
    return `Open the ${s.target === 'lore' ? 'Lore folder' : 'project folder'} in ${s.app}`;
  return s.label;
}
