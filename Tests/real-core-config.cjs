const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,'..'),dir=process.argv[2];
const context={window:{EasyTierBridge:{},matchMedia:()=>({addEventListener(){}})},document:{addEventListener(){}},crypto};
vm.createContext(context);
for(const f of ['vendor/toml.js','config.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'ui',f),'utf8'),context);
for(const vpn of [false,true]) {
  fs.writeFileSync(path.join(dir,'vpn-'+vpn+'.toml'),vm.runInContext(`buildTOML({...newProfile(),networkName:'isolated-review',secret:'abc#def',noTun:true,peers:[],vpnPortalEnabled:${vpn}})`,context));
}
const smoke=vm.runInContext(`var p={...newProfile(),networkName:'isolated-review',hostname:'Review-Isolated',secret:'abc#def',noTun:true,ipv4:'10.123.45.1',peers:[]};var raw=parseConfigTOML(buildTOML(p));raw.listeners=[];raw.stun_servers=[];raw.stun_servers_v6=[];raw.flags.disable_upnp=true;EasyTierTOML.stringify(raw,{numbersAsFloat:true})`,context);
fs.writeFileSync(path.join(dir,'smoke.toml'),smoke);
