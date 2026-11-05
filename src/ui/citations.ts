/** Splits answer text into plain text and footnote references like [1] or [1, 2]. */

export type Segment = { type: "text"; text: string } | { type: "ref"; n: number };

const MARKER = /\s*\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Drops any reference to a fact that doesn't exist, so a link never points at nothing. */
export function splitCitations(text: string, factCount: number): Segment[] {
  const segments: Segment[] = [];
  let last = 0;

  for (const match of text.matchAll(MARKER)) {
    if (match.index > last) segments.push({ type: "text", text: text.slice(last, match.index) });
    for (const value of match[1].split(",")) {
      const n = Number(value);
      if (n >= 1 && n <= factCount) segments.push({ type: "ref", n });
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}
