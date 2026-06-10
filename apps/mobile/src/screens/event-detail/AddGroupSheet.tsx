import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { trpcErrorCode } from "../../lib/trpcError";
import { AppText, BottomSheet, Button, FormError, Row, Section } from "../../ui";

type GroupRow = { id: string; name: string };

// A bottom sheet that lists the current user's groups and lets them attach one to a meetup.
// Everyone already in the attached group joins the meetup automatically; new members are
// added when they join the group later.
export function AddGroupSheet({
  visible,
  eventId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  eventId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazily load the user's groups the first time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    trpc.groups.mine
      .query()
      .then((rows) => setGroups(rows))
      .catch(() => setError("Could not load your groups."));
  }, [visible]);

  const add = useCallback(
    async (groupId: string) => {
      setBusyId(groupId);
      setError(null);
      try {
        await trpc.events.addGroup.mutate({ eventId, groupId });
        onAdded();
        onClose();
      } catch (err: unknown) {
        setError(
          trpcErrorCode(err) === "FORBIDDEN"
            ? "You can only add groups you are in."
            : "Could not add that group.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [eventId, onAdded, onClose],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Section
        title="Add a group"
        size="lg"
        sub="Everyone in the group joins this meetup. New members are added automatically."
      />
      {error ? <FormError>{error}</FormError> : null}
      {groups === null && !error ? (
        <AppText variant="caption">Loading your groups...</AppText>
      ) : null}
      {groups?.length === 0 ? (
        <AppText variant="caption">You are not in any other groups.</AppText>
      ) : null}
      {groups?.map((g) => (
        <Row key={g.id}>
          <AppText variant="rowLabel" style={{ flex: 1 }}>
            {g.name}
          </AppText>
          <Button
            label={busyId === g.id ? "Adding..." : "Add"}
            variant="outline"
            size="sm"
            disabled={busyId !== null}
            onPress={() => add(g.id)}
          />
        </Row>
      ))}
    </BottomSheet>
  );
}
