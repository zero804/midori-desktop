import { existsSync, promises as fs } from 'fs';
import { resolve } from 'path';
import fetch from 'node-fetch';

import { windowsManager } from '..';
import { ElectronBlocker, Request } from '@cliqz/adblocker-electron';
import { getPath } from '~/utils';
import { ipcMain } from 'electron';

export let engine: ElectronBlocker;

const loadFilters = async () => {
  const path = resolve(getPath('adblock/cache.dat'));

  const downloadFilters = async () => {
    // Load lists to perform ads and tracking blocking:
    //
    //  - https://easylist.to/easylist/easylist.txt
    //  - https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext
    //  - https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/resource-abuse.txt
    //  - https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt
    //  - https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt
    //  - https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt
    //
    //  - https://easylist.to/easylist/easyprivacy.txt
    //  - https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt
    engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);

    try {
      await fs.writeFile(path, engine.serialize());
    } catch (err) {
      if (err) return console.error(err);
    }
  };

  if (existsSync(path)) {
    try {
      const buffer = await fs.readFile(resolve(path));

      try {
        engine = ElectronBlocker.deserialize(buffer);
      } catch (e) {
        return downloadFilters();
      }
    } catch (err) {
      return console.error(err);
    }
  } else {
    return downloadFilters();
  }
};

export const runAdblockService = (ses: any) => {
  if (!ses.webRequest.listeners || ses.id1) return;

  ses.id1 = '';

  const emitBlockedEvent = (request: Request) => {
    for (const window of windowsManager.list) {
      window.webContents.send(`blocked-ad-${request.tabId}`);
    }
  };

  loadFilters().then(() => {
    engine.enableBlockingInSession(ses);

    const item: any = Array.from(
      ses.webRequest.listeners.get('onBeforeRequest'),
    ).pop();

    const item2: any = Array.from(
      ses.webRequest.listeners.get('onHeadersReceived'),
    ).pop();

    if (item && item2) {
      ses.id1 = item[1];
      ses.id2 = item2[1];
    }

    engine.on('request-blocked', emitBlockedEvent);
    engine.on('request-redirected', emitBlockedEvent);
  });
};

export const stopAdblockService = (ses: any) => {
  if (!ses.webRequest.listeners) return;
  try {
    if (engine) {
      engine.disableBlockingInSession(ses);
    }
  } catch (e) {
    if (ses.id1) {
      ses.webRequest.removeListener('onBeforeRequest', ses.id1.id);
      delete ses.id1;
    }

    if (ses.id2) {
      ses.webRequest.removeListener('onHeadersReceived', ses.id2.id);
      delete ses.id2;
    }
  }
};
