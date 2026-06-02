import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { font, ui } from "../theme";
import { BackBar, HardShadow, ScreenBackground } from "../ui";

type Props = NativeStackScreenProps<MeetupsStackParams, "NewDial">;

// The visible "how pinned down is this?" dial - the single front door. It replaces the old hidden
// whenMode toggle: the open end (float) is anonymous + collaborative, the closed end (set) is a
// concrete event. The downstream experience is very different; the entry is one friendly choice.
const OPTIONS = [
  {
    branch: "float",
    title: "Float it",
    sub: "Just an idea - drop it anonymously and let the group shape it.",
    color: ui.gradient[1],
  },
  {
    branch: "rough",
    title: "Rough plan",
    sub: "You know what, not exactly when. Offer a few times; it locks itself.",
    color: ui.surface,
  },
  {
    branch: "set",
    title: "It's set",
    sub: "Fixed time and place. It's on - who's in?",
    color: ui.surface,
  },
] as const;

export function NewDial({ navigation }: Props) {
  return (
    <ScreenBackground header={<BackBar title="New meetup" onBack={() => navigation.goBack()} />}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: 9,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: ui.ink,
            marginBottom: 14,
          }}
        >
          How pinned down is this?
        </Text>

        {OPTIONS.map((o) => (
          <HardShadow key={o.branch} radius={ui.rCard} style={{ marginBottom: 14 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${o.title}. ${o.sub}`}
              onPress={() => navigation.navigate("CreateWizard", { branch: o.branch })}
              style={{
                backgroundColor: o.color,
                borderWidth: ui.border,
                borderColor: ui.ink,
                borderRadius: ui.rCard,
                paddingHorizontal: 18,
                paddingVertical: 18,
              }}
            >
              <Text style={{ fontFamily: font.display, fontSize: 20, color: ui.ink }}>
                {o.title}
              </Text>
              <Text
                style={{
                  fontFamily: font.medium,
                  fontSize: 12,
                  color: ui.muted,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                {o.sub}
              </Text>
            </Pressable>
          </HardShadow>
        ))}
      </ScrollView>
    </ScreenBackground>
  );
}
