import { describe, expect, it } from 'vitest';
import { ChainFetcher, ChallengeError, type BrowserFetcher, type FirecrawlFetcher } from '../src/fetcher.js';

const fake = <T>(impl: (url: string) => Promise<string>) => ({ get: impl }) as unknown as T;

describe('цепочка загрузчиков', () => {
  it('берёт страницу браузером, а при заглушке уходит в Firecrawl', async () => {
    const browser = fake<BrowserFetcher>(async (u) => {
      if (u.includes('bad')) throw new ChallengeError('заглушка');
      return 'browser';
    });
    const firecrawl = fake<FirecrawlFetcher>(async () => 'firecrawl');
    const chain = new ChainFetcher(browser, firecrawl);
    expect(await chain.get('https://x/ok')).toBe('browser');
    expect(await chain.get('https://x/bad')).toBe('firecrawl');
    expect(chain.usedFallback).toBe(1);
  });

  it('после трёх провалов подряд перестаёт тратить время на браузер', async () => {
    let browserCalls = 0;
    const browser = fake<BrowserFetcher>(async () => { browserCalls++; throw new ChallengeError('заглушка'); });
    const chain = new ChainFetcher(browser, fake<FirecrawlFetcher>(async () => 'firecrawl'));
    for (let i = 0; i < 6; i++) await chain.get(`https://x/${i}`);
    expect(browserCalls).toBe(3);
    expect(chain.usedFallback).toBe(6);
  });

  it('без запасного загрузчика ошибка браузера не проглатывается', async () => {
    const chain = new ChainFetcher(fake<BrowserFetcher>(async () => { throw new ChallengeError('заглушка'); }), undefined);
    await expect(chain.get('https://x')).rejects.toThrow('заглушка');
  });
});
