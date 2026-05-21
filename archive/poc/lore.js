const path = require('path');
const fs = require('fs');

function findLoreFolder(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const lore = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('.ai-lore-')
  );
  return lore ? path.join(root, lore.name) : null;
}

function extractLink(text) {
  const m = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return m ? { title: m[1].trim(), href: m[2].trim() } : null;
}

function readH1(content) {
  const m = content.match(/^#\s+(.+)\s*$/m);
  return m ? m[1].trim() : null;
}

function readStatus(lorePath) {
  const statusPath = path.join(lorePath, 'memory/status/status.index.md');
  const content = fs.readFileSync(statusPath, 'utf-8');
  const modeMatch = content.match(/\|\s*\*\*Mode\*\*\s*\|\s*([^|]+?)\s*\|/);
  const focusMatch = content.match(
    /\|\s*\*\*Active focus\*\*\s*\|\s*(\[[^\]]+\]\([^)]+\))/
  );
  return {
    mode: modeMatch ? modeMatch[1].trim() : null,
    focusLink: focusMatch ? extractLink(focusMatch[1]) : null,
    statusDir: path.dirname(statusPath),
  };
}

function readTracker(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const title = readH1(content);
  const sections = content.split(/^##\s+/m);
  const activeSection = sections.find((s) => /^Active child pointer/.test(s));
  let activeChildLink = null;
  if (activeSection) {
    const body = activeSection.replace(/^Active child pointer\s*\n?/, '');
    activeChildLink = extractLink(body);
  }
  return {
    title,
    activeChildLink,
    fileDir: path.dirname(filePath),
  };
}

function readChain(root) {
  const lorePath = findLoreFolder(root);
  if (!lorePath) {
    return {
      error: `No .ai-lore-<name>/ folder found as a direct child of ${root}.`,
    };
  }
  try {
    const status = readStatus(lorePath);
    if (!status.focusLink) {
      return {
        mode: status.mode,
        focus: null,
        activeChild: null,
        root,
        lorePath,
      };
    }
    const focusPath = path.resolve(status.statusDir, status.focusLink.href);
    const focus = readTracker(focusPath);
    if (!focus) {
      return { error: `Focus file not found at ${focusPath}.` };
    }
    let activeChild = null;
    let cursor = focus;
    while (cursor && cursor.activeChildLink) {
      const nextPath = path.resolve(cursor.fileDir, cursor.activeChildLink.href);
      const next = readTracker(nextPath);
      if (!next) break;
      activeChild = next.title;
      cursor = next;
    }
    return {
      mode: status.mode,
      focus: focus.title,
      activeChild,
      root,
      lorePath,
    };
  } catch (e) {
    return { error: `Failed to read tracker chain: ${e.message}` };
  }
}

module.exports = { findLoreFolder, readStatus, readTracker, readChain };
