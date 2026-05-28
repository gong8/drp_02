import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { TheMoment } from "./src/screens/TheMoment";
import { colors } from "./src/theme";

export default function App() {
  return (
    <View style={styles.root}>
      <TheMoment />
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
