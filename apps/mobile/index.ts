import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// Defined locally (instead of expo/AppEntry) so the entry resolves correctly
// under pnpm's hoisted node_modules, where expo lives at the repo root.
registerRootComponent(App);
