import { Pressable } from "react-native";
import { AccountAvatar } from "./AccountAvatar";

// Header right-slot button: the signed-in user's avatar; tapping it opens the Account tab. Takes an
// onPress instead of a navigation prop so it stays decoupled from any stack's param list.
export function AccountHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <AccountAvatar />
    </Pressable>
  );
}
