import { useAuth, useUser } from "@clerk/clerk-expo";
import { Pressable, StyleSheet, Text } from "react-native";
import { useDevAuth } from "../lib/auth";
import { colors, space } from "../theme";

// Header control: shows the signed-in name and signs out (Clerk session or dev bypass).
export function AccountButton() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { devUser, signOutDev } = useDevAuth();

  const label = devUser ? "Test user" : (user?.firstName ?? user?.username ?? "Account");

  const onPress = async () => {
    if (devUser) {
      signOutDev();
      return;
    }
    await signOut();
  };

  return (
    <Pressable style={styles.btn} onPress={onPress} hitSlop={8}>
      <Text style={styles.text}>{label} - Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  text: { color: colors.accentInk, fontSize: 13, fontWeight: "600" },
});
