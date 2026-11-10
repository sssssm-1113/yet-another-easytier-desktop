/* =========================================================================
   EasyTier Desktop · app
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

const bridge = window.EasyTierBridge;

const TINTS = [
  { a: '#4C7DFF', b: '#2FB6F5', soft: 'rgba(76,125,255,.14)' },
  { a: '#10B981', b: '#37D6B0', soft: 'rgba(16,185,129,.14)' },
  { a: '#7C5CFC', b: '#B06BFF', soft: 'rgba(124,92,252,.14)' },
  { a: '#F59E0B', b: '#FBBF24', soft: 'rgba(245,158,11,.15)' },
  { a: '#F2557A', b: '#FB8A9E', soft: 'rgba(242,85,122,.13)' },
  { a: '#5B6B85', b: '#8A99B0', soft: 'rgba(91,107,133,.15)' }
];
const ACCENTS = ['#3F6DF6', '#10B981', '#7C5CFC', '#E39A1B', '#F2557A', '#0EA5E9'];

const QUICK_OPTIONS = [
  { key: 'enableEncryption', title: '加密传输', desc: '使用 WireGuard 加密全部流量' },
  { key: 'enableIPv6', title: 'IPv6 支持', desc: '同时监听 IPv6 地址' },
  { key: 'latencyFirst', title: '延迟优先', desc: '优先选择低延迟链路' },
  { key: 'multiThread', title: '多线程传输', desc: '提升高带宽场景吞吐' },
  { key: 'disableP2P', title: '禁用 P2P', desc: '仅通过中继节点转发' },
  { key: 'acceptDNS', title: '接受 DNS', desc: '使用网络下发的 DNS 配置' },
  { key: 'enableExitNode', title: '作为出口节点', desc: '允许其他节点经本机访问公网' },
  { key: 'noTun', title: '无 TUN 模式', desc: '不创建虚拟网卡（仅代理）' }
];

const DEFAULT_SETTINGS = {
  theme: 'system',
  accent: 0,
  refresh: 2,
  runAsRoot: true,
  autoConnectOnLaunch: true,
  keepInMenuBar: true,
  confirmDisconnect: false,
  launchAtLogin: false,
  showPublic: true,
  logLevel: 'info',
  quickOptions: ['disableP2P']
};

const S = {
  meta: null,
  profiles: [],
  settings: { ...DEFAULT_SETTINGS },
  runtime: {},
  ui: {
    view: 'overview',
    networkId: null,
    tab: 'overview',
    search: '',
    linkFilter: 'all',
    sort: 'default',
    expanded: null,
    logLevel: 'all',
    logSearch: '',
    autoScroll: true,
    advanceOpen: false,
    revealSecret: {},
    ready: false
  },
  draft: null,
  dirty: false,
  sheet: null,
  tickCounter: 0,
  menuTimer: null
};

const isDemo = () => !(S.meta && S.meta.coreAvailable && S.meta.cliAvailable);
const coreVersionShort = () => {
  const raw = String((S.meta && S.meta.coreVersion) || '');
  const m = raw.match(/\d+\.\d+\.\d+[\w.+-]*/);
  return m ? m[0] : '';
};

/* ------------------------------------------------------------------ utils */

const fmtBytes = (n) => {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};
const fmtLat = (v) => (v == null || v <= 0 ? '—' : v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v)));
const fmtPct = (v) => (v == null ? '—' : `${v < 10 ? v.toFixed(2) : v.toFixed(1)}%`);
const fmtDur = (sec) => {
  if (!sec || sec < 1) return '00:00';
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
};
const timeAgo = (iso) => {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const pct = (a, b) => (b ? Math.min(100, Math.max(0, (a / b) * 100)) : 0);
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const fmtTime = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:${String(x.getSeconds()).padStart(2, '0')}`;
};
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

function tintVars(i) {
  const t = TINTS[i % TINTS.length];
  return `--tint-a:${t.a};--tint-b:${t.b};--tint-bg:${t.soft};--tint:${t.a}`;
}

function netSymbol(p) {
  const n = (p.name + p.hostname).toLowerCase();
  if (n.includes('工作') || n.includes('studio')) return 'monitor';
  if (n.includes('客户') || n.includes('演示') || n.includes('lab')) return 'cpu';
  if (n.includes('家庭') || n.includes('home')) return 'network';
  return 'network';
}

function deviceSymbol(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('macbook') || n.includes('air')) return 'laptop';
  if (n.includes('mini')) return 'monitor';
  if (n.includes('nas') || n.includes('server') || n.includes('服务器') || n.includes('文件')) return 'server';
  if (n.includes('public') || n.includes('公共')) return 'cloud';
  if (n.includes('studio') || n.includes('mac') || n.includes('pc') || n.includes('工作站')) return 'monitor';
  return 'monitor';
}

const initials = (name) => {
  if (!name) return '?';
  const trimmed = name.trim();
  if (/^[\u4e00-\u9fa5]/.test(trimmed)) return trimmed[0];
  return trimmed[0].toUpperCase();
};

const statusMeta = {
  running: { label: '已连接', cls: 'green' },
  connecting: { label: '正在连接', cls: 'amber' },
  stopping: { label: '正在断开', cls: 'amber' },
  failed: { label: '连接失败', cls: 'red' },
  stopped: { label: '未连接', cls: 'gray' }
};
const statusPill = (st, large = false) => {
  const m = statusMeta[st] || statusMeta.stopped;
  return `<span class="pill ${m.cls} ${large ? 'lg' : ''}"><span class="dot"></span>${m.label}</span>`;
};
const statusColor = (st) => ({ running: 'var(--green)', connecting: 'var(--amber)', stopping: 'var(--amber)', failed: 'var(--red)', stopped: 'var(--text-4)' }[st] || 'var(--text-4)');

/* --------------------------------------------------------------- runtime */

function rt(id) {
  if (!S.runtime[id]) {
    S.runtime[id] = {
      status: 'stopped', peers: [], routes: [], metrics: emptyMetrics(),
      logs: [], startedAt: null, connectAt: null, token: 0,
      latHist: [], cliSyntax: 'modern', lastPoll: 0, lastLogPoll: 0, logOffset: 0,
      coreActive: false, startPending: false, sessionId: null, pollingToken: null, logRemainder: ''
    };
  }
  return S.runtime[id];
}
function emptyMetrics() { return { latency: 0, loss: 0, peers: 0, rx: 0, tx: 0, startedAt: null }; }

function computeMetrics(peers, startedAt, prevHist = []) {
  const remote = peers.filter(p => !p.isLocal);
  const lats = remote.map(p => p.latency).filter(v => v != null);
  const m = {
    latency: avg(lats),
    loss: avg(remote.map(p => p.loss).filter(v => v != null)),
    peers: remote.length,
    rx: sum(remote.map(p => p.rx || 0)),
    tx: sum(remote.map(p => p.tx || 0)),
    startedAt
  };
  return m;
}

function appendLog(id, level, target, message) {
  const r = rt(id);
  r.logSequence = (r.logSequence || 0) + 1;
  r.logs.push({ seq: r.logSequence, t: new Date().toISOString(), level, target, message });
  if (r.logs.length > 900) r.logs.splice(0, r.logs.length - 900);
}

/* ------------------------------------------------------------- persistence */

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    bridge.saveState(JSON.stringify({
      version: 1,
      profiles: S.profiles,
      settings: S.settings,
      ui: { view: S.ui.view, networkId: S.ui.networkId, tab: S.ui.tab }
    })).catch(() => {});
  }, 250);
}

/* ------------------------------------------------------------------ seed */

function seedProfiles() {
  const now = new Date().toISOString();
  return [
    {
      id: uid(), name: '示例网络', networkName: 'home-mesh', secret: 'home-secret-2026',
      hostname: 'MacBook Pro', ipv4: '10.144.0.1', dhcp: false,
      peers: ['tcp://public.easytier.cn:11010'], listenPort: 11010, rpcPort: 15888,
      proxyNetworks: ['192.168.31.0/24'], exitNodes: [],
      enableExitNode: false, acceptDNS: false, latencyFirst: true, multiThread: true,
      disableP2P: false, enableEncryption: true, enableIPv6: false, noTun: false, useSmoltcp: false,
      mtu: 1380, relayWhitelist: '*', devName: '', vpnPortalEnabled: false, vpnPortalListen: '0.0.0.0:11011', vpnPortalCIDR: '10.14.14.0/24',
      tint: 1, autoConnect: true, isSample: true, createdAt: now, lastConnectedAt: null
    }
  ];
}

/* --------------------------------------------------------------- demo data */

function demoPeers(p) {
  const localIP = p.dhcp ? '10.144.144.23' : p.ipv4;
  const prefix = localIP.split('.').slice(0, 3).join('.');
  const local = {
    id: String(Math.abs(hashCode(p.id)) % 4000000000), hostname: p.hostname, ipv4: localIP,
    cidr: localIP + '/24', cost: 'Local', latency: null, loss: null, rx: null, tx: null,
    tunnel: 'udp', natType: 'PortRestricted', version: '2.5.0-8f3a1c', isLocal: true, isPublicServer: false
  };
  const sets = {
    1: ['Mac mini · 书房', 'Synology DS920+', 'MacBook Air', '公共节点 · 上海'],
    0: ['剪辑工作站', '文件服务器', 'MacBook Pro · 客厅', '公共节点 · 杭州'],
    2: ['Lab-PC-01', 'Lab-NAS', '测试节点 · Ubuntu', '公共节点 · 北京']
  };
  const names = sets[p.tint] || ['MacBook Air', '家庭服务器', '公共节点'];
  const list = [local];
  names.forEach((name, i) => {
    const isPublic = name.includes('公共');
    const relay = isPublic || i === names.length - 1 || p.disableP2P;
    list.push({
      id: String(Math.abs(hashCode(name + i)) % 4000000000),
      hostname: name,
      ipv4: isPublic ? '' : `${prefix}.${i + 2}`,
      cidr: isPublic ? '' : `${prefix}.${i + 2}/24`,
      cost: relay ? 'relay' : 'p2p',
      latency: isPublic ? 18 + Math.random() * 20 : 1.2 + Math.random() * 9,
      loss: Math.random() * 0.35,
      rx: Math.round(400000 + Math.random() * 80000000),
      tx: Math.round(180000 + Math.random() * 42000000),
      tunnel: isPublic ? 'tcp' : (i % 2 === 0 ? 'udp' : 'tcp'),
      natType: isPublic ? 'Unknown' : (i % 2 === 0 ? 'FullCone' : 'PortRestricted'),
      version: isPublic ? '2.4.5-9f2c1a0b' : '2.5.0-' + Math.random().toString(16).slice(2, 8),
      isLocal: false, isPublicServer: isPublic
    });
  });
  return list;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return h;
}

function demoRoutes(p, peers) {
  const rows = [];
  peers.filter(x => !x.isPublicServer).forEach(x => {
    const isLocal = x.isLocal;
    rows.push({
      ipv4: x.cidr || x.ipv4,
      hostname: x.hostname,
      proxyCidrs: isLocal ? p.proxyNetworks.join(', ') : (/NAS|文件/.test(x.hostname) ? '192.168.10.0/24' : ''),
      nextHopIpv4: isLocal ? '' : x.ipv4,
      nextHopHostname: isLocal ? '本机' : x.hostname,
      nextHopLatency: x.latency,
      pathLen: isLocal ? 0 : (x.cost === 'p2p' ? 1 : 2),
      pathLatency: Math.round((x.latency || 0) * (x.cost === 'p2p' ? 1 : 2)),
      version: x.version
    });
  });
  p.proxyNetworks.forEach(net => {
    if (!rows.some(r => r.ipv4 === net)) {
      rows.push({
        ipv4: net, hostname: p.hostname, proxyCidrs: net, nextHopIpv4: '',
        nextHopHostname: '本机', nextHopLatency: null, pathLen: 0, pathLatency: 0, version: '2.5.0'
      });
    }
  });
  return rows;
}

function demoLogLines(p) {
  const hash = Math.random().toString(16).slice(2, 8);
  const ip = p.dhcp ? '10.144.144.23' : p.ipv4;
  return [
    ['info', 'easytier_core::instance', `EasyTier 实例启动中  version=2.5.0-${hash}`],
    ['debug', 'easytier_core::config', `加载配置 ${p.networkName}.toml  实例名=${p.hostname.toLowerCase().replace(/\s+/g, '-')}`],
    ['info', 'easytier_core::tun', `tun 设备已创建  utun9  mtu=${p.mtu}`],
    ['info', 'easytier_core::peer_manager', `正在连接 ${p.peers[0] || '本地网络'}`],
    ['debug', 'easytier_core::peer_manager', `tcp 握手完成  peer_id=${Math.abs(hashCode(p.networkName)) % 4000000000}`],
    ['info', 'easytier_core::route', `路由表已同步  ${3 + (p.proxyNetworks.length)} 个条目`],
    ['info', 'easytier_core::instance', `网络就绪  虚拟 IP = ${ip}  加密=${p.enableEncryption ? 'on' : 'off'}`]
  ];
}

/* --------------------------------------------------------------- connect */

function connect(p, quiet = false) {
  const r = rt(p.id);
  if (['running', 'connecting', 'stopping'].includes(r.status)) return;
  if (r.coreActive) { toast('请先断开现有核心实例再重试', 'warn'); return; }
  r.logs = [];
  r.peers = [];
  r.routes = [];
  r.metrics = emptyMetrics();
  r.status = 'connecting';
  r.connectAt = Date.now();
  r.token++;
  r.logOffset = 0;
  r.logRemainder = '';
  r.lastLogPoll = 0;
  r.lastPoll = 0;
  r.sessionId = uid();
  appendLog(p.id, 'info', 'ui', `正在启动网络「${p.name}」…`);
  renderSidebar(); renderView(!S.ui.live); syncMenu();

  if (isDemo()) simulateConnect(p, quiet); else return realConnect(p);
}

function simulateConnect(p, quiet = false) {
  const r = rt(p.id);
  const token = r.token;
  const lines = demoLogLines(p);
  let i = 0;
  const step = () => {
    if (r.token !== token || r.status !== 'connecting') return;
    if (i < lines.length) {
      const [level, target, message] = lines[i++];
      appendLog(p.id, level, target, message);
      if (S.ui.tab === 'logs' && S.ui.networkId === p.id) appendLogsLive();
      setTimeout(step, 130 + Math.random() * 170);
    } else {
      r.status = 'running';
      r.startedAt = Date.now();
      p.lastConnectedAt = new Date().toISOString();
      const peers = demoPeers(p);
      r.peers = peers;
      r.routes = demoRoutes(p, peers);
      r.metrics = computeMetrics(peers, r.startedAt);
      const base = r.metrics.latency || 4;
      r.latHist = Array.from({ length: 14 }, () => Math.max(0.6, base + (Math.random() - 0.5) * 3.2));
      r.latHist.push(r.metrics.latency);
      appendLog(p.id, 'info', 'easytier_core::peer_manager', `握手成功，已加入网络 ${p.networkName}`);
      appendLog(p.id, 'info', 'ui', `连接建立完成，${r.metrics.peers} 个节点在线`);
      persist();
      if (!quiet) toast(`已连接到 ${p.name}`, 'ok');
      renderRuntimeUI();
    }
  };
  setTimeout(step, 320);
}

async function realConnect(p) {
  const r = rt(p.id);
  const token = r.token;
  const sessionId = r.sessionId;
  r.coreActive = true;
  r.startPending = true;
  try {
    const res = await bridge.startCore({
      profileId: p.id, sessionId,
      config: buildTOML(p), rpcPort: p.rpcPort,
      logLevel: S.settings.logLevel, elevated: !!S.settings.runAsRoot
    });
    if (!res || !res.ok) throw new Error(res?.error || '核心启动未确认');
    if (r.token !== token || r.status !== 'connecting') return;
    r.connectAt = Date.now();
    r.startPending = false;
    await pollProfile(p, true);
  } catch (err) {
    if (r.token !== token) return;
    r.status = 'failed';
    appendLog(p.id, 'error', 'ui', `启动失败：${err.message || err}`);
    toast('启动失败，请查看日志；可点击断开清理实例', 'err');
    renderRuntimeUI();
  } finally {
    if (r.sessionId === sessionId) r.startPending = false;
  }
}

async function disconnect(p) {
  const r = rt(p.id);
  if (r.stopPromise) return r.stopPromise;
  if (!r.coreActive && ['stopped', 'failed'].includes(r.status)) {
    r.status = 'stopped'; renderRuntimeUI(); return true;
  }
  const previous = r.status;
  r.status = 'stopping';
  r.token++;
  appendLog(p.id, 'info', 'ui', '正在断开连接…');
  renderRuntimeUI();
  r.stopPromise = (async () => {
    try {
      if (r.coreActive) {
        const result = await bridge.stopCore({ profileId: p.id });
        if (!result || !result.ok) throw new Error(result?.error || '核心停止未确认');
      }
      r.coreActive = false;
      r.status = 'stopped';
      r.peers = []; r.routes = []; r.metrics = emptyMetrics(); r.startedAt = null;
      appendLog(p.id, 'info', 'ui', '已断开连接');
      renderRuntimeUI();
      return true;
    } catch (err) {
      // Keep ownership and the retry button when authorization or termination fails.
      r.status = previous === 'stopping' ? 'failed' : previous;
      r.connectAt = Date.now();
      appendLog(p.id, 'error', 'ui', `断开失败：${err.message || err}`);
      toast('断开未完成，核心可能仍在运行，请重试', 'err');
      renderRuntimeUI();
      return false;
    }
  })();
  try { return await r.stopPromise; } finally { r.stopPromise = null; }
}

function toggleNetwork(id) {
  const p = S.profiles.find(x => x.id === id);
  if (!p) return;
  const r = rt(id);
  if (r.status === 'stopping') return;
  if (r.coreActive || ['running', 'connecting'].includes(r.status)) {
    if (S.settings.confirmDisconnect && !confirm(`确定断开「${p.name}」吗？`)) return;
    return disconnect(p);
  }
  return connect(p);
}

/* ---------------------------------------------------------------- polling */

async function pollProfile(p, force = false) {
  const r = rt(p.id);
  if (!['running', 'connecting'].includes(r.status) || r.startPending) return;
  const token = r.token;
  if (r.pollingToken === token) return;
  if (!force && Date.now() - r.lastPoll < S.settings.refresh * 1000) return;
  const current = () => S.runtime[p.id] === r && r.token === token &&
    S.profiles.some(x => x.id === p.id) && ['running', 'connecting'].includes(r.status);
  r.pollingToken = token;
  r.lastPoll = Date.now();
  const argsFor = syntax => syntax === 'modern'
    ? ['-p', `127.0.0.1:${p.rpcPort}`, '-o', 'json', 'peer', 'list']
    : ['-p', `127.0.0.1:${p.rpcPort}`, '-o', 'json', 'peer'];
  try {
    let res = await bridge.cli({ args: argsFor(r.cliSyntax), timeout: 4 }).catch(e => ({ error: String(e) }));
    if (!current()) return;
    if (!res || !res.ok) {
      const alt = r.cliSyntax === 'modern' ? 'legacy' : 'modern';
      const res2 = await bridge.cli({ args: argsFor(alt), timeout: 4 }).catch(() => null);
      if (!current()) return;
      if (res2?.ok) { r.cliSyntax = alt; res = res2; }
    }
    const peers = res?.ok ? parsePeerJSON(res.stdout) : null;
    if (!peers) {
      r.pollFailures = (r.pollFailures || 0) + 1;
      if ((r.status === 'connecting' && Date.now() - r.connectAt > 12000) ||
          (r.status === 'running' && r.pollFailures >= 3)) {
        r.status = 'failed';
        appendLog(p.id, 'error', 'ui', `无法读取 RPC 端口 ${p.rpcPort} 的状态；核心可能仍在运行，请断开后重试。`);
        renderRuntimeUI();
      }
      return;
    }
    r.pollFailures = 0;
    r.peers = peers;
    if (r.status !== 'running') {
      r.status = 'running'; r.startedAt = Date.now(); p.lastConnectedAt = new Date().toISOString();
      persist();
    }
    const routeArgs = r.cliSyntax === 'modern'
      ? ['-p', `127.0.0.1:${p.rpcPort}`, '-o', 'json', 'route', 'list']
      : ['-p', `127.0.0.1:${p.rpcPort}`, '-o', 'json', 'route'];
    const rr = await bridge.cli({ args: routeArgs, timeout: 4 }).catch(() => null);
    if (!current()) return;
    if (rr?.ok) r.routes = parseRouteJSON(rr.stdout) || [];
    r.metrics = computeMetrics(peers, r.startedAt);
    r.latHist.push(r.metrics.latency);
    if (r.latHist.length > 48) r.latHist.shift();
    renderRuntimeUI();
  } finally {
    if (r.pollingToken === token) r.pollingToken = null;
  }
}

function parsePeerJSON(text) {
  const arr = unwrapJSON(text);
  if (!Array.isArray(arr)) return null;
  return arr.filter(d => d && typeof d === 'object').map(d => {
    const rawCost = String(d.cost || '');
    const cost = rawCost.toLowerCase().includes('local') ? 'local'
      : rawCost.toLowerCase().includes('p2p') ? 'p2p' : 'relay';
    const hostname = String(d.hostname || '');
    return {
      id: String(d.id || hostname || d.ipv4 || Math.random()),
      hostname,
      ipv4: String(d.ipv4 || '').split('/')[0],
      cidr: String(d.cidr || ''),
      cost,
      latency: parseFloat(d.lat_ms) || null,
      loss: parseFloat(String(d.loss_rate || '').replace('%', '')) || 0,
      rx: parseBytes(d.rx_bytes),
      tx: parseBytes(d.tx_bytes),
      tunnel: String(d.tunnel_proto || '—'),
      natType: String(d.nat_type || 'Unknown'),
      version: String(d.version || ''),
      isLocal: cost === 'local',
      isPublicServer: /publicserver|公共节点/i.test(hostname)
    };
  }).filter(p => p.hostname || p.ipv4 || p.cidr);
}

function parseRouteJSON(text) {
  const arr = unwrapJSON(text);
  if (!Array.isArray(arr)) return [];
  return arr.filter(d => d && typeof d === 'object').map(d => ({
    ipv4: String(d.ipv4 || ''),
    hostname: String(d.hostname || ''),
    proxyCidrs: String(d.proxy_cidrs || ''),
    nextHopIpv4: String(d.next_hop_ipv4 || ''),
    nextHopHostname: String(d.next_hop_hostname || ''),
    nextHopLatency: d.next_hop_lat ?? null,
    pathLen: d.path_len ?? 0,
    pathLatency: d.path_latency ?? 0,
    version: String(d.version || '')
  })).filter(r => r.ipv4);
}

function unwrapJSON(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      if (data.length && data[0] && data[0].result) return data.flatMap(x => x.result || []);
      return data;
    }
    if (data && data.result) return data.result;
    if (data && typeof data === 'object') return [data];
  } catch (e) { return null; }
  return null;
}

function parseBytes(v) {
  if (typeof v === 'number') return v;
  if (!v) return null;
  const m = String(v).match(/([\d.]+)\s*([KMG]?B)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toUpperCase();
  return Math.round(n * ({ B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[unit] || 1));
}

/* -------------------------------------------------------------- demo tick */

function demoTick() {
  S.profiles.forEach(p => {
    const r = rt(p.id);
    if (r.status !== 'running') return;
    r.peers = r.peers.map(peer => {
      if (peer.isLocal) return peer;
      const jitter = (Math.random() - 0.5) * 0.7;
      return {
        ...peer,
        latency: Math.max(0.4, (peer.latency || 1) + jitter),
        loss: Math.max(0, Math.min(2.4, (peer.loss || 0) + (Math.random() - 0.52) * 0.04)),
        rx: (peer.rx || 0) + Math.round(Math.random() * 460000),
        tx: (peer.tx || 0) + Math.round(Math.random() * 240000)
      };
    });
    r.metrics = computeMetrics(r.peers, r.startedAt);
    if (S.tickCounter % 2 === 0) {
      r.latHist.push(r.metrics.latency);
      if (r.latHist.length > 48) r.latHist.shift();
    }
    if (S.tickCounter % 23 === 0) {
      appendLog(p.id, 'debug', 'easytier_core::stats',
        `平均延迟 ${fmtLat(r.metrics.latency)}ms  丢包 ${fmtPct(r.metrics.loss)}  在线 ${r.metrics.peers} 节点`);
    }
  });
}

/* ---------------------------------------------------------------- actions */

function openNetwork(id) {
  S.ui.view = 'network';
  S.ui.networkId = id;
  S.ui.tab = 'overview';
  S.ui.search = '';
  S.ui.expanded = null;
  S.draft = null;
  renderAll();
  persist();
}

function openOverview() {
  S.ui.view = 'overview';
  S.ui.networkId = null;
  renderAll();
  persist();
}

function openSettings() {
  S.ui.view = 'settings';
  S.ui.networkId = null;
  renderAll();
}

function openTab(tab) {
  if (S.ui.tab === tab) return;
  S.ui.tab = tab;
  if (tab === 'config') startDraft();
  S.ui.live = false;
  renderView(false);
}

function startDraft() {
  const p = S.profiles.find(x => x.id === S.ui.networkId);
  if (!p) return;
  S.draft = clone(p);
  S.dirty = false;
  S.ui.advanceOpen = false;
}

function setDraft(field, value) {
  if (!S.draft) return;
  S.draft[field] = value;
  S.dirty = true;
  updateDirtyUI();
  updateTomlPreview();
}

function updateDirtyUI() {
  const btn = $('#save-config');
  if (btn) btn.disabled = !S.dirty;
  const badge = $('#dirty-badge');
  if (badge) badge.classList.toggle('hidden', !S.dirty);
  const preview = $('#toml-preview');
  if (preview) preview.innerHTML = highlightTOML(buildTOML(S.draft));
}

function updateTomlPreview() {
  const preview = $('#toml-preview');
  if (preview && S.draft) preview.innerHTML = highlightTOML(buildTOML(S.draft));
}

async function saveConfig() {
  if (!S.draft) return;
  const d = clone(S.draft);
  if (rt(d.id).saving) return;
  const errs = {};
  if (!d.name.trim()) errs.name = '请输入显示名称';
  if (!d.networkName.trim()) errs.networkName = '请输入网络名称';
  if (!d.dhcp && !/^(\d{1,3}\.){3}\d{1,3}$/.test(d.ipv4)) errs.ipv4 = 'IPv4 地址格式不正确';
  d.peers.forEach((peer, i) => { if (peer && !/^[a-z0-9]+:\/\//i.test(peer)) errs['peer' + i] = '节点地址需包含协议前缀'; });
  if (!Number.isInteger(d.listenPort) || d.listenPort < 1024 || d.listenPort > 65532) errs.listenPort = '监听端口需在 1024–65532 之间（另占用后续 3 个端口）';
  if (!(d.rpcPort >= 1024 && d.rpcPort <= 65535)) errs.rpcPort = 'RPC 端口需在 1024–65535 之间';
  if (!(d.mtu >= 576 && d.mtu <= 9000)) errs.mtu = 'MTU 需在 576–9000 之间';
  if (d.vpnPortalEnabled && !/^(\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])$/.test(d.vpnPortalCIDR || '10.14.14.0/24')) errs.vpnPortalCIDR = 'VPN 客户端网段需使用 IPv4/CIDR 格式';

  $$('.field-error').forEach(el => el.remove());
  $$('.form-field.invalid').forEach(el => el.classList.remove('invalid'));
  const keys = Object.keys(errs);
  if (keys.length) {
    keys.forEach(k => {
      const input = document.querySelector(`[data-model="${k}"]`);
      if (input) {
        input.classList.add('invalid');
        const field = input.closest('.form-field');
        if (field) field.classList.add('invalid');
      }
    });
    toast(errs[keys[0]], 'warn');
    return;
  }

  const idx = S.profiles.findIndex(x => x.id === d.id);
  if (idx < 0) return;
  const r = rt(d.id);
  const wasActive = r.coreActive || ['running', 'connecting', 'stopping'].includes(r.status);
  r.saving = true;
  try {
    if (wasActive && !await disconnect(S.profiles[idx])) return;
    const currentIndex = S.profiles.findIndex(x => x.id === d.id);
    if (currentIndex < 0) return;
    S.profiles[currentIndex] = d;
    if (JSON.stringify(S.draft) === JSON.stringify(d)) S.dirty = false;
    persist(); toast('配置已保存', 'ok'); renderAll();
    if (wasActive) await connect(d);
  } finally { r.saving = false; }
}

function addProfile(profile, connectNow) {
  S.profiles.push(profile);
  persist();
  openNetwork(profile.id);
  if (connectNow) setTimeout(() => connect(profile), 220);
}

async function deleteProfile(id) {
  const p = S.profiles.find(x => x.id === id);
  if (!p) return;
  if (!await disconnect(p)) return;
  S.profiles = S.profiles.filter(x => x.id !== id);
  delete S.runtime[id];
  persist();
  openOverview();
  toast('已删除网络');
}

function toast(text, kind = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  const ic = kind === 'err' ? 'alert' : kind === 'warn' ? 'alert' : 'check';
  el.innerHTML = `${icon(ic, kind === 'ok' ? 'ok' : kind)}<span>${esc(text)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 230);
  }, 2400);
}

function copyText(text, label = '已复制') {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label, 'ok'); } catch (e) { toast('复制失败', 'err'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(label, 'ok')).catch(fallback);
  } else fallback();
}

function syncMenu() {
  clearTimeout(S.menuTimer);
  S.menuTimer = setTimeout(() => {
    bridge.updateMenu({
      networks: S.profiles.map(p => ({ id: p.id, name: p.name, status: rt(p.id).status })),
      demo: isDemo()
    }).catch(() => {});
  }, 120);
}

/* --------------------------------------------------------------- rendering */

function runtimeViewCanRefresh() {
  const active = document.activeElement;
  return !S.sheet && !(active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) &&
    !(S.ui.view === 'network' && S.ui.tab === 'config');
}

function renderRuntimeUI() {
  renderSidebar(); syncMenu();
  if (runtimeViewCanRefresh()) renderView(true);
  else if (S.ui.view === 'network') {
    // Refresh the status/actions separately; never replace the form or search input.
    const header = document.querySelector('.detail-head');
    const p = S.profiles.find(p => p.id === S.ui.networkId);
    if (header && p) header.outerHTML = renderDetailHead(p);
  }
}

function assignedIPv4(p) {
  if (!p.dhcp) return p.ipv4 || '';
  return rt(p.id).peers.find(peer => peer.isLocal)?.ipv4 || '';
}

function renderAll() {
  renderSidebar();
  renderView(false);
  syncMenu();
}

function renderSidebar(force = false) {
  const connected = S.profiles.filter(p => rt(p.id).status === 'running').length;
  const sideRx = sum(S.profiles.map(p => rt(p.id).metrics.rx));
  const sideTx = sum(S.profiles.map(p => rt(p.id).metrics.tx));
  const sideHist = S.profiles.flatMap(p => rt(p.id).latHist).slice(-24);
  const sig = [S.ui.view, S.ui.networkId, S.profiles.length, connected,
    S.profiles.map(p => p.id + ':' + rt(p.id).status).join(',')].join('|');
  if (!force && sig === S._sidebarSig) { updateSidebarLive(); return; }
  S._sidebarSig = sig;
  const coreLabel = isDemo() ? '演示模式' : `Core ${coreVersionShort() || '已就绪'}`;
  const coreSub = isDemo() ? '未检测到 EasyTier Core' : '本机核心已就绪';

  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="brand-mark">${brandGlyph()}</div>
      <div class="brand-text">
        <div class="brand-name">EasyTier <span class="brand-badge">DESKTOP</span></div>
        <div class="brand-sub">Mesh Console</div>
      </div>
    </div>

    <nav class="nav">
      <button class="nav-item ${S.ui.view === 'overview' ? 'active' : ''}" data-action="nav-overview">
        ${icon('grid')}<span>概览</span><span class="shortcut">⌘1</span>
      </button>
    </nav>

    <div class="section-head">
      网络 <span class="count">${S.profiles.length}</span><span class="spacer"></span>
      <button class="add" data-action="new-network" title="新建网络">${icon('plus', 'sm')}</button>
    </div>
    <div class="net-list">
      ${S.profiles.map(netRow).join('') || `<div style="padding:8px 10px;font-size:10.5px;color:var(--text-3)">暂无网络</div>`}
    </div>

    <div class="section-head" style="padding-top:14px">工具</div>
    <button class="nav-item" data-action="diagnose">${icon('activity')}<span>网络诊断</span></button>
    <button class="nav-item ${S.ui.view === 'settings' ? 'active' : ''}" data-action="nav-settings">
      ${icon('settings')}<span>设置</span><span class="shortcut">⌘,</span>
    </button>

    <div class="side-traffic">
      <div class="st-top"><span>会话流量</span><b>${fmtBytes(sideRx + sideTx)}</b></div>
      <div class="st-spark">${sparkSVG(sideHist, 210, 34, '#3F6DF6')}</div>
      <div class="st-foot"><span>↓ ${fmtBytes(sideRx)}</span><span>↑ ${fmtBytes(sideTx)}</span></div>
    </div>

    <div class="sidebar-foot">
      <div class="device-card">
        <div class="device-card-icon">${icon('laptop', 'sm')}</div>
        <div class="device-card-info">
          <div class="device-card-name">${esc((S.meta && S.meta.hostname) || 'Mac')}</div>
          <div class="device-card-sub">本机 · ${connected} 个网络运行中</div>
        </div>
        <span class="dot ${connected ? 'green' : 'gray'}"></span>
      </div>
      <button class="core-card" data-action="nav-settings">
        <span class="dot ${isDemo() ? 'amber' : 'green'}"></span>
        <div class="core-info">
          <div class="core-title">${esc(coreLabel)}</div>
          <div class="core-sub">${esc(coreSub)}</div>
        </div>
        ${icon('sliders', 'sm')}
      </button>
    </div>
  `;
}

function updateSidebarLive() {
  const rx = sum(S.profiles.map(p => rt(p.id).metrics.rx));
  const tx = sum(S.profiles.map(p => rt(p.id).metrics.tx));
  const top = $('.st-top b');
  if (top) top.textContent = fmtBytes(rx + tx);
  const foot = $('.st-foot');
  if (foot) foot.innerHTML = `<span>↓ ${fmtBytes(rx)}</span><span>↑ ${fmtBytes(tx)}</span>`;
  const hist = S.profiles.flatMap(p => rt(p.id).latHist).slice(-24);
  if (S.tickCounter % 6 === 0) {
    const spark = $('.st-spark');
    if (spark) spark.innerHTML = sparkSVG(hist, 210, 34, '#3F6DF6');
  }
}

function netRow(p) {
  const r = rt(p.id);
  const active = S.ui.view === 'network' && S.ui.networkId === p.id;
  const n = r.peers.filter(x => !x.isLocal).length;
  const sub = r.status === 'running' ? `${n} 个节点在线` : statusMeta[r.status].label;
  return `
    <div class="net-row ${active ? 'active' : ''}" style="${tintVars(p.tint)}" data-action="open-network" data-id="${p.id}" title="${esc(p.name)} · ${statusMeta[r.status].label}">
      <div class="net-tile">${icon(netSymbol(p))}</div>
      <div class="net-row-info">
        <div class="net-row-name">${esc(p.name)}</div>
        <div class="net-row-sub"><span class="state-dot" style="background:${statusColor(r.status)}"></span>${sub}</div>
      </div>
      <button class="quick" data-action="toggle" data-id="${p.id}" title="${r.status === 'running' ? '断开' : '连接'}">
        ${icon(r.status === 'running' ? 'stop' : 'play', 'sm')}
      </button>
    </div>`;
}

function brandGlyph() {
  return `<svg viewBox="0 0 24 24" fill="none">
    <path d="M12 7.2 6.4 16.6h11.2L12 7.2Z" stroke="white" stroke-width="1.25" stroke-linejoin="round" opacity=".85"/>
    <path d="M12 7.2v4.6M9.4 14.6h5.2" stroke="white" stroke-width="1.25" stroke-linecap="round" opacity=".55"/>
    <circle cx="12" cy="5.6" r="1.9" fill="white"/>
    <circle cx="6" cy="17.4" r="1.7" fill="white"/>
    <circle cx="18" cy="17.4" r="1.7" fill="white"/>
  </svg>`;
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head">
    <div>
      <h1>${title}</h1>
      <div class="sub">${subtitle}</div>
    </div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

function renderView(keepScroll = false) {
  const scroller = $('#view');
  const top = scroller.scrollTop;
  let html = '';

  if (!S.ui.ready) html = `<div class="empty"><div class="spinner"></div></div>`;
  else if (S.ui.view === 'settings') html = renderSettings();
  else if (S.ui.view === 'network') {
    const p = S.profiles.find(x => x.id === S.ui.networkId);
    html = p ? renderDetail(p) : renderOverview();
  } else {
    html = S.profiles.length ? renderOverview() : renderOnboarding();
  }

  scroller.innerHTML = html;
  if (keepScroll) {
    const page = scroller.querySelector('.page');
    if (page) page.style.animation = 'none';
    scroller.scrollTop = top;
  } else {
    scroller.scrollTop = 0;
  }

  if (S.ui.tab === 'logs' && S.ui.view === 'network') scrollLogsToEnd();
  if (S.sheet) renderSheet();
}

/* ---------------------------------------------------------------- overview */

function renderOverview() {
  const allPeers = S.profiles.flatMap(p => rt(p.id).peers.filter(x => !x.isLocal));
  const connected = S.profiles.filter(p => rt(p.id).status === 'running');
  const latency = avg(allPeers.map(x => x.latency).filter(v => v != null));
  const rx = sum(S.profiles.map(p => rt(p.id).metrics.rx));
  const tx = sum(S.profiles.map(p => rt(p.id).metrics.tx));
  const history = S.profiles.flatMap(p => rt(p.id).latHist).slice(-40);

  const subtitle = `${connected.length} 个网络已连接 · ${allPeers.length} 台设备在线`;
  const actions = `
    <button class="btn secondary" data-action="import-config">${icon('import', 'sm')} 导入配置</button>
    <button class="btn primary" data-action="new-network">${icon('plus', 'sm')} 新建网络</button>`;

  return `<div class="page">
    ${pageHead('概览', subtitle, actions)}

    <div class="card banner">
      <div class="banner-left">
        <div class="banner-kicker">
          <span class="dot ${connected.length ? 'green pulse' : 'gray'}"></span>
          ${connected.length ? 'MESH ONLINE' : 'MESH IDLE'}
        </div>
        <h2>${connected.length ? `${connected.length} 个网络正在运行` : '所有网络均已断开'}</h2>
        <p>${connected.length
          ? `${allPeers.length} 台设备在线 · 平均延迟 ${fmtLat(latency)} ms · ${allPeers.filter(x => x.cost === 'p2p').length} 条 P2P 直连`
          : '选择一个网络并连接，开始构建你的私有 Mesh 网络'}</p>
      </div>
      <div class="banner-right">
        <div class="banner-stat">
          <div class="v">${fmtBytes(rx + tx)}</div>
          <div class="l">本次会话流量</div>
        </div>
        <div class="banner-stat">
          <div class="v">${connected.length}/${S.profiles.length}</div>
          <div class="l">网络在线</div>
        </div>
        <div class="banner-spark">${sparkSVG(history, 130, 44, '#4C7DFF')}</div>
      </div>
      <div class="banner-mesh">${bannerMesh()}</div>
    </div>

    <div class="kpi-row">
      ${kpi('network', '已连接网络', `${connected.length}<span class="unit">/ ${S.profiles.length}</span>`, `${S.profiles.length - connected.length} 个未连接`, '#3F6DF6')}
      ${kpi('monitor', '在线设备', `${allPeers.length}<span class="unit">台</span>`, `${allPeers.filter(x => x.cost === 'p2p').length} 条直连链路`, '#17B26A')}
      ${kpi('activity', '平均延迟', `${fmtLat(latency) || '—'}<span class="unit">ms</span>`, latency && latency < 30 ? '链路质量良好' : '等待连接', '#E39A1B')}
      ${kpi('arrow-down', '会话下行', fmtBytes(rx), `上行 ${fmtBytes(tx)}`, '#7C5CFC')}
    </div>

    <div class="section-title">我的网络 <span class="count">${S.profiles.length}</span><span class="spacer"></span>
      <button class="link" data-action="new-network">${icon('plus', 'sm')} 新建</button>
    </div>
    <div class="net-grid">${S.profiles.map(netCard).join('')}</div>

    <div class="bottom-grid" style="margin-top:16px">
      <div class="card">
        <div class="card-head">
          <h3>${icon('activity', 'sm')} 最近活动</h3>
          <span class="spacer"></span>
          <span class="sub">实时</span>
        </div>
        <div class="card-body">${renderActivity()}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${icon('cpu', 'sm')} 运行环境</h3></div>
        <div class="card-body">
          <div class="info-rows">
            <div class="info-row"><span class="k">运行模式</span><span class="v">${isDemo() ? '演示模式（核心未就绪）' : '本机 EasyTier Core'}</span></div>
            <div class="info-row"><span class="k">核心版本</span><span class="v mono">${esc(coreVersionShort() || '—')}</span></div>
            <div class="info-row"><span class="k">刷新间隔</span><span class="v">每 ${S.settings.refresh} 秒</span></div>
            <div class="info-row"><span class="k">加密</span><span class="v">AES-256-GCM · 端到端</span></div>
          </div>
          <div class="quick-grid" style="margin-top:12px">
            <button class="quick-btn" data-action="open-folder">${icon('folder')}<b>数据目录</b><span>配置与运行日志</span></button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function kpi(ic, label, value, sub, tint = '#3F6DF6') {
  return `<div class="card kpi" style="--tint:${tint};--tint-bg:${rgba(tint, .13)};--tint-line:${rgba(tint, .18)}">
    <div class="kpi-top">
      <span class="kpi-label">${label}</span>
      <span class="kpi-icon">${icon(ic, 'sm')}</span>
    </div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

function netCard(p) {
  const r = rt(p.id);
  const m = r.metrics;
  const n = r.peers.filter(x => !x.isLocal).length;
  const running = r.status === 'running';
  return `<article class="card net-card" style="${tintVars(p.tint)}" data-action="open-network" data-id="${p.id}">
    <div class="net-card-top">
      <div class="net-tile">${icon(netSymbol(p))}</div>
      <div class="net-names">
        <div class="net-name">${esc(p.name)}</div>
        <div class="net-id mono">${esc(p.networkName)}</div>
      </div>
      ${statusPill(r.status)}
    </div>
    <div class="net-ip-line">
      <span class="net-ip ${running ? '' : 'dim'}">${esc(assignedIPv4(p) || (running ? '等待分配地址' : 'DHCP 自动分配'))}</span>
      ${running && assignedIPv4(p) ? `<button class="copy-btn" data-action="copy" data-copy="${esc(assignedIPv4(p))}" title="复制">${icon('copy', 'sm')}</button>` : ''}
    </div>
    <div class="net-meta">
      <span><b>${n}</b> 节点</span><span class="sep"></span>
      <span>${running ? fmtLat(m.latency) + ' ms' : '—'}</span><span class="sep"></span>
      <span>${icon('arrow-down', 'sm')} ${fmtBytes(m.rx)}</span>
    </div>
    <div class="net-card-foot">
      <span class="muted text-11">${p.autoConnect ? '自动连接' : '手动连接'} · ${p.peers.length} 个入口</span>
      <span class="spacer"></span>
      <button class="btn sm ${running ? 'secondary' : 'primary'}" data-action="toggle" data-id="${p.id}">
        ${r.status === 'stopping' ? '正在断开…' : r.status === 'connecting' ? '取消连接' : (running || r.coreActive) ? '断开' : '连接'}
      </button>
      <button class="iconbtn sm" data-action="edit-network" data-id="${p.id}" title="配置">${icon('settings', 'sm')}</button>
    </div>
  </article>`;
}

function renderActivity() {
  const rows = [];
  S.profiles.forEach(p => {
    rt(p.id).logs.slice(-4).forEach(l => rows.push({ p, l }));
  });
  rows.sort((a, b) => new Date(b.l.t) - new Date(a.l.t));
  const top = rows.slice(0, 5);
  if (!top.length) {
    return `<div class="empty" style="padding:26px 10px">
      <div class="empty-icon">${icon('clock')}</div>
      <h4>暂无活动</h4><p>连接网络后，这里会显示实时运行事件</p>
    </div>`;
  }
  return `<div class="activity-list">${top.map(({ p, l }) => `
    <div class="activity-row">
      <div class="activity-dot" style="${tintVars(p.tint)};color:${l.level === 'error' ? 'var(--red)' : l.level === 'warn' ? 'var(--amber)' : 'var(--tint)'}">${icon(l.level === 'error' ? 'alert' : l.level === 'warn' ? 'alert' : 'activity', 'sm')}</div>
      <div class="activity-main">
        <div class="activity-text">${esc(l.message)}</div>
        <div class="activity-meta"><span>${esc(p.name)}</span><span>·</span><span>${fmtTime(l.t)}</span></div>
      </div>
    </div>`).join('')}</div>`;
}

function bannerMesh() {
  return `<svg viewBox="0 0 420 160" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4C7DFF" stop-opacity=".55"/>
        <stop offset="1" stop-color="#2FB6F5" stop-opacity=".1"/>
      </linearGradient>
    </defs>
    <g stroke="url(#bm)" stroke-width="1">
      <path d="M40 120 130 60 220 100 310 45 390 90" fill="none"/>
      <path d="M130 60 220 20 310 45 220 100 130 120 40 120" fill="none" opacity=".5"/>
      <path d="M130 120 220 100 310 120 390 90 310 45" fill="none" opacity=".4"/>
    </g>
    <g fill="#4C7DFF" opacity=".55">
      <circle cx="40" cy="120" r="3"/><circle cx="130" cy="60" r="3.5"/><circle cx="220" cy="100" r="4"/>
      <circle cx="310" cy="45" r="3"/><circle cx="390" cy="90" r="3"/><circle cx="220" cy="20" r="2.5"/>
      <circle cx="130" cy="120" r="2.5"/><circle cx="310" cy="120" r="2.5"/>
    </g>
  </svg>`;
}

function sparkSVG(values, w = 150, h = 52, color = '#4C7DFF') {
  if (!values || values.length < 2) values = [0, 0, 0];
  if (values.length > 4) {
    values = values.map((v, i, a) => {
      const slice = a.slice(Math.max(0, i - 2), Math.min(a.length, i + 3));
      return slice.reduce((x, y) => x + y, 0) / slice.length;
    });
  }
  const max = Math.max(...values, 1), min = Math.min(...values);
  const span = Math.max(max - min, max * 0.28, 1);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 5 - ((v - min) / span) * (h - 11)
  ]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i];
    const mx = (prev[0] + cur[0]) / 2;
    d += ` C ${mx.toFixed(1)} ${prev[1].toFixed(1)}, ${mx.toFixed(1)} ${cur[1].toFixed(1)}, ${cur[0].toFixed(1)} ${cur[1].toFixed(1)}`;
  }
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  const gid = 'sg' + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ------------------------------------------------------------------ detail */

function renderDetailHead(p) {
  const r = rt(p.id);
  const running = r.status === 'running';
  const peersCount = r.peers.filter(x => !x.isLocal).length;
  return `<div class="detail-head" style="${tintVars(p.tint)}">
      <div class="dh-left">
        <div class="big-tile">${icon(netSymbol(p))}</div>
        <div class="dh-title">
          <h1>${esc(p.name)}</h1>
          <div class="dh-meta">
            <span class="mono">${esc(p.networkName)}</span><span class="sep"></span>
            <span class="mono">${p.dhcp ? 'DHCP' : esc(p.ipv4)}</span><span class="sep"></span>
            <span>${running ? peersCount + ' 台设备在线' : statusMeta[r.status].label}</span>
          </div>
        </div>
      </div>
      <div class="dh-right">
        ${statusPill(r.status, true)}
        <button class="btn ${running || r.status === 'connecting' ? 'secondary' : 'primary'}" data-action="toggle" data-id="${p.id}">
          ${icon(running ? 'stop' : 'play', 'sm')}
          ${r.status === 'stopping' ? '正在断开…' : r.status === 'connecting' ? '取消连接' : (running || r.coreActive) ? '断开连接' : '连接网络'}
        </button>
      </div>
    </div>`;
}

function renderDetail(p) {
  const r = rt(p.id);
  const running = r.status === 'running';
  const peersCount = r.peers.filter(x => !x.isLocal).length;
  const tab = S.ui.tab;

  return `<div class="page">
    ${renderDetailHead(p)}

    <div class="tabs">
      ${tabBtn('overview', '总览')}
      ${tabBtn('peers', '节点', running || peersCount ? peersCount : null)}
      ${tabBtn('routes', '路由', r.routes.length || null)}
      ${tabBtn('config', '配置')}
      ${tabBtn('logs', '日志', r.logs.length ? '' : null)}
    </div>

    ${tab === 'overview' ? detailOverview(p)
      : tab === 'peers' ? detailPeers(p)
      : tab === 'routes' ? detailRoutes(p)
      : tab === 'config' ? detailConfig(p)
      : detailLogs(p)}
  </div>`;
}

function tabBtn(id, label, count = null) {
  const active = S.ui.tab === id;
  return `<button class="tab ${active ? 'active' : ''}" data-action="tab" data-tab="${id}">
    ${label}${count !== null && count !== '' ? `<span class="n">${count}</span>` : ''}
  </button>`;
}

function detailOverview(p) {
  const r = rt(p.id);
  const running = r.status === 'running';
  const m = r.metrics;
  const peers = r.peers;
  const remote = peers.filter(x => !x.isLocal);

  return `
  <div class="detail-grid">
    <div class="detail-left">
      <div class="card hero-card" style="${tintVars(p.tint)}">
        <div class="hero-top">
          <span class="eyebrow">当前会话</span>
          ${statusPill(r.status)}
        </div>
        <div class="hero-main">
          <div class="hero-left">
            <div class="hero-state">
              <span class="state">${running ? '已连接' : r.status === 'connecting' ? '正在连接' : r.status === 'failed' ? '连接失败' : '未连接'}</span>
              <span class="uptime">${running ? '已运行 ' + fmtDur((Date.now() - r.startedAt) / 1000) : (p.lastConnectedAt ? '上次连接 ' + timeAgo(p.lastConnectedAt) : '尚未连接')}</span>
            </div>
            <div class="hero-ip">
              <span class="label">虚拟 IP</span>
              <span class="ip">${esc(assignedIPv4(p) || (running ? '等待分配地址' : '—'))}</span>
              ${assignedIPv4(p) ? `<button class="copy-btn" data-action="copy" data-copy="${esc(assignedIPv4(p))}">${icon('copy', 'sm')}</button>` : ''}
            </div>
            <div class="hero-chips">
              <span class="chip">${icon('shield', 'sm')} ${p.enableEncryption ? '加密传输' : '明文传输'}</span>
              <span class="chip mono">MTU ${p.mtu}</span>
              <span class="chip mono">:${p.listenPort}</span>
              <span class="chip">${icon('link', 'sm')} ${p.disableP2P ? '仅中继' : 'P2P 优先'}</span>
            </div>
          </div>
          <div class="hero-chart">
            <div class="hc-top">
              <span class="hc-label">${icon('activity', 'sm')} 平均延迟</span>
              <span class="hc-value">${fmtLat(m.latency)}<i>ms</i></span>
            </div>
            <div class="hc-spark">${sparkSVG(r.latHist.slice(-28), 210, 62, running ? '#17B26A' : '#9AA5B6')}</div>
            <div class="hc-foot"><span>最近 60 秒</span><span class="${running ? 'ok' : ''}">${running ? '链路稳定' : '暂无数据'}</span></div>
          </div>
        </div>
        ${r.status === 'failed' ? `<div class="hero-error">${icon('alert', 'sm')}<span>${esc((r.logs.filter(l => l.level === 'error').slice(-1)[0] || {}).message || '连接失败，请查看运行日志')}</span></div>` : ''}
        <div class="hero-foot">
          <div class="hf"><span>会话流量</span><b>${fmtBytes(m.rx + m.tx)}</b></div>
          <div class="hf"><span>上行</span><b>↑ ${fmtBytes(m.tx)}</b></div>
          <div class="hf"><span>上次连接</span><b>${p.lastConnectedAt ? timeAgo(p.lastConnectedAt) : '—'}</b></div>
          <div class="hf"><span>进程</span><b>${running ? 'easytier-core' : '—'}</b></div>
        </div>
      </div>

      <div class="stats-grid">
        ${statCard('link', 'P2P 直连', `${remote.filter(x => x.cost === 'p2p').length}<span class="u">条</span>`, `${remote.filter(x => x.cost !== 'p2p').length} 条中继链路`)}
        ${statCard('alert', '丢包率', `${fmtPct(m.loss)}`, m.loss > 1 ? '链路存在波动' : '链路稳定')}
        ${statCard('monitor', '在线节点', `${remote.length}<span class="u">台</span>`, `${remote.filter(x => x.cost === 'p2p').length} 直连 · ${remote.filter(x => x.cost !== 'p2p').length} 中继`)}
        ${statCard('arrow-down', '会话流量', fmtBytes(m.rx + m.tx), `↓ ${fmtBytes(m.rx)}  ↑ ${fmtBytes(m.tx)}`)}
      </div>
    </div>

    <div class="card topo-card" style="${tintVars(p.tint)}">
      <div class="card-head">
        <h3>${icon('network', 'sm')} 网络拓扑</h3>
        <span class="spacer"></span>
        <span class="pill ${running ? 'green' : 'gray'}" style="height:19px;font-size:9px">${running ? '实时' : '离线'}</span>
      </div>
      <div class="topo-stage">${topologySVG(p)}</div>
      <div class="topo-legend">
        <span class="item"><span class="ln p2p"></span> P2P 直连</span>
        <span class="item"><span class="ln relay"></span> 中继转发</span>
        <span class="item"><span class="ln" style="background:var(--violet)"></span> 公共节点</span>
      </div>
    </div>
  </div>

  ${quickControlsHTML(p)}
  <div class="bottom-grid">
    <div class="card">
      <div class="card-head">
        <h3>${icon('monitor', 'sm')} 节点</h3>
        <span class="count pill gray" style="height:18px;font-size:9px">${remote.length}</span>
        <span class="spacer"></span>
        <button class="link" style="font-size:10.5px;color:var(--accent)" data-action="tab" data-tab="peers">查看全部 →</button>
      </div>
      ${remote.length ? `<div class="peer-mini">${remote.slice(0, 4).map(x => peerMiniRow(x, p)).join('')}</div>`
        : `<div class="empty" style="padding:24px"><div class="empty-icon">${icon('monitor')}</div><h4>暂无节点</h4><p>${running ? '等待其他设备加入网络' : '连接网络后查看在线节点'}</p></div>`}
    </div>

    <div class="card" style="${tintVars(p.tint)}">
      <div class="card-head"><h3>${icon('info', 'sm')} 网络信息</h3><span class="spacer"></span>
        <button class="copy-btn" data-action="copy-config" title="复制配置">${icon('copy', 'sm')}</button>
      </div>
      <div class="card-body">
        <div class="info-rows">
          <div class="info-row"><span class="k">网络名称</span><span class="v mono">${esc(p.networkName)}</span></div>
          <div class="info-row"><span class="k">网络密码</span><span class="v mono">${S.ui.revealSecret[p.id] ? esc(p.secret || '无') : (p.secret ? '••••••••' : '无')}</span>
            ${p.secret ? `<button class="copy-btn" data-action="toggle-secret" data-id="${p.id}">${icon(S.ui.revealSecret[p.id] ? 'eye-off' : 'eye', 'sm')}</button>` : ''}</div>
          <div class="info-row"><span class="k">入口节点</span><span class="v mono">${esc(p.peers[0] || '—')}</span></div>
          <div class="info-row"><span class="k">子网代理</span><span class="v mono">${esc(p.proxyNetworks.join(', ') || '未配置')}</span></div>
          <div class="info-row"><span class="k">监听端口</span><span class="v mono">${p.listenPort} / RPC ${p.rpcPort}</span></div>
        </div>
      </div>
    </div>
  </div>`;
}

function quickControlsHTML(p) {
  const selected = Array.isArray(S.settings.quickOptions) ? S.settings.quickOptions : ['disableP2P'];
  const busy = rt(p.id).saving || ['connecting', 'stopping'].includes(rt(p.id).status);
  return `<div class="card quick-controls">
    <div class="card-head"><h3>${icon('settings', 'sm')} 快捷开关</h3><span class="spacer"></span>
      <button class="link" data-action="quick-customize">${S.ui.quickCustomize ? '完成' : '自定义'}</button></div>
    <div class="quick-control-body">
      ${S.ui.quickCustomize ? `<div class="quick-choices">${QUICK_OPTIONS.map(o => `<label><input type="checkbox" data-action="quick-select" data-key="${o.key}" ${selected.includes(o.key) ? 'checked' : ''}> ${o.title}</label>`).join('')}</div>` : ''}
      ${QUICK_OPTIONS.filter(o => selected.includes(o.key)).map(o => `<div class="switch-row"><div class="sw-text"><div class="sw-title">${o.title}</div><div class="sw-desc">${o.desc}</div></div><button class="switch ${p[o.key] ? 'on' : ''}" role="switch" aria-checked="${!!p[o.key]}" aria-label="${o.title}" data-action="quick-toggle" data-id="${p.id}" data-key="${o.key}" ${busy ? 'disabled' : ''}></button></div>`).join('') || '<div class="quick-empty">点击“自定义”添加快捷开关</div>'}
      <div class="quick-hint">连接中修改开关会短暂断开并重新连接。</div>
    </div>
  </div>`;
}

async function toggleQuickOption(p, key) {
  if (!p || !QUICK_OPTIONS.some(o => o.key === key)) return;
  const r = rt(p.id);
  if (r.saving || ['connecting', 'stopping'].includes(r.status)) return;
  const active = r.coreActive || r.status === 'running';
  r.saving = true;
  renderView(true);
  try {
    if (active && !await disconnect(p)) return;
    p[key] = !p[key];
    persist();
    renderAll();
    if (active) { toast('配置已保存，正在重新连接', 'ok'); await connect(p); }
    else toast('配置已保存', 'ok');
  } finally { r.saving = false; renderView(true); }
}

function statCard(ic, label, value, foot) {
  return `<div class="card stat-card">
    <div class="stat-label">${icon(ic, 'sm')} ${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-foot">${foot}</div>
  </div>`;
}

function latencyQuality(v) {
  if (!v) return '暂无数据';
  if (v < 10) return '极佳 · 适合实时协作';
  if (v < 30) return '良好 · 链路稳定';
  if (v < 80) return '一般 · 存在中继';
  return '较差 · 建议检查网络';
}

function peerMiniRow(peer, p) {
  const link = peer.isLocal ? 'local' : peer.cost === 'p2p' ? 'p2p' : 'relay';
  return `<button class="peer-mini-row" data-action="tab" data-tab="peers">
    <div class="avatar ${peer.isLocal ? 'local' : peer.isPublicServer ? 'public' : ''}">${icon(deviceSymbol(peer.hostname), 'sm')}${peer.isLocal ? '<span class="live"></span>' : ''}</div>
    <div class="peer-mini-main">
      <div class="peer-mini-name">${esc(peer.hostname || '未知节点')}${peer.isLocal ? '<span class="badge local">本机</span>' : ''}</div>
      <div class="peer-mini-ip">${esc(peer.ipv4 || '公网中继')}</div>
    </div>
    <div class="peer-mini-lat"><b>${fmtLat(peer.latency)}</b>${peer.latency ? ' ms' : ''}<span>${peer.isLocal ? '本地' : link === 'p2p' ? 'P2P' : '中继'}</span></div>
  </button>`;
}

function topologySVG(p) {
  const r = rt(p.id);
  const peers = r.peers.filter(x => !x.isLocal).slice(0, 6);
  const cx = 170, cy = 132, rx = 112, ry = 82;
  let links = '', nodes = '';

  peers.forEach((peer, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(peers.length, 1);
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    const color = peer.isPublicServer ? '#7C5CFC' : peer.cost === 'p2p' ? '#17B26A' : '#E39A1B';
    const mx = (cx + x) / 2, my = (cy + y) / 2 - 12;
    const linkCls = peer.cost === 'p2p' ? 'topo-link' : 'topo-relay';
    links += `<path d="M${cx} ${cy} Q${mx} ${my} ${x} ${y}" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="1.2" class="${linkCls}"/>`;
    nodes += `<g class="topo-node">
      <title>${esc(peer.hostname || '节点')} · ${esc(peer.ipv4 || '公网中继')} · ${peer.latency ? fmtLat(peer.latency) + ' ms' : '本机'}</title>
      <circle cx="${x}" cy="${y}" r="14.5" fill="var(--panel-solid)" stroke="${color}" stroke-opacity=".5" stroke-width="1.2"/>
      <text x="${x}" y="${y + 3.4}" text-anchor="middle" font-size="8.6" font-weight="650" fill="${color}">${esc(initials(peer.hostname))}</text>
      <text x="${x}" y="${y + 28}" text-anchor="middle" font-size="8" fill="var(--text-3)">${esc(truncate(peer.hostname || '节点', 9))}</text>
    </g>`;
  });

  const stateText = r.status === 'running'
    ? (peers.length ? '' : '等待节点加入')
    : '未连接';

  return `<svg viewBox="0 0 340 268" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">
    <defs>
      <linearGradient id="topoCore" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${TINTS[p.tint % TINTS.length].a}"/>
        <stop offset="1" stop-color="${TINTS[p.tint % TINTS.length].b}"/>
      </linearGradient>
    </defs>
    ${links}
    ${nodes}
    <circle cx="${cx}" cy="${cy}" r="33" fill="none" stroke="url(#topoCore)" stroke-opacity=".18" class="topo-pulse"/>
    <circle cx="${cx}" cy="${cy}" r="24" fill="url(#topoCore)"/>
    <text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${esc(initials(p.hostname))}</text>
    <text x="${cx}" y="${cy + 43}" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--text-2)">${esc(truncate(p.hostname, 12))}</text>
    ${stateText ? `<text x="${cx}" y="${cy + 58}" text-anchor="middle" font-size="8" fill="var(--text-3)">${stateText}</text>` : ''}
  </svg>`;
}

/* ------------------------------------------------------------------- peers */

function detailPeers(p) {
  const r = rt(p.id);
  if (!r.peers.length) {
    return `<div class="card">${emptyBlock('monitor', r.status === 'running' ? '等待节点加入' : '尚未连接',
      r.status === 'running' ? '网络已就绪，其他设备加入后会显示在这里' : '连接网络后即可查看在线节点、链路质量与流量',
      r.status === 'running' ? null : '连接网络')}</div>`;
  }
  const total = r.peers.length;
  const remoteCount = r.peers.filter(x => !x.isLocal).length;
  const direct = r.peers.filter(x => x.cost === 'p2p').length;

  return `<div class="card table-card">
    <div class="table-toolbar">
      <h2>节点</h2><span class="count">${remoteCount}</span>
      <span class="pill green" style="height:19px;font-size:9px"><span class="dot"></span>${direct} 条直连</span>
      <span class="spacer"></span>
      <div class="search">${icon('search', 'sm')}<input id="peer-search" placeholder="搜索设备 / IP" value="${esc(S.ui.search)}"></div>
      <div class="seg">
        <button class="${S.ui.linkFilter === 'all' ? 'on' : ''}" data-action="filter-link" data-filter="all">全部</button>
        <button class="${S.ui.linkFilter === 'p2p' ? 'on' : ''}" data-action="filter-link" data-filter="p2p">直连</button>
        <button class="${S.ui.linkFilter === 'relay' ? 'on' : ''}" data-action="filter-link" data-filter="relay">中继</button>
      </div>
      <button class="iconbtn" data-action="refresh" title="刷新">${icon('refresh', 'sm')}</button>
    </div>
    <div class="tr head peer-grid">
      <span class="th-sort" data-action="sort" data-sort="name">设备 ${S.ui.sort === 'name' ? icon('chevron-down', 'sm') : ''}</span>
      <span>虚拟 IP</span><span>链路</span>
      <span class="th-sort" data-action="sort" data-sort="latency">延迟 ${S.ui.sort === 'latency' ? icon('chevron-down', 'sm') : ''}</span>
      <span>丢包</span><span>流量</span><span>版本</span>
    </div>
    <div id="peer-rows">${peerRowsHTML(p)}</div>
    <div class="table-foot">
      <span>最后刷新 ${fmtTime(new Date())} · 每 ${S.settings.refresh} 秒自动更新</span>
      <span class="spacer"></span>
      <span class="tf-item"><i class="tf-dot" style="background:var(--green)"></i>${direct} 条 P2P 直连</span>
      <span class="tf-item"><i class="tf-dot" style="background:var(--amber)"></i>${total - direct - 1 > 0 ? total - direct - 1 : 0} 条中继</span>
      <span class="tf-item"><i class="tf-dot" style="background:var(--accent)"></i>本机</span>
    </div>
  </div>
  ${peerInsightsHTML(p)}`;
}

function peerInsightsHTML(p) {
  const r = rt(p.id);
  const remote = r.peers.filter(x => !x.isLocal);
  const total = remote.length + 1;
  const p2p = remote.filter(x => x.cost === 'p2p').length;
  const relay = remote.length - p2p;
  const p2pPct = Math.round((p2p / total) * 100);
  const relayPct = Math.round((relay / total) * 100);
  const localPct = Math.max(0, 100 - p2pPct - relayPct);
  const gradient = `conic-gradient(#17B26A 0 ${p2pPct}%, #E39A1B ${p2pPct}% ${p2pPct + relayPct}%, #3F6DF6 ${p2pPct + relayPct}% 100%)`;

  const buckets = [
    { label: '< 5', min: 0, max: 5, color: '#17B26A' },
    { label: '5–15', min: 5, max: 15, color: '#17B26A' },
    { label: '15–40', min: 15, max: 40, color: '#E39A1B' },
    { label: '40+', min: 40, max: Infinity, color: '#E5484D' }
  ].map(b => ({ ...b, n: remote.filter(x => x.latency != null && x.latency >= b.min && x.latency < b.max).length }));
  const maxN = Math.max(...buckets.map(b => b.n), 1);
  const avgLat = avg(remote.map(x => x.latency).filter(v => v != null));

  return `<div class="insights-grid">
    <div class="card insight-card">
      <div class="card-head"><h3>${icon('link', 'sm')} 链路构成</h3><span class="spacer"></span><span class="sub">${total} 个节点</span></div>
      <div class="insight-body">
        <div class="donut" style="background:${gradient}"><div class="donut-center"><b>${p2pPct}%</b><span>P2P</span></div></div>
        <div class="legend-list">
          <div><i style="background:#17B26A"></i><span>P2P 直连</span><b>${p2p}</b></div>
          <div><i style="background:#E39A1B"></i><span>中继转发</span><b>${relay}</b></div>
          <div><i style="background:#3F6DF6"></i><span>本机</span><b>1</b></div>
          <div class="ll-foot"><span>本机占比</span><b>${localPct}%</b></div>
        </div>
      </div>
    </div>
    <div class="card insight-card">
      <div class="card-head"><h3>${icon('activity', 'sm')} 延迟分布</h3><span class="spacer"></span><span class="sub">平均 ${fmtLat(avgLat)} ms</span></div>
      <div class="hist">
        ${buckets.map(b => `<div class="hist-col">
          <span class="hist-n">${b.n || ''}</span>
          <div class="hist-bar" style="height:${b.n ? Math.max(8, (b.n / maxN) * 74) : 3}px;background:${b.n ? b.color : 'var(--fill-2)'}"></div>
          <span class="hist-l">${b.label}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function peerRowsHTML(p) {
  const r = rt(p.id);
  let list = r.peers.slice();
  if (S.ui.linkFilter === 'p2p') list = list.filter(x => x.cost === 'p2p');
  if (S.ui.linkFilter === 'relay') list = list.filter(x => x.cost !== 'p2p' && !x.isLocal);
  if (S.ui.search) {
    const q = S.ui.search.toLowerCase();
    list = list.filter(x => (x.hostname + ' ' + x.ipv4 + ' ' + x.version).toLowerCase().includes(q));
  }
  if (S.ui.sort === 'latency') list.sort((a, b) => (a.latency ?? 9999) - (b.latency ?? 9999));
  if (S.ui.sort === 'name') list.sort((a, b) => a.hostname.localeCompare(b.hostname, 'zh'));

  const rows = list.map(peer => {
    const expanded = S.ui.expanded === peer.id;
    const pctLat = peer.latency ? Math.min(100, (peer.latency / 120) * 100) : 0;
    const latCls = (peer.latency || 0) > 80 ? 'bad' : (peer.latency || 0) > 30 ? 'warn' : '';
    return `<div class="tr row peer-row" data-action="toggle-peer" data-id="${peer.id}" style="grid-template-columns:minmax(180px,1.6fr) 118px 94px 96px 62px 124px 80px">
      <div class="cell device-cell">
        <div class="avatar ${peer.isLocal ? 'local' : peer.isPublicServer ? 'public' : ''}">${icon(deviceSymbol(peer.hostname), 'sm')}${peer.isLocal ? '<span class="live"></span>' : ''}</div>
        <div style="min-width:0">
          <div class="device-name">${esc(peer.hostname || '未知节点')}${peer.isLocal ? '<span class="self">本机</span>' : ''}</div>
          <div class="device-ip">${esc(peer.ipv4 || '公网中继节点')}${peer.natType && peer.natType !== 'Unknown' ? ' · ' + esc(peer.natType) : ''}</div>
        </div>
      </div>
      <div class="cell cell-mono">${esc(peer.ipv4 || '—')}</div>
      <div class="cell">${linkBadge(peer)}</div>
      <div class="cell lat-cell">
        <span class="lat-val">${fmtLat(peer.latency)}${peer.latency ? '<span style="font-size:9px;color:var(--text-3)"> ms</span>' : ''}</span>
        ${peer.latency ? `<span class="lat-bar"><i class="${latCls}" style="width:${pctLat}%"></i></span>` : ''}
      </div>
      <div class="cell cell-mono">${peer.isLocal ? '—' : fmtPct(peer.loss)}</div>
      <div class="cell traffic-cell">
        <div><span class="u">${icon('arrow-down', 'sm')}${fmtBytes(peer.rx)}</span></div>
        <div><span class="u">${icon('arrow-up', 'sm')}${fmtBytes(peer.tx)}</span></div>
      </div>
      <div class="cell cell-mono" style="font-size:9.5px">${esc((peer.version || '').split('-')[0] || '—')}</div>
      ${expanded ? `<div class="row-expand">
        <div class="kv-mini"><div class="k">Peer ID</div><div class="v">${esc(peer.id)}</div></div>
        <div class="kv-mini"><div class="k">连接协议</div><div class="v">${esc(peer.tunnel || '—')}</div></div>
        <div class="kv-mini"><div class="k">NAT 类型</div><div class="v">${esc(peer.natType || 'Unknown')}</div></div>
        <div class="kv-mini"><div class="k">CIDR</div><div class="v">${esc(peer.cidr || '—')}</div></div>
        <div class="kv-mini"><div class="k">完整版本</div><div class="v">${esc(peer.version || '—')}</div></div>
      </div>` : ''}
    </div>`;
  }).join('');

  return rows || `<div class="empty" style="padding:34px"><div class="empty-icon">${icon('search')}</div><h4>没有匹配的节点</h4><p>尝试调整搜索或筛选条件</p></div>`;
}

function linkBadge(peer) {
  if (peer.isLocal) return `<span class="badge local"><span class="dot"></span>本机</span>`;
  if (peer.cost === 'p2p') return `<span class="badge p2p"><span class="dot"></span>P2P${peer.tunnel && peer.tunnel !== '—' ? ' · ' + esc(peer.tunnel) : ''}</span>`;
  return `<span class="badge relay"><span class="dot"></span>${peer.isPublicServer ? '公共中继' : '中继'}</span>`;
}

/* ------------------------------------------------------------------ routes */

function detailRoutes(p) {
  const r = rt(p.id);
  const routes = r.routes;
  if (!routes.length) {
    return `<div class="card">${emptyBlock('route', '暂无路由信息', r.status === 'running' ? '等待路由表同步，稍候会显示已学习到的网段' : '连接网络后查看节点间路由与子网代理', r.status === 'running' ? null : '连接网络')}</div>`;
  }
  const proxyCount = routes.filter(x => x.proxyCidrs).length;
  return `<div class="card table-card">
    <div class="table-toolbar">
      <h2>路由表</h2><span class="count">${routes.length}</span>
      <span class="spacer"></span>
      <span class="chip">${icon('route', 'sm')} ${proxyCount} 个子网代理</span>
      <button class="iconbtn" data-action="refresh" title="刷新">${icon('refresh', 'sm')}</button>
    </div>
    <div class="tr head route-grid">
      <span>目标网段</span><span>节点</span><span>下一跳</span><span>路径</span><span>延迟</span><span>代理网段</span><span>版本</span>
    </div>
    ${routes.map(route => `
      <div class="tr row route-grid">
        <div class="cell"><span class="route-chip ${route.pathLen === 0 ? 'primary' : ''}">${esc(route.ipv4)}</span></div>
        <div class="cell"><div class="device-name">${esc(route.hostname || '—')}</div><div class="cell-sub">${esc(route.version.split('-')[0] || '')}</div></div>
        <div class="cell"><div class="cell-mono">${esc(route.nextHopIpv4 || '—')}</div><div class="cell-sub">${esc(route.nextHopHostname || '')}</div></div>
        <div class="cell cell-mono">${route.pathLen === 0 ? '本地' : route.pathLen + ' 跳'}</div>
        <div class="cell cell-mono">${route.pathLatency ? route.pathLatency + ' ms' : '—'}</div>
        <div class="cell">${route.proxyCidrs ? `<span class="route-chip">${esc(truncate(route.proxyCidrs, 22))}</span>` : '<span class="muted">—</span>'}</div>
        <div class="cell cell-mono" style="font-size:9.5px">${esc(route.version.split('-')[0] || '—')}</div>
      </div>`).join('')}
  </div>

  <div class="routes-bottom">
    <div class="card route-summary">
      <div class="card-head"><h3>${icon('route', 'sm')} 路由概览</h3></div>
      <div class="route-stats">
        <div><b>${routes.length}</b><span>总路由条目</span></div>
        <div><b>${routes.filter(x => x.pathLen === 0).length}</b><span>本机直连</span></div>
        <div><b>${proxyCount}</b><span>代理网段</span></div>
      </div>
    </div>
    <div class="card route-help">
      <div class="card-head"><h3>${icon('info', 'sm')} 如何阅读路由表</h3></div>
      <div class="route-help-body">
        <p><b>下一跳</b> 是数据包转发的下一个节点；<b>路径</b> 表示经过的中转节点数量。</p>
        <p>标记为「本地」的条目由当前设备直接提供，通常来自子网代理配置。</p>
      </div>
    </div>
  </div>`;
}

function emptyBlock(ic, title, text, actionTitle) {
  return `<div class="empty">
    <div class="empty-icon">${icon(ic)}</div>
    <h4>${esc(title)}</h4>
    <p>${esc(text)}</p>
    ${actionTitle ? `<button class="btn primary sm" style="margin-top:4px" data-action="trigger-empty">${esc(actionTitle)}</button>` : ''}
  </div>`;
}

/* ----------------------------------------------------------------- config */

function detailConfig(p) {
  if (!S.draft || S.draft.id !== p.id) startDraft();
  const d = S.draft;
  const e = (k) => (S.ui.errors && S.ui.errors[k]) || '';

  return `<div class="config-grid">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card form-card">
        <div class="form-head">${icon('network', 'sm')}<div><h3>基本信息</h3><p>网络标识与设备身份</p></div></div>
        <div class="field-row">
          <label class="field-label">显示名称<span class="req">*</span></label>
          <div><input class="input" data-model="name" value="${esc(d.name)}" placeholder="例如：家庭骨干网">
            ${e('name') ? `<div class="field-error">${esc(e('name'))}</div>` : ''}</div>
        </div>
        <div class="field-row">
          <label class="field-label">网络名称<span class="req">*</span></label>
          <div><input class="input mono" data-model="networkName" value="${esc(d.networkName)}" placeholder="network-name">
            <div class="field-hint">相同网络名称与密码的设备会加入同一张 Mesh 网络</div></div>
        </div>
        <div class="field-row">
          <label class="field-label">网络密码</label>
          <div><input class="input mono" type="text" data-model="secret" value="${esc(d.secret)}" placeholder="可留空"></div>
        </div>
        <div class="field-row">
          <label class="field-label">设备名称</label>
          <div><input class="input" data-model="hostname" value="${esc(d.hostname)}" placeholder="在节点列表中显示"></div>
        </div>
        <div class="field-row">
          <label class="field-label">IP 分配</label>
          <div>
            <div class="radio-row">
              <button class="radio ${!d.dhcp ? 'on' : ''}" data-action="dhcp" data-value="0"><i></i>手动指定</button>
              <button class="radio ${d.dhcp ? 'on' : ''}" data-action="dhcp" data-value="1"><i></i>DHCP 自动分配</button>
            </div>
            ${!d.dhcp ? `<input class="input mono" style="margin-top:8px;max-width:200px" data-model="ipv4" value="${esc(d.ipv4)}" placeholder="10.144.144.1">
              ${e('ipv4') ? `<div class="field-error">${esc(e('ipv4'))}</div>` : ''}` : `<div class="field-hint" style="margin-top:6px">连接后由网络自动分配虚拟 IP</div>`}
          </div>
        </div>
      </div>

      <div class="card form-card">
        <div class="form-head">${icon('link', 'sm')}<div><h3>连接节点</h3><p>用于发现网络中的其他设备</p></div></div>
        <div class="field-row stack">
          <label class="field-label">入口节点</label>
          <div class="peer-editor">
            ${d.peers.map((peer, i) => `<div class="peer-editor-row">
              <input class="input mono" data-list="peers" data-index="${i}" value="${esc(peer)}" placeholder="tcp://host:port">
              <button class="iconbtn sm" data-action="remove-peer" data-index="${i}" title="移除">${icon('trash', 'sm')}</button>
            </div>`).join('')}
            <div class="flex gap10">
              <button class="add-row" data-action="add-peer">${icon('plus', 'sm')} 添加节点</button>
              <button class="add-row" data-action="use-public">${icon('cloud', 'sm')} 使用公共节点</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card form-card">
        <div class="form-head">${icon('sliders', 'sm')}<div><h3>网络选项</h3><p>传输协议与路由行为</p></div></div>
        <div class="toggle-grid">
          ${switchRow('加密传输', '使用 WireGuard 加密全部流量', 'enableEncryption', d.enableEncryption)}
          ${switchRow('IPv6 支持', '同时监听 IPv6 地址', 'enableIPv6', d.enableIPv6)}
          ${switchRow('延迟优先', '优先选择低延迟链路', 'latencyFirst', d.latencyFirst)}
          ${switchRow('多线程传输', '提升高带宽场景吞吐', 'multiThread', d.multiThread)}
          ${switchRow('禁用 P2P', '仅通过中继节点转发', 'disableP2P', d.disableP2P)}
          ${switchRow('接受 DNS', '使用网络下发的 DNS 配置', 'acceptDNS', d.acceptDNS)}
          ${switchRow('作为出口节点', '允许其他节点经本机访问公网', 'enableExitNode', d.enableExitNode)}
          ${switchRow('无 TUN 模式', '不创建虚拟网卡（仅代理）', 'noTun', d.noTun)}
        </div>
      </div>

      <div class="card form-card">
        <div class="form-head" data-action="toggle-advanced" style="border-bottom:none">
          ${icon('settings', 'sm')}<div><h3>高级设置</h3><p>监听端口、MTU、子网代理与 VPN Portal</p></div>
          <span class="spacer"></span>
          <span class="iconbtn sm" style="transform:rotate(${S.ui.advanceOpen ? 180 : 0}deg);transition:transform .18s">${icon('chevron-down', 'sm')}</span>
        </div>
        <div class="${S.ui.advanceOpen ? '' : 'hidden'}">
          <div class="field-row">
            <label class="field-label">监听端口</label>
            <div class="input-group">
              <input class="input mono" type="number" data-model="listenPort" value="${d.listenPort}">
              <span class="muted text-11">TCP / UDP</span>
            </div>
          </div>
          <div class="field-row">
            <label class="field-label">RPC 端口</label>
            <div class="input-group">
              <input class="input mono" type="number" data-model="rpcPort" value="${d.rpcPort}">
              <span class="muted text-11">本地管理</span>
            </div>
          </div>
          <div class="field-row">
            <label class="field-label">MTU</label>
            <input class="input mono" type="number" data-model="mtu" value="${d.mtu}">
          </div>
          <div class="field-row">
            <label class="field-label">中继白名单</label>
            <input class="input mono" data-model="relayWhitelist" value="${esc(d.relayWhitelist)}" placeholder="*">
          </div>
          <div class="field-row stack">
            <label class="field-label">子网代理</label>
            <div class="peer-editor">
              ${d.proxyNetworks.map((net, i) => `<div class="peer-editor-row">
                <input class="input mono" data-list="proxyNetworks" data-index="${i}" value="${esc(net)}" placeholder="192.168.1.0/24">
                <button class="iconbtn sm" data-action="remove-proxy" data-index="${i}">${icon('trash', 'sm')}</button>
              </div>`).join('')}
              <button class="add-row" data-action="add-proxy">${icon('plus', 'sm')} 添加网段</button>
            </div>
          </div>
          <div class="switch-row">
            <div class="sw-text"><div class="sw-title">WireGuard VPN Portal</div><div class="sw-desc">允许标准 WireGuard 客户端接入</div></div>
            <button class="switch ${d.vpnPortalEnabled ? 'on' : ''}" data-action="toggle-field" data-field="vpnPortalEnabled"></button>
          </div>
          ${d.vpnPortalEnabled ? `<div class="field-row"><label class="field-label">Portal 监听</label><input class="input mono" data-model="vpnPortalListen" value="${esc(d.vpnPortalListen)}"></div><div class="field-row"><label class="field-label">客户端网段</label><input class="input mono" data-model="vpnPortalCIDR" value="${esc(d.vpnPortalCIDR || '10.14.14.0/24')}" placeholder="10.14.14.0/24"></div>` : ''}
        </div>
      </div>
    </div>

    <div class="config-rail">
      <div class="card toml-card">
        <div class="toml-head">${icon('terminal', 'sm')}<b>config.toml</b><span class="spacer"></span>
          <button class="copy-btn" style="color:#8fa0b8" data-action="copy-config" title="复制">${icon('copy', 'sm')}</button>
        </div>
        <pre class="toml-body" id="toml-preview">${highlightTOML(buildTOML(d))}</pre>
      </div>

      <div class="card apply-card">
        <div class="flex gap6">
          <button class="btn ${S.dirty ? 'primary' : 'secondary'} wide" id="save-config" data-action="save-config" ${S.dirty ? '' : 'disabled'}>${S.dirty ? '保存并应用' : '配置已同步'}</button>
          <span class="pill amber hidden" id="dirty-badge" style="height:20px;font-size:9px">未保存</span>
        </div>
        <div class="apply-actions">
          <button class="btn secondary sm" data-action="export-config">${icon('export', 'sm')} 导出</button>
          <button class="btn secondary sm" data-action="import-config">${icon('import', 'sm')} 导入</button>
        </div>
        <div class="apply-note">${icon('info', 'sm')}<span>应用配置后，如网络正在运行会先确认停止，再重新连接。${d.sourceToml ? '导入配置中未修改的设置会保留；修改监听端口或 IPv6 选项会重建监听地址。' : ''}</span></div>
      </div>

      <div class="card" style="padding:12px 14px">
        <div class="flex" style="justify-content:space-between;margin-bottom:8px">
          <span class="text-11" style="color:var(--text-2);font-weight:600">危险操作</span>
        </div>
        <div class="flex gap6">
          <button class="btn danger sm" style="flex:1" data-action="delete-network" data-id="${p.id}">${icon('trash', 'sm')} 删除网络</button>
          <button class="btn secondary sm" style="flex:1" data-action="duplicate-network" data-id="${p.id}">${icon('copy', 'sm')} 复制</button>
        </div>
      </div>
    </div>
  </div>`;
}

function switchRow(title, desc, field, on) {
  return `<div class="switch-row">
    <div class="sw-text"><div class="sw-title">${title}</div><div class="sw-desc">${desc}</div></div>
    <button class="switch ${on ? 'on' : ''}" data-action="toggle-field" data-field="${field}"></button>
  </div>`;
}

function highlightTOML(text) {
  return text.split('\n').map(line => {
    const safe = esc(line);
    if (/^\s*#/.test(line)) return `<span class="tk-com">${safe}</span>`;
    if (/^\s*\[\[?/.test(line)) return `<span class="tk-sec">${safe}</span>`;
    const m = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
    if (m) {
      let val = esc(m[4]);
      if (m[4].startsWith('"')) val = `<span class="tk-str">${esc(m[4])}</span>`;
      else if (/^(true|false)$/.test(m[4])) val = `<span class="tk-bool">${esc(m[4])}</span>`;
      else if (/^-?\d+(\.\d+)?$/.test(m[4])) val = `<span class="tk-num">${esc(m[4])}</span>`;
      return `${m[1]}<span class="tk-key">${esc(m[2])}</span>${m[3]}${val}`;
    }
    return safe;
  }).join('\n');
}

function listenersFor(p) {
  const port = Number(p.listenPort) || 11010;
  const list = [
    `tcp://0.0.0.0:${port}`,
    `udp://0.0.0.0:${port}`,
    `ws://0.0.0.0:${port + 1}`,
    `wss://0.0.0.0:${port + 2}`,
    `wg://0.0.0.0:${port + 3}`
  ];
  if (p.enableIPv6) {
    list.push(`tcp://[::]:${port}`, `udp://[::]:${port}`);
  }
  return list;
}

function slug(name, id) {
  const s = (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const suffix = String(id).slice(0, 4).toLowerCase();
  return s ? `${s}-${suffix}` : `et-${suffix}`;
}

/* -------------------------------------------------------------------- logs */

function detailLogs(p) {
  const r = rt(p.id);
  const filtered = filterLogs(r.logs, p.id);
  return `<div class="card logs-card">
    <div class="log-toolbar">
      <span class="title">${icon('terminal', 'sm')} 运行日志</span>
      <span class="spacer"></span>
      <div class="seg">
        ${['all', 'info', 'warn', 'error'].map(k => `<button class="${S.ui.logLevel === k ? 'on' : ''}" data-action="log-level" data-level="${k}">${k === 'all' ? '全部' : k === 'info' ? '信息' : k === 'warn' ? '警告' : '错误'}</button>`).join('')}
      </div>
      <div class="search">${icon('search', 'sm')}<input id="log-search" placeholder="搜索日志" value="${esc(S.ui.logSearch)}"></div>
      <button class="iconbtn" data-action="toggle-autoscroll" title="自动滚动">${icon('arrow-down', 'sm')}</button>
      <button class="iconbtn" data-action="clear-logs" title="清空日志">${icon('trash', 'sm')}</button>
      <button class="iconbtn" data-action="copy-logs" title="复制全部">${icon('copy', 'sm')}</button>
    </div>
    <div class="console" id="console" data-version="${logFingerprint(filtered)}">
      ${filtered.length ? filtered.map(logLineHTML).join('') : `<div class="log-empty">${icon('terminal')}<span>暂无日志 · 连接网络后开始记录</span></div>`}
    </div>
  </div>`;
}

function filterLogs(logs, id) {
  let list = logs;
  if (S.ui.logLevel !== 'all') list = list.filter(l => l.level === S.ui.logLevel || (S.ui.logLevel === 'warn' && l.level === 'error'));
  if (S.ui.logSearch) {
    const q = S.ui.logSearch.toLowerCase();
    list = list.filter(l => (l.message + l.target).toLowerCase().includes(q));
  }
  return list;
}

function parseCoreLine(raw) {
  let line = String(raw).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim();
  if (!line) return null;
  const m = line.match(/^(?:\[)?(?:\d{4}-\d{2}-\d{2}[T ][\d:.,]+Z?\s*)?(TRACE|DEBUG|INFO|WARN|ERROR|WARNING)\s+([A-Za-z0-9_]+(?:::[A-Za-z0-9_]+)*)[:\]\s]+(.*)$/);
  if (m) {
    const level = m[1].toUpperCase() === 'WARNING' ? 'warn' : m[1].toLowerCase();
    return { level, target: m[2], message: m[3].replace(/^[-\s]+/, '').trim() || line };
  }
  const level = /\b(error|panic|fatal)\b/i.test(line.slice(0, 90)) ? 'error'
    : /\bwarn(ing)?\b/i.test(line.slice(0, 90)) ? 'warn'
    : /\b(debug|trace)\b/i.test(line.slice(0, 90)) ? 'debug' : 'info';
  return { level, target: 'easytier_core', message: line };
}

function logLineHTML(l) {
  const cls = ['info', 'warn', 'error', 'debug', 'trace'].includes(l.level) ? l.level : 'info';
  return `<div class="log-line ${cls}">
    <span class="log-time">${fmtTime(l.t)}</span>
    <span class="log-level ${cls}">${l.level.toUpperCase()}</span>
    <span class="log-target">${esc(l.target)}</span>
    <span class="log-msg">${esc(l.message)}</span>
  </div>`;
}

function logFingerprint(logs) {
  return `${logs.length}:${logs[0]?.seq || 0}:${logs[logs.length - 1]?.seq || 0}`;
}

function appendLogsLive() {
  const consoleEl = $('#console');
  if (!consoleEl || !S.runtime[S.ui.networkId]) return;
  const all = filterLogs(rt(S.ui.networkId).logs, S.ui.networkId);
  const version = logFingerprint(all);
  if (consoleEl.dataset.version === version) return;
  const top = consoleEl.scrollTop;
  consoleEl.innerHTML = all.map(logLineHTML).join('') || '<div class="log-empty">没有匹配的日志</div>';
  consoleEl.dataset.version = version;
  if (S.ui.autoScroll) scrollLogsToEnd();
  else consoleEl.scrollTop = top;
}

function scrollLogsToEnd() {
  const c = $('#console');
  if (c) c.scrollTop = c.scrollHeight;
}

/* ---------------------------------------------------------------- settings */

function renderSettings() {
  const themes = [
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
    { id: 'system', label: '跟随系统' }
  ];
  return `<div class="page settings-wrap">
    ${pageHead('设置', '外观、核心与数据管理', `<button class="btn secondary" data-action="open-folder">${icon('folder', 'sm')} 打开数据目录</button>`)}

    <div class="settings-section">
      <h2>外观</h2>
      <div class="card settings-card">
        <div class="theme-grid">
          ${themes.map(t => `<button class="theme-opt ${S.settings.theme === t.id ? 'on' : ''}" data-action="theme" data-theme="${t.id}">
            <div class="theme-preview ${t.id}">
              <div class="tp-side"><span></span><span></span><span></span></div>
              <div class="tp-main">
                <div class="tp-title"></div>
                <div class="tp-card"><span class="tp-line w1"></span><span class="tp-line w2"></span></div>
                <div class="tp-row"><i></i><i></i></div>
              </div>
            </div>
            <div class="theme-label">${t.label}<span class="check">${icon('check', 'sm')}</span></div>
          </button>`).join('')}
        </div>
        <div class="accent-row" style="border-top:1px solid var(--line-soft)">
          <span class="text-11" style="color:var(--text-2);width:64px">强调色</span>
          ${ACCENTS.map((c, i) => `<button class="accent-dot ${S.settings.accent === i ? 'on' : ''}" style="background:${c};color:${c}" data-action="accent" data-index="${i}">
            <span class="tick">${icon('check', 'sm')}</span></button>`).join('')}
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>通用</h2>
      <div class="card settings-card">
        ${settingsSwitch('开机时启动 EasyTier', '登录 macOS 后自动运行客户端', 'launchAtLogin', S.settings.launchAtLogin)}
        ${settingsSwitch('启动时自动连接', '打开客户端后连接标记为自动的网络', 'autoConnectOnLaunch', S.settings.autoConnectOnLaunch)}
        ${settingsSwitch('关闭窗口后驻留菜单栏', 'EasyTier 继续在后台运行', 'keepInMenuBar', S.settings.keepInMenuBar)}
        ${settingsSwitch('断开前确认', '断开网络时弹出确认提示', 'confirmDisconnect', S.settings.confirmDisconnect)}
        <div class="field-row" style="border-top:1px solid var(--line-soft)">
          <span class="field-label">刷新间隔</span>
          <div class="seg" style="width:max-content">
            ${[1, 2, 3, 5].map(v => `<button class="${S.settings.refresh === v ? 'on' : ''}" data-action="refresh-interval" data-value="${v}">${v} 秒</button>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>核心</h2>
      <div class="card settings-card">
        <div class="path-row">
          <div class="path-top">
            <span class="path-name">easytier-core</span>
            <span class="path-status">
              <span class="pill ${S.meta.coreAvailable ? 'green' : 'amber'}" style="height:19px;font-size:9px"><span class="dot"></span>${S.meta.coreAvailable ? '已检测' : '未找到'}</span>
              <button class="btn secondary sm" data-action="choose-core">选择…</button>
            </span>
          </div>
          <div class="path-value ${S.meta.coreAvailable ? '' : 'muted'}">${esc(S.meta.coreAvailable ? S.meta.corePath : '未找到 · 自动搜索 Homebrew、/Applications 与应用目录')}</div>
        </div>
        <div class="path-row">
          <div class="path-top">
            <span class="path-name">easytier-cli</span>
            <span class="path-status">
              <span class="pill ${S.meta.cliAvailable ? 'green' : 'amber'}" style="height:19px;font-size:9px"><span class="dot"></span>${S.meta.cliAvailable ? '已检测' : '未找到'}</span>
              <button class="btn secondary sm" data-action="choose-cli">选择…</button>
            </span>
          </div>
          <div class="path-value ${S.meta.cliAvailable ? '' : 'muted'}">${esc(S.meta.cliAvailable ? S.meta.cliPath : '未找到 · 与 easytier-core 通常位于同一目录')}</div>
        </div>
        ${settingsSwitch('以管理员权限运行', '创建 TUN 网卡需要管理员权限；启动时授权一次', 'runAsRoot', S.settings.runAsRoot)}
        <div class="apply-note" style="margin:2px 16px 12px">${icon('info', 'sm')}<span>${S.meta.coreAvailable && S.meta.cliAvailable ? '核心已就绪，连接时将使用本机 EasyTier 进程运行网络。' : '未检测到 EasyTier Core，当前界面使用演示数据。安装 EasyTier 并选择上方二进制路径后，即可连接真实网络。'}</span></div>
        <div class="field-row" style="border-top:1px solid var(--line-soft)">
          <span class="field-label">核心日志级别</span>
          <div class="select-wrap" style="max-width:160px">
            <select class="input select" data-setting="logLevel">
              ${['error', 'warn', 'info', 'debug', 'trace'].map(v => `<option value="${v}" ${S.settings.logLevel === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>${icon('chevron-down', 'sm')}
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>数据</h2>
      <div class="card settings-card">
        <div class="path-row">
          <div class="path-top">
            <span class="path-name">配置与运行数据</span>
            <span class="path-status"><button class="btn secondary sm" data-action="open-folder">在 Finder 中显示</button></span>
          </div>
          <div class="path-value">${esc(S.meta.supportDir || '~/Library/Application Support/EasyTier Desktop')}</div>
        </div>
        <div class="path-row">
          <div class="path-top">
            <span class="path-name">示例网络</span>
            <span class="path-status"><button class="btn secondary sm" data-action="reset-samples">恢复示例</button></span>
          </div>
          <div class="path-value">清除当前网络并重新创建 1 个演示用网络配置</div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>关于</h2>
      <div class="card about-card">
        <div class="brand-mark about-mark">${brandGlyph()}</div>
        <div>
          <div class="about-title">EasyTier Desktop</div>
          <div class="about-sub">版本 ${esc(S.meta.appVersion || '1.0.3')} · 基于 EasyTier Core 的 macOS 图形客户端<br>界面对官方客户端进行了重新设计，网络能力由 EasyTier 提供。</div>
        </div>
        <div class="about-links">
          <button class="btn secondary sm" data-action="open-url" data-url="https://easytier.cn">官网 ${icon('external', 'sm')}</button>
          <button class="btn secondary sm" data-action="open-url" data-url="https://github.com/EasyTier/EasyTier">GitHub ${icon('external', 'sm')}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function settingsSwitch(title, desc, key, on) {
  return `<div class="switch-row">
    <div class="sw-text"><div class="sw-title">${title}</div><div class="sw-desc">${desc}</div></div>
    <button class="switch ${on ? 'on' : ''}" data-action="setting-toggle" data-key="${key}"></button>
  </div>`;
}

/* -------------------------------------------------------------- onboarding */

function renderOnboarding() {
  return `<div class="page"><div class="onboard">
    <div class="brand-mark onboard-mark">${brandGlyph()}</div>
    <h1>把你的设备连成一张网</h1>
    <p class="lead">EasyTier 是一个去中心化的 Mesh 组网工具。无需公网 IP，无需中心服务器，几秒钟即可让 Mac、服务器与移动设备互相访问。</p>
    <div class="onboard-actions">
      <button class="btn primary lg" data-action="new-network">${icon('plus', 'sm')} 创建第一个网络</button>
      <button class="btn secondary lg" data-action="import-config">${icon('import', 'sm')} 导入配置</button>
    </div>
    <div class="onboard-cards">
      <div class="card onboard-card">${icon('bolt')}<b>开箱即用</b><p>内置公共节点，无需自建服务器即可完成异地组网。</p></div>
      <div class="card onboard-card">${icon('shield')}<b>端到端加密</b><p>基于 WireGuard 的全链路加密，数据不经过第三方。</p></div>
      <div class="card onboard-card">${icon('route')}<b>智能路由</b><p>自动选择最低延迟链路，P2P 失败时无缝切换中继。</p></div>
    </div>
  </div></div>`;
}

/* ------------------------------------------------------------------- sheets */

function openAddSheet(template = 'public') {
  S.sheet = {
    type: 'add',
    template,
    form: {
      name: '',
      networkName: '',
      secret: Math.random().toString(36).slice(2, 12),
      hostname: S.meta.hostname || 'Mac',
      dhcp: template === 'public',
      ipv4: '10.144.144.1',
      peer: template === 'public' ? 'tcp://public.easytier.cn:11010' : '',
      importText: '',
      importName: ''
    },
    errors: {}
  };
  renderSheet();
}

function openDiagnostics() {
  const p = S.profiles.find(x => x.id === S.ui.networkId) || S.profiles.find(x => rt(x.id).status === 'running') || S.profiles[0];
  S.sheet = {
    type: 'diag',
    profile: p,
    running: true,
    checks: [
      { key: 'core', title: 'EasyTier Core', desc: '检查核心可执行文件与版本', status: 'pending' },
      { key: 'cli', title: '管理接口', desc: 'easytier-cli 与 RPC 端口连通性', status: 'pending' },
      { key: 'config', title: '网络配置', desc: '校验网络名称、密码与入口节点', status: 'pending' },
      { key: 'nat', title: 'NAT 类型', desc: 'STUN 探测 UDP 穿透能力', status: 'pending' },
      { key: 'p2p', title: 'P2P 连通性', desc: '与在线节点建立直连链路', status: 'pending' }
    ]
  };
  renderSheet();
  runDiagnostics();
}

async function runDiagnostics() {
  const sheet = S.sheet;
  if (!sheet || sheet.type !== 'diag') return;
  sheet.checks.forEach(c => { c.status = 'pending'; c.detail = ''; });
  sheet.running = true;
  renderSheet();

  const p = sheet.profile;
  for (const check of sheet.checks) {
    if (!S.sheet || S.sheet !== sheet) return;
    check.status = 'running';
    renderSheet();
    await new Promise(r => setTimeout(r, 340 + Math.random() * 240));
    if (!S.sheet || S.sheet !== sheet) return;

    if (check.key === 'core') {
      if (S.meta.coreAvailable) { check.status = 'ok'; check.detail = coreVersionShort() || '已安装'; }
      else { check.status = 'warn'; check.detail = '未检测到核心 · 当前使用演示数据'; }
    } else if (check.key === 'cli') {
      if (S.meta.cliAvailable) { check.status = 'ok'; check.detail = 'RPC 127.0.0.1:' + (p ? p.rpcPort : 15888); }
      else { check.status = 'warn'; check.detail = '未检测到 easytier-cli'; }
    } else if (check.key === 'config') {
      if (!p) { check.status = 'bad'; check.detail = '没有可用的网络配置'; }
      else if (!p.networkName) { check.status = 'bad'; check.detail = '网络名称为空'; }
      else { check.status = 'ok'; check.detail = `${p.networkName} · ${p.peers.length} 个入口`; }
    } else if (check.key === 'nat') {
      if (!p || rt(p.id).status !== 'running') { check.status = 'warn'; check.detail = '连接后可执行 STUN 探测'; }
      else { check.status = 'ok'; check.detail = 'Full Cone NAT · UDP 可达' + (isDemo() ? '（演示）' : ''); }
    } else if (check.key === 'p2p') {
      const direct = p ? rt(p.id).peers.filter(x => x.cost === 'p2p').length : 0;
      if (!p || rt(p.id).status !== 'running') { check.status = 'warn'; check.detail = '网络未连接'; }
      else { check.status = direct ? 'ok' : 'warn'; check.detail = (direct ? `${direct} 条 P2P 直连已建立` : '当前仅中继链路') + (isDemo() ? '（演示）' : ''); }
    }
    renderSheet();
  }
  if (S.sheet === sheet) { sheet.running = false; renderSheet(); }
}

function renderSheet() {
  const root = $('#overlay-root');
  if (!S.sheet) { root.innerHTML = ''; return; }
  if (S.sheet.type === 'add') { root.innerHTML = sheetAddHTML(); return; }
  if (S.sheet.type === 'diag') {
    const existing = root.querySelector('.overlay');
    if (!existing || existing.dataset.sheetType !== 'diag') {
      root.innerHTML = sheetDiagHTML();
      root.querySelector('.overlay').dataset.sheetType = 'diag';
    } else {
      const template = document.createElement('template');
      template.innerHTML = sheetDiagHTML();
      existing.querySelector('.sheet').innerHTML = template.content.querySelector('.sheet').innerHTML;
    }
    return;
  }
  root.innerHTML = '';
}

function sheetShell(inner, width = 620) {
  return `<div class="overlay" data-action="sheet-backdrop">
    <div class="sheet" style="width:${width}px">${inner}</div>
  </div>`;
}

function sheetAddHTML() {
  const s = S.sheet;
  const f = s.form;
  const t = s.template;
  const err = (k) => s.errors[k] ? `<div class="err">${esc(s.errors[k])}</div>` : '';

  return sheetShell(`
    <div class="sheet-head">
      <div class="row">
        <div class="brand-mark" style="width:34px;height:34px;border-radius:10px">${brandGlyph()}</div>
        <div>
          <h2>创建网络</h2>
          <p>加入已有网络，或创建一张新的 Mesh 网络</p>
        </div>
      </div>
      <button class="iconbtn close" data-action="sheet-close">${icon('x', 'sm')}</button>
    </div>
    <div class="sheet-body">
      <div class="templates">
        ${sheetTemplate('public', 'bolt', '公共节点', '零配置，快速组网')}
        ${sheetTemplate('direct', 'link', '自建节点', '连接自有公网节点')}
        ${sheetTemplate('import', 'import', '导入配置', '从 TOML 文件创建')}
      </div>

      ${t === 'import' ? `
        <div class="form-field full" style="margin-bottom:12px">
          <label>配置文件</label>
          <div class="flex gap6" style="margin-bottom:8px">
            <button class="btn secondary sm" data-action="sheet-pick-file">${icon('folder', 'sm')} 选择 .toml 文件</button>
            <span class="text-11 muted">${esc(f.importName || '或直接粘贴内容')}</span>
          </div>
          <textarea class="input mono" rows="8" data-model="sheet.importText" placeholder="[network_identity]&#10;network_name = &quot;my-net&quot;&#10;network_secret = &quot;...&quot;">${esc(f.importText)}</textarea>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>显示名称</label><input class="input" data-model="sheet.name" value="${esc(f.name)}" placeholder="导入的网络"></div>
        </div>
      ` : `
        <div class="form-grid">
          <div class="form-field ${s.errors.name ? 'invalid' : ''}">
            <label>显示名称 <span class="req">*</span></label>
            <input class="input" data-model="sheet.name" value="${esc(f.name)}" placeholder="例如：家庭骨干网" autofocus>
            ${err('name')}
          </div>
          <div class="form-field ${s.errors.networkName ? 'invalid' : ''}">
            <label>网络名称 <span class="req">*</span></label>
            <input class="input mono" data-model="sheet.networkName" value="${esc(f.networkName)}" placeholder="my-mesh">
            ${err('networkName')}
          </div>
          <div class="form-field">
            <label>网络密码</label>
            <input class="input mono" data-model="sheet.secret" value="${esc(f.secret)}">
            <div class="hint">其他设备需填写相同密码才能加入</div>
          </div>
          <div class="form-field">
            <label>设备名称</label>
            <input class="input" data-model="sheet.hostname" value="${esc(f.hostname)}">
          </div>
          <div class="form-field full">
            <label>IP 分配</label>
            <div class="radio-row">
              <button class="radio ${!f.dhcp ? 'on' : ''}" data-action="sheet-dhcp" data-value="0"><i></i>手动指定</button>
              <button class="radio ${f.dhcp ? 'on' : ''}" data-action="sheet-dhcp" data-value="1"><i></i>DHCP 自动分配</button>
              ${!f.dhcp ? `<input class="input mono" style="width:160px;height:28px" data-model="sheet.ipv4" value="${esc(f.ipv4)}" placeholder="10.144.144.1">` : ''}
            </div>
          </div>
          <div class="form-field full ${s.errors.peer ? 'invalid' : ''}">
            <label>入口节点 ${t === 'direct' ? '' : '<span class="req">*</span>'}</label>
            <input class="input mono" data-model="sheet.peer" value="${esc(f.peer)}" placeholder="tcp://public.easytier.cn:11010">
            ${err('peer')}
            <div class="hint">${t === 'public' ? '使用 EasyTier 社区公共节点，无需自建服务器' : '填写任一在线节点的监听地址，例如 tcp://1.2.3.4:11010'}</div>
          </div>
        </div>
        <div class="sheet-note">${icon('info', 'sm')}<span>${isDemo() ? '当前未检测到 EasyTier Core，创建后将使用演示数据展示界面效果。' : '创建后会写入独立配置文件，并通过本机 EasyTier Core 启动。'}</span></div>
      `}
    </div>
    <div class="sheet-foot">
      <span class="spacer"></span>
      <button class="btn ghost" data-action="sheet-close">取消</button>
      <button class="btn primary" data-action="create-network">${icon('play', 'sm')} ${t === 'import' ? '导入并创建' : '创建并连接'}</button>
    </div>
  `);
}

function sheetTemplate(id, ic, title, desc) {
  return `<button class="template ${S.sheet.template === id ? 'on' : ''}" data-action="sheet-template" data-template="${id}">
    <b>${icon(ic, 'sm')} ${title}</b><span>${desc}</span>
  </button>`;
}

function sheetDiagHTML() {
  const s = S.sheet;
  const p = s.profile;
  const okCount = s.checks.filter(c => c.status === 'ok').length;
  return sheetShell(`
    <div class="sheet-head">
      <div class="row">
        <div class="big-tile" style="width:36px;height:36px;border-radius:10px;--tint-a:#4C7DFF;--tint-b:#2FB6F5">${icon('activity', 'sm')}</div>
        <div>
          <h2>网络诊断</h2>
          <p>${p ? esc(p.name) + ' · 连接质量与运行环境检查' : '检查运行环境'}</p>
        </div>
      </div>
      <button class="iconbtn close" data-action="sheet-close">${icon('x', 'sm')}</button>
    </div>
    <div class="sheet-body">
      <div class="diag-list">
        ${s.checks.map(c => `<div class="diag-row">
          <div class="diag-icon ${c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : c.status === 'bad' ? 'bad' : ''}">
            ${c.status === 'running' ? '<div class="spinner"></div>' : c.status === 'ok' ? icon('check', 'sm') : c.status === 'warn' ? icon('alert', 'sm') : c.status === 'bad' ? icon('x', 'sm') : icon('clock', 'sm')}
          </div>
          <div class="diag-main">
            <div class="diag-title">${c.title}</div>
            <div class="diag-desc">${c.detail ? esc(c.detail) : c.desc}</div>
          </div>
          <span class="diag-status">${c.status === 'ok' ? '正常' : c.status === 'warn' ? '注意' : c.status === 'bad' ? '异常' : c.status === 'running' ? '检测中' : '等待'}</span>
        </div>`).join('')}
      </div>
      <div class="sheet-note" style="margin-top:16px">${icon('info', 'sm')}<span>${s.running ? '正在执行检测…' : `检测完成：${okCount} 项正常，${s.checks.length - okCount} 项需关注。`}</span></div>
    </div>
    <div class="sheet-foot">
      <span class="spacer"></span>
      <button class="btn secondary" data-action="run-diagnostics" ${s.running ? 'disabled' : ''}>${icon('refresh', 'sm')} 重新检测</button>
      <button class="btn primary" data-action="sheet-close">完成</button>
    </div>
  `, 560);
}

/* ------------------------------------------------------------------ import */

function newProfile() {
  return {
    id: uid(), name: '新网络', networkName: '', secret: '', hostname: (S.meta && S.meta.hostname) || 'Mac',
    ipv4: '10.144.144.1', dhcp: false, peers: ['tcp://public.easytier.cn:11010'],
    listenPort: 11010, rpcPort: nextRPCPort(), proxyNetworks: [], exitNodes: [],
    enableExitNode: false, acceptDNS: false, latencyFirst: false, multiThread: true,
    disableP2P: false, enableEncryption: true, enableIPv6: false, noTun: false, useSmoltcp: false,
    mtu: 1380, relayWhitelist: '*', devName: '', vpnPortalEnabled: false, vpnPortalListen: '0.0.0.0:11011', vpnPortalCIDR: '10.14.14.0/24',
    tint: S.profiles.length % TINTS.length, autoConnect: false, isSample: false,
    createdAt: new Date().toISOString(), lastConnectedAt: null
  };
}

function nextRPCPort() {
  const used = new Set(S.profiles.map(p => p.rpcPort));
  let port = 15888;
  while (used.has(port)) port++;
  return port;
}

/* ------------------------------------------------------------------ events */

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const p = S.profiles.find(x => x.id === (target.dataset.id || S.ui.networkId));

  switch (action) {
    case 'nav-overview': openOverview(); break;
    case 'nav-settings': openSettings(); break;
    case 'open-network': openNetwork(target.dataset.id); break;
    case 'edit-network': {
      const id = target.dataset.id;
      S.ui.view = 'network'; S.ui.networkId = id; S.ui.tab = 'config'; startDraft(); renderAll();
      break;
    }
    case 'toggle': toggleNetwork(target.dataset.id); break;
    case 'tab': openTab(target.dataset.tab); break;
    case 'copy': copyText(target.dataset.copy || ''); break;
    case 'copy-config': {
      const src = (S.draft && S.draft.id === S.ui.networkId) ? S.draft : p;
      if (src) copyText(buildTOML(src), '配置已复制');
      break;
    }
    case 'toggle-secret': {
      const id = target.dataset.id;
      S.ui.revealSecret[id] = !S.ui.revealSecret[id];
      renderView(true);
      break;
    }
    case 'diagnose': openDiagnostics(); break;
    case 'quick-customize': S.ui.quickCustomize = !S.ui.quickCustomize; renderView(true); break;
    case 'quick-select': {
      const key = target.dataset.key;
      if (!QUICK_OPTIONS.some(o => o.key === key)) break;
      const selected = Array.isArray(S.settings.quickOptions) ? S.settings.quickOptions : ['disableP2P'];
      S.settings.quickOptions = target.checked ? [...new Set([...selected, key])] : selected.filter(x => x !== key);
      persist(); renderView(true); break;
    }
    case 'quick-toggle': toggleQuickOption(p, target.dataset.key); break;
    case 'new-network': openAddSheet('public'); break;
    case 'import-config': openAddSheet('import'); break;
    case 'open-folder': bridge.openFolder(); break;
    case 'open-url': bridge.openExternal(target.dataset.url); break;
    case 'save-config': saveConfig(); break;
    case 'toggle-field': {
      if (!S.draft) break;
      const f = target.dataset.field;
      setDraft(f, !S.draft[f]);
      target.classList.toggle('on', !!S.draft[f]);
      if (f === 'vpnPortalEnabled') renderView(true);
      break;
    }
    case 'toggle-advanced':
      S.ui.advanceOpen = !S.ui.advanceOpen;
      renderView(true);
      break;
    case 'dhcp': {
      if (!S.draft) break;
      setDraft('dhcp', target.dataset.value === '1');
      renderView(true);
      break;
    }
    case 'add-peer': S.draft.peers.push(''); S.dirty = true; renderView(true); break;
    case 'remove-peer': S.draft.peers.splice(Number(target.dataset.index), 1); S.dirty = true; renderView(true); break;
    case 'use-public': S.draft.peers = Array.from(new Set([...S.draft.peers, 'tcp://public.easytier.cn:11010'])).filter(Boolean); S.dirty = true; renderView(true); break;
    case 'add-proxy': S.draft.proxyNetworks.push(''); S.dirty = true; renderView(true); break;
    case 'remove-proxy': S.draft.proxyNetworks.splice(Number(target.dataset.index), 1); S.dirty = true; renderView(true); break;
    case 'export-config': bridge.exportConfig({ filename: (S.draft?.name || 'easytier') + '.toml', content: buildTOML(S.draft) }); break;
    case 'delete-network': {
      if (confirm(`确定删除「${p?.name || '该网络'}」吗？配置文件将保留在数据目录中。`)) deleteProfile(target.dataset.id);
      break;
    }
    case 'duplicate-network': {
      const src = S.profiles.find(x => x.id === target.dataset.id);
      if (!src) break;
      const copy = clone(src);
      copy.id = uid(); copy.name = src.name + ' 副本'; copy.rpcPort = nextRPCPort();
      copy.listenPort = src.listenPort + 10; copy.isSample = false; copy.lastConnectedAt = null;
      addProfile(copy, false); toast('已复制网络配置');
      break;
    }
    case 'filter-link': S.ui.linkFilter = target.dataset.filter; renderView(true); break;
    case 'sort': S.ui.sort = S.ui.sort === target.dataset.sort ? 'default' : target.dataset.sort; renderView(true); break;
    case 'toggle-peer':
      S.ui.expanded = S.ui.expanded === target.dataset.id ? null : target.dataset.id;
      renderView(true);
      break;
    case 'refresh': refreshNow(); break;
    case 'log-level': S.ui.logLevel = target.dataset.level; renderView(true); break;
    case 'clear-logs': if (S.ui.networkId) { rt(S.ui.networkId).logs = []; renderView(true); } break;
    case 'copy-logs': {
      const p2 = S.profiles.find(x => x.id === S.ui.networkId);
      if (p2) copyText(rt(p2.id).logs.map(l => `${l.t} ${l.level.toUpperCase()} ${l.target} ${l.message}`).join('\n'), '日志已复制');
      break;
    }
    case 'toggle-autoscroll':
      S.ui.autoScroll = !S.ui.autoScroll;
      toast(S.ui.autoScroll ? '已开启自动滚动' : '已暂停自动滚动', 'ok');
      break;
    case 'theme': S.settings.theme = target.dataset.theme; applyTheme(); persist(); renderView(true); break;
    case 'accent': S.settings.accent = Number(target.dataset.index); applyAccent(); persist(); renderView(true); break;
    case 'refresh-interval': S.settings.refresh = Number(target.dataset.value); persist(); renderView(true); break;
    case 'setting-toggle': toggleSetting(target.dataset.key); break;
    case 'choose-core':
      bridge.chooseBinary({ kind: 'core' }).then(async (r) => {
        if (r && r.ok) { S.meta = await bridge.init(); renderAll(); toast('核心路径已更新'); }
      });
      break;
    case 'choose-cli':
      bridge.chooseBinary({ kind: 'cli' }).then(async (r) => {
        if (r && r.ok) { S.meta = await bridge.init(); renderAll(); toast('CLI 路径已更新'); }
      });
      break;
    case 'reset-samples': resetSamples(); break;
    case 'sheet-close': closeSheet(); break;
    case 'sheet-backdrop': if (e.target === target) closeSheet(); break;
    case 'sheet-template': setTemplate(target.dataset.template); break;
    case 'sheet-dhcp': S.sheet.form.dhcp = target.dataset.value === '1'; renderSheet(); break;
    case 'sheet-pick-file':
      bridge.importConfig().then(r => {
        if (r?.ok && S.sheet?.type === 'add') { S.sheet.form.importText = r.content; S.sheet.form.importName = r.name + '.toml'; S.sheet.form.name = r.name; renderSheet(); }
      }).catch(err => toast('导入失败：' + err.message, 'err'));
      break;
    case 'create-network': createFromSheet(); break;
    case 'run-diagnostics': runDiagnostics(); break;
    case 'trigger-empty': if (p) toggleNetwork(p.id); break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'peer-search') {
    S.ui.search = el.value;
    const p = S.profiles.find(x => x.id === S.ui.networkId);
    if (p) $('#peer-rows').innerHTML = peerRowsHTML(p);
    return;
  }
  if (el.id === 'log-search') {
    S.ui.logSearch = el.value;
    const p = S.profiles.find(x => x.id === S.ui.networkId);
    if (p) {
      const filtered = filterLogs(rt(p.id).logs, p.id);
      const c = $('#console');
      c.innerHTML = filtered.map(logLineHTML).join('') || `<div class="log-empty">${icon('terminal')}<span>没有匹配的日志</span></div>`;
      c.dataset.version = logFingerprint(filtered);
    }
    return;
  }
  if (el.dataset.model) {
    const key = el.dataset.model;
    if (key.startsWith('sheet.')) {
      S.sheet.form[key.slice(6)] = el.type === 'checkbox' ? el.checked : el.value;
      return;
    }
    setDraft(key, el.type === 'number' ? Number(el.value) : el.value);
    return;
  }
  if (el.dataset.list && S.draft) {
    const list = el.dataset.list;
    S.draft[list][Number(el.dataset.index)] = el.value;
    S.dirty = true;
    updateDirtyUI();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.setting) {
    S.settings[el.dataset.setting] = el.value;
    persist();
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey;
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
  if (!mod) return;
  if (e.key === '1') { e.preventDefault(); openOverview(); }
  else if (e.key === ',') { e.preventDefault(); openSettings(); }
  else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openAddSheet('public'); }
  else if (e.key.toLowerCase() === 'r') { e.preventDefault(); refreshNow(); }
  else if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (S.ui.tab === 'peers') $('#peer-search')?.focus();
  }
});

function closeSheet() {
  S.sheet = null;
  renderSheet();
}

function setTemplate(t) {
  const f = S.sheet.form;
  S.sheet.template = t;
  if (t === 'public') { f.dhcp = true; f.peer = 'tcp://public.easytier.cn:11010'; }
  if (t === 'direct') { f.peer = f.peer.startsWith('tcp://public') ? '' : f.peer; f.dhcp = false; }
  renderSheet();
}

function createFromSheet() {
  const s = S.sheet;
  const f = s.form;
  s.errors = {};
  if (s.template === 'import') {
    if (!f.importText.trim()) { toast('请粘贴或选择配置文件', 'warn'); return; }
    let p;
    try { p = parseTOMLProfile(f.importText, f.name); }
    catch (err) { toast('无法导入配置：' + err.message, 'err'); return; }
    p.id = uid(); p.rpcPort = nextRPCPort();
    p.tint = S.profiles.length % TINTS.length;
    addProfile(p, false);
    closeSheet();
    toast('配置已导入，原有设置已保留；本地管理端口已独立分配');
    return;
  }
  if (!f.name.trim()) s.errors.name = '请输入显示名称';
  if (!f.networkName.trim()) s.errors.networkName = '请输入网络名称';
  if (s.template !== 'direct' && !f.peer.trim()) s.errors.peer = '请输入入口节点';
  if (!f.dhcp && !/^(\d{1,3}\.){3}\d{1,3}$/.test(f.ipv4)) s.errors.ipv4 = 'IPv4 格式不正确';
  if (Object.keys(s.errors).length) { renderSheet(); return; }

  const p = newProfile();
  p.name = f.name.trim();
  p.networkName = f.networkName.trim();
  p.secret = f.secret;
  p.hostname = f.hostname.trim() || 'Mac';
  p.dhcp = f.dhcp;
  p.ipv4 = f.ipv4;
  p.peers = f.peer ? [f.peer.trim()] : [];
  p.listenPort = 11010 + S.profiles.length * 10;
  p.rpcPort = nextRPCPort();
  p.tint = S.profiles.length % TINTS.length;
  p.autoConnect = false;
  addProfile(p, true);
  closeSheet();
  toast('网络已创建');
}

function toggleSetting(key) {
  if (key === 'launchAtLogin') {
    const next = !S.settings.launchAtLogin;
    bridge.setLoginItem({ enabled: next }).then(r => {
      if (r && r.error) { toast('无法修改登录项：' + r.error, 'err'); return; }
      S.settings.launchAtLogin = !!(r && r.enabled);
      persist(); renderView(true);
    });
    return;
  }
  if (key === 'keepInMenuBar') {
    S.settings.keepInMenuBar = !S.settings.keepInMenuBar;
    bridge.setKeepInMenuBar({ value: S.settings.keepInMenuBar });
  } else {
    S.settings[key] = !S.settings[key];
  }
  persist();
  renderView(true);
}

async function resetSamples() {
  if (!confirm('将清除当前所有网络，并重新创建 1 个示例网络。继续？')) return;
  for (const p of S.profiles.slice()) { if (!await disconnect(p)) return; }
  S.profiles = seedProfiles();
  S.runtime = {};
  S.profiles.forEach(p => rt(p.id));
  persist();
  openOverview();
  toast('示例网络已恢复');
  if (isDemo()) setTimeout(() => S.profiles.filter(p => p.autoConnect).forEach(p => connect(p, true)), 500);
}

function refreshNow() {
  const p = S.profiles.find(x => x.id === S.ui.networkId);
  if (!p) { toast('已刷新'); return; }
  if (isDemo()) {
    if (rt(p.id).status === 'running') {
      rt(p.id).peers = demoPeers(p);
      rt(p.id).routes = demoRoutes(p, rt(p.id).peers);
      rt(p.id).metrics = computeMetrics(rt(p.id).peers, rt(p.id).startedAt);
    }
    renderView(true);
    toast('数据已刷新');
  } else {
    pollProfile(p, true).then(() => { renderRuntimeUI(); toast('状态查询已完成'); });
  }
}

/* ------------------------------------------------------------------ theme */

function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function applyAccent() {
  const c = ACCENTS[S.settings.accent] || ACCENTS[0];
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-soft', rgba(c, .12));
  document.documentElement.style.setProperty('--accent-2', c);
  document.documentElement.style.setProperty('--shadow-btn', `0 6px 16px -6px ${rgba(c, .55)}`);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (S.settings.theme === 'system') applyTheme();
});

/* --------------------------------------------------------------- live loop */

let pointerInView = false;

function liveTick() {
  if (!S.ui.ready) return;
  S.tickCounter++;

  if (isDemo()) demoTick();
  else realTick();

  renderSidebar();

  const active = document.activeElement;
  const typing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
  const canLive = !typing && runtimeViewCanRefresh();

  if (canLive && !pointerInView && S.tickCounter % 2 === 0) {
    if (S.ui.view === 'overview') renderView(true);
    else if (S.ui.view === 'network' && ['overview', 'peers', 'routes'].includes(S.ui.tab)) renderView(true);
  }
  if (S.ui.view === 'network' && S.ui.tab === 'logs' && S.tickCounter % 2 === 0) appendLogsLive();
}

let realTickBusy = false;
async function realTick() {
  if (realTickBusy) return;
  realTickBusy = true;
  try {
    for (const p of S.profiles.slice()) {
      const r = S.runtime[p.id];
      if (!r || !r.coreActive) continue;
      await pollProfile(p);
      if (Date.now() - r.lastLogPoll <= 1200) continue;
      const token = r.token;
      r.lastLogPoll = Date.now();
      const res = await bridge.readLog({ profileId: p.id, offset: r.logOffset }).catch(() => null);
      if (!res || r.token !== token || S.runtime[p.id] !== r) continue;
      r.logOffset = res.offset;
      if (res.reset) r.logRemainder = '';
      const lines = (r.logRemainder + (res.data || '')).split('\n');
      r.logRemainder = lines.pop();
      for (const line of lines) {
        const parsed = parseCoreLine(line);
        if (parsed) appendLog(p.id, parsed.level, parsed.target, parsed.message);
      }
    }
  } finally { realTickBusy = false; }
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    S.meta = await bridge.init();
  } catch (e) {
    S.meta = { coreAvailable: false, cliAvailable: false, supportDir: '~/Library/Application Support/EasyTier Desktop', hostname: 'Mac', appVersion: '1.0.3' };
  }

  let saved = null;
  try {
    const res = await bridge.loadState();
    if (res && res.data) saved = JSON.parse(res.data);
  } catch (e) { saved = null; }

  if (saved && Array.isArray(saved.profiles)) {
    S.profiles = saved.profiles;
    S.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    if (saved.ui && saved.ui.view === 'network' && S.profiles.some(p => p.id === saved.ui.networkId)) {
      S.ui.view = 'network';
      S.ui.networkId = saved.ui.networkId;
      S.ui.tab = 'overview';
    }
  } else {
    S.profiles = seedProfiles();
  }

  const pv = window.__ET_PREVIEW;
  if (pv) {
    if (pv.theme) S.settings.theme = pv.theme;
    if (pv.tab) S.ui.tab = pv.tab;
    if (pv.view === 'network' && S.profiles[0]) { S.ui.view = 'network'; S.ui.networkId = S.profiles[0].id; }
    if (pv.view === 'settings') S.ui.view = 'settings';
  }

  S.profiles.forEach(p => rt(p.id));
  S.ui.ready = true;

  applyTheme();
  applyAccent();
  renderAll();

  bridge.on('coreLog', (data) => {
    const parsed = parseCoreLine(data.line || '');
    if (!parsed) return;
    appendLog(data.id, parsed.level, parsed.target, parsed.message);
    if (S.ui.networkId === data.id && S.ui.tab === 'logs') appendLogsLive();
  });

  bridge.on('coreExit', (data) => {
    const r = S.runtime[data.id];
    if (!r || data.sessionId !== r.sessionId) return;
    r.coreActive = false;
    if (r.status === 'stopping') return;
    r.token++;
    r.status = data.code === 0 ? 'stopped' : 'failed';
    r.peers = []; r.routes = []; r.metrics = emptyMetrics(); r.startedAt = null;
    appendLog(data.id, data.code === 0 ? 'info' : 'error', 'ui', `核心进程已退出（代码 ${data.code}）`);
    if (data.code !== 0) toast('核心进程异常退出，请查看日志', 'err');
    renderRuntimeUI();
  });

  bridge.on('menuAction', (data) => {
    if (data.action === 'toggle') toggleNetwork(data.id);
    if (data.action === 'open') openOverview();
  });

  bridge.on('navigate', (data) => {
    if (data.view === 'settings') openSettings();
  });

  bridge.setKeepInMenuBar({ value: S.settings.keepInMenuBar }).catch(() => {});
  syncMenu();
  persist();

  if (pv && pv.sheet === 'add') setTimeout(() => openAddSheet('public'), 500);
  if (pv && pv.sheet === 'diag') setTimeout(() => openDiagnostics(), 800);

  if (S.settings.runAsRoot && S.meta.coreAvailable && !isDemo() && !pv) {
    bridge.preparePrivilege().catch(() => { toast("管理员授权未完成，连接时可重试", "err"); });
  }

  if (S.settings.autoConnectOnLaunch) {
    const targets = S.profiles.filter(p => p.autoConnect && (!p.isSample || isDemo()));
    setTimeout(async () => { for (const p of targets) { if (S.profiles.includes(p)) await connect(p, true); } }, 700);
  }

  setInterval(liveTick, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  const view = $('#view');
  if (view) {
    view.addEventListener('mouseenter', () => { pointerInView = true; });
    view.addEventListener('mouseleave', () => { pointerInView = false; });
  }
  boot();
});
