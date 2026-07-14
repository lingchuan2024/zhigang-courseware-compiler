import JSZip from 'jszip';
import type { MinerUAsset, MinerUConfig, MinerUParseStatus } from '../types';

interface MinerUEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

interface UploadTicket {
  batch_id: string;
  file_urls: string[];
}

interface BatchItem {
  file_name: string;
  state: 'waiting-file' | 'pending' | 'running' | 'converting' | 'done' | 'failed';
  err_msg?: string;
  full_zip_url?: string;
}

interface BatchResult {
  batch_id: string;
  extract_result: BatchItem[];
}

export interface MinerUParseOutput {
  batchId?: string;
  markdown: string;
  assets: MinerUAsset[];
}

export interface MinerURunOptions {
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onStatus?: (status: MinerUParseStatus, progress: number) => void;
}

function endpoint(config: MinerUConfig, path: string): string {
  const normalizedPath = path.replace(/^\//, '');
  if (/^https:\/\/mineru\.net\/api\/v4\/?$/i.test(config.endpoint.trim())) {
    return `/api/mineru/v4/${normalizedPath}`;
  }
  return `${config.endpoint.replace(/\/$/, '')}/${normalizedPath}`;
}

function resourceEndpoint(url: string): string {
  return `/api/mineru/resource?url=${encodeURIComponent(url)}`;
}

export function formatMinerUError(message?: string): string {
  if (!message) return 'MinerU 解析失败，请检查配置后重试。';
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return '此前请求被浏览器跨域策略拦截。现已改用本地 MinerU 代理，请重新解析。';
  }
  return message;
}

function explainNetworkError(error: unknown): never {
  if (error instanceof TypeError && /failed to fetch|networkerror|network request failed/i.test(error.message)) {
    throw new Error('无法连接本地 MinerU 代理。请确认应用通过 npm run dev 或 npm run preview 启动后重试。');
  }
  throw error;
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) throw new Error(`${action}失败（HTTP ${response.status}）`);
  const envelope = await response.json() as MinerUEnvelope<T>;
  if (envelope.code !== 0) throw new Error(`${action}失败：${envelope.msg || `错误码 ${envelope.code}`}`);
  return envelope.data;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlField(body: string, field: string): string {
  const match = body.match(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`, 'i'));
  return match ? decodeXmlText(match[1]).slice(0, 240) : '';
}

async function readSafeUploadError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  if (!body) return '';

  const code = xmlField(body, 'Code');
  const message = xmlField(body, 'Message');
  if (code || message) {
    const label = code === 'SignatureDoesNotMatch'
      ? `OSS 签名校验失败（${code}）`
      : code;
    return [label, message].filter(Boolean).join('：');
  }

  try {
    const parsed = JSON.parse(body) as { code?: string | number; msg?: string; message?: string };
    return [parsed.code, parsed.msg || parsed.message]
      .filter(value => value !== undefined && value !== '')
      .join('：')
      .slice(0, 320);
  } catch {
    return body.includes('MinerU resource host is not allowed')
      ? 'MinerU 返回了未获代理允许的上传域名'
      : '';
  }
}

function mimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

export async function extractMarkdownFromMinerUZip(buffer: ArrayBuffer): Promise<{ markdown: string; assets: MinerUAsset[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files).filter(file => !file.dir);
  const markdownFile = files
    .filter(file => /(^|\/)full\.md$/i.test(file.name) || /\.md$/i.test(file.name))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!markdownFile) throw new Error('MinerU 结果包中没有找到 Markdown 文件');

  const markdown = await markdownFile.async('string');
  const root = markdownFile.name.includes('/')
    ? markdownFile.name.slice(0, markdownFile.name.lastIndexOf('/') + 1)
    : '';
  const assets: MinerUAsset[] = [];
  for (const file of files) {
    if (file === markdownFile || /\.json$/i.test(file.name)) continue;
    const data = await file.async('uint8array');
    assets.push({
      path: file.name.startsWith(root) ? file.name.slice(root.length) : file.name,
      mimeType: mimeType(file.name),
      size: data.byteLength,
    });
  }
  return { markdown, assets };
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runMinerUParse(
  file: File,
  config: MinerUConfig,
  options: MinerURunOptions = {},
): Promise<MinerUParseOutput> {
  const fetcher = options.fetcher ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const emit = (status: MinerUParseStatus, progress: number) => options.onStatus?.(status, progress);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    emit('uploading', 3);
    const ticketResponse = await fetcher(endpoint(config, 'file-urls/batch'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        files: [{ name: file.name }],
        model_version: config.modelVersion,
        language: config.language,
        enable_formula: config.enableFormula,
        enable_table: config.enableTable,
      }),
    });
    const ticket = await readJson<UploadTicket>(ticketResponse, '申请 MinerU 上传地址');
    const uploadUrl = ticket.file_urls[0];
    if (!uploadUrl) throw new Error('MinerU 未返回文件上传地址');

    const uploadResponse = await fetcher(resourceEndpoint(uploadUrl), { method: 'PUT', body: file });
    if (!uploadResponse.ok) {
      const detail = await readSafeUploadError(uploadResponse);
      throw new Error(`上传课件失败（HTTP ${uploadResponse.status}）${detail ? `：${detail}` : ''}`);
    }
    emit('queued', 15);

    const startedAt = Date.now();
    let archiveUrl = '';
    while (Date.now() - startedAt <= timeoutMs) {
      const resultResponse = await fetcher(endpoint(config, `extract-results/batch/${ticket.batch_id}`), {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const result = await readJson<BatchResult>(resultResponse, '查询 MinerU 解析进度');
      const item = result.extract_result[0];
      if (!item) throw new Error('MinerU 返回了空的解析任务');
      if (item.state === 'failed') throw new Error(item.err_msg || 'MinerU 解析失败');
      if (item.state === 'done') {
        archiveUrl = item.full_zip_url || '';
        break;
      }
      emit(item.state === 'converting' ? 'normalizing' : item.state === 'running' ? 'parsing' : 'queued', item.state === 'running' ? 45 : 20);
      await wait(pollIntervalMs);
    }
    if (!archiveUrl) throw new Error('MinerU 解析超时，请稍后重试');

    emit('downloading', 88);
    const archiveResponse = await fetcher(resourceEndpoint(archiveUrl));
    if (!archiveResponse.ok) throw new Error(`下载 MinerU 结果失败（HTTP ${archiveResponse.status}）`);
    const parsed = await extractMarkdownFromMinerUZip(await archiveResponse.arrayBuffer());
    emit('completed', 100);
    return { batchId: ticket.batch_id, ...parsed };
  } catch (error) {
    explainNetworkError(error);
  }
}
