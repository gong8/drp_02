import { Text, View } from "react-native";
import { ui } from "../theme";

// Home list status: going = green check, awaiting = empty box, declined = muted x.
export function StatusCheck({ status }: { status: "going" | "awaiting" | "declined" }) {
  const on = status === "going";
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: on ? ui.going : ui.ink,
        backgroundColor: on ? ui.going : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Text style={{ fontSize: 10, color: "#fff" }}>{"✓"}</Text>}
      {status === "declined" && <Text style={{ fontSize: 10, color: ui.muted }}>{"×"}</Text>}
    </View>
  );
}
