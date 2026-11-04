import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";

// Local fork: per-browser choice between the stock sidebar and the dense thread list.
const DENSE_THREAD_LIST_STORAGE_KEY = "t3code:local:dense-thread-list";

export function useDenseThreadListView(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useLocalStorage(
    DENSE_THREAD_LIST_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  return [enabled, setEnabled];
}
