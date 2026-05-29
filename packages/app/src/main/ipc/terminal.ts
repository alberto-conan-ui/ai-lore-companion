import type {
  TerminalInputArg,
  TerminalResizeArg,
  TerminalSpawnEngineArg,
} from '../../shared/ipc.js';
import type { RegisterModule } from './types.js';

/** Terminal PTY lifecycle — spawn (plain + engine), input, resize, kill. */
export const registerTerminal: RegisterModule = (reg, deps) => {
  reg.handle('spawnTerminal', (event) => {
    const ctx = deps.contextFor(event);
    return ctx ? ctx.ptyService.spawn() : '';
  });

  reg.handle('spawnTerminalEngine', (event, arg: TerminalSpawnEngineArg) => {
    const ctx = deps.contextFor(event);
    if (!ctx) return '';
    return ctx.ptyService.spawn({ binary: arg.binary, args: arg.args });
  });

  reg.on('sendTerminalInput', (event, arg: TerminalInputArg) => {
    deps.contextFor(event)?.ptyService.write(arg.id, arg.data);
  });

  reg.on('resizeTerminal', (event, arg: TerminalResizeArg) => {
    deps.contextFor(event)?.ptyService.resize(arg.id, arg.cols, arg.rows);
  });

  reg.on('killTerminal', (event, id) => {
    deps.contextFor(event)?.ptyService.kill(id);
  });
};
