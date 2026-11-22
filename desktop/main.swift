import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var webView: WKWebView!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let size = NSSize(width: 1280, height: 840)
    window = NSWindow(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Daily 0.1"
    window.center()
    window.setFrameAutosaveName("Daily01MainWindow")
    window.minSize = NSSize(width: 900, height: 600)

    let config = WKWebViewConfiguration()
    webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    window.contentView?.addSubview(webView)

    if let url = URL(string: "http://121.196.228.134:7000/") {
      webView.load(URLRequest(url: url))
    }

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "好")
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "确定")
    alert.addButton(withTitle: "取消")
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = prompt
    alert.addButton(withTitle: "确定")
    alert.addButton(withTitle: "取消")
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.beginSheetModal(for: window) { response in
      completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
