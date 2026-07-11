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
});
