/**
 * Code formatting utilities for ProcessDrawer and other components.
 *
 * Provides JSON → Python literal conversion, string repr, and
 * pretty-printing helpers used in code block rendering.
 */

/** Indentation string used for Python-style literal formatting (2 spaces). */
const INDENT = "  ";

/** Default max string length for `reprTruncated` before truncation kicks in. */
const DEFAULT_REPR_MAX_LEN = 100;

/**
 * Parse a JSON string and format as Python dict literal.
 * Falls back to raw string if not valid JSON.
 */
export function formatAsPython(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = JSON.parse(trimmed);
    return jsonToPythonLiteral(parsed, 0);
  } catch {
    // Not JSON — show as-is (plain text)
    return trimmed;
  }
}

/** Recursive JSON → Python literal converter */
export function jsonToPythonLiteral(val: unknown, indent: number): string {
  const pad = INDENT.repeat(indent);
  const padInner = INDENT.repeat(indent + 1);

  if (val === null) return "None";
  if (val === true) return "True";
  if (val === false) return "False";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return _repr(val);

  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map((v) => `${padInner}${jsonToPythonLiteral(v, indent + 1)},`);
    return `[\n${items.join("\n")}\n${pad}]`;
  }

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v]) => {
      const pyKey = /^[a-zA-Z_]\w*$/.test(k) ? k : _repr(k);
      return `${padInner}${pyKey}: ${jsonToPythonLiteral(v, indent + 1)},`;
    });
    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  return String(val);
}

/** Python repr() for strings — uses single quotes by default */
function _repr(s: string): string {
  // Use single quotes; escape internal quotes and backslashes
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `'${escaped}'`;
}

/** Pretty-print a string as JSON (if valid), else return as-is */
export function formatAsJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

/** Smart-truncate a string for Python repr in code examples */
export function reprTruncated(s: string, maxLen = DEFAULT_REPR_MAX_LEN): string {
  const truncated = s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
  return _repr(truncated);
}
