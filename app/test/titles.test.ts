import { describe, expect, it } from 'vitest';
import { lawGroup, shortTitle } from '../src/lib/state.svelte';

describe('короткие названия в меню', () => {
  it('законы и кодексы', () => {
    expect(shortTitle('Уголовный Кодекс Штата San-Andreas')).toBe('Уголовный кодекс');
    expect(shortTitle('Кодекс штата San-Andreas «О судопроизводстве и статусе судей»')).toBe('Кодекс «О судопроизводстве и статусе судей»');
    expect(shortTitle('Закон штата San-Andreas О ЗАКРЫТЫХ, ОХРАНЯЕМЫХ И ОСОБО ОХРАНЯЕМЫХ ТЕРРИТОРИЯХ ШТАТА San-Andreas'))
      .toBe('Закон о закрытых, охраняемых и особо охраняемых территориях');
    expect(shortTitle('Закон «О Сенате»')).toBe('О Сенате');
    expect(shortTitle('Закон о статусе Los Santos Police Department [LSPD]')).toBe('Закон о статусе Los Santos Police Department [LSPD]');
  });
  it('правила проекта не ломаются', () => {
    expect(shortTitle('Правила мероприятия "Cбора общих кладов"')).toBe('Сбора общих кладов');
    expect(shortTitle('Общие правила проекта')).toBe('Общие правила проекта');
  });
  it('группы законов', () => {
    expect(lawGroup('Конституция Штата San-Andreas')).toBe('Конституция');
    expect(lawGroup('Уголовный Кодекс Штата San-Andreas')).toBe('Кодексы');
    expect(lawGroup('Закон о статусе Federal Investigation Bureau [FIB]')).toBe('Госструктуры');
    expect(lawGroup('Закон об охоте и о сохранении охотничьих ресурсов')).toBe('Законы');
  });
});
