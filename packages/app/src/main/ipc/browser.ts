import { BrowserWindow } from 'electron';
import { loadBrowserProfile, saveBrowserProfile } from '../browser-prefs.js';
import * as browser from '../browser.js';
import type { RegisterModule } from './types.js';

/** Embedded `WebContentsView` browser tabs — create, navigate, profile, etc. */
export const registerBrowser: RegisterModule = (reg, deps) => {
  reg.on('browserCreate', (event, tabId, initialUrl) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) browser.create(win, tabId, loadBrowserProfile(deps.getUserDataDir()), initialUrl);
  });
  reg.on('browserDestroy', (_event, tabId) => {
    browser.destroy(tabId);
  });
  reg.handle('browserGetUrl', (_event, tabId) => browser.getUrl(tabId));
  reg.on('browserSetVisible', (_event, tabId, visible) => {
    browser.setVisible(tabId, visible);
  });
  reg.on('browserSetBounds', (_event, tabId, bounds) => {
    browser.setBounds(tabId, bounds);
  });
  reg.on('browserNavigate', (_event, tabId, url) => {
    browser.navigate(tabId, url);
  });
  reg.on('browserGoBack', (_event, tabId) => {
    browser.goBack(tabId);
  });
  reg.on('browserGoForward', (_event, tabId) => {
    browser.goForward(tabId);
  });
  reg.on('browserReload', (_event, tabId) => {
    browser.reload(tabId);
  });
  reg.on('browserSetProfile', (_event, tabId, profile) => {
    saveBrowserProfile(deps.getUserDataDir(), profile);
    browser.setProfile(tabId, profile);
  });
  reg.on('browserSuppressAll', (event, suppress) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) browser.suppressAll(win.id, suppress);
  });
};
