// Vertical resize handle.
//
// A thin draggable bar that sits between two siblings and lets the
// user adjust the height of one of them by dragging.  Used to make
// the bottom panel (DeltaStatsBar + DeltaTable) resizable.
//
// Behaviour:
//  - `onDelta` is called with the drag distance in pixels:
//      positive deltaY  → the user dragged UP    (the lower
//                          sibling should grow, so add deltaY)
//      negative deltaY  → the user dragged DOWN  (the lower
//                          sibling should shrink, so add deltaY)
//  - The parent is responsible for clamping the new height to a
//    reasonable range and for owning the height value (this
//    component is fully controlled).
//  - During a drag we lock the body cursor and disable text
//    selection so the drag feels stable.  Both are restored on
//    mouseup, even if the mouseup fires outside the handle (the
//    listeners are attached to `window`).
//  - A subtle three-line grip is rendered in the centre so the
//    affordance is discoverable without being noisy.

import { useCallback, useRef } from 'react';

interface Props {
  /** Called on every mousemove with the drag distance (negative
   *  when the user drags down).  The parent accumulates the delta
   *  into its height state. */
  onDelta: (deltaY: number) => void;
  /** Optional className for the wrapper. */
  className?: string;
  /** Accessible label for screen readers. */
  ariaLabel?: string;
}

export function VResizeHandle({
  onDelta,
  className = '',
  ariaLabel = 'Resize panel',
}: Props) {
  // We keep `lastY` in a ref so successive mousemove events can
  // compute the per-event delta without re-creating listeners.
  const lastYRef = useRef<number | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only respond to the primary mouse button.
      if (e.button !== 0) return;
      e.preventDefault();
      lastYRef.current = e.clientY;

      const onMove = (ev: MouseEvent) => {
        if (lastYRef.current == null) return;
        // Dragging up (clientY decreases) → positive delta → panel grows.
        const deltaY = lastYRef.current - ev.clientY;
        lastYRef.current = ev.clientY;
        if (deltaY !== 0) onDelta(deltaY);
      };
      const onUp = () => {
        lastYRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Lock the visual state for the duration of the drag.
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [onDelta],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={
        'group relative h-1.5 cursor-ns-resize flex-shrink-0 ' +
        'bg-tv-border hover:bg-tv-accent/60 active:bg-tv-accent ' +
        'transition-colors ' +
        className
      }
      title="Drag to resize the bottom panel"
    >
      {/* Three-line grip, centred.  Becomes brighter on hover/active
          so the affordance is discoverable without being noisy. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col gap-[2px] opacity-50 group-hover:opacity-90">
          <span className="block h-px w-5 bg-tv-textDim group-hover:bg-tv-text" />
          <span className="block h-px w-5 bg-tv-textDim group-hover:bg-tv-text" />
          <span className="block h-px w-5 bg-tv-textDim group-hover:bg-tv-text" />
        </div>
      </div>
    </div>
  );
}
