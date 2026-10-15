/**
 * Small helpers shared by the new mix builder. Nothing here touches the page
 * unless it's called, so the pure functions can be tested with `bun test`.
 *
 * Text from the API or the user only ever goes into the page as text
 * (textContent / text nodes), never as HTML.
 */

/**
 * Create an element. `props`: `class`, `text`, `on<event>` handlers, `dataset`,
 * boolean `hidden` / `disabled`, and anything else as an attribute.
 * Children are nodes or strings (added as text).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "hidden" || key === "disabled") node[key] = Boolean(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** localStorage that never throws (private mode, blocked storage). */
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to do
    }
  },
};

export const pad2 = (n) => String(n).padStart(2, "0");

/** Seconds to "mm:ss", or "h:mm:ss" from an hour up. */
export function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Seconds to "m:ss" / "h:mm:ss": the format saved in project files and sent to the server. */
export function shortTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** "1:23", "01:02:03", "83" or 83 to seconds; null when it isn't a time. */
export function parseTime(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  if (parts.length > 1 && parts.slice(1).some((p) => Number(p) > 59)) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
