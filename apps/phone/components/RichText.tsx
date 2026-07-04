import { Fragment, type ReactNode } from 'react';
import { Text } from 'react-native';

/**
 * Tiny markdown renderer for assistant replies — no external dependency (keeps
 * the patched RN bundle lean). Handles the subset Claude actually emits:
 * **bold**, *italic*, `code`, bullet lists (-, *, •) and blank-line paragraphs.
 *
 * Everything renders inside ONE <Text> (nested <Text> for styling, "\n" for
 * line breaks) so the bubble sizes to its content naturally — a nested View
 * layout collapses to one char per line inside a hug-content bubble.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(
        <Text key={`${keyBase}-${key++}`} style={{ fontWeight: '700' }}>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith('`')) {
      out.push(
        <Text key={`${keyBase}-${key++}`} style={{ fontFamily: 'monospace' }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else {
      out.push(
        <Text key={`${keyBase}-${key++}`} style={{ fontStyle: 'italic' }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, color = '#1A1A1A' }: { text: string; color?: string }) {
  const lines = text.split('\n');
  return (
    <Text style={{ color, lineHeight: 20 }}>
      {lines.map((raw, i) => {
        const line = raw.replace(/^#{1,6}\s+/, ''); // strip heading marks
        const bullet = /^\s*[-*•]\s+/.test(line);
        const content = bullet ? line.replace(/^\s*[-*•]\s+/, '') : line;
        return (
          <Fragment key={i}>
            {bullet ? '•  ' : ''}
            {renderInline(content, String(i))}
            {i < lines.length - 1 ? '\n' : ''}
          </Fragment>
        );
      })}
    </Text>
  );
}
