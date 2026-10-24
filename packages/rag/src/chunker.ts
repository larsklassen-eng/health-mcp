/*
 * Splits free text into chunks for search. Chunks end at paragraph or sentence
 * boundaries where possible, so each one reads on its own, and the next chunk
 * repeats the last sentences of the previous one, so a fact that spans the
 * boundary is still found.
 */

export interface ChunkOptions {
  /** Longest chunk, in characters. */
  maxChars?: number;
  /** Text carried over from the end of one chunk to the start of the next, in whole sentences. */
  overlapChars?: number;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = { maxChars: 800, overlapChars: 100 };

/** A sentence or short paragraph; chunks are built from these. */
interface Unit {
  text: string;
  /** Starts a new paragraph, so it is joined with a blank line instead of a space. */
  paragraphStart: boolean;
}

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

/** Splits a piece that is still too long at spaces, or anywhere if a single word is. */
function splitWords(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    for (let start = 0; start < word.length; start += maxChars) {
      const part = word.slice(start, start + maxChars);
      if (current && current.length + 1 + part.length > maxChars) {
        pieces.push(current);
        current = "";
      }
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Paragraphs that fit as they are; longer ones become sentences, then word runs. */
function units(text: string, maxChars: number): Unit[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => {
    const parts =
      paragraph.length <= maxChars
        ? [paragraph]
        : [...sentences.segment(paragraph)]
            .map(({ segment }) => segment.trim())
            .filter(Boolean)
            .flatMap((sentence) =>
              sentence.length <= maxChars ? [sentence] : splitWords(sentence, maxChars),
            );
    return parts.map((part, i) => ({ text: part, paragraphStart: i === 0 }));
  });
}

const join = (parts: Unit[]) =>
  parts.map((unit, i) => (i === 0 ? "" : unit.paragraphStart ? "\n\n" : " ") + unit.text).join("");

/** Splits `text` into chunks of at most `maxChars`, overlapping by whole sentences. */
export function splitText(text: string, options: ChunkOptions = {}): string[] {
  const { maxChars, overlapChars } = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const chunks: string[] = [];
  let current: Unit[] = [];

  for (const unit of units(text, maxChars)) {
    if (current.length === 0 || join([...current, unit]).length <= maxChars) {
      current.push(unit);
      continue;
    }
    chunks.push(join(current));

    // Carry over the last sentences that fit in the overlap, if the new unit still fits after them.
    const overlap: Unit[] = [];
    for (let i = current.length - 1; i >= 0; i--) {
      const candidate = [current[i]!, ...overlap];
      if (join(candidate).length > overlapChars) break;
      overlap.unshift(current[i]!);
    }
    current = join([...overlap, unit]).length <= maxChars ? [...overlap, unit] : [unit];
  }
  if (current.length > 0) chunks.push(join(current));
  return chunks;
}
