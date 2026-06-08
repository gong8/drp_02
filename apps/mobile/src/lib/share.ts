// One home for the copy/share OS-integration fork, so screens never branch on Platform.OS. Copy uses
// expo-clipboard (which proxies to navigator.clipboard on web). Share uses the Web Share API on web
// and the native share sheet on native, and ALWAYS degrades to copying the link so it is never a
// dead end.

import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";

export async function copyToClipboard(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

// The Web Share API is optional and not in the base DOM types; narrow it here.
type WebShareNavigator = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};

// Share an invite. Returns whether it fell back to copying the link (so the caller can flip its label
// to "Link copied"). A user cancelling the OS share sheet is a no-op, NOT a fallback.
export async function shareInvite(text: string, url: string): Promise<{ copied: boolean }> {
  if (Platform.OS === "web") {
    const nav = typeof navigator !== "undefined" ? (navigator as WebShareNavigator) : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: text, text, url });
        return { copied: false };
      } catch (err) {
        // AbortError = the user dismissed the share sheet; treat as a no-op (do not copy).
        if (err instanceof Error && err.name === "AbortError") return { copied: false };
        // Any other failure falls through to the copy fallback below.
      }
    }
    await copyToClipboard(url);
    return { copied: true };
  }

  try {
    // iOS honours `url`; Android only reads `message`, so the URL rides along in the message too.
    const result = await Share.share({ message: `${text} ${url}`, url });
    if (result.action === Share.dismissedAction) return { copied: false };
    return { copied: false };
  } catch {
    await copyToClipboard(url);
    return { copied: true };
  }
}
