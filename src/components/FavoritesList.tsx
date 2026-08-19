// Favourites panel — the right-side list of starred pairs.
//
// Each row is clickable: clicking switches the active symbol, the
// way you'd expect from a TV-style favourites bar.  The currently
// active symbol gets a left-edge marker (a small triangle / "►")
// so the user can see at a glance which row corresponds to what's
// on the chart.  Each row also has an inline "unstar" button on
// the right that removes the pair from the favourites list (and,
// if it was the active symbol, the list keeps working — the active
// symbol can be unstarred and will simply disappear from this
// list, while the chart stays on it).
//
// Empty state: a quiet hint instead of a blank box.

import { useMemo } from 'react';

interface Props {
  favorites: ReadonlyArray<string>;
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onToggle: (symbol: string) => void;
}

export function FavoritesList({
  favorites,
  activeSymbol,
  onSelect,
  onToggle,
}: Props) {
  // Sort the list with the active symbol pinned to the top so the
  // user can see at a glance which row is selected even when the
  // list scrolls.  Other rows keep their insertion order.
  const sorted = useMemo(() => {
    const rest = favorites.filter((s) => s !== activeSymbol);
    return activeSymbol && favorites.includes(activeSymbol)
      ? [activeSymbol, ...rest]
      : [...favorites];
  }, [favorites, activeSymbol]);

  return (
    <div className="flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-tv-border text-tv-textDim text-[10px] uppercase tracking-wider flex items-center justify-between">
        <span>Favorites</span>
        <span className="text-tv-textDim/60 normal-case tracking-normal">
          {favorites.length}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="px-3 py-4 text-tv-textDim/70 text-center leading-relaxed">
          Tap the ★ next to a symbol
          <br />
          to add it here.
        </div>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((sym) => {
            const isActive = sym === activeSymbol;
            return (
              <li
                key={sym}
                className={
                  'group flex items-center gap-1 pl-2 pr-1.5 py-1.5 ' +
                  (isActive
                    ? 'bg-tv-accent/10 border-l-2 border-tv-accent text-tv-text'
                    : 'border-l-2 border-transparent hover:bg-tv-panel2 text-tv-textDim hover:text-tv-text')
                }
              >
                {/* Active marker: small filled triangle in the
                    accent colour when this row is the current
                    chart symbol.  Kept absolutely-positioned-style
                    via the parent's left border instead, but we
                    keep an explicit arrow for clarity. */}
                <span
                  aria-hidden="true"
                  className={
                    'w-3 inline-flex justify-center text-[10px] ' +
                    (isActive ? 'text-tv-accent' : 'text-transparent group-hover:text-tv-textDim/40')
                  }
                >
                  ►
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(sym)}
                  className="flex-1 min-w-0 text-left font-mono truncate"
                  title={`Switch to ${sym}`}
                >
                  {sym}
                </button>
                <button
                  type="button"
                  onClick={() => onToggle(sym)}
                  aria-label={`Remove ${sym} from favorites`}
                  title="Remove from favorites"
                  className="w-5 h-5 inline-flex items-center justify-center text-tv-amber
                             hover:text-tv-amber/70 rounded
                             opacity-60 hover:opacity-100"
                >
                  ★
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
