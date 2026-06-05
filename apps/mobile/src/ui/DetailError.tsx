import { ERR_NETWORK } from "../lib/copy";
import { EmptyState } from "./EmptyState";
import { ScreenHeader } from "./ScreenHeader";
import { ScreenScroll } from "./ScreenScroll";

// The error / not-found state shared by the detail screens: a back bar over a muted line that reads
// the network error on a fetch failure, else the screen's own not-found label.
export function DetailError({
  error,
  onBack,
  notFoundLabel,
}: {
  error: boolean;
  onBack: () => void;
  notFoundLabel: string;
}) {
  return (
    <ScreenScroll header={<ScreenHeader title="Back" onBack={onBack} />}>
      <EmptyState>{error ? ERR_NETWORK : notFoundLabel}</EmptyState>
    </ScreenScroll>
  );
}
