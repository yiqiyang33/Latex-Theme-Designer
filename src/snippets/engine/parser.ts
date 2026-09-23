import { HSnippet, IHSnippetHeader } from './hsnippet';

const CODE_DELIMITER = '``';
const HEADER_REGEXP = /^snippet ?(?:`([^`]+)`|(\S+))?(?: "([^"]+)")?(?: ([AMiwbmt]*))?/;

function parseSnippetHeader(header: string): IHSnippetHeader {
  let match = HEADER_REGEXP.exec(header);
  if (!match) throw new Error('Invalid snippet header');

  let trigger: string | RegExp = match[2];
  if (match[1]) {
    // The trailing anchor has to mean "end of the matched context", not "end of any
    // line": under the m flag a bare $ also matches before every newline, so a
    // multiline trigger could fire against text well above the cursor. The m flag
    // itself stays so that a user's own ^ keeps its per-line meaning.
    let source = match[1].endsWith('$') ? match[1] : `${match[1]}$`;
    trigger = new RegExp(`${source}(?![\\s\\S])`, 'm');
  }

  return {
    trigger,
    description: match[3] || '',
    flags: match[4] || '',
  };
}

interface IHSnippetInfo {
  body: string;
  placeholders: number;
  header: IHSnippetHeader;
}

function escapeString(string: string) {
  // Backslashes must be doubled before quotes are escaped. The other order turns the
  // backslash this pass just added in front of a quote into an escaped backslash,
  // leaving the quote bare and making the generated snippet function unparseable.
  return string.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function countPlaceholders(string: string) {
  return string.split(/\$\d+|\$\{\d+\}/g).length - 1;
}

function parseSnippet(headerLine: string, lines: string[]): IHSnippetInfo {
  let header = parseSnippetHeader(headerLine);

  let script = [`(require, t, m, w, path) => {`];
  script.push(`let rv = "";`);
  script.push(`let result = [];`);
  script.push(`let blockResults = [];`);

  let isCode = false;
  let placeholders = 0;

  while (lines.length > 0) {
    let line = lines.shift() as string;

    if (isCode) {
      if (!line.includes(CODE_DELIMITER)) {
        script.push(line.trim());
      } else {
        let [code, ...rest] = line.split(CODE_DELIMITER);
        script.push(code.trim());
        lines.unshift(rest.join(CODE_DELIMITER));
        script.push(`result.push({block: blockResults.length});`);
        script.push(`blockResults.push(rv);`);
        isCode = false;
      }
    } else {
      if (line.startsWith('endsnippet')) {
        break;
      } else if (!line.includes(CODE_DELIMITER)) {
        script.push(`result.push("${escapeString(line)}");`);
        script.push(`result.push("\\n");`);
        placeholders += countPlaceholders(line);
      } else if (isCode == false) {
        let [text, ...rest] = line.split(CODE_DELIMITER);
        script.push(`result.push("${escapeString(text)}");`);
        script.push(`rv = "";`);
        placeholders += countPlaceholders(text);
        lines.unshift(rest.join(CODE_DELIMITER));
        isCode = true;
      }
    }
  }

  // Remove extra newline at the end, but only when the body loop actually emitted one.
  // An empty body leaves just the declarations, and popping one of those makes the
  // generated function throw ReferenceError at expansion time.
  if (script[script.length - 1] === `result.push("\\n");`) script.pop();
  script.push(`return [result, blockResults];`);
  script.push(`}`);

  return { body: script.join('\n'), header, placeholders };
}

// Transforms an hsnips file into a single function where the global context lives, every snippet is
// transformed into a local function inside this and the list of all snippet functions is returned
// so we can build the approppriate HSnippet objects.
export function parse(content: string): HSnippet[] {
  // A BOM would glue itself to the first header keyword and silently drop that snippet.
  let lines = content.replace(/^﻿/, '').split(/\r?\n/);

  let snippetInfos = [];
  let script = [];
  let isCode = false;
  let priority = 0;

  while (lines.length > 0) {
    let line = lines.shift() as string;

    if (isCode) {
      if (line.startsWith('endglobal')) {
        isCode = false;
      } else {
        script.push(line);
      }
    } else if (line.startsWith('global')) {
      isCode = true;
    } else if (line.startsWith('priority ')) {
      priority = Number(line.substring('priority '.length).trim()) || 0;
    } else if (line.match(HEADER_REGEXP)) {
      let info = parseSnippet(line, lines);
      info.header.priority = priority;
      snippetInfos.push(info);

      priority = 0;
    }
  }

  script.push(`return [`);
  for (let snippet of snippetInfos) {
    script.push(snippet.body);
    script.push(',');
  }
  script.push(`]`);

  let generators = new Function(script.join('\n'))().map((generator: Function) => {
    // for some reason, `require` is not defined inside the snippet code blocks,
    // so we're going to bind the it onto the function
    return generator.bind(null, require) as GeneratorFunction;
  });
  return snippetInfos.map((s, i) => new HSnippet(s.header, generators[i], s.placeholders));
}
