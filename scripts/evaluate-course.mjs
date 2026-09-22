// Real API evaluation. Credentials and course artifacts stay in ignored .uploads/.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { createServer } from 'vite';
const [pdf, label = 'baseline', knowledgeRun] = process.argv.slice(2);
if (!pdf || !/^[\w-]+$/.test(label) || (knowledgeRun && !/^[\w-]+$/.test(knowledgeRun))) throw new Error('Usage: node scripts/evaluate-course.mjs <pdf> <run-label>');
const root = resolve('.uploads/evaluation');
const dir = resolve(root, label);
await mkdir(dir, { recursive: true });
const credentials = JSON.parse(await readFile(resolve(root, 'credentials.json'), 'utf8'));
const config = { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: credentials.deepseek };
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
const port = Number(process.env.EVAL_PORT || 5199);
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, watch: null }, appType: 'custom' });
await server.listen();
const load = path => server.ssrLoadModule(`/src/lib/${path}.ts`);
const save = (name, value) => writeFile(resolve(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const sourceHash = createHash('sha256').update(await readFile(pdf)).digest('hex');
const sourceCache = resolve(root, `${sourceHash}.md`);
const started = Date.now();
const stages = [];
const mark = stage => { stages.push({ stage, elapsedMs: Date.now() - started }); console.log(stage); };
const usage = await load('model-usage');
const nativeFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  const time = Date.now();
  const response = await nativeFetch(url, options);
  if (String(url).includes('api.deepseek.com')) {
    const body = await response.clone().json().catch(() => ({}));
    requests.push({ status: response.status, durationMs: Date.now() - time, usage: body.usage, finishReason: body.choices?.[0]?.finish_reason });
    await save('requests.json', requests);
  }
  return response;
};
try {
  let markdown;
  try { markdown = await readFile(sourceCache, 'utf8'); mark('mineru-cache'); }
  catch {
    const { runMinerUParse } = await load('mineru-client');
    const result = await runMinerUParse(new File([await readFile(pdf)], basename(pdf), { type: 'application/pdf' }), {
      endpoint: 'https://mineru.net/api/v4', apiKey: credentials.mineru, modelVersion: 'vlm', language: 'en', enableFormula: true, enableTable: true,
    }, { onStatus: mark, fetcher: (url, options) => {
      return nativeFetch(new URL(String(url), `http://127.0.0.1:${port}`), { ...options, signal: AbortSignal.timeout(120000) });
    }});
    markdown = result.markdown;
    await writeFile(sourceCache, markdown);
  }
  mark('knowledge-start');
  const { runKnowledgePipeline } = await load('knowledge-pipeline-v2');
  const result = knowledgeRun ? JSON.parse(await readFile(resolve(root, knowledgeRun, 'knowledge.json'), 'utf8')) : await runKnowledgePipeline(config, [{ markdown, title: basename(pdf) }], 'evaluation-lecture2', {
    onStatusChange: mark, onTopicProgress: (n,total) => mark(`topic ${n}/${total}`), onNoteProgress: (n,total) => mark(`card ${n}/${total}`),
  });
  await save('knowledge.json', result);
  if (!result.knowledgeCards.length) throw new Error(result.errors.join('; ') || 'No knowledge cards generated');
  const { runMasterNoteGeneration } = await load('master-note-generator');
  mark('master-note-start');
  const notes = await runMasterNoteGeneration(config, {
    courseId: 'evaluation-lecture2', title: basename(pdf), topics: result.topics, topicRelations: result.topicRelations,
    orderedTopicIds: result.courseLearningPath.orderedTopicIds, knowledgeCards: result.knowledgeCards,
    glossary: result.glossary, formulaIndex: result.formulaCards, terminology: {}, symbols: {},
    structureVersion: result.versions.topicStructure, narrativePaths: result.narrativePaths, teachingRelations: result.teachingRelations,
  }, { onTopicSynthesis: (_,n,total) => mark(`synthesis ${n}/${total}`), onChapter: (_,n,total) => mark(`chapter ${n}/${total}`) });
  await save('notes.json', notes);
  await save('notes.md', notes.masterNote.markdown);
  mark('completed');
} catch (error) {
  await save('error.txt', String(error));
  console.error(String(error)); process.exitCode = 1;
} finally {
  await save('metrics.json', { sourceHash, knowledgeRun, elapsedMs: Date.now() - started, stages, requests, totals: requests.reduce((sum, r) => ({ promptTokens: sum.promptTokens + (r.usage?.prompt_tokens ?? 0), completionTokens: sum.completionTokens + (r.usage?.completion_tokens ?? 0), totalTokens: sum.totalTokens + (r.usage?.total_tokens ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), usage: usage.getUsageRecords() });
  await server.close();
}
