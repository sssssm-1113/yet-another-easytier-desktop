const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function harness() {
  const events={},timers=[];
  const bridge={cli:async()=>({ok:true,stdout:'[]'}),startCore:async()=>({ok:true}),stopCore:async()=>({ok:true}),readLog:async()=>({data:'',offset:0})};
  const ctx={window:{EasyTierBridge:bridge,matchMedia:()=>({addEventListener(){}})},document:{activeElement:null,addEventListener:(k,fn)=>events[k]=fn,querySelector:()=>null,querySelectorAll:()=>[]},crypto,console,confirm:()=>true,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval(){}};
  vm.createContext(ctx);
  for(const f of ['vendor/toml.js','config.js','app.js']) vm.runInContext(fs.readFileSync(path.join(root,'ui',f),'utf8'),ctx,{filename:f});
  const run=s=>vm.runInContext(s,ctx);
  run(`var paints=0;renderSidebar=()=>{};syncMenu=()=>{};renderView=()=>paints++;toast=()=>{};persist=()=>{};openOverview=()=>{};renderSheet=()=>{};
    S.meta={coreAvailable:true,cliAvailable:true};var p={...newProfile(),networkName:'review'};S.profiles=[p];var r=rt(p.id);r.status='running';r.coreActive=true;r.sessionId='session-a';`);
  return {ctx,run,bridge,timers,events};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

test('TOML roundtrip preserves secrets, empty peers, routing, unknown fields, dates and integer precision',()=>{
  const {run,ctx}=harness();
  ctx.fixture=`hostname = 'host #1'
listeners = ['tcp://127.0.0.1:12000']
exit_nodes = ['10.1.0.1']
peer = []
unknown_integer = 9223372036854775807
unknown_float = 2.0
unknown_date = 2026-11-09
[network_identity]
network_name = 'review'
network_secret = 'abc#def"\\pass'
[flags]
relay_network_whitelist = 'private-*'
mtu = 1400
use_smoltcp = true
custom_flag = 'keep'
[vpn_portal_config]
wireguard_listen = '127.0.0.1:12011'
client_cidr = '10.200.0.0/24'
`;
  const result=run(`var imported=parseTOMLProfile(fixture,'imported');var before=parseConfigTOML(fixture);var after=parseConfigTOML(buildTOML(clone(imported)));delete after.rpc_portal;EasyTierTOML.stringify(before,{numbersAsFloat:true})===EasyTierTOML.stringify(after,{numbersAsFloat:true})`);
  assert.equal(result,true);
  assert.equal(run('imported.secret'), 'abc#def"\\pass');
  assert.deepEqual(plain(run('imported.peers')),[]);
  assert.equal(run('imported.listenPort'),12000);
  run(`imported.hostname='edited';imported.mtu=1450;`);
  assert.equal(run('parseConfigTOML(buildTOML(imported)).flags.mtu'),1450n);
  assert.equal(run('parseConfigTOML(buildTOML(imported)).flags.custom_flag'),'keep');
  assert.equal(run('parseConfigTOML(buildTOML(imported)).unknown_float'),2);
});
test('TOML escaped and multiline strings work; malformed TOML and unsafe keys are rejected',()=>{
  const {run}=harness();
  run(`p.secret='line1\\nline2\\t"\\\\#';p.peers=[];`);
  assert.equal(run('parseTOMLProfile(buildTOML(p)).secret'),run('p.secret'));
  assert.throws(()=>run(`parseTOMLProfile('[network_identity]\\nnetwork_name="x"\\nnetwork_name="y"')`));
  assert.throws(()=>run(`parseTOMLProfile('__proto__.bad=true\\n[network_identity]\\nnetwork_name="x"')`));
});
test('imported peer options survive edits to unrelated fields',()=>{
  const {run}=harness();
  run(`var imported=parseTOMLProfile('[network_identity]\\nnetwork_name="x"\\n[[peer]]\\nuri="tcp://127.0.0.1:12000"\\ncustom="keep"');imported.hostname='changed';`);
  assert.equal(run('parseConfigTOML(buildTOML(imported)).peer[0].custom'),'keep');
});
test('late peer response cannot reconnect after a confirmed disconnect',async()=>{
  const {run,bridge}=harness(), pending=deferred();bridge.cli=()=>pending.promise;
  const poll=run('pollProfile(p,true)');await run('disconnect(p)');
  assert.equal(run('r.status'),'stopped');
  bridge.cli=async()=>({ok:true,stdout:'[]'});pending.resolve({ok:true,stdout:'[]'});await poll;
  assert.equal(run('r.status'),'stopped');
});
test('late route response cannot replace cleared routes after disconnect',async()=>{
  const {run,bridge}=harness(), pending=deferred();let calls=0;
  bridge.cli=async()=>++calls===1?{ok:true,stdout:'[]'}:pending.promise;
  const poll=run('pollProfile(p,true)');await new Promise(setImmediate);
  await run('disconnect(p)');pending.resolve({ok:true,stdout:'[{"ipv4":"10.1.0.1"}]'});await poll;
  assert.deepEqual(plain(run('r.routes')),[]);assert.equal(run('r.status'),'stopped');
});
test('concurrent polling for the same connection is coalesced',async()=>{
  const {run,bridge}=harness(), pending=deferred();let calls=0;
  bridge.cli=()=>{calls++;return pending.promise};const poll=run('pollProfile(p,true)');
  await run('pollProfile(p,true)');assert.equal(calls,1);
  await run('disconnect(p)');pending.resolve({ok:true,stdout:'[]'});await poll;
});
test('disconnect waits for completion and retains ownership on cancellation',async()=>{
  const {run,bridge}=harness(), pending=deferred();bridge.stopCore=()=>pending.promise;
  const stop=run('disconnect(p)');assert.equal(run('r.status'),'stopping');assert.equal(run('r.coreActive'),true);
  pending.reject(new Error('authorization cancelled'));assert.equal(await stop,false);
  assert.equal(run('r.status'),'running');assert.equal(run('r.coreActive'),true);
  bridge.stopCore=async()=>({ok:true});assert.equal(await run('disconnect(p)'),true);
  assert.equal(run('r.coreActive'),false);
});
test('failed stop prevents deleting a running or connecting profile',async()=>{
  const {run,bridge}=harness();bridge.stopCore=async()=>{throw new Error('cancelled')};
  run("r.status='connecting'");await run('deleteProfile(p.id)');assert.equal(run('S.profiles.length'),1);
  bridge.stopCore=async()=>({ok:true});await run('deleteProfile(p.id)');assert.equal(run('S.profiles.length'),0);
});
test('save waits for stop and never replaces the configuration after stop failure',async()=>{
  const {run,bridge}=harness();run("S.draft=clone(p);S.draft.hostname='edited';S.dirty=true;");
  bridge.stopCore=async()=>{throw new Error('cancelled')};await run('saveConfig()');
  assert.notEqual(run('S.profiles[0].hostname'),'edited');assert.equal(run('S.dirty'),true);
  const pending=deferred();bridge.stopCore=()=>pending.promise;let starts=0;
  bridge.startCore=async()=>{starts++;return {ok:true}};
  const save=run('saveConfig()');await new Promise(setImmediate);assert.equal(starts,0);
  pending.resolve({ok:true});await save;assert.equal(starts,1);assert.equal(run('S.profiles[0].hostname'),'edited');
});
test('pending start is not polled and late start response cannot undo cancellation',async()=>{
  const {run,bridge}=harness(), pending=deferred();let polls=0;
  run("r.status='stopped';r.coreActive=false;");bridge.startCore=()=>pending.promise;
  bridge.cli=async()=>{polls++;return {ok:true,stdout:'[]'}};
  const start=run('connect(p)');await run('pollProfile(p,true)');assert.equal(polls,0);
  await run('disconnect(p)');pending.resolve({ok:true});await start;
  assert.equal(run('r.status'),'stopped');assert.equal(polls,0);
});
test('polling preserves config view and focused inputs while refreshing an idle overview',async()=>{
  const {run,ctx}=harness();run("S.ui.view='network';S.ui.tab='config'");await run('pollProfile(p,true)');assert.equal(run('paints'),0);
  run("S.ui.view='overview'");ctx.document.activeElement={tagName:'INPUT'};await run('pollProfile(p,true)');assert.equal(run('paints'),0);
  ctx.document.activeElement=null;await run('pollProfile(p,true)');assert.equal(run('paints'),1);
});
test('DHCP card and details show the actual local address or pending state',()=>{
  const {run}=harness();run("p.dhcp=true;r.peers=[{isLocal:true,ipv4:'10.23.45.67'}]");
  for(const html of [run('netCard(p)'),run('detailOverview(p)')]) {assert.ok(html.includes('10.23.45.67'));assert.ok(!html.includes('10.144.144.23'));}
  run('r.peers=[]');assert.ok(run('netCard(p)').includes('等待分配地址'));
});
test('repeat RPC failures clear connected status but preserve the stop action',async()=>{
  const {run,bridge}=harness();bridge.cli=async()=>({ok:false});
  for(let i=0;i<3;i++)await run('pollProfile(p,true)');
  assert.equal(run('r.status'),'failed');assert.equal(run('r.coreActive'),true);assert.ok(run('netCard(p)').includes('断开'));
});
test('native import dialog timeout is passed as the third argument',()=>{
  const calls=[],timeouts=[];
  const c={window:{webkit:{messageHandlers:{et:{postMessage:p=>calls.push(p)}}}},setTimeout:(fn,ms)=>{timeouts.push(ms);return 1},clearTimeout(){},console};
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'ui/bridge.js'),'utf8'),c);
  vm.runInContext('window.EasyTierBridge.importConfig()',c);assert.equal(timeouts[0],120000);assert.equal(calls[0].cmd,'importConfig');
});

test('official core 2.6.4 JSON fixtures decode local address and routes',()=>{
  const {run,ctx}=harness();
  ctx.peerFixture=fs.readFileSync(path.join(__dirname,'fixtures/core-2.6.4-peers.json'),'utf8');
  ctx.routeFixture=fs.readFileSync(path.join(__dirname,'fixtures/core-2.6.4-routes.json'),'utf8');
  assert.equal(run('parsePeerJSON(peerFixture)[0].isLocal'),true);
  assert.equal(run('parsePeerJSON(peerFixture)[0].ipv4'),'10.123.45.1');
  assert.equal(run('parseRouteJSON(routeFixture)[0].ipv4'),'10.123.45.1/24');
});
test('VPN Portal includes its required client CIDR and preserves imported CIDR on listen edits',()=>{
  const {run}=harness();
  run("p.vpnPortalEnabled=true");
  assert.equal(run('parseConfigTOML(buildTOML(p)).vpn_portal_config.client_cidr'),'10.14.14.0/24');
  run("p.vpnPortalCIDR='10.200.0.0/24';var imported=parseTOMLProfile(buildTOML(p));imported.vpnPortalListen='127.0.0.1:12011'");
  assert.equal(run('parseConfigTOML(buildTOML(imported)).vpn_portal_config.client_cidr'),'10.200.0.0/24');
});


test('fresh setup creates exactly one sample without replacing saved networks',()=>{
  const {run}=harness();
  assert.equal(run('seedProfiles().length'),1);
  assert.equal(run('seedProfiles()[0].isSample'),true);
  assert.equal(run('S.profiles[0].networkName'),'review');
});
