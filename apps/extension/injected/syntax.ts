/**
 * Line-oriented syntax tokenizers for the Sources panel. Tones map 1:1 onto
 * `theme.devtools.syntax` keys, so every skin colors code with the palette it
 * already uses for the Elements tree. Regex-based and deliberately shallow:
 * good coloring for real-world files, never an exception for weird ones —
 * anything unrecognized falls through as plain text. State that must survive
 * line breaks (block comments, template literals, unclosed tags) is threaded
 * through the per-line loop.
 */

export type SyntaxTone =
  | "text"
  | "tag"
  | "attributeName"
  | "attributeValue"
  | "comment"
  | "doctype"
  | "punctuation"
  | "property"
  | "value"
  | "number"
  | "string"
  | "keyword";

export type SyntaxToken = { text: string; tone: SyntaxTone };

export type SourceLanguage = "html" | "css" | "js";

const JS_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "from",
  "default",
  "async",
  "await",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "in",
  "of",
  "delete",
  "void",
  "yield",
  "static",
  "get",
  "set",
  "this",
  "null",
  "undefined",
  "true",
  "false",
]);

/** Pushes `text` merged into the previous token when the tones match. */
function push(out: SyntaxToken[], text: string, tone: SyntaxTone) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.tone === tone) last.text += text;
  else out.push({ text, tone });
}

function tokenizeCssLines(lines: string[]): SyntaxToken[][] {
  let inComment = false;
  let inBlock = false;
  let afterColon = false;

  return lines.map((line) => {
    const out: SyntaxToken[] = [];
    let pos = 0;
    while (pos < line.length) {
      const rest = line.slice(pos);

      if (inComment) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          push(out, rest, "comment");
          pos = line.length;
        } else {
          push(out, rest.slice(0, end + 2), "comment");
          inComment = false;
          pos += end + 2;
        }
        continue;
      }

      if (rest.startsWith("/*")) {
        inComment = true;
        continue;
      }

      const space = /^\s+/.exec(rest);
      if (space) {
        push(out, space[0], "text");
        pos += space[0].length;
        continue;
      }

      const str = /^("(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$))/.exec(
        rest,
      );
      if (str) {
        push(out, str[0], "string");
        pos += str[0].length;
        continue;
      }

      const ch = rest[0];
      if (ch === "{") {
        inBlock = true;
        afterColon = false;
        push(out, ch, "punctuation");
        pos += 1;
        continue;
      }
      if (ch === "}") {
        inBlock = false;
        afterColon = false;
        push(out, ch, "punctuation");
        pos += 1;
        continue;
      }
      if (ch === ";") {
        afterColon = false;
        push(out, ch, "punctuation");
        pos += 1;
        continue;
      }
      if (ch === ":" && inBlock) {
        afterColon = true;
        push(out, ch, "punctuation");
        pos += 1;
        continue;
      }

      const atRule = /^@[\w-]+/.exec(rest);
      if (atRule && !inBlock) {
        push(out, atRule[0], "keyword");
        pos += atRule[0].length;
        continue;
      }

      const word = /^[^{}:;'"\s/]+|^\//.exec(rest);
      if (word) {
        const tone: SyntaxTone = !inBlock
          ? "text"
          : afterColon
            ? "value"
            : "property";
        push(out, word[0], tone);
        pos += word[0].length;
        continue;
      }

      push(out, ch, "text");
      pos += 1;
    }
    return out;
  });
}

function tokenizeJsLines(lines: string[]): SyntaxToken[][] {
  let inComment = false;
  let inTemplate = false;

  return lines.map((line) => {
    const out: SyntaxToken[] = [];
    let pos = 0;
    while (pos < line.length) {
      const rest = line.slice(pos);

      if (inComment) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          push(out, rest, "comment");
          pos = line.length;
        } else {
          push(out, rest.slice(0, end + 2), "comment");
          inComment = false;
          pos += end + 2;
        }
        continue;
      }

      if (inTemplate) {
        const end = /(?:^|[^\\])`/.exec(rest);
        if (!end) {
          push(out, rest, "string");
          pos = line.length;
        } else {
          const upTo = end.index + end[0].length;
          push(out, rest.slice(0, upTo), "string");
          inTemplate = false;
          pos += upTo;
        }
        continue;
      }

      if (rest.startsWith("//")) {
        push(out, rest, "comment");
        pos = line.length;
        continue;
      }
      if (rest.startsWith("/*")) {
        inComment = true;
        continue;
      }

      const str = /^("(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$))/.exec(
        rest,
      );
      if (str) {
        push(out, str[0], "string");
        pos += str[0].length;
        continue;
      }
      if (rest[0] === "`") {
        const closed = /^`(?:[^`\\]|\\.)*`/.exec(rest);
        if (closed) {
          push(out, closed[0], "string");
          pos += closed[0].length;
        } else {
          push(out, rest, "string");
          inTemplate = true;
          pos = line.length;
        }
        continue;
      }

      const num =
        /^(?:0[xXbBoO][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
      if (num) {
        push(out, num[0], "number");
        pos += num[0].length;
        continue;
      }

      const word = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (word) {
        push(out, word[0], JS_KEYWORDS.has(word[0]) ? "keyword" : "text");
        pos += word[0].length;
        continue;
      }

      push(out, rest[0], "text");
      pos += 1;
    }
    return out;
  });
}

function tokenizeHtmlLines(lines: string[]): SyntaxToken[][] {
  let inComment = false;
  let inTag = false;

  return lines.map((line) => {
    const out: SyntaxToken[] = [];
    let pos = 0;
    while (pos < line.length) {
      const rest = line.slice(pos);

      if (inComment) {
        const end = rest.indexOf("-->");
        if (end === -1) {
          push(out, rest, "comment");
          pos = line.length;
        } else {
          push(out, rest.slice(0, end + 3), "comment");
          inComment = false;
          pos += end + 3;
        }
        continue;
      }

      if (inTag) {
        const space = /^\s+/.exec(rest);
        if (space) {
          push(out, space[0], "text");
          pos += space[0].length;
          continue;
        }
        const close = /^\/?>/.exec(rest);
        if (close) {
          push(out, close[0], "punctuation");
          inTag = false;
          pos += close[0].length;
          continue;
        }
        const attrValue = /^("[^"]*(?:"|$)|'[^']*(?:'|$))/.exec(rest);
        if (attrValue) {
          push(out, attrValue[0], "attributeValue");
          pos += attrValue[0].length;
          continue;
        }
        if (rest[0] === "=") {
          push(out, "=", "punctuation");
          pos += 1;
          continue;
        }
        const attrName = /^[\w:-]+/.exec(rest);
        if (attrName) {
          push(out, attrName[0], "attributeName");
          pos += attrName[0].length;
          continue;
        }
        push(out, rest[0], "text");
        pos += 1;
        continue;
      }

      if (rest.startsWith("<!--")) {
        inComment = true;
        continue;
      }
      const doctype = /^<![^>]*>?/.exec(rest);
      if (doctype) {
        push(out, doctype[0], "doctype");
        pos += doctype[0].length;
        continue;
      }
      const open = /^<\/?/.exec(rest);
      if (open) {
        push(out, open[0], "punctuation");
        pos += open[0].length;
        const name = /^[\w:-]+/.exec(line.slice(pos));
        if (name) {
          push(out, name[0], "tag");
          pos += name[0].length;
        }
        inTag = true;
        continue;
      }

      const text = /^[^<]+/.exec(rest);
      if (text) {
        push(out, text[0], "text");
        pos += text[0].length;
        continue;
      }

      push(out, rest[0], "text");
      pos += 1;
    }
    return out;
  });
}

/** Tokenizes already-split lines; the caller owns the line cap. */
export function tokenizeLines(
  lines: string[],
  language: SourceLanguage,
): SyntaxToken[][] {
  if (language === "css") return tokenizeCssLines(lines);
  if (language === "js") return tokenizeJsLines(lines);
  return tokenizeHtmlLines(lines);
}
