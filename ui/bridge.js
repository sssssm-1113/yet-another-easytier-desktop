/* Native bridge + browser preview mock */
(function () {
  const hasNative = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.et);
  const listeners = {};
  const pending = new Map();
  let seq = 1;

  window.__etResolve = function (id, payload) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (payload && payload.error) p.reject(new Error(payload.error));
    else p.resolve(payload);
  };

  window.__etEvent = function (name, payload) {
    (listeners[name] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  };

  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  }

  function call(cmd, params, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const id = seq++;
      const timer = timeout > 0 ? setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('native timeout: ' + cmd));
        }
      }, timeout) : null;
      pending.set(id, { resolve, reject, timer });
      try {
        window.webkit.messageHandlers.et.postMessage(Object.assign({ id, cmd }, params || {}));
      } catch (e) {
        pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  const api = {
    on,
    init: () => call('init'),
    loadState: () => call('loadState'),
    saveState: (data) => call('saveState', { data }),
    startCore: (p) => call('startCore', p, 0),
    stopCore: (p) => call('stopCore', p, 0),
    cli: (p) => call('cli', p, 15000),
    readLog: (p) => call('readLog', p, 8000),
    chooseBinary: (p) => call('chooseBinary', p, 120000),
    setLoginItem: (p) => call('setLoginItem', p, 10000),
    openFolder: () => call('openFolder'),
    openInstanceFolder: (p) => call('openInstanceFolder', p),
    exportConfig: (p) => call('exportConfig', p, 120000),
    importConfig: () => call('importConfig', {}, 120000),
    openExternal: (url) => call('openExternal', { url }),
    setKeepInMenuBar: (p) => call('setKeepInMenuBar', p),
    updateMenu: (p) => call('updateMenu', p),
    quit: () => call('quit'),
    log: (message) => call('log', { message })
  };

  if (hasNative) {
    window.EasyTierBridge = api;
    return;
  }

  /* ---------- browser preview ---------- */

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const KEY = 'easytier.preview.state';

  const mock = Object.assign({}, api, {
    init: async () => ({
      coreAvailable: false,
      cliAvailable: false,
      coreVersion: '',
      cliVersion: '',
      loginItem: false,
      appVersion: '1.0.0',
      supportDir: '~/Library/Application Support/EasyTier Desktop',
      hostname: 'MacBook Pro',
      os: 'macOS (Preview)'
    }),
    loadState: async () => ({ data: localStorage.getItem(KEY) }),
    saveState: async (data) => { localStorage.setItem(KEY, data); return { ok: true }; },
    startCore: async () => { await wait(300); return { ok: true }; },
    stopCore: async () => ({ ok: true }),
    cli: async () => ({ ok: false, status: 1, stdout: '', stderr: 'easytier-cli not installed' }),
    readLog: async () => ({ data: '', offset: 0 }),
    chooseBinary: async () => ({ ok: false }),
    setLoginItem: async (p) => ({ ok: true, enabled: !!(p && p.enabled) }),
    openFolder: async () => ({ ok: true }),
    openInstanceFolder: async () => ({ ok: true }),
    exportConfig: async (p) => {
      const blob = new Blob([p.content || ''], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.filename || 'config.toml';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      return { ok: true };
    },
    importConfig: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.toml,.txt';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) { resolve({ ok: false }); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ ok: true, name: file.name.replace(/\.[^.]+$/, ''), content: reader.result });
        reader.readAsText(file);
      };
      input.click();
    }),
    openExternal: async (url) => { window.open(url, '_blank'); return { ok: true }; },
    setKeepInMenuBar: async () => ({ ok: true }),
    updateMenu: async () => ({ ok: true }),
    quit: async () => ({ ok: true }),
    log: async (message) => { console.log('[UI]', message); return { ok: true }; }
  });

  window.EasyTierBridge = mock;
})();
