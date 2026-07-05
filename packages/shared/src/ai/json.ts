/** Small JSON-extraction helpers shared by the Claude client and its tools. */

/** Pull the first balanced JSON object out of a text blob. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object in response');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in response');
}

/** Pull the first JSON array out of a text blob (for suggestions). */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('No JSON array in response');
  return JSON.parse(text.slice(start, end + 1));
}
