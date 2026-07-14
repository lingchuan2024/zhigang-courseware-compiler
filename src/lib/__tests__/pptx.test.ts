import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parsePptxBuffer } from '../pptx';
import {
  deleteDocumentSource,
  loadDocumentSource,
  saveDocumentSource,
} from '../document-source';

function slideXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`;
}

describe('PPTX parsing', () => {
  it('按幻灯片编号生成页面，并提取文字供后续 AI 使用', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide2.xml', slideXml('第二张幻灯片'));
    zip.file('ppt/slides/slide1.xml', slideXml('第一张 &amp; 介绍'));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const progress: Array<[number, number]> = [];
    const pages = await parsePptxBuffer(buffer, (current, total) => {
      progress.push([current, total]);
    });

    expect(pages).toHaveLength(2);
    expect(pages.map(page => page.pageNumber)).toEqual([1, 2]);
    expect(pages[0].text).toContain('第一张 & 介绍');
    expect(pages[1].text).toContain('第二张幻灯片');
    expect(pages.every(page => page.preview === undefined)).toBe(true);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it('保存并恢复原始 PPTX 二进制，而不是保存识别后的页面图片', async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    await saveDocumentSource('pptx-test-document', source);

    const restored = await loadDocumentSource('pptx-test-document');
    expect(Array.from(new Uint8Array(restored!))).toEqual([1, 2, 3, 4]);

    await deleteDocumentSource('pptx-test-document');
    expect(await loadDocumentSource('pptx-test-document')).toBeNull();
  });
});
