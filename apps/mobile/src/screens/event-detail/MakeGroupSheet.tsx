import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { BottomSheet, Button, Field, FormError, Section } from "../../ui";

// A bottom sheet that crystallizes a meetup's full roster (origin group + attached groups +
// ad-hoc participants) into a new, permanent group - so the people on this meetup become a
// group you can plan with again without having to re-invite everyone.
export function MakeGroupSheet({
  visible,
  eventId,
  defaultName,
  onClose,
  onCreated,
}: {
  visible: boolean;
  eventId: string;
  defaultName: string;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the name field each time the sheet opens so stale edits do not persist.
  useEffect(() => {
    if (visible) {
      setName(defaultName);
      setError(null);
    }
  }, [visible, defaultName]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Give the group a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await trpc.groups.createFromEvent.mutate({ eventId, name: trimmed });
      onCreated(id);
      onClose();
    } catch {
      setError("Could not make the group.");
    } finally {
      setBusy(false);
    }
  }, [name, eventId, onCreated, onClose]);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Section
        title="Make a group from this"
        size="lg"
        sub="Keep everyone who was on this meetup as a group you can plan with again."
      />
      <Field
        label="Group name"
        value={name}
        onChangeText={setName}
        placeholder="Group name"
        style={{ marginBottom: 12 }}
      />
      {error ? <FormError>{error}</FormError> : null}
      <Button
        label={busy ? "Making..." : "Make group"}
        variant="primary"
        disabled={busy}
        onPress={create}
        style={{ marginTop: 4 }}
      />
    </BottomSheet>
  );
}
