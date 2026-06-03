import { Text, View } from "react-native";
import { font, ui } from "../theme";
import { BackBar } from "./BackBar";
import { ScreenBackground } from "./ScreenBackground";

// The error / not-found state shared by the detail screens: a back bar over a muted line that reads
// "Couldn't reach the server." on a fetch error, else the screen's own not-found label.
export function DetailError({
  error,
  onBack,
  notFoundLabel,
}: {
  error: boolean;
  onBack: () => void;
  notFoundLabel: string;
}) {
  return (
    <ScreenBackground>
      <View style={{ padding: 16 }}>
        <BackBar title="Back" onBack={onBack} />
        <Text style={{ fontFamily: font.medium, color: ui.muted }}>
          {error ? "Couldn't reach the server." : notFoundLabel}
        </Text>
      </View>
    </ScreenBackground>
  );
}
