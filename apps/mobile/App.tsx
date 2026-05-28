import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Availability } from "./src/screens/Availability";
import { Floating } from "./src/screens/Floating";
import { Home } from "./src/screens/Home";
import { Reveal } from "./src/screens/Reveal";
import { Suggest } from "./src/screens/Suggest";
import { TheMoment } from "./src/screens/TheMoment";
import { colors } from "./src/theme";

export type Route =
  | { name: "home" }
  | { name: "suggest" }
  | { name: "availability"; suggestionId: string }
  | { name: "floating" }
  | { name: "moment" }
  | { name: "reveal"; momentId: string };

export type Navigate = (route: Route) => void;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  return (
    <View style={styles.root}>
      {route.name === "home" && <Home navigate={setRoute} />}
      {route.name === "suggest" && <Suggest navigate={setRoute} />}
      {route.name === "availability" && (
        <Availability navigate={setRoute} suggestionId={route.suggestionId} />
      )}
      {route.name === "floating" && <Floating navigate={setRoute} />}
      {route.name === "moment" && <TheMoment navigate={setRoute} />}
      {route.name === "reveal" && <Reveal navigate={setRoute} momentId={route.momentId} />}
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } });
