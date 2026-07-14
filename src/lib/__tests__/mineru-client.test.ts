import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { extractMarkdownFromMinerUZip, formatMinerUError, runMinerUParse } from '../mineru-client';
import type { MinerUConfig } from '../../types';

const config: MinerUConfig = {
  endpoint: 'https://mineru.net/api/v4',
  apiKey: 'token',
  modelVersion: 'vlm',
  language: 'ch',
  enableFormula: true,
  enableTable: true,
};

describe('MinerU client', () => {
  it('extracts full.md and image assets from the result archive', async () => {
    const zip = new JSZip();
    zip.file('course/full.md', '# 解析结果\n\n![图](images/a.png)');
    zip.file('course/images/a.png', new Uint8Array([1, 2, 3]));
    const result = await extractMarkdownFromMinerUZip(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(result.markdown).toContain('# 解析结果');
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].path).toBe('images/a.png');
  });

  it('creates a signed upload, uploads the file, polls, and downloads the result', async () => {
    const zip = new JSZip();
    zip.file('full.md', '# 完成');
    const archive = await zip.generateAsync({ type: 'arraybuffer' });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { batch_id: 'batch-1', file_urls: ['https://upload.test/file'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { batch_id: 'batch-1', extract_result: [{ file_name: 'course.pdf', state: 'running', err_msg: '' }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { batch_id: 'batch-1', extract_result: [{ file_name: 'course.pdf', state: 'done', err_msg: '', full_zip_url: 'https://download.test/result.zip' }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(archive, { status: 200 }));
    const statuses: string[] = [];

    const result = await runMinerUParse(new File(['pdf'], 'course.pdf', { type: 'application/pdf' }), config, {
      fetcher,
      pollIntervalMs: 0,
      onStatus: status => statuses.push(status),
    });

    expect(result.markdown).toBe('# 完成');
    expect(statuses).toEqual(expect.arrayContaining(['uploading', 'queued', 'parsing', 'downloading', 'completed']));
    expect(fetcher.mock.calls[0][0]).toBe('/api/mineru/v4/file-urls/batch');
    expect(fetcher.mock.calls[1][0]).toContain('/api/mineru/resource?url=');
    expect(fetcher.mock.calls[2][0]).toBe('/api/mineru/v4/extract-results/batch/batch-1');
    expect(fetcher.mock.calls[4][0]).toContain('/api/mineru/resource?url=');
  });

  it('surfaces MinerU task failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { batch_id: 'batch-1', file_urls: ['https://upload.test/file'] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { batch_id: 'batch-1', extract_result: [{ file_name: 'course.pdf', state: 'failed', err_msg: '解析失败' }] } }), { status: 200 }));

    await expect(runMinerUParse(new File(['pdf'], 'course.pdf'), config, { fetcher, pollIntervalMs: 0 }))
      .rejects.toThrow('解析失败');
  });

  it('includes the safe OSS error code when a signed upload is rejected', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { batch_id: 'batch-1', file_urls: ['https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/signed'] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(
        '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature does not match.</Message><RequestId>secret-request-id</RequestId></Error>',
        { status: 403, headers: { 'Content-Type': 'application/xml' } },
      ));

    let error: unknown;
    try {
      await runMinerUParse(new File(['pdf'], 'course.pdf'), config, { fetcher });
    } catch (reason) {
      error = reason;
    }

    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('SignatureDoesNotMatch');
    expect(message).not.toContain('secret-request-id');
  });

  it('explains when the local MinerU proxy cannot be reached', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(runMinerUParse(new File(['pdf'], 'course.pdf'), config, { fetcher }))
      .rejects.toThrow('无法连接本地 MinerU 代理');
  });

  it('translates a persisted Failed to fetch message', () => {
    expect(formatMinerUError('Failed to fetch')).toContain('跨域');
  });
});
