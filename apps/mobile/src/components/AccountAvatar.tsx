import { useDisplayName } from "../lib/auth";
import { ui } from "../theme";
import { Avatar } from "../ui";

// The small header avatar on Home/Groups, showing the signed-in user's initial. Identity and
// sign-out live in the Account tab; this is a decorative balance for the heading.
export function AccountAvatar() {
  const name = useDisplayName("?");
  return <Avatar initial={name.charAt(0).toUpperCase()} color={ui.brand} size={28} />;
}
