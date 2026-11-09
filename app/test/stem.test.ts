import { describe, expect, it } from 'vitest';
import { stem } from '../src/lib/stem';

describe('русский стеммер', () => {
  it('приводит разные формы слова к одной основе', () => {
    const same = (...ws: string[]) => expect(new Set(ws.map(stem)).size).toBe(1);
    same('оскорбление', 'оскорбления', 'оскорблением');
    same('убийство', 'убийства', 'убийству');
    same('аккаунт', 'аккаунта', 'аккаунтов', 'аккаунтами');
    same('транспорт', 'транспорта', 'транспортом');
    same('блокировка', 'блокировки', 'блокировку');
  });
  it('по эталонным примерам Snowball', () => {
    expect(stem('вавиловка')).toBe('вавиловк');
    expect(stem('вагонами')).toBe('вагон');
    expect(stem('важнейшие')).toBe('важн');
    expect(stem('валентность')).toBe('валентн');
  });
  it('латиницу и короткие слова не трогает', () => {
    expect(stem('DM')).toBe('dm');
    expect(stem('дм')).toBe('дм');
  });
});
