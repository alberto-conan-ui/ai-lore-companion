import type { JSX } from 'react';

/**
 * File-type icons for the navigator + changes panels (Read-only IDE P4). Crisp
 * inline SVG (no icon font — guaranteed to render, colour-controlled): one
 * folder glyph, and a page whose **colour is per-extension** (so `.ts`, `.js`,
 * `.json`, `.md`, `.yaml` … each read distinctly) over a **category mark** that
 * groups code / docs / data / images by shape. Colour does the fine
 * distinction; the mark does the coarse one.
 */

type Category = 'code' | 'doc' | 'data' | 'image' | 'archive' | 'generic';

/** Coarse category → fallback colour (used when an extension has no own colour). */
const CATEGORY_COLOR: Record<Category | 'folder', string> = {
  folder: '#7e9bbf',
  code: '#e6c07b',
  doc: '#8ab4e8',
  data: '#d19a66',
  image: '#98c379',
  archive: '#c678dd',
  generic: '#8b97a3',
};

/** Per-extension colour — the fine distinction the user asked for. Roughly the
 *  language's own brand hue where there is one. */
const EXT_COLOR: Record<string, string> = {
  ts: '#3d8fd1',
  tsx: '#3d8fd1',
  js: '#e8d44d',
  jsx: '#e8d44d',
  mjs: '#e8d44d',
  cjs: '#e8d44d',
  json: '#d4a363',
  yaml: '#d1574d',
  yml: '#d1574d',
  toml: '#bb8b66',
  xml: '#9bbf6a',
  csv: '#7f9f5f',
  md: '#7fa8d9',
  markdown: '#7fa8d9',
  mdx: '#7fa8d9',
  txt: '#9aa6b2',
  css: '#a974d6',
  html: '#e08a4b',
  py: '#6fa8dc',
  rs: '#d98a5e',
  go: '#5fc9e8',
  rb: '#e06c6c',
  sh: '#9bd06a',
  bash: '#9bd06a',
  zsh: '#9bd06a',
  svg: '#c678dd',
  png: '#98c379',
  jpg: '#98c379',
  jpeg: '#98c379',
  gif: '#98c379',
  webp: '#98c379',
  pdf: '#e06c6c',
  zip: '#c0a060',
  dmg: '#c0a060',
  lock: '#8b97a3',
  env: '#c9b458',
  ini: '#c9b458',
};

const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'sh',
  'bash',
  'zsh',
  'c',
  'h',
  'cpp',
  'rb',
  'java',
  'css',
  'html',
  'vue',
  'svelte',
]);
const DOC = new Set(['md', 'markdown', 'mdx', 'txt', 'rst', 'adoc']);
const DATA = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'ini', 'env', 'lock']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'icns', 'bmp']);
const ARCHIVE = new Set(['zip', 'gz', 'tar', 'tgz', 'dmg', 'pdf', 'bin']);

function categoryOf(ext: string): Category {
  if (CODE.has(ext)) return 'code';
  if (DOC.has(ext)) return 'doc';
  if (DATA.has(ext)) return 'data';
  if (IMAGE.has(ext)) return 'image';
  if (ARCHIVE.has(ext)) return 'archive';
  return 'generic';
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The page silhouette (folded corner) shared by every file. */
const PAGE =
  'M4 1.75h4.4L12 5.35V13.4a.75.75 0 0 1-.75.75H4.75A.75.75 0 0 1 4 13.4V2.5a.75.75 0 0 1 .75-.75Z';
const FOLD = 'M8.3 1.95V5a.5.5 0 0 0 .5.5h3';

/** The small interior mark per category (stroked, centred low on the page). */
function mark(cat: Category, color: string): JSX.Element | null {
  const s = {
    stroke: color,
    strokeWidth: 1,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (cat) {
    case 'code':
      return <path d="M6.7 8.4 5.4 9.8l1.3 1.3M9.3 8.4l1.3 1.4-1.3 1.3" {...s} />;
    case 'doc':
      return <path d="M5.9 8.5h4.2M5.9 10.1h4.2M5.9 11.7h2.6" {...s} />;
    case 'data':
      return (
        <path
          d="M7 8.3c-.7 0-.6.8-.6 1.2 0 .5-.4.6-.6.6.2 0 .6.1.6.6 0 .4-.1 1.2.6 1.2M9 8.3c.7 0 .6.8.6 1.2 0 .5.4.6.6.6-.2 0-.6.1-.6.6 0 .4.1 1.2-.6 1.2"
          {...s}
        />
      );
    case 'image':
      return <path d="M5.7 12.1 7.6 10l1.2 1.2 1.2-1.4 1.3 1.9M6.5 8.7v.01" {...s} />;
    default:
      return null;
  }
}

/** A 14×14 icon for a tree/grid row. `isDir` renders the folder glyph; otherwise
 *  the extension drives colour and the category drives the interior mark. */
export function FileIcon({ name, isDir }: { name: string; isDir: boolean }): JSX.Element {
  if (isDir) {
    const c = CATEGORY_COLOR.folder;
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={iconStyle}>
        <path
          d="M1.75 4.35c0-.6.46-1.05 1.05-1.05h2.45l1.2 1.4h5.75c.6 0 1.05.46 1.05 1.05v5.45c0 .6-.46 1.05-1.05 1.05H2.8c-.6 0-1.05-.46-1.05-1.05V4.35Z"
          fill={c}
          fillOpacity="0.85"
          stroke={c}
          strokeWidth="0.6"
        />
      </svg>
    );
  }
  const ext = extOf(name);
  const cat = categoryOf(ext);
  const c = EXT_COLOR[ext] ?? CATEGORY_COLOR[cat];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={iconStyle}>
      <path
        d={PAGE}
        fill={c}
        fillOpacity="0.15"
        stroke={c}
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
      <path d={FOLD} fill="none" stroke={c} strokeWidth="1.05" strokeLinejoin="round" />
      {mark(cat, c)}
    </svg>
  );
}

const iconStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'block',
};
