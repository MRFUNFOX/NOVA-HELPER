import { isChallengePage } from './forum.js';

/** Источник HTML страниц форума. В проде — Firecrawl, в тестах — фикстуры. */
export interface Fetcher {
  get(url: string): Promise<string>;
}

export class ChallengeError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Firecrawl REST API v2. Антибот форума («React Labs Security») пропускает не каждый запрос
 * и отдаёт заглушку с кодом 200 — поэтому проверяем содержимое и повторяем с паузой.
 */
export class FirecrawlFetcher implements Fetcher {
  credits = 0;
  constructor(
    private apiKey: string,
    private opts: { retries?: number; waitFor?: number; log?: (s: string) => void } = {},
  ) {}

  async get(url: string): Promise<string> {
    const retries = this.opts.retries ?? 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            url,
            formats: ['rawHtml'],
            onlyMainContent: false,
            maxAge: 0,
            waitFor: (this.opts.waitFor ?? 6000) + attempt * 2000,
            // после двух неудач переключаемся на усиленный прокси
            proxy: attempt >= 2 ? 'enhanced' : 'auto',
            timeout: 60000,
          }),
        });
        if (res.status === 429) { await sleep(15000 * (attempt + 1)); continue; }
        if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { success?: boolean; data?: { rawHtml?: string; metadata?: { creditsUsed?: number; statusCode?: number } } };
        this.credits += json.data?.metadata?.creditsUsed ?? 1;
        const html = json.data?.rawHtml ?? '';
        const status = json.data?.metadata?.statusCode ?? 200;
        if (status >= 400) throw new Error(`Форум вернул ${status} для ${url}`);
        if (!html || isChallengePage(html)) throw new ChallengeError(`Заглушка антибота вместо ${url}`);
        return html;
      } catch (e) {
        lastErr = e;
        this.opts.log?.(`  ↻ ${url}: ${(e as Error).message} (попытка ${attempt + 1}/${retries + 1})`);
        await sleep(3000 * (attempt + 1));
      }
    }
    throw lastErr;
  }
}

/**
 * Бесплатный загрузчик: настоящий Chromium (Playwright) в GitHub Actions.
 * Проверка «Checking your browser» — JS-челлендж: браузер проходит его сам, кука
 * сохраняется в контексте, и дальше страницы открываются без повторной проверки.
 */
export class BrowserFetcher implements Fetcher {
  private browser?: import('playwright-core').Browser;
  private context?: import('playwright-core').BrowserContext;
  failures = 0;

  constructor(private opts: { challengeTimeoutMs?: number; log?: (s: string) => void } = {}) {}

  private async ctx() {
    if (this.context) return this.context;
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 NovaHelperBot/1.0',
    });
    // Картинки, шрифты и медиа для разбора не нужны — экономим время и трафик форума
    await this.context.route('**/*', (route) => {
      const t = route.request().resourceType();
      return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
    });
    return this.context;
  }

  async get(url: string): Promise<string> {
    let lastErr: unknown;
    // Сбой одной загрузки (переход в момент проверки, таймаут) не должен ронять весь сбор
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.once(url);
      } catch (e) {
        lastErr = e;
        this.opts.log?.(`  ↻ браузер, попытка ${attempt}/3: ${(e as Error).message.split('\n')[0]}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    this.failures++;
    throw lastErr;
  }

  private async once(url: string): Promise<string> {
    const context = await this.ctx();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const deadline = Date.now() + (this.opts.challengeTimeoutMs ?? 25000);
      while (Date.now() < deadline) {
        let html: string;
        try {
          html = await page.content();
        } catch {
          // Проверка форума как раз перенаправляет страницу — дождаться, пока она загрузится
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          continue;
        }
        if (!isChallengePage(html) && /class="p-body|<rss|<\?xml/.test(html)) return html;
        await page.waitForTimeout(1000);
      }
      throw new ChallengeError(`Браузер не прошёл проверку форума: ${url}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    await this.browser?.close();
  }
}

/**
 * Сначала бесплатный браузер, при неудаче — Firecrawl. Если браузер подряд проваливает
 * несколько страниц, остаток прогона идёт сразу через Firecrawl, чтобы не терять время.
 */
export class ChainFetcher implements Fetcher {
  private browserDisabled = false;
  private streak = 0;
  usedFallback = 0;

  constructor(private primary: BrowserFetcher | undefined, private fallback: FirecrawlFetcher | undefined, private log: (s: string) => void = () => {}) {}

  async get(url: string): Promise<string> {
    if (this.primary && !this.browserDisabled) {
      try {
        const html = await this.primary.get(url);
        this.streak = 0;
        return html;
      } catch (e) {
        this.streak++;
        this.log(`  ↻ браузер: ${(e as Error).message}`);
        if (this.streak >= 3) {
          this.browserDisabled = true;
          this.log('  ⚠ браузер трижды подряд не прошёл защиту — дальше через Firecrawl');
        }
        if (!this.fallback) throw e;
      }
    }
    if (!this.fallback) throw new Error('Нет доступного загрузчика');
    this.usedFallback++;
    return this.fallback.get(url);
  }
}

/** Отдаёт заранее сохранённые страницы — для тестов и офлайн-сборки. */
export class FixtureFetcher implements Fetcher {
  constructor(private pages: Map<string, string>) {}
  async get(url: string): Promise<string> {
    const html = this.pages.get(url) ?? this.pages.get(url.replace(/\/$/, ''));
    if (html === undefined) throw new Error(`Нет фикстуры для ${url}`);
    return html;
  }
}
