import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import type { SpaceSkill, SpaceSkillsList } from '../../../../shared/ipc.js';

type Props = {
  /** The terminal of the AI tab the column belongs to. */
  ptyId: string;
  /** Give the keyboard back to the terminal after a skill is inserted. */
  focusPty: () => void;
  /** The tab's engine, whose adapter decides each skill's `invocation` (M10.5); `null` uses `/lore:<name>`. */
  engineId: string | null;
};

const PARTS: readonly SpaceSkill['part'][] = ['processes', 'verbs'];

/**
 * The Skills column of an AI tab in a Space window (phase M4.6): the skills of
 * the Space's install into Claude Code, as `lore:<name>`, with the sentence of
 * the card's index line and its layer, grouped by part (processes, verbs).
 *
 * Clicking a skill types `/lore:<name>` into this tab's terminal without a
 * newline, so the Human Lead can add to it before sending, and gives the
 * keyboard back to the terminal. The list is read when the column mounts and
 * again when the window regains focus (after an install, for example).
 */
export function SkillsColumn({ ptyId, focusPty, engineId }: Props): JSX.Element {
  const [list, setList] = useState<SpaceSkillsList | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const read = (): void => {
      void window.cockpit.spaceSkillsList(engineId !== null ? { engineId } : {}).then((result) => {
        if (!live) return;
        if (result.ok) {
          setList(result.value);
          setProblem(null);
        } else {
          setProblem(result.error.message);
        }
      });
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
    };
  }, [engineId]);

  const insert = (invocation: string): void => {
    window.cockpit.sendTerminalInput({ id: ptyId, data: invocation });
    focusPty();
  };

  return (
    <nav style={columnStyle} aria-label="Skills" data-testid="skills-column">
      {problem ? (
        <p style={noteStyle} role="alert" data-testid="skills-problem">
          {problem}
        </p>
      ) : null}
      {list && list.skills.length === 0 && !problem ? (
        <p style={noteStyle} data-testid="skills-empty">
          No skill is installed. Run the setup step that installs the Lore into Claude Code.
        </p>
      ) : null}
      {list
        ? PARTS.map((part) => {
            const rows = list.skills.filter((skill) => skill.part === part);
            if (rows.length === 0) return null;
            const headingId = `skills-${part}`;
            return (
              <section key={part} aria-labelledby={headingId} data-testid={`skills-group-${part}`}>
                <h3 id={headingId} style={groupStyle}>
                  {part}
                </h3>
                {rows.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    style={rowStyle}
                    onClick={() => insert(skill.invocation)}
                    title={`Insert ${skill.invocation}`}
                    data-testid={`skill-row-${skill.name}`}
                  >
                    <span style={nameLineStyle}>
                      <span style={nameStyle}>lore:{skill.name}</span>
                      <span style={layerStyle} data-testid="skill-layer">
                        {skill.layer}
                      </span>
                    </span>
                    {skill.description ? (
                      <span style={descriptionStyle}>{skill.description}</span>
                    ) : null}
                  </button>
                ))}
              </section>
            );
          })
        : null}
      {list && list.notInstalled.length > 0 ? (
        <p style={noteStyle} data-testid="skills-not-installed">
          Without an installed skill: {list.notInstalled.join(', ')}. Install the Lore again to add
          them.
        </p>
      ) : null}
    </nav>
  );
}

const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.5rem 0',
};

const groupStyle: CSSProperties = {
  margin: 0,
  padding: '0.35rem 0.85rem 0.15rem',
  fontSize: '0.68rem',
  fontWeight: 700,
  color: 'var(--color-text-soft)',
  letterSpacing: '0.08em',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  width: '100%',
  padding: '0.3rem 0.85rem',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
};

const nameLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.4rem',
  width: '100%',
};

const nameStyle: CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--color-purple)',
};

const layerStyle: CSSProperties = {
  fontSize: '0.65rem',
  color: 'var(--color-text-muted)',
};

const descriptionStyle: CSSProperties = {
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.72rem',
  lineHeight: 1.35,
  color: 'var(--color-text-dim)',
};

const noteStyle: CSSProperties = {
  margin: 0,
  padding: '0.5rem 0.85rem',
  fontSize: '0.75rem',
  lineHeight: 1.5,
  color: 'var(--color-text-muted)',
};
