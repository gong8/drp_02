import { ui } from "../theme";
import { AppText } from "./Text";

// The shared inline form-error line (a brand-coloured caption), so the error wrapper has one home.
// Pair with the ERR_SAVE / ERR_NETWORK copy constants.
export function FormError({ children }: { children: string }) {
  return (
    <AppText variant="caption" style={{ color: ui.brand, marginBottom: 10 }}>
      {children}
    </AppText>
  );
}
