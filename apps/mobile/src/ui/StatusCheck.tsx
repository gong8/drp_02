import { Text, View } from "react-native";
import { ui } from "../theme";

// Home list status: going = green check, awaiting = empty box, declined = muted x,
// reacting = pink dot (a plan still collecting your input).
export function StatusCheck({
  status,
}: {
  status: "going" | "awaiting" | "declined" | "reacting";
}) {
  const on = status === "going";
  const reacting = status === "reacting";
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: on ? ui.going : reacting ? ui.brand : ui.ink,
        backgroundColor: on ? ui.going : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Text style={{ fontSize: 10, color: "#fff" }}>{"✓"}</Text>}
      {status === "declined" && <Text style={{ fontSize: 10, color: ui.muted }}>{"×"}</Text>}
      {reacting && (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ui.brand }} />
      )}
    </View>
  );
}
