/* TOML source is retained as text so unknown fields, dates and large integers
   survive JSON state persistence. Only fields changed in the editor are merged. */
const CONFIG_FLAGS = {
  enable_encryption: 'enableEncryption', enable_ipv6: 'enableIPv6',
  latency_first: 'latencyFirst', multi_thread: 'multiThread', disable_p2p: 'disableP2P',
  enable_exit_node: 'enableExitNode', accept_dns: 'acceptDNS', no_tun: 'noTun',
  use_smoltcp: 'useSmoltcp', mtu: 'mtu', relay_network_whitelist: 'relayWhitelist', dev_name: 'devName'
};
const CONFIG_FIELDS = ['networkName', 'secret', 'hostname', 'dhcp', 'ipv4', 'listenPort',
  'peers', 'proxyNetworks', 'exitNodes', 'vpnPortalEnabled', 'vpnPortalListen', 'vpnPortalCIDR', ...Object.values(CONFIG_FLAGS)];
const parseConfigTOML = text => EasyTierTOML.parse(text, { integersAsBigInt: true, unsafeKeyBehaviour: 'throw' });
const tomlInteger = n => BigInt(Number.isSafeInteger(Number(n)) ? Number(n) : 0);

function buildTOML(p) {
  const imported = !!p.sourceToml;
  const config = imported ? parseConfigTOML(p.sourceToml) : {};
  const baseline = p.importedBaseline || {};
  const changed = key => !imported || JSON.stringify(p[key]) !== JSON.stringify(baseline[key]);
  if (!imported) config.instance_name = slug(p.networkName || p.name, p.id);
  if (changed('hostname')) config.hostname = p.hostname || 'Mac';
  if (changed('dhcp') || changed('ipv4')) {
    if (p.dhcp) { config.dhcp = true; delete config.ipv4; }
    else { config.ipv4 = p.ipv4; delete config.dhcp; }
  }
  // Management must always address this profile, even for imported configurations.
  config.rpc_portal = '127.0.0.1:' + p.rpcPort;
  if (changed('listenPort') || changed('enableIPv6')) config.listeners = listenersFor(p);
  if (changed('networkName') || changed('secret')) {
    config.network_identity = { ...(config.network_identity || {}), network_name: p.networkName, network_secret: p.secret };
  }
  const mergeRows = (section, field, key) => {
    if (!changed(field)) return;
    const existing = Array.isArray(config[section]) ? config[section] : [];
    config[section] = (p[field] || []).filter(Boolean).map(value => ({
      ...(existing.find(row => row[key] === value) || {}), [key]: value
    }));
  };
  mergeRows('peer', 'peers', 'uri');
  mergeRows('proxy_network', 'proxyNetworks', 'cidr');
  if (changed('exitNodes')) config.exit_nodes = p.exitNodes || [];
  for (const [key, field] of Object.entries(CONFIG_FLAGS)) {
    if (!changed(field)) continue;
    config.flags = config.flags || {};
    if (field === 'devName' && !p[field]) delete config.flags[key];
    else config.flags[key] = field === 'mtu' ? tomlInteger(p[field]) : p[field];
  }
  if (changed('vpnPortalEnabled') || changed('vpnPortalListen') || changed('vpnPortalCIDR')) {
    if (p.vpnPortalEnabled) {
      config.vpn_portal_config = { ...(config.vpn_portal_config || {}), wireguard_listen: p.vpnPortalListen };
      if (!imported || changed('vpnPortalCIDR') || !config.vpn_portal_config.client_cidr) {
        config.vpn_portal_config.client_cidr = p.vpnPortalCIDR || '10.14.14.0/24';
      }
    } else delete config.vpn_portal_config;
  }
  return '# EasyTier Desktop · 配置文件\n' + EasyTierTOML.stringify(config, { numbersAsFloat: true });
}

function parseTOMLProfile(text, name) {
  const config = parseConfigTOML(text);
  for (const key of ['network_identity', 'flags', 'vpn_portal_config']) {
    if (config[key] !== undefined && (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key]))) {
      throw new Error(key + ' 必须是配置表');
    }
  }
  const identity = config.network_identity || {};
  if (typeof identity.network_name !== 'string' || !identity.network_name.trim()) {
    throw new Error('缺少有效的 network_identity.network_name');
  }
  if (identity.network_secret !== undefined && typeof identity.network_secret !== 'string') {
    throw new Error('network_secret 必须是字符串');
  }
  const p = newProfile();
  p.name = name || identity.network_name;
  p.networkName = identity.network_name;
  p.secret = identity.network_secret ?? '';
  for (const key of ['hostname', 'ipv4']) {
    if (config[key] !== undefined) {
      if (typeof config[key] !== 'string') throw new Error(key + ' 必须是字符串');
      p[key] = config[key];
    }
  }
  if (config.dhcp !== undefined && typeof config.dhcp !== 'boolean') throw new Error('dhcp 必须是布尔值');
  p.dhcp = config.dhcp === true;
  const rows = (section, key) => {
    if (config[section] === undefined) return [];
    if (!Array.isArray(config[section]) || config[section].some(row => !row || typeof row[key] !== 'string')) {
      throw new Error(section + ' 格式不正确');
    }
    return config[section].map(row => row[key]);
  };
  p.peers = rows('peer', 'uri');
  p.proxyNetworks = rows('proxy_network', 'cidr');
  if (config.listeners !== undefined) {
    if (!Array.isArray(config.listeners) || config.listeners.some(x => typeof x !== 'string')) throw new Error('listeners 必须是字符串数组');
    const listener = config.listeners.find(x => /^(tcp|udp):\/\//.test(x));
    const port = listener && listener.match(/:(\d+)$/);
    if (port) p.listenPort = Number(port[1]);
  }
  if (config.exit_nodes !== undefined) {
    if (!Array.isArray(config.exit_nodes) || config.exit_nodes.some(x => typeof x !== 'string')) throw new Error('exit_nodes 必须是字符串数组');
    p.exitNodes = config.exit_nodes;
  }
  for (const [key, field] of Object.entries(CONFIG_FLAGS)) {
    const value = config.flags?.[key];
    if (value === undefined) continue;
    if (field === 'mtu') {
      if (typeof value !== 'bigint' || value < 576n || value > 9000n) throw new Error('MTU 需在 576–9000 之间');
      p[field] = Number(value);
    } else {
      const expected = ['relayWhitelist', 'devName'].includes(field) ? 'string' : 'boolean';
      if (typeof value !== expected) throw new Error('flags.' + key + ' 类型不正确');
      p[field] = value;
    }
  }
  p.vpnPortalEnabled = !!config.vpn_portal_config;
  if (p.vpnPortalEnabled) {
    if (typeof config.vpn_portal_config.wireguard_listen !== 'string') throw new Error('VPN Portal 缺少 wireguard_listen');
    p.vpnPortalListen = config.vpn_portal_config.wireguard_listen;
    p.vpnPortalCIDR = config.vpn_portal_config.client_cidr || p.vpnPortalCIDR;
  }
  p.sourceToml = text;
  p.importedBaseline = Object.fromEntries(CONFIG_FIELDS.map(key => [key, clone(p[key])]));
  return p;
}
