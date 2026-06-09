import { Text, type TextProps, type TextStyle } from "react-native";
import { font, ui } from "../theme";

// The single typographic vocabulary. Every recurring font+size+color recipe lives here as a named
// variant so the same "muted 11 caption" / "display 16 title" is never
// re-typed inline. Pass `style` to tweak (e.g. colour, margins); pass `mono` for tabular figures.
type Variant =
  | "screenTitle"
  | "title"
  | "cardTitle"
  | "rowLabel"
  | "rowLabelSm"
  | "body"
  | "caption"
  | "captionPara";

const V: Record<Variant, TextStyle> = {
  screenTitle: { fontFamily: font.black, fontSize: 27, letterSpacing: -1, color: ui.ink },
  title: { fontFamily: font.display, fontSize: 16, color: ui.ink },
  // The display-15 heading on a card (group-name row, fizzled-card title); 1px under `title`.
  cardTitle: { fontFamily: font.display, fontSize: 15, color: ui.ink },
  // The bold list-row label shared by the vote rows and the wizard's added-activity rows.
  rowLabel: { fontFamily: font.bold, fontSize: 14, color: ui.ink },
  // The bold-13 list-row label shared by DeadlineField, RemoveDot, PersonRow, and CheckOption.
  rowLabelSm: { fontFamily: font.bold, fontSize: 13, color: ui.ink },
  body: { fontFamily: font.medium, fontSize: 13, color: ui.ink, lineHeight: 19 },
  // Tight single-line caption (labels, hints).
  caption: { fontFamily: font.medium, fontSize: 11, color: ui.muted, lineHeight: 16 },
  // Same caption, looser line-height for multi-line paragraph body copy.
  captionPara: { fontFamily: font.medium, fontSize: 11, color: ui.muted, lineHeight: 18 },
};

export function AppText({
  variant = "body",
  mono = false,
  style,
  ...rest
}: TextProps & { variant?: Variant; mono?: boolean }) {
  return (
    <Text {...rest} style={[V[variant], mono ? { fontVariant: ["tabular-nums"] } : null, style]} />
  );
}
