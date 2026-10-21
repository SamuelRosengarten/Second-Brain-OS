import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer. It builds React elements only (never raw HTML), so imported or AI-written text
 * cannot inject markup. Links are limited to http(s) and mailto. Supported: headings, paragraphs, bold, italic,
 * inline code, fenced code, links, ordered/unordered lists, blockquotes, horizontal rules.
 */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code, links, bold, italic
  const re = /(`[^`\n]+`)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(\b_([^_\n]+)_\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) {
      out.push(
        SAFE_URL.test(m[4]) ? (
          <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>
        ) : (
          <span key={k}>{m[3]}</span> // unsafe scheme (javascript:, data:, ...) is shown as plain text
        ),
      );
    } else if (m[5]) out.push(<strong key={k}>{m[6]}</strong>);
    else if (m[7]) out.push(<strong key={k}>{m[8]}</strong>);
    else if (m[9]) out.push(<em key={k}>{m[10]}</em>);
    else if (m[11]) out.push(<em key={k}>{m[12]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k()}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2], `h${key}`);
      const id = k();
      blocks.push(level === 1 ? <h1 key={id}>{content}</h1> : level === 2 ? <h2 key={id}>{content}</h2> : level === 3 ? <h3 key={id}>{content}</h3> : <h4 key={id}>{content}</h4>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={k()} />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k()}>{inline(q.join(" "), `q${key}`)}</blockquote>);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items: ReactNode[] = [];
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      let n = 0;
      while (i < lines.length && re.test(lines[i])) {
        const text = re.exec(lines[i])![1];
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        items.push(<li key={n++}>{task ? <>{task[1] === " " ? "☐ " : "☑ "}{inline(task[2], `l${key}-${n}`)}</> : inline(text, `l${key}-${n}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k()}>{items}</ol> : <ul key={k()}>{items}</ul>);
      continue;
    }
    // paragraph: consecutive non-special lines
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) p.push(lines[i++]);
    if (!p.length) { p.push(lines[i++]); }
    blocks.push(<p key={k()}>{inline(p.join("\n"), `p${key}`)}</p>);
  }
  return <div className={`md ${className ?? ""}`}>{blocks}</div>;
}
