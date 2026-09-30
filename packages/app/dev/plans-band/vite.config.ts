import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * A browser harness for the Plans band (alberto-conan-ui/ai-lore-companion#34). The companion is an Electron app that a
 * browser cannot open; this page shows the band in Chrome with the real renderer code (`BandPlans`, `usePlansState`, the
 * Space dashboard's shell and styles) and the real main-side service (`src/main/space/plans.ts`, loaded by this dev
 * server), with `window.cockpit` replaced by a few fetch calls to this server. Nothing else of the app is here.
 *
 *     npm run dev:plans-band -w @ai-lore-companion/app        then open http://localhost:5199/
 *
 * `PLANS_SPACE` is the Space folder the tool is run in (it must hold tools/plan/plans.py). The default is the Space the
 * companion sits in (repos/ai-lore-companion/packages/app/dev/plans-band is five folders below it).
 *
 * The page's states, by `?sim=`: `demo` (the fake GitHub: a list), `incomplete`, `refused`, `unreachable`, `empty`, `none`
 * (a Space with no plans tool: the band is not drawn) and `live` (the real GitHub, through the same shared reader).
 * Opening a row starts `tools/plan/edit.py` (with `--demo` for the fake ones) when nothing answers on port 8765, and opens
 * the dashboard in a new tab.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SPACE = process.env.PLANS_SPACE ?? resolve(here, '../../../../../..');
const SIMS = ['demo', 'incomplete', 'refused', 'unreachable', 'empty', 'none', 'live'] as const;
type Sim = (typeof SIMS)[number];

function plansBackend(): Plugin {
  return {
    name: 'plans-backend',
    async configureServer(server) {
      const services = new Map<Sim, import('../../src/main/space/plans.ts').SpacePlans>();
      const service = async (sim: Sim) => {
        const held = services.get(sim);
        if (held) return held;
        const plans = (await server.ssrLoadModule(
          resolve(here, '../../src/main/space/plans.ts'),
        )) as typeof import('../../src/main/space/plans.ts');
        const core = (await server.ssrLoadModule('@ai-lore-companion/core')) as {
          execFileRunner: import('@ai-lore-companion/core').CommandRunner;
        };
        const env: Record<string, string> =
          sim === 'live'
            ? {}
            : {
                COCKPIT_PLANS_DEMO: '1',
                ...(sim === 'demo' || sim === 'none' ? {} : { COCKPIT_PLANS_SIMULATE: sim }),
              };
        const created = plans.createSpacePlans({
          runner: core.execFileRunner,
          root: SPACE,
          liveGitHub: true,
          env,
          toolExists: () => sim !== 'none',
        });
        services.set(sim, created);
        return created;
      };
      server.middlewares.use('/__plans', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const sim = SIMS.find((s) => s === url.searchParams.get('sim')) ?? 'demo';
        res.setHeader('content-type', 'application/json');
        try {
          const plans = await service(sim);
          if (url.pathname === '/refresh') {
            res.end(JSON.stringify({ ok: true, value: await plans.refresh() }));
          } else if (url.pathname === '/state') {
            res.end(JSON.stringify({ ok: true, value: plans.current() }));
          } else if (url.pathname === '/open') {
            res.end(JSON.stringify(await plans.open(Number(url.searchParams.get('number')))));
          } else {
            res.statusCode = 404;
            res.end('{"ok":false}');
          }
        } catch (caught) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(caught) }));
        }
      });
      server.httpServer?.once('close', () => {
        for (const plans of services.values()) plans.dispose();
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), plansBackend()],
  server: { port: 5199, strictPort: true },
});
