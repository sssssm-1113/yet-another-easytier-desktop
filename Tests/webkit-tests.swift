import Cocoa
import WebKit

final class WebKitTests: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addUserScript(WKUserScript(source: """
          window.__testErrors=[];
          addEventListener('error',e=>window.__testErrors.push(String(e.message)));
          addEventListener('unhandledrejection',e=>window.__testErrors.push(String(e.reason)));
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(source: """
          EasyTierBridge.loadState=async()=>({data:JSON.stringify({profiles:[],settings:{autoConnectOnLaunch:false}})});
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: webView.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = webView
        window.orderFront(nil)
        let url = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("index.html")
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { fputs("WebKit test timed out\n", stderr); exit(1) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.callAsyncJavaScript("""
          const checks=[];
          const check=(value,name)=>{if(!value)throw Error(name);checks.push(name)};
          for(let i=0;i<100&&!S.ui.ready;i++)await new Promise(r=>setTimeout(r,20));
          check(S.ui.ready,'app boots with bundled scripts');
          S.meta={...S.meta,coreAvailable:true,cliAvailable:true};
          const p={...newProfile(),name:'WebKit 回归网络',networkName:'webkit-review',dhcp:true};
          S.profiles=[p];const r=rt(p.id);r.status='connecting';r.connectAt=Date.now();r.coreActive=true;r.sessionId='web-test';
          const peerJSON=JSON.stringify([{cost:'Local',hostname:'Test Mac',ipv4:'10.23.45.67',version:'test'},
              {cost:'p2p',hostname:'Remote',ipv4:'10.23.45.68',lat_ms:1.2,loss_rate:0,rx_bytes:1000,tx_bytes:500}]);
          bridge.cli=async({args})=>({ok:true,stdout:args.includes('peer')?peerJSON:'[]'});
          bridge.readLog=async()=>({data:'',offset:0});
          openNetwork(p.id);openTab('config');
          const input=document.querySelector('[data-model="secret"]');
          input.focus();input.value='abc#def"\\\\pass';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(3,3);
          const expected=input.value;
          await pollProfile(p,true);
          await new Promise(r=>setTimeout(r,2300));
          check(document.activeElement===input && input.isConnected,'configuration input retains focus across polling and live ticks');
          check(input.selectionStart===3 && input.value===expected,'input caret and value are retained');
          check(document.querySelector('.detail-head .pill').textContent.includes('已连接'),'connection header updates without replacing the configuration form');
          check(parseConfigTOML(buildTOML(S.draft)).network_identity.network_secret===expected,'special password survives DOM edit and TOML generation');
          openTab('peers');
          const search=document.querySelector('#peer-search');search.focus();search.value='Remote';search.dispatchEvent(new Event('input',{bubbles:true}));
          await pollProfile(p,true);
          check(document.activeElement===search && search.isConnected && search.value==='Remote','peer search retains focus and filter');
          search.blur();openTab('overview');
          check(document.querySelector('.hero-ip .ip').textContent==='10.23.45.67','detail view renders actual DHCP address');
          openOverview();check(document.querySelector('.net-ip').textContent==='10.23.45.67','overview card renders actual DHCP address');
          check(!document.body.textContent.includes('10.144.144.23'),'live views contain no mock DHCP address');
          check(window.__testErrors.length===0,'no browser errors or unhandled promises');
          window.__etEvent('coreExit',{id:p.id,sessionId:'old-session',code:1});
          check(r.status==='running' && r.coreActive,'old core exit event cannot stop the new session');
          r.logs=[];for(let i=0;i<900;i++)appendLog(p.id,'info','test','row-'+i);
          openNetwork(p.id);openTab('logs');appendLog(p.id,'info','test','rollover-newest');appendLogsLive();
          check(document.querySelectorAll('#console .log-line').length===900 && document.querySelector('#console').textContent.includes('rollover-newest'),'rolling log view updates after reaching its 900-line cap');
          openOverview();S.settings.theme='dark';applyTheme();
          return {checks,errors:window.__testErrors};
        """, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                print("WebKit regression:", value)
                let cfg = WKSnapshotConfiguration()
                self.webView.takeSnapshot(with: cfg) { image, error in
                    if CommandLine.arguments.count > 2, let image, let tiff = image.tiffRepresentation,
                       let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
                    }
                    exit(0)
                }
            case .failure(let error): fputs("WebKit failure: \(error)\n", stderr); exit(1)
            }
        }
    }
}

@main struct RunWebKitTests {
    static func main() {
        let app = NSApplication.shared
        let delegate = WebKitTests()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
