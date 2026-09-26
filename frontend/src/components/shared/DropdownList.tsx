"use client";

import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactElement,
} from "react";

/**
 * The app-wide dropdown rules (wired into the MUI theme, see theme/theme.ts, so every Select and
 * Autocomplete in the app follows them without each page opting in):
 *  - the list always opens BELOW its field - never flipped above it, where it could land under the
 *    cursor and cause an accidental click;
 *  - it shows every option (no "...N more" truncation), DROPDOWN_MAX_ROWS rows at a time, and the rest
 *    is reached by scrolling.
 */
export const DROPDOWN_MAX_ROWS = 6;
/** Row height of the type-ahead (Autocomplete) lists. */
export const DROPDOWN_ROW_PX = 36;
/** A plain Select's rows are a little taller than the type-ahead lists'. */
export const SELECT_ROW_PX = 40;

/** Lists longer than this are drawn virtually (only the rows in view); shorter ones are ordinary MUI lists, whose
 *  keyboard handling (arrows move the highlight, Enter picks) needs no help. */
export const VIRTUALIZE_ABOVE = 1500;

/** Lets a type-ahead tell its virtual list to scroll a row into view when the keyboard highlight moves. */
export const VirtualScrollContext = createContext<MutableRefObject<((index: number) => void) | null> | null>(null);

/**
 * Listbox for the very long type-ahead lists (every lot number of a sale: 10,000+): DROPDOWN_MAX_ROWS rows in view,
 * the rest by scrolling, but only the rows currently in view are put into the page - rendering them all would freeze it.
 */
export const VirtualListbox = forwardRef<HTMLDivElement, HTMLAttributes<HTMLElement>>(function VirtualListbox(props, ref) {
  const { children, style, onScroll, ...other } = props;
  const items = Children.toArray(children) as ReactElement<{ style?: CSSProperties }>[];
  const [scrollTop, setScrollTop] = useState(0);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const scrollCtx = useContext(VirtualScrollContext);
  const viewport = DROPDOWN_ROW_PX * Math.min(items.length, DROPDOWN_MAX_ROWS);
  const first = Math.max(0, Math.floor(scrollTop / DROPDOWN_ROW_PX) - 3);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewport) / DROPDOWN_ROW_PX) + 3);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref]
  );

  // Arrow keys move MUI's highlight, but a row that is not drawn cannot scroll itself into view: do it here.
  useEffect(() => {
    if (!scrollCtx) return;
    scrollCtx.current = (index: number) => {
      const el = innerRef.current;
      if (!el) return;
      const top = index * DROPDOWN_ROW_PX;
      const bottom = top + DROPDOWN_ROW_PX;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    };
    return () => {
      scrollCtx.current = null;
    };
  }, [scrollCtx]);

  return (
    <div
      ref={setRefs}
      {...other}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        onScroll?.(e);
      }}
      style={{ ...style, maxHeight: viewport, overflow: "auto", padding: 0 }}
    >
      <div style={{ height: items.length * DROPDOWN_ROW_PX, position: "relative" }}>
        {items.slice(first, last).map((item, i) =>
          cloneElement(item, {
            style: {
              ...item.props.style,
              position: "absolute",
              top: (first + i) * DROPDOWN_ROW_PX,
              left: 0,
              right: 0,
              height: DROPDOWN_ROW_PX,
              boxSizing: "border-box",
              alignItems: "center",
            },
          })
        )}
      </div>
    </div>
  );
});
