import { Citation } from '../types';

// ========== Helpers ==========

/**
 * Validate generated markdown content against a set of contract checks.
 * Only fixes deterministic format issues; does NOT rewrite content.
 */
export function validateGeneratedMarkdown(
  content: string,
  citations: Citation[]
): { warnings: string[]; fixedContent: string } {
  const warnings: string[] = [];
  let fixedContent = content;

  // 1. Unclosed code fences (```)
  const codeFenceCount = (fixedContent.match(/```/g) || []).length;
  if (codeFenceCount % 2 !== 0) {
    warnings.push('检测到未闭合的代码块围栏（```），已自动补全');
    fixedContent = fixedContent.replace(/\n?$/, '') + '\n```';
  }

  // 2. Unclosed $$ (display math)
  const dollarPairs = (fixedContent.match(/\$\$/g) || []).length;
  if (dollarPairs % 2 !== 0) {
    warnings.push('检测到未闭合的数学公式块（$$），已自动补全');
    fixedContent = fixedContent.replace(/\n?$/, '') + '\n$$';
  }

  // Build set of valid citation markers (case-insensitive)
  const validMarkersLower = new Set(citations.map(c => c.marker.toLowerCase()));

  // 3. Find citation markers in content that don't exist in citations array
  //    Match patterns like [cite-1], [t1-cite-1], etc.
  const citationPattern = /\[([^\]]*cite-\d+[^\]]*)\]/gi;
  const contentCitationsLower = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(fixedContent)) !== null) {
    const markerLower = match[1].toLowerCase();
    contentCitationsLower.add(markerLower);
    if (!validMarkersLower.has(markerLower)) {
      warnings.push(`内容中的引用标记 [${match[1]}] 不在引用列表中`);
    }
  }

  // 4. Citations in array but not used in content
  for (const c of citations) {
    if (!contentCitationsLower.has(c.marker.toLowerCase())) {
      warnings.push(`引用标记 [${c.marker}] 在引用列表中但未在内容中使用`);
    }
  }

  // 5. Dangerous link protocols
  const dangerousLinkPattern = /\[([^\]]*)\]\((javascript:|data:|vbscript:|file:)[^)]*\)/gi;
  if (dangerousLinkPattern.test(fixedContent)) {
    warnings.push('检测到不安全的链接协议，已移除链接目标');
    // Reset lastIndex since we used .test()
    dangerousLinkPattern.lastIndex = 0;
    fixedContent = fixedContent.replace(
      /\[([^\]]*)\]\((javascript:|data:|vbscript:|file:)[^)]*\)/gi,
      '$1'
    );
  }

  // Also check bare URLs with dangerous protocols
  const bareDangerousPattern = /(^|\s)((javascript:|data:|vbscript:|file:)\S+)/gi;
  if (bareDangerousPattern.test(fixedContent)) {
    warnings.push('检测到不安全的裸链接协议，已移除');
    bareDangerousPattern.lastIndex = 0;
    fixedContent = fixedContent.replace(
      /(^|\s)((javascript:|data:|vbscript:|file:)\S+)/gi,
      '$1'
    );
  }

  // 6. Broken table structures
  const tableWarnings = validateTables(fixedContent);
  warnings.push(...tableWarnings);

  return { warnings, fixedContent };
}

/**
 * Validate markdown table structures.
 * Checks for inconsistent column counts and malformed separator rows.
 */
function validateTables(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split('\n');
  let inTable = false;
  let headerCols = 0;
  let separatorLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').slice(1, -1);

      if (!inTable) {
        // Header row
        headerCols = cols.length;
        inTable = true;
        separatorLineIdx = i + 1;
      } else if (i === separatorLineIdx) {
        // Separator row (should be |---|---|)
        const sepCols = cols.length;
        if (sepCols !== headerCols) {
          warnings.push(
            `第${i + 1}行表格分隔行列数（${sepCols}）与表头（${headerCols}）不一致`
          );
        }
        const allSeparators = cols.every(c => /^\s*:?-+:?\s*$/.test(c));
        if (!allSeparators) {
          warnings.push(`第${i + 1}行表格分隔符格式不正确`);
        }
      } else {
        // Data row
        const dataCols = cols.length;
        if (dataCols !== headerCols && dataCols > 0) {
          warnings.push(
            `第${i + 1}行表格列数（${dataCols}）与表头（${headerCols}）不一致`
          );
        }
      }
    } else {
      inTable = false;
      separatorLineIdx = -1;
    }
  }

  return warnings;
}
