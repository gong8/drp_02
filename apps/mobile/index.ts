import { registerRootComponent } from "expo";

import App from "./App";
import { ui } from "./src/theme";

// On web the app is a centered phone-width column on a pink backdrop (see App.tsx Shell). Paint the
// page (html/body) the same pink so the document edges - top strip, overscroll - never flash a stray
// default colour behind the app. Guarded for native, where `document` does not exist.
if (typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = ui.brand;
  document.body.style.backgroundColor = ui.brand;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// Defined locally (instead of expo/AppEntry) so the entry resolves correctly
// under pnpm's hoisted node_modules, where expo lives at the repo root.
registerRootComponent(App);
