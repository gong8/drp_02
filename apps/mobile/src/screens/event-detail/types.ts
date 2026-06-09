import type { RouterOutputs } from "../../lib/trpc";

// The events.get payload and its candidate row shapes, shared by the EventDetail container and the
// phase sub-components so the move did not need to thread these types through props.
export type Detail = NonNullable<RouterOutputs["events"]["get"]>;
export type TimeCand = Detail["timeCandidates"][number];
export type ActivityCand = Detail["activityCandidates"][number];
