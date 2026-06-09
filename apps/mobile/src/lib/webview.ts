// Detects when the web app is running inside a chat app's in-app browser (WhatsApp/Instagram/Facebook
// webview, generic Android WebView). This matters for the conversion funnel: Google's OAuth refuses to
// run in many embedded webviews ("disallowed_useragent"), so the JoinMeetup screen shows an
// "open in your browser" escape hatch when the host is hostile. Web-only - native always reports
// not-hostile (it has its own real auth flow).

import { Platform } from "react-native";

export type InAppApp = "whatsapp" | "instagram" | "facebook" | "other";

export type InAppResult = {
  // True when sign-in is likely to be blocked and we should offer the open-in-browser escape hatch.
  hostile: boolean;
  // The recognised host app, when we can name it (so copy can say "Open in Safari" with context).
  app: InAppApp | null;
  os: "ios" | "android" | "other";
};

// Pure classifier over a user-agent string + platform, so it is unit-testable without a real navigator.
// Heuristics (best-effort - UAs are not contractual):
//   - Named shells: WhatsApp / Instagram / FB (FBAN|FBAV|FB_IAB) are always hostile.
//   - Android generic WebView: the "; wv" token.
//   - iOS in-app: WebKit/Mobile WITHOUT the "Safari" token (real Safari and standalone Chrome include
//     it; embedded WKWebViews omit it). Conservative: only flag when it clearly looks embedded.
export function classifyUserAgent(ua: string, platformOS: string): InAppResult {
  if (platformOS !== "web") return { hostile: false, app: null, os: "other" };

  const os: InAppResult["os"] = /iPhone|iPad|iPod/i.test(ua)
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : "other";

  if (/WhatsApp/i.test(ua)) return { hostile: true, app: "whatsapp", os };
  if (/Instagram/i.test(ua)) return { hostile: true, app: "instagram", os };
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return { hostile: true, app: "facebook", os };

  // Generic Android WebView marker.
  if (os === "android" && /;\s*wv\b/i.test(ua)) return { hostile: true, app: "other", os };

  // iOS embedded WKWebView: WebKit on iOS but no "Safari" / no standalone-Chrome ("CriOS") token.
  if (os === "ios" && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua) && !/CriOS/i.test(ua)) {
    return { hostile: true, app: "other", os };
  }

  return { hostile: false, app: null, os };
}

// The live read against the running browser. Returns a not-hostile result when there is no navigator
// (native, SSR, or a stripped environment) so callers never crash and simply skip the escape hatch.
export function detectInAppBrowser(): InAppResult {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return classifyUserAgent(ua, Platform.OS);
}
