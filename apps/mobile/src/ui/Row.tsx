import type { ReactNode } from "react";
import { ui } from "../theme";
import { Tappable } from "./Tappable";

// The single full-width list-row look shared by the voting board and the create flow, so a candidate,
// an added idea, and a vote all read as the same table. `tinted` marks the caller's own pick.
export function Row({
  children,
  onPress,
  tinted = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  tinted?: boolean;
}) {
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 8,
    borderRadius: ui.rInput,
    borderWidth: ui.border,
    borderColor: ui.ink,
    backgroundColor: tinted ? ui.tint : ui.surface,
  };
  return (
    <Tappable onPress={onPress} style={style}>
      {children}
    </Tappable>
  );
}
