import { useState } from "react";

/**
 * Call `onChange` during render whenever `value` differs from the last render.
 *
 * This replaces the very common `useEffect(() => { if (open) setDraft(applied) },
 * [open])` shape. React recommends adjusting state during render instead: the
 * component re-runs immediately with the new state *before* the browser paints,
 * so a panel never shows one frame of the stale draft, and there is no second
 * commit. An effect can only fire after the paint, which is both a visible flash
 * and a wasted render pass — hence `react-hooks/set-state-in-effect`.
 *
 * Only call setters of the calling component from `onChange`; a render-phase
 * update to a *different* component is not allowed.
 *
 * @example
 * useWhenChanged(dialogOpen, (open) => {
 *   if (open) setDraft(applied);
 * });
 */
export function useWhenChanged<T>(value: T, onChange: (next: T, prev: T) => void): void {
  const [prev, setPrev] = useState(value);
  if (!Object.is(value, prev)) {
    setPrev(value);
    onChange(value, prev);
  }
}
