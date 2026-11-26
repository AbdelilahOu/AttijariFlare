/** Minimum count of letters and digits for converted markdown to count as a text layer. */
export const MIN_TEXT_CHARS = 40;

/**
 * True when the markdown produced from a PDF carries real text. Scanned statements without
 * a text layer come back empty or as page headings and image placeholders only.
 */
export function hasUsableText(markdown: string): boolean {
  const withoutImages = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const meaningful = withoutImages.match(/[\p{L}\p{N}]/gu);
  return (meaningful?.length ?? 0) >= MIN_TEXT_CHARS;
}

/**
 * Splits statement markdown into chunks of at most `maxChars`, on line boundaries so a
 * transaction row is never cut in half. A single line longer than `maxChars` is split on
 * whitespace as a last resort. Chunks do not overlap, so rows are never duplicated.
 */
export function chunkMarkdown(markdown: string, maxChars: number): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) {
      chunks.push(current.trimEnd());
    }
    current = "";
  };

  for (const line of lines) {
    for (const piece of splitLongLine(line, maxChars)) {
      const next = current.length === 0 ? piece : `${current}\n${piece}`;
      if (next.length > maxChars) {
        flush();
        current = piece;
      } else {
        current = next;
      }
    }
  }
  flush();
  return chunks;
}

function splitLongLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(" ", maxChars);
    const at = cut > 0 ? cut : maxChars;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest.length > 0) {
    pieces.push(rest);
  }
  return pieces;
}

/** Splits one chunk in two halves on a line boundary (used when the model output overflows). */
export function splitChunk(chunk: string): [string, string] | null {
  const lines = chunk.split("\n");
  if (lines.length < 2) {
    return null;
  }
  const middle = Math.ceil(lines.length / 2);
  return [lines.slice(0, middle).join("\n"), lines.slice(middle).join("\n")];
}
