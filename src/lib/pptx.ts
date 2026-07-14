import JSZip from 'jszip';
import type { CoursePage, SourceTextBlock, SourceTextItem } from '../types';

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

function elementsByTagName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName(name));
}

function paragraphText(paragraph: Element): string {
  return elementsByTagName(paragraph, 'a:t')
    .map(element => element.textContent || '')
    .join('')
    .trim();
}

function createBlock(text: string, pageNumber: number, blockIndex: number): SourceTextBlock {
  const item: SourceTextItem = {
    text,
    x: 0,
    y: -blockIndex,
    fontSize: 14,
    hasEol: true,
    sourceIndex: blockIndex,
  };

  return {
    items: [item],
    text,
    pageNumber,
    blockIndex,
    avgFontSize: 14,
    yStart: -blockIndex,
    yEnd: -blockIndex,
  };
}

export async function parsePptxBuffer(
  buffer: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<CoursePage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map(path => {
      const match = path.match(SLIDE_PATH);
      return match ? { path, number: Number(match[1]) } : null;
    })
    .filter((slide): slide is { path: string; number: number } => slide !== null)
    .sort((left, right) => left.number - right.number);

  if (slides.length === 0) {
    throw new Error('PPTX 中未找到幻灯片');
  }

  const pages: CoursePage[] = [];
  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index];
    onProgress?.(index + 1, slides.length);
    const xml = await zip.file(slide.path)?.async('text');
    if (!xml) {
      pages.push({
        pageNumber: index + 1,
        text: '',
        warning: '幻灯片内容读取失败',
      });
      continue;
    }

    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror')) {
      pages.push({
        pageNumber: index + 1,
        text: '',
        warning: '幻灯片 XML 解析失败',
      });
      continue;
    }

    let texts = elementsByTagName(document, 'a:p')
      .map(paragraphText)
      .filter(Boolean);
    if (texts.length === 0) {
      texts = elementsByTagName(document, 'a:t')
        .map(element => (element.textContent || '').trim())
        .filter(Boolean);
    }

    const blocks = texts.map((text, blockIndex) => createBlock(text, index + 1, blockIndex));
    pages.push({
      pageNumber: index + 1,
      text: texts.join('\n').trim(),
      blocks: blocks.length > 0 ? blocks : undefined,
      warning: blocks.length === 0 ? '本页未检测到可提取文字' : undefined,
    });
  }

  return pages;
}
