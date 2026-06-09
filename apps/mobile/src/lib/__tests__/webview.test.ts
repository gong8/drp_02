// Unit tests for the in-app-browser classifier (apps/mobile/src/lib/webview.ts). The detection is
// best-effort UA sniffing, so these pin the documented heuristics against representative user agents.

import { classifyUserAgent } from "../webview";

// Representative UA fragments (real ones are longer; the tokens we key on are present).
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_WHATSAPP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24";
const IOS_WKWEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36";
const ANDROID_INSTAGRAM =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 Instagram 300.0";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

describe("classifyUserAgent", () => {
  it("flags named chat-app shells as hostile with the right app + os", () => {
    expect(classifyUserAgent(IOS_WHATSAPP, "web")).toMatchObject({
      hostile: true,
      app: "whatsapp",
      os: "ios",
    });
    expect(classifyUserAgent(ANDROID_INSTAGRAM, "web")).toMatchObject({
      hostile: true,
      app: "instagram",
      os: "android",
    });
  });

  it("flags the generic Android WebView (; wv) and the iOS embedded WKWebView", () => {
    expect(classifyUserAgent(ANDROID_WEBVIEW, "web").hostile).toBe(true);
    expect(classifyUserAgent(IOS_WKWEBVIEW, "web").hostile).toBe(true);
  });

  it("treats real Safari and desktop Chrome as not hostile", () => {
    expect(classifyUserAgent(IOS_SAFARI, "web").hostile).toBe(false);
    expect(classifyUserAgent(DESKTOP_CHROME, "web").hostile).toBe(false);
  });

  it("never flags non-web platforms (native has its own auth flow)", () => {
    expect(classifyUserAgent(IOS_WHATSAPP, "ios")).toEqual({
      hostile: false,
      app: null,
      os: "other",
    });
  });
});
