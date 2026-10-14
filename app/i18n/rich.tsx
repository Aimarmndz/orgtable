import { Fragment, type ReactNode } from "react";
import { fmt, type Params } from "./format";

// Messages with markup, without HTML in the translations: translators write
// "Read the <link>privacy policy</link>" and the code decides what <link> renders.
// Tags are simple names, not nested. An unknown tag is rendered as plain text.

export type RichTags = Record<string, (chunk: string) => ReactNode>;

export function rich(template: string, tags: RichTags, params: Params = {}): ReactNode {
  const text = fmt(template, params);
  const parts: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [, tag, chunk] = match;
    const render = tags[tag];
    parts.push(<Fragment key={i++}>{render ? render(chunk) : chunk}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
