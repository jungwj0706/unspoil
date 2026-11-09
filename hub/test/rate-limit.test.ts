import assert from 'node:assert/strict';
import test from 'node:test';
import { completeJson, LlmRateLimited } from '../server/llm.ts';

test('Groq 429 respects Retry-After and suppresses immediate retries from other tabs', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":{"message":"rate limited"}}', {status:429,headers:{'retry-after':'10'}});
  };
  const request = {purpose:'classify' as const,model:'test-only',stable:'JSON',variable:'test',maxTokens:100,items:1};
  try {
    await assert.rejects(completeJson(request), error => error instanceof LlmRateLimited && error.retryAfterMs >= 9000);
    await assert.rejects(completeJson(request), LlmRateLimited);
    assert.equal(calls,1);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=originalKey;
  }
});
