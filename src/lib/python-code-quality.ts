export interface PythonCodeIssue { line: number; reason: string }

function bracketIssues(lines: Array<{ text: string; number: number }>): PythonCodeIssue[] {
  const issues: PythonCodeIssue[] = [];
  const stack: Array<{ token: string; line: number }> = [];
  let quote = '';
  let escaped = false;
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const { text, number } of lines) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (char === '\\') { escaped = true; continue; }
        if (text.startsWith(quote, i)) { i += quote.length - 1; quote = ''; }
        continue;
      }
      if (char === '#') break;
      if (char === '"' || char === "'") {
        quote = text.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
        i += quote.length - 1;
      } else if ('([{'.includes(char)) stack.push({ token: char, line: number });
      else if (pairs[char]) {
        if (stack.at(-1)?.token !== pairs[char]) issues.push({ line: number, reason: `括号 ${char} 没有匹配的起始括号` });
        else stack.pop();
      }
    }
    escaped = false;
  }
  for (const opening of stack) issues.push({ line: opening.line, reason: `括号 ${opening.token} 未闭合` });
  return issues;
}

/** Conservative layout checks only; this is not a Python parser or execution sandbox. */
export function findPythonCodeIssues(markdown: string): PythonCodeIssue[] {
  const issues: PythonCodeIssue[] = [];
  let fence = '';
  let python = false;
  let pending: { indent: number; line: number } | undefined;
  let triple = '';
  let codeLines: Array<{ text: string; number: number }> = [];
  const lines = markdown.split('\n');
  lines.forEach((raw, index) => {
    const line = raw.replace(/^\s*> ?/, '');
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!fence && marker) {
      fence = marker[1];
      python = /^(python|py|python3)\s*$/i.test(marker[2].trim());
      return;
    }
    if (fence && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      if (python && pending) issues.push({ line: pending.line, reason: '代码块在冒号后缺少缩进的语句体' });
      if (python) issues.push(...bracketIssues(codeLines));
      codeLines = [];
      fence = ''; python = false; pending = undefined; triple = '';
      return;
    }
    if (!python) return;
    codeLines.push({ text: line, number: index + 1 });
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (triple) { if (line.includes(triple)) triple = ''; return; }
    const indent = (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;
    if (pending && indent <= pending.indent) {
      issues.push({ line: index + 1, reason: `第 ${pending.line} 行冒号后的语句体没有增加缩进` });
    }
    pending = undefined;
    const quote = trimmed.match(/^(?:[rubf]*)?("""|''')/i)?.[1];
    if (quote && trimmed.indexOf(quote, trimmed.indexOf(quote) + 3) < 0) { triple = quote; return; }
    if (/^(?:(?:async\s+)?(?:def|class|if|elif|for|while|with|match|case)\b.*|else|try|except(?:\b.*)?|finally):\s*(?:#.*)?$/.test(trimmed)) {
      pending = { indent, line: index + 1 };
    }
    if (/^[A-Za-z_]\w*(?:[ \t]+[A-Za-z_]\w*)+\s*:\s*[-+]?\d+(?:\.\d+)?\s*$/.test(trimmed)) {
      issues.push({ line: index + 1, reason: 'Python 代码围栏中混入了类似控制台输出的非代码行' });
    }
  });
  if (python) issues.push(...bracketIssues(codeLines));
  return issues;
}
