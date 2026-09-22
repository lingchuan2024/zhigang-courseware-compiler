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
let phase = 'parse';
const courseId = `evaluation-${sourceHash.slice(0, 12)}`;
globalThis.fetch = async (url, options) => {
  const time = Date.now();
  let response;
  try { response = await nativeFetch(url, options); }
  catch (error) {
    if (String(url).includes('api.deepseek.com')) {
      requests.push({ phase, status: 0, durationMs: Date.now() - time, error: error instanceof Error ? error.message : 'Network failure' });
      await save('requests.json', requests);
    }
    throw error;
  }
  if (String(url).includes('api.deepseek.com')) {
    const body = await response.clone().json().catch(() => ({}));
    requests.push({ phase, status: response.status, durationMs: Date.now() - time, usage: body.usage, finishReason: body.choices?.[0]?.finish_reason });
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
      endpoint: 'https://mineru.net/api/v4', apiKey: credentials.mineru, modelVersion: 'vlm', language: process.env.EVAL_LANGUAGE || 'ch', enableFormula: true, enableTable: true,
    }, { onStatus: mark, fetcher: (url, options) => {
      return nativeFetch(new URL(String(url), `http://127.0.0.1:${port}`), { ...options, signal: AbortSignal.timeout(120000) });
    }});
    markdown = result.markdown;
    await writeFile(sourceCache, markdown);
  }
  phase = 'knowledge';
  mark('knowledge-start');
  if (knowledgeRun) {
    const previous = JSON.parse(await readFile(resolve(root, knowledgeRun, 'metrics.json'), 'utf8'));
    if (previous.sourceHash !== sourceHash) throw new Error('Cannot reuse knowledge from a different source PDF');
  }
  const { runKnowledgePipeline } = await load('knowledge-pipeline-v2');
  const result = knowledgeRun ? JSON.parse(await readFile(resolve(root, knowledgeRun, 'knowledge.json'), 'utf8')) : await runKnowledgePipeline(config, [{ markdown, title: basename(pdf) }], courseId, {
    onStatusChange: mark, onTopicProgress: (n,total) => mark(`topic ${n}/${total}`), onNoteProgress: (n,total) => mark(`card ${n}/${total}`),
  });
  if (process.env.EVAL_RECHECK_CARDS === '1') {
    const { findPythonCodeIssues } = await load('python-code-quality');
    const damaged = result.knowledgeCards.filter(card => findPythonCodeIssues(card.detailedNote).length);
    if (damaged.length) {
      mark(`repair-cards ${damaged.length}`);
      const { enrichKnowledgeCards } = await load('card-enrichment');
      const repaired = await enrichKnowledgeCards(config, damaged, result.topics, result.teachingBlocks, result.teachingRelations, result.allBlocks);
      if (repaired.failedCardIds.length) throw new Error('Card repair failed; original run remains unchanged');
      const replacements = new Map(repaired.cards.map(card => [card.id, card]));
      result.knowledgeCards = result.knowledgeCards.map(card => replacements.get(card.id) ?? card);
      result.versions.cards++;
    }
  }
  await save('knowledge.json', result);
  if (!result.knowledgeCards.length) throw new Error(result.errors.join('; ') || 'No knowledge cards generated');
  const { runMasterNoteGeneration } = await load('master-note-generator');
  phase = 'notes';
  mark('master-note-start');
  let notes;
  if (process.env.EVAL_RETRY_CHAPTERS === '1') {
    if (!knowledgeRun) throw new Error('Chapter retry requires a previous run');
    notes = JSON.parse(await readFile(resolve(root, knowledgeRun, 'notes.json'), 'utf8'));
    const { regenerateChapterNote } = await load('master-note-generator');
    for (let i = 0; i < notes.chapterNotes.length; i++) {
      const chapter = notes.chapterNotes[i];
      if (chapter.status === 'completed') continue;
      mark(`retry-chapter ${i + 1}/${notes.chapterNotes.length}`);
      notes.chapterNotes[i] = await regenerateChapterNote(config, {
        plan: notes.chapterPlan.find(plan => plan.id === chapter.id),
        syntheses: notes.topicSyntheses.filter(synthesis => chapter.topicIds.includes(synthesis.topicId)),
        knowledgeCards: result.knowledgeCards,
        previousChapterSummary: notes.chapterNotes[i - 1]?.markdown.slice(0, 800) || '',
        terminology: {}, symbols: {}, previousRetryCount: chapter.retryCount || 0,
      });
    }
    const { assembleCourseMasterNote } = await load('course-master-note');
    notes.masterNote = assembleCourseMasterNote({ courseId, title: basename(pdf), outline: notes.chapterPlan, chapterNotes: notes.chapterNotes, knowledgeCards: result.knowledgeCards, glossary: result.glossary, formulaIndex: result.formulaCards, structureVersion: result.versions.topicStructure });
  } else notes = await runMasterNoteGeneration(config, {
    courseId: courseId, title: basename(pdf), topics: result.topics, topicRelations: result.topicRelations,
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
  await save('metrics.json', { sourceHash, sourceName: basename(pdf), knowledgeRun, retryChapters: process.env.EVAL_RETRY_CHAPTERS === '1', recheckCards: process.env.EVAL_RECHECK_CARDS === '1', language: process.env.EVAL_LANGUAGE || 'ch', elapsedMs: Date.now() - started, stages, requests, totals: requests.reduce((sum, r) => ({ promptTokens: sum.promptTokens + (r.usage?.prompt_tokens ?? 0), completionTokens: sum.completionTokens + (r.usage?.completion_tokens ?? 0), totalTokens: sum.totalTokens + (r.usage?.total_tokens ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 }), usage: usage.getUsageRecords() });
  await server.close();
}
