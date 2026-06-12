import { View } from "react-native";
import {
  BADGE_NEW,
  ERR_CHANGE_DOOR,
  LABEL_PLUS_ONES,
  PLUS_ONES_CLOSED_SUB,
  PLUS_ONES_LOCKED_NOTE,
  PLUS_ONES_OPEN_LABEL,
  PLUS_ONES_OPEN_SUB,
  peopleCount,
  TITLE_WHOS_IN,
  viaSharer,
  WHOS_IN_LOADING,
} from "../../lib/copy";
import { isNewJoin } from "../../lib/rosterSeen";
import type { RouterOutputs } from "../../lib/trpc";
import {
  AppText,
  BottomSheet,
  CheckOption,
  FormError,
  PersonRow,
  Section,
  StatusPill,
} from "../../ui";

type Roster = RouterOutputs["events"]["roster"];

// Everyone a plan reaches, counted once (groups can overlap, and a +1 may sit in two sections
// server-side never - but two GROUPS sharing a member is normal).
export function rosterHeadcount(roster: Roster): number {
  const ids = new Set<string>();
  for (const g of roster.groups) for (const m of g.members) ids.add(m.id);
  for (const p of roster.participants) ids.add(p.id);
  return ids.size;
}

// The Who's-in sheet (DRP-63): the full live roster, grouped by where it comes from - the origin
// group, each attached group, then the ad-hoc +1s with brought-by attribution ("via Leo") and a NEW
// badge on anyone who joined since this device last looked. Presence is not a vote: this lists who
// the plan reaches, never who voted for what, so anonymity is untouched. The +1 door sits on top -
// visible to everyone for transparency, enabled per roster.canToggle (group members, while the
// choice is unlocked; a frozen choice says so).
export function WhoIsInSheet({
  visible,
  roster,
  seenMs,
  doorBusy,
  doorError,
  onToggleDoor,
  onClose,
}: {
  visible: boolean;
  roster: Roster | null;
  seenMs: number | null;
  doorBusy: boolean;
  doorError: boolean;
  onToggleDoor: (open: boolean) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Section
        title={TITLE_WHOS_IN}
        size="lg"
        sub={roster ? peopleCount(rosterHeadcount(roster)) : undefined}
      />
      {roster === null ? (
        <AppText variant="caption">{WHOS_IN_LOADING}</AppText>
      ) : (
        <>
          <CheckOption
            label={PLUS_ONES_OPEN_LABEL}
            sub={
              roster.lockJoins
                ? PLUS_ONES_LOCKED_NOTE
                : roster.joinsOpen
                  ? PLUS_ONES_OPEN_SUB
                  : PLUS_ONES_CLOSED_SUB
            }
            on={roster.joinsOpen}
            disabled={!roster.canToggle || doorBusy}
            onToggle={() => onToggleDoor(!roster.joinsOpen)}
          />
          {doorError ? <FormError>{ERR_CHANGE_DOOR}</FormError> : null}
          {roster.groups.map((g) => (
            <View key={g.id} style={{ marginTop: 16 }}>
              <AppText variant="caption">{g.name}</AppText>
              {g.members.map((m, i) => (
                <PersonRow key={m.id} name={m.name} color={m.color} index={i} />
              ))}
            </View>
          ))}
          {roster.participants.length > 0 ? (
            <View style={{ marginTop: 16 }}>
              <AppText variant="caption">{LABEL_PLUS_ONES}</AppText>
              {roster.participants.map((p, i) => (
                <PersonRow
                  key={p.id}
                  name={p.name}
                  color={p.color}
                  index={i}
                  right={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {p.invitedBy ? (
                        <AppText variant="caption">{viaSharer(p.invitedBy.name)}</AppText>
                      ) : null}
                      {isNewJoin(p.joinedAt, seenMs) ? <StatusPill label={BADGE_NEW} /> : null}
                    </View>
                  }
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}
