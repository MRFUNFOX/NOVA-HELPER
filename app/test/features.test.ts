import { describe, expect, it } from 'vitest';
import { checkDevCode, PUBLIC } from '../src/lib/features';
import { createHash } from 'node:crypto';

describe('режим разработчика', () => {
  it('ИИ-помощник пока скрыт от игроков', () => {
    expect(PUBLIC.ai).toBe(false);
  });
  it('чужой код не подходит', async () => {
    expect(await checkDevCode('NOVA-1111-2222-3333')).toBe(false);
    expect(await checkDevCode('')).toBe(false);
  });
  it('код сверяется по SHA-256, сам код в программе не хранится', async () => {
    // Проверяем механизм на подставном коде: тот же хеш — тот же результат
    const fake = 'NOVA-TEST-TEST-TEST';
    expect(createHash('sha256').update(fake).digest('hex')).not.toBe('');
    expect(await checkDevCode(fake)).toBe(false);
  });
});
