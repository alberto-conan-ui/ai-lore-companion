import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  type EngineEntry,
  claudeCodeInstallPaths,
  execFileRunner,
  installClaudeCode,
  listSessionCloses,
  readLore,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { type McpHost, createMcpHost } from '../../../src/main/helper/mcp-host.js';
import type { PtyService } from '../../../src/main/pty.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { createSpaceSessionsRegister } from '../../../src/main/space/ipc/sessions.js';
import {
  configureSessionServer,
  sessionServer,
} from '../../../src/main/space/session-server/index.js';
import type {
  SpaceSessionHeader,
  SpaceSessionHeaderResult,
  SpaceSessionLeaveWritingResult,
  SpaceSessionStartResult,
  SpaceSkillsResult,
} from '../../../src/shared/ipc.js';
import { LORE_TEMPLATE_DIR, spaceHarnessFor } from './space-harness.js';

// Phase M4.6: the channels the session header and the Skills column use. The header is read
// from the desk and pushed when the broker changes the mode; Leave Writing is the broker's
// step; the skills are the Lore's verbs and processes that the install holds.

let space: SpaceFixture;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'header-space',
    repositories: ['app'],
  });
});

after(() => space.cleanup());

const ENGINES: EngineEntry[] = [{ id: 'claude-code', name: 'Claude Code', binary: 'claude' }];

test('the header follows the desk, Leave Writing releases the claims, and the skills are listed', async () => {
  const mcp: McpHost = createMcpHost();
  await mcp.listen();
  configureSessionServer({ host: async () => mcp });
  const h = spaceHarnessFor(
    createSpaceSessionsRegister(() => ({
      engines: () => ENGINES,
      loginPath: async () => null,
      runner: () => execFileRunner,
      newId: () => `s-hdr-${Math.random().toString(16).slice(2, 8)}`,
      // M9.7: readiness also probes the engine; here it is always installed and signed in.
      probeEngine: async (engine) => ({
        engineId: engine.id,
        name: engine.name,
        binary: engine.binary,
        state: { kind: 'fine', version: null },
        guidance: null,
        command: null,
        catalogId: null,
        maker: null,
        required: false,
        guardedSessions: true,
        installed: { kind: 'installed', version: null },
        signIn: { kind: 'signed-in' },
        installCommand: null,
        installNeeds: null,
        signInCommand: null,
        note: null,
        page: null,
      }),
    })),
  );
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    let spawned = 0;
    context.ptyService = {
      spawn: () => `pty-${++spawned}`,
      write: () => {},
      resize: () => {},
      kill: () => {},
      killAll: () => {},
      hasRunningTask: () => false,
    } as unknown as PtyService;

    // Before the install: no skill, and every verb and process is named as not installed.
    const before = (await h.invoke('spaceSkillsList', spaceWindow, {})) as SpaceSkillsResult;
    assert.ok(before.ok);
    assert.equal(before.value.skills.length, 0);
    assert.ok(before.value.notInstalled.length > 0);

    const lore = await readLore(space.root);
    assert.ok(lore.ok);
    assert.ok((await installClaudeCode(lore.value, context.desk.install)).ok);

    const skills = (await h.invoke('spaceSkillsList', spaceWindow, {})) as SpaceSkillsResult;
    assert.ok(skills.ok);
    assert.deepEqual(skills.value.notInstalled, []);
    const parts = new Set(skills.value.skills.map((skill) => skill.part));
    assert.deepEqual([...parts].sort(), ['processes', 'verbs']);
    const verbs = lore.value.parts.verbs.map((entry) => entry.name);
    assert.deepEqual(
      skills.value.skills.filter((skill) => skill.part === 'verbs').map((skill) => skill.name),
      verbs,
    );
    for (const skill of skills.value.skills) {
      assert.ok(['core', 'default', 'own'].includes(skill.layer));
    }
    // The description is the installed one, which is what Claude Code shows.
    const first = skills.value.skills[0];
    assert.ok(first);
    const skillFile = join(
      claudeCodeInstallPaths(context.desk.install).skills,
      first.name,
      'SKILL.md',
    );
    writeFileSync(
      skillFile,
      readFileSync(skillFile, 'utf8').replace(/^description: .*$/m, 'description: As installed.'),
    );
    const reread = (await h.invoke('spaceSkillsList', spaceWindow, {})) as SpaceSkillsResult;
    assert.ok(reread.ok);
    assert.equal(
      reread.value.skills.find((skill) => skill.name === first.name)?.description,
      'As installed.',
    );
    // M10.5: `invocation` is `/lore:<name>` with no engine, or Claude Code's own; a Codex
    // engine id gives Codex's sentence.
    assert.ok(skills.value.skills.every((skill) => skill.invocation === `/lore:${skill.name}`));
    const claudeInvocation = (await h.invoke('spaceSkillsList', spaceWindow, {
      engineId: 'default.claude',
    })) as SpaceSkillsResult;
    assert.ok(claudeInvocation.ok);
    assert.ok(
      claudeInvocation.value.skills.every((skill) => skill.invocation === `/lore:${skill.name}`),
    );
    const codexInvocation = (await h.invoke('spaceSkillsList', spaceWindow, {
      engineId: 'default.codex',
    })) as SpaceSkillsResult;
    assert.ok(codexInvocation.ok);
    assert.ok(
      codexInvocation.value.skills.every(
        (skill) =>
          skill.invocation === `Run the Lore's ${skill.name}: read its card and follow it.`,
      ),
    );
    // A window that is not a 1.0 window of this Space gets neither the skills nor a header.
    const v08 = { webContentsId: 424_242 };
    const v08Skills = (await h.invoke('spaceSkillsList', v08, {})) as { error?: { kind: string } };
    assert.equal(v08Skills.error?.kind, 'not-a-space-window');
    const insidePage = {
      webContentsId: spaceWindow.webContents.id,
      frame: 'inside-the-page' as const,
    };
    const framed = (await h.invoke('spaceSkillsList', insidePage, {})) as {
      error?: { kind: string };
    };
    assert.equal(framed.error?.kind, 'not-a-space-window');
    const invalid = (await h.invoke('spaceSkillsList', spaceWindow, { extra: 1 })) as {
      error?: { kind: string };
    };
    assert.equal(invalid.error?.kind, 'invalid-argument');

    const started = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: [],
    })) as SpaceSessionStartResult;
    assert.ok(started.ok, JSON.stringify(started));
    const { sessionId } = started.value;

    const readOnly = (await h.invoke('spaceSessionHeader', spaceWindow, {
      sessionId,
    })) as SpaceSessionHeaderResult;
    assert.ok(readOnly.ok);
    assert.equal(readOnly.value.mode, 'read-only');
    assert.deepEqual(readOnly.value.targets, []);
    assert.equal(readOnly.value.item, null);
    assert.equal(readOnly.value.engineId, 'claude-code');

    // The session enters Writing through the broker: the header is pushed to the window.
    const broker = context.service(sessionServer).broker;
    const asked = broker.forSession(sessionId).requestWriting({
      targets: [{ kind: 'lore' }],
      reason: 'the test writes the Lore',
    });
    assert.ok(asked.ok);
    const answered = broker.answerWriting(asked.value.ticket, { confirm: true });
    assert.ok(answered.ok && answered.value.granted);
    const pushes = () =>
      spaceWindow.sent
        .filter((message) => message.channel === 'space:on-session-header')
        .map((message) => message.payload as SpaceSessionHeader);
    const writingPush = pushes().at(-1);
    assert.equal(writingPush?.sessionId, sessionId);
    assert.equal(writingPush?.mode, 'writing');
    assert.deepEqual(writingPush?.targets, [{ kind: 'lore' }]);

    const writing = (await h.invoke('spaceSessionHeader', spaceWindow, {
      sessionId,
    })) as SpaceSessionHeaderResult;
    assert.ok(writing.ok);
    assert.equal(writing.value.mode, 'writing');

    // The Files window may not leave Writing for a session; an unknown session is refused.
    h.space.host.openFilesWindow(context);
    const filesWindow = h.space.created[1];
    assert.ok(filesWindow);
    const stranger = (await h.invoke('spaceSessionLeaveWriting', filesWindow, {
      sessionId,
    })) as { error?: { kind: string } };
    assert.equal(stranger.error?.kind, 'not-a-space-window');
    for (const [channel, arg] of [
      ['spaceSessionHeader', { sessionId }],
      ['spaceSkillsList', {}],
    ] as const) {
      const fromFiles = (await h.invoke(channel, filesWindow, arg)) as { error?: { kind: string } };
      assert.equal(fromFiles.error?.kind, 'not-a-space-window', channel);
      const fromV08 = (await h.invoke(channel, { webContentsId: 424_242 }, arg)) as {
        error?: { kind: string };
      };
      assert.equal(fromV08.error?.kind, 'not-a-space-window', channel);
    }
    const unknown = (await h.invoke('spaceSessionLeaveWriting', spaceWindow, {
      sessionId: 's-nobody',
    })) as { error?: { kind: string } };
    assert.equal(unknown.error?.kind, 'unknown-session');

    const left = (await h.invoke('spaceSessionLeaveWriting', spaceWindow, {
      sessionId,
    })) as SpaceSessionLeaveWritingResult;
    assert.ok(left.ok, JSON.stringify(left));
    assert.deepEqual(left.value.released, [{ kind: 'lore' }]);
    // Leaving Writing recorded the session close of the root it held.
    const desk = context.service(spaceDesk).open();
    assert.ok(desk.ok);
    const closes = listSessionCloses(desk.value);
    assert.ok(closes.ok);
    assert.ok(
      closes.value.some((close) => close.sessionId === sessionId),
      JSON.stringify(closes.value),
    );
    const readOnlyPush = pushes().at(-1);
    assert.equal(readOnlyPush?.mode, 'read-only');
    assert.deepEqual(readOnlyPush?.targets, []);

    const noSuch = (await h.invoke('spaceSessionHeader', spaceWindow, {
      sessionId: 's-nobody',
    })) as { error?: { kind: string } };
    assert.equal(noSuch.error?.kind, 'unknown-session');

    await h.invoke('spaceSessionEnd', spaceWindow, { sessionId });
    await h.space.host.windowClosed(filesWindow.id);
    await h.space.host.windowClosed(spaceWindow.id);
  } finally {
    configureSessionServer(null);
    await mcp.close();
    h.cleanup();
  }
});
