import { describe, it, expect } from 'vitest';
import { validateFile, MAX_FILE_SIZE } from '../pdf';

describe('pdf validation', () => {
  it('should reject non-PDF files', () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
  });

  it('should accept PDF files', () => {
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });

  it('should reject files larger than max size', () => {
    const largeContent = new Uint8Array(MAX_FILE_SIZE + 1);
    const file = new File([largeContent], 'large.pdf', { type: 'application/pdf' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('20MB');
  });

  it('should accept .pdf extension even with wrong mime type', () => {
    const file = new File(['content'], 'test.pdf', { type: 'application/octet-stream' });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });

  it('should accept OOXML PowerPoint .pptx files', () => {
    const file = new File(
      ['pptx-content'],
      'lecture.pptx',
      { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
    );
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });

  it('should reject legacy binary .ppt files with a clear message', () => {
    const file = new File(['ppt-content'], 'lecture.ppt', { type: 'application/vnd.ms-powerpoint' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('PPTX');
  });

  it('should accept .md and .markdown files', () => {
    const md = new File(['# 标题'], 'lecture.md', { type: 'text/markdown' });
    expect(validateFile(md).valid).toBe(true);

    const markdown = new File(['# 标题'], 'lecture.markdown', { type: '' });
    expect(validateFile(markdown).valid).toBe(true);

    const mdNoMime = new File(['# 标题'], 'lecture.md', { type: '' });
    expect(validateFile(mdNoMime).valid).toBe(true);
  });
});
