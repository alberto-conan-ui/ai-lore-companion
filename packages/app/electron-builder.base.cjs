/**
 * Extends target for `electron-builder.space.json` (M11.1).
 *
 * electron-builder's `extends` loads whatever file it points to and merges
 * that file's own top-level content as the parent configuration — it does
 * not know that this project's inline configuration lives nested under
 * `package.json`'s `build` key. Pointing `extends` straight at
 * `package.json` was tried and confirmed broken against the installed
 * `electron-builder`/`app-builder-lib` (25.1.8): it merges the whole file —
 * `name`, `scripts`, `dependencies`, and all — and leaves `appId`, `mac`,
 * `linux`, `files` and `extraResources` undefined, because those live one
 * level down, inside `build`.
 *
 * This file is the one line of indirection that makes `extends` reach the
 * real, inline configuration instead of that broken shortcut: it hands
 * electron-builder exactly the `build` object from `package.json`, so
 * `electron-builder.space.json` still restates nothing — the v0.8 build's
 * `appId`, `productName`, `mac`, `linux`, `files` and `extraResources` stay
 * defined in exactly one place.
 */
module.exports = require('./package.json').build;
