import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
for (const label of process.argv.slice(2)) {
  if (!/^[\w-]+$/.test(label)) throw new Error('Invalid run label');
  const dir = resolve('.uploads/evaluation', label);
  const read = name => readFile(resolve(dir, name), 'utf8').then(JSON.parse);
  const [metrics, knowledge, notes] = await Promise.all([read('metrics.json'), read('knowledge.json'), read('notes.json')]);
  const start = metrics.stages.find(s => s.stage === 'master-note-start')?.elapsedMs ?? 0;
  const requests = metrics.requests;
  const count = items => items.reduce((sum, item) => ({ ...sum, [item.status]: (sum[item.status] ?? 0) + 1 }), {});
  const tokens = items => items.reduce((sum, item) => sum + (item.usage?.total_tokens ?? 0), 0);
  // usage.taskType describes application calls; requests is the provider billing source.
  const noteUsage = metrics.usage.filter(item => item.promptVersion.startsWith('master-note-'));
  const firstNote = noteUsage[0];
  const noteStartIndex = firstNote ? requests.findIndex(r =>
    r.usage?.prompt_tokens === firstNote.promptTokens && r.usage?.completion_tokens === firstNote.completionTokens
  ) : -1;
  console.log(JSON.stringify({
    label, elapsedSeconds: metrics.elapsedMs / 1000, noteSeconds: (metrics.elapsedMs - start) / 1000,
    requests: requests.length, tokens: tokens(requests), unknownUsageResponses: requests.filter(r => !r.usage).length,
    noteTokens: requests.some(r => r.phase) ? tokens(requests.filter(r => r.phase === 'notes')) : noteStartIndex >= 0 ? tokens(requests.slice(noteStartIndex)) : null,
    truncatedResponses: requests.filter(r => r.finishReason === 'length').length,
    topics: knowledge.topics.length, cards: count(knowledge.knowledgeCards),
    sourceBlockCoverage: knowledge.validation.coverage.coverageRate,
    syntheses: count(notes.topicSyntheses), chapters: count(notes.chapterNotes),
    noteCharacters: notes.chapterNotes.reduce((sum, c) => sum + c.markdown.length, 0),
    chaptersTitles: notes.chapterNotes.map(c => c.title),
    warnings: knowledge.warnings.filter(w => /失败|降级|缺失/.test(w)),
  }, null, 2));
}
