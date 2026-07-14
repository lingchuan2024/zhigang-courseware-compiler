/**
 * MinerU Markdown 标准化器
 *
 * 清理 MinerU 输出的 Markdown 中常见问题：
 * - 公式格式不统一
 * - 标题层级不准确
 * - 重复页眉页脚
 * - 空内容
 * - 碎片短段落
 * - 图片与图注分离
 * - 表格格式不稳定
 * - 代码块未闭合
 *
 * 该函数是幂等的：多次运行结果相同。
 */

// ========== 主入口 ==========

/**
 * 标准化 MinerU Markdown 输出。
 * @param markdown - 原始 Markdown 文本
 * @returns 标准化后的 Markdown 文本
 */
export function normalizeMinerUMarkdown(markdown: string): string {
  if (!markdown || markdown.trim().length === 0) return '';

  let lines = markdown.split('\n');

  // 按顺序处理各项问题
  lines = normalizeFormulas(lines);
  lines = closeUnterminatedDisplayMath(lines);
  lines = fixHeadingLevels(lines);
  lines = removeDuplicateContent(lines);
  lines = cleanupEmptyContent(lines);
  lines = mergeShortParagraphs(lines);
  lines = bindImageCaptions(lines);
  lines = cleanupTables(lines);
  lines = cleanupCodeBlocks(lines);
  lines = collapseBlankLines(lines);

  return lines.join('\n').trim() + '\n';
}

/**
 * MinerU occasionally omits a closing `\]`. Once normalized, that leaves a
 * lone `$$` which would make the Markdown renderer consume the rest of the
 * document as math. Close the display formula at a safe structural boundary:
 * after a balanced LaTeX environment, before a Markdown heading, or at EOF.
 */
function closeUnterminatedDisplayMath(lines: string[]): string[] {
  const result: string[] = [];
  let inCodeBlock = false;
  let inDisplayMath = false;
  let environmentDepth = 0;

  const nextNonEmptyLine = (from: number): string => {
    for (let index = from; index < lines.length; index++) {
      if (lines[index].trim()) return lines[index].trim();
    }
    return '';
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (inDisplayMath && /^#{1,6}\s+/.test(trimmed)) {
      result.push('$$');
      inDisplayMath = false;
      environmentDepth = 0;
    }

    const delimiterCount = (line.match(/\$\$/g) ?? []).length;
    const wasInDisplayMath = inDisplayMath;
    result.push(line);

    if (delimiterCount % 2 === 1) {
      inDisplayMath = !inDisplayMath;
      if (!inDisplayMath) environmentDepth = 0;
    }

    if (!inDisplayMath) continue;

    const beginCount = (line.match(/\\begin\{[^}]+\}/g) ?? []).length;
    const endCount = (line.match(/\\end\{[^}]+\}/g) ?? []).length;
    environmentDepth = Math.max(0, environmentDepth + beginCount - endCount);

    const completedEnvironment = wasInDisplayMath && endCount > 0 && environmentDepth === 0;
    if (completedEnvironment && nextNonEmptyLine(index + 1) !== '$$') {
      result.push('$$');
      inDisplayMath = false;
    }
  }

  if (inDisplayMath) result.push('$$');
  return result;
}

// ========== 1. 公式标准化 ==========

/**
 * 将 \(...\) 转为 $...$，\[...\] 转为 $$...$$，
 * 确保 $$ 块独占行。
 * 不修改代码块内的内容。
 */
function normalizeFormulas(lines: string[]): string[] {
  const result: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 检测代码块边界
    if (line.trim().match(/^(`{3,}|~{3,})/)) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // \[...\] → $$...$$
    line = line.replace(/\\\[(.+?)\\\]/g, (_, content) => `$$${content}$$`);
    // 独立的 \[
    // Replacement strings treat `$$` as an escape for one literal `$`.
    // Use callbacks so a standalone MinerU `\[`/`\]` becomes a real
    // display-math delimiter instead of a broken single-dollar delimiter.
    line = line.replace(/\\\[\s*$/g, () => '$$');
    // 独立的 \]
    line = line.replace(/^\s*\\\]/g, () => '$$');

    // \(...\) → $...$
    line = line.replace(/\\\((.+?)\\\)/g, (_, content) => `$${content}$`);

    // 确保 $$ 独占行：如果行内有 $$ 且周围有其他内容，拆分
    const dollarMatch = line.match(/\$\$/);
    if (dollarMatch && line.trim() !== '$$' && !line.trim().startsWith('$$')) {
      // 行内有 $$ 但不是独占行，拆分
      const parts = line.split(/\$\$/);
      if (parts.length >= 2) {
        result.push(parts[0].trim());
        result.push('$$');
        // 重新处理剩余部分
        const rest = parts.slice(1).join('$$');
        if (rest.trim()) {
          if (rest.trim() === '$$') {
            result.push('$$');
          } else {
            result.push(rest.trim());
          }
        }
        continue;
      }
    }

    result.push(line);
  }

  return result;
}

// ========== 2. 标题层级修正 ==========

/**
 * 修正标题层级：
 * - 如果没有 #（level 1），将第一个 ## 提升为 #
 * - 如果所有标题都是 ### 或更深，整体提升 2 级
 * - 删除空标题
 */
function fixHeadingLevels(lines: string[]): string[] {
  // 统计标题层级
  const headingLines = lines.filter(l => l.match(/^#{1,6}\s+/));
  if (headingLines.length === 0) return lines;

  const minLevel = Math.min(
    ...headingLines.map(l => (l.match(/^(#+)\s+/)?.[1].length ?? 7))
  );

  // 如果最浅标题是 level 3+，整体提升
  if (minLevel >= 3) {
    const promote = minLevel - 1;
    lines = lines.map(l => {
      const match = l.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const newLevel = Math.max(1, match[1].length - promote);
        return `${'#'.repeat(newLevel)} ${match[2]}`;
      }
      return l;
    });
  }

  // 如果没有 level 1 但有 level 2，提升第一个 level 2
  const hasLevel1 = lines.some(l => l.match(/^#\s+/));
  if (!hasLevel1) {
    let promoted = false;
    lines = lines.map(l => {
      if (!promoted && l.match(/^##\s+/)) {
        promoted = true;
        return '#' + l.substring(2);
      }
      return l;
    });
  }

  // 删除空标题（"## " 后无内容）
  return lines.filter(l => !l.match(/^#{1,6}\s*$/));
}

// ========== 3. 重复内容清理 ==========

/**
 * 移除连续重复行和重复页眉页脚。
 */
function removeDuplicateContent(lines: string[]): string[] {
  const protectedLines = new Set<number>();
  let inCodeBlock = false;
  let inDisplayMath = false;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      protectedLines.add(index);
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      protectedLines.add(index);
      continue;
    }

    const delimiterCount = (trimmed.match(/\$\$/g) ?? []).length;
    if (inDisplayMath || delimiterCount > 0) protectedLines.add(index);
    if (delimiterCount % 2 === 1) inDisplayMath = !inDisplayMath;
  }

  const normalizeKey = (line: string): string => line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
  const isPageCounter = (line: string): boolean => {
    const value = line.trim();
    return /^(?:page\s*)?\d+\s*(?:\/|of)\s*\d+$/i.test(value)
      || /^第\s*\d+\s*页$/.test(value)
      || /^page\s+\d+$/i.test(value);
  };

  const counts = new Map<string, number>();
  lines.forEach((line, index) => {
    if (protectedLines.has(index) || isPageCounter(line)) return;
    const key = normalizeKey(line);
    if (key.length >= 4 && key.length <= 160) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  const repeatedBoilerplate = new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= 3)
      .map(([key]) => key),
  );

  const result: string[] = [];
  const keptBoilerplate = new Set<string>();
  let lastContentKey = '';

  lines.forEach((line, index) => {
    if (protectedLines.has(index)) {
      result.push(line);
      lastContentKey = '';
      return;
    }
    if (isPageCounter(line)) return;

    const key = normalizeKey(line);
    if (!key) {
      result.push(line);
      return;
    }
    if (key === lastContentKey) return;
    lastContentKey = key;

    if (repeatedBoilerplate.has(key)) {
      if (keptBoilerplate.has(key)) return;
      keptBoilerplate.add(key);
    }
    result.push(line);
  });

  return result;
}

// ========== 4. 空内容清理 ==========

/**
 * 移除纯空白行、空标题后的空节、合并多余空行。
 */
function cleanupEmptyContent(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 保留所有非空行
    if (trimmed !== '') {
      result.push(line);
      continue;
    }

    // 空行：检查是否在两个标题之间（空节）
    const prevLine = result.length > 0 ? result[result.length - 1] : '';
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

    // 如果前后都是标题，跳过空行（节内容为空）
    if (
      prevLine.match(/^#{1,6}\s+/) &&
      nextLine.trim().match(/^#{1,6}\s+/)
    ) {
      continue;
    }

    result.push(line);
  }

  return result;
}

// ========== 5. 短段落合并 ==========

/**
 * 将连续的短段落（< 30 字符，非标题/列表/代码/表格）合并为一个段落。
 */
function mergeShortParagraphs(lines: string[]): string[] {
  const result: string[] = [];
  let inCodeBlock = false;
  let pendingShort: string[] = [];

  const flushPending = () => {
    if (pendingShort.length > 0) {
      if (pendingShort.length === 1) {
        result.push(pendingShort[0]);
      } else {
        result.push(pendingShort.join(' '));
      }
      pendingShort = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // 代码块边界
    if (trimmed.match(/^(`{3,}|~{3,})/)) {
      flushPending();
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // 空行：flush
    if (trimmed === '') {
      flushPending();
      result.push(line);
      continue;
    }

    // 标题、列表、表格、引用、公式、图片：flush
    if (
      trimmed.match(/^#{1,6}\s+/) ||
      trimmed.match(/^[-*+]\s+/) ||
      trimmed.match(/^\d+\.\s+/) ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('$$') ||
      trimmed.startsWith('![')
    ) {
      flushPending();
      result.push(line);
      continue;
    }

    // 短段落：加入 pending
    if (trimmed.length < 30) {
      pendingShort.push(trimmed);
    } else {
      flushPending();
      result.push(line);
    }
  }

  flushPending();
  return result;
}

// ========== 6. 图片与图注绑定 ==========

/**
 * 确保图片和紧随其后的图注之间没有空行。
 * 图注特征：以"图"、"Figure"、"Fig."、"表"、"Table"开头，且 < 50 字符。
 */
function bindImageCaptions(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测图片
    if (trimmed.startsWith('![')) {
      result.push(line);

      // 检查下一行是否是图注
      if (i + 1 < lines.length) {
        const nextTrimmed = lines[i + 1].trim();
        const isCaption =
          nextTrimmed.length < 50 &&
          (nextTrimmed.match(/^(图|Figure|Fig\.?|表|Table)\s*/i) !== null);

        if (isCaption) {
          // 跳过中间的空行，直接添加图注
          // 跳过空行
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j < lines.length && j === i + 1) {
            // 图注紧跟图片，无需处理
          } else if (j < lines.length) {
            // 有空行，但图注在后面 — 不移除空行（让自然段落分隔）
          }
        }
      }
      continue;
    }

    result.push(line);
  }

  return result;
}

// ========== 7. 表格清理 ==========

/**
 * 确保 GFM 表格有正确的分隔行。
 */
function cleanupTables(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // 检测表格开始（行以 | 开头）
    if (trimmed.startsWith('|') && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();

      // 检查下一行是否是分隔行
      if (!nextTrimmed.match(/^\|[\s:|-]+\|$/)) {
        // 缺少分隔行，添加一个
        const colCount = (trimmed.match(/\|/g) ?? []).length - 1;
        if (colCount > 0) {
          result.push(lines[i]);
          result.push('|' + Array(colCount).fill('---').join('|') + '|');
          i++;
          continue;
        }
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result;
}

// ========== 8. 代码块清理 ==========

/**
 * 确保代码块有语言标签，闭合未闭合的代码块。
 */
function cleanupCodeBlocks(lines: string[]): string[] {
  const result: string[] = [...lines];
  let inCodeBlock = false;
  let fenceMarker = '';

  for (let i = 0; i < result.length; i++) {
    const trimmed = result[i].trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);

    if (fenceMatch) {
      if (!inCodeBlock) {
        // 开启代码块
        inCodeBlock = true;
        fenceMarker = fenceMatch[1][0]; // ` 或 ~

        // 如果没有语言标签，尝试推断
        if (!fenceMatch[2].trim()) {
          const lang = inferCodeLanguage(result, i);
          if (lang) {
            result[i] = fenceMatch[1] + lang;
          }
        }
      } else if (trimmed[0] === fenceMarker) {
        // 关闭代码块
        const onlyFence = trimmed.match(new RegExp(`^${fenceMarker}{3,}\\s*$`));
        if (onlyFence) {
          inCodeBlock = false;
          fenceMarker = '';
        }
      }
    }
  }

  // 闭合未闭合的代码块
  if (inCodeBlock) {
    result.push(fenceMarker.repeat(3));
  }

  return result;
}

/**
 * 从代码内容推断语言标签。
 */
function inferCodeLanguage(lines: string[], startIndex: number): string {
  // 收集代码块内容
  const content: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(/^(`{3,}|~{3,})/)) break;
    content.push(lines[i]);
  }

  const text = content.join('\n');

  // 简单推断
  if (text.match(/console\.(log|error|warn)/)) return 'javascript';
  if (text.match(/print\(|def\s+\w+\(|import\s+\w+/)) return 'python';
  if (text.match(/System\.out|public\s+(class|static|void)/)) return 'java';
  if (text.match(/#include|int\s+main/)) return 'cpp';
  if (text.match(/func\s+\w+|package\s+main/)) return 'go';
  if (text.match(/fn\s+\w+|let\s+mut\s+/)) return 'rust';
  if (text.match(/SELECT\s+.*\s+FROM/i)) return 'sql';
  if (text.match(/<\?php|echo\s+/)) return 'php';

  return '';
}

// ========== 9. 空行合并 ==========

/**
 * 将 3+ 连续空行合并为 2 行。
 */
function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim() === '') {
      blankCount++;
      if (blankCount <= 2) {
        result.push(line);
      }
    } else {
      blankCount = 0;
      result.push(line);
    }
  }

  // 移除开头的空行
  while (result.length > 0 && result[0].trim() === '') {
    result.shift();
  }

  return result;
}
