import { useSyncExternalStore } from "react";
import { type StudioState, studioClient } from "./store";

export const useStudio = (): StudioState =>
  useSyncExternalStore(studioClient.subscribe, studioClient.getState);

export { studioClient };
