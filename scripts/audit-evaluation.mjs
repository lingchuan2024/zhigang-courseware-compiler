// Offline checks of actual notes through the same renderer used in the app.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
try {
  const { MarkdownRenderer } = await server.ssrLoadModule('/src/components/MarkdownRenderer.tsx');
  for (const label of process.argv.slice(2)) {
    if (!/^[\w-]+$/.test(label)) throw new Error('Invalid label');
    const dir = resolve('.uploads/evaluation', label);
    const markdown = await readFile(resolve(dir, 'notes.md'), 'utf8');
    const notes = JSON.parse(await readFile(resolve(dir, 'notes.json'), 'utf8'));
    const html = renderToStaticMarkup(React.createElement(MarkdownRenderer, { content: markdown }));
    const snippets = [...markdown.matchAll(/(?:^|\n)(?:> )?```python[^\n]*\n([\s\S]*?)\n(?:> )?```/g)].map(m => m[1].replace(/^> ?/gm, ''));
    // Parse only. Never execute generated programs.
    const check = spawnSync('python3', ['-c', 'import ast,json,sys\nr=[]\nfor i,s in enumerate(json.load(sys.stdin)):\n try: ast.parse(s)\n except SyntaxError as e: r.append({"snippet":i+1,"line":e.lineno,"reason":e.msg})\nprint(json.dumps(r))'], { input: JSON.stringify(snippets), encoding: 'utf8' });
    if (check.status !== 0) throw new Error(check.stderr || 'Python syntax audit unavailable');
    const audit = {
      label,
      katexErrors: (html.match(/class="katex-error"/g) ?? []).length,
      displayEquations: (html.match(/class="katex-display"/g) ?? []).length,
      tables: (html.match(/<table[ >]/g) ?? []).length,
      codeBlocks: (html.match(/<pre[ >]/g) ?? []).length,
      pythonSnippets: snippets.length,
      codeChapterBodiesPreserved: notes.chapterNotes.filter(c => c.status === 'completed' && /```|~~~/.test(c.markdown)).every(c => markdown.includes(c.markdown)),
      pythonSyntaxErrors: JSON.parse(check.stdout),
      // Coverage and syntax are not proofs of factual correctness.
    };
    await writeFile(resolve(dir, 'audit.json'), JSON.stringify(audit, null, 2));
    await writeFile(resolve(dir, 'rendered.html'), html);
    console.log(JSON.stringify(audit));
  }
} finally { await server.close(); }
