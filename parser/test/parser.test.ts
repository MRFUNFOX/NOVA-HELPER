import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { htmlToLines } from '../src/text.js';
import { parseStructure } from '../src/structure.js';
import { classifyPunishment, splitPipePunishments } from '../src/punishments.js';
import { isChallengePage, parseNodeList, parseThreadList, parseThreadPage, slugify } from '../src/forum.js';
import { applyAmendments } from '../src/amendments.js';
import { buildDocument } from '../src/document.js';
import type { Amendment, RuleNode } from '../src/types.js';

const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
const flat = (ns: RuleNode[], out: RuleNode[] = []) => { for (const n of ns) { out.push(n); flat(n.children, out); } return out; };
const NOW = new Date('2026-11-09T18:00:00Z');

describe('Уголовный кодекс (Horizon)', () => {
  const body = fx('horizon_uk_411152.html').split('<div class="bbWrapper">')[1]!;
  const roots = parseStructure(htmlToLines(body), { docId: 'uk', title: 'Уголовный Кодекс Штата San-Andreas' });
  const all = flat(roots);

  it('строит иерархию часть → раздел → глава → статья → ч.', () => {
    const a61 = all.find((n) => n.kind === 'article' && n.number === '6.1')!;
    expect(a61.text).toBe('Нанесение телесных повреждений');
    expect(a61.jurisdiction).toBe('Федеральная/Региональная');
    expect(a61.children.map((c) => c.number)).toEqual(['1', '2', '3']);
    const chapter = all.find((n) => n.kind === 'chapter' && n.number === 'VI')!;
    expect(chapter.children.some((c) => c.number === '6.1')).toBe(true);
  });

  it('извлекает звёзды розыска и наказание каждой части', () => {
    const part = all.find((n) => n.id === 'uk#a6.1/c2')!;
    expect(part.wanted).toEqual([4, 4]);
    expect(part.punishments[0]!.raw).toBe('4 года лишения свободы.');
    expect(part.punishments[0]!.kinds).toContain('prison');
    const slander = all.find((n) => n.id === 'uk#a7.4/c1')!;
    expect(slander.wanted).toEqual([2, 3]);
  });

  it('не теряет ни одной строки «Наказание:» (в исходнике их 141)', () => {
    expect(all.reduce((a, n) => a + n.punishments.length, 0)).toBe(141);
    expect(all.some((n) => /наказани[ея]\s*:/i.test(n.text))).toBe(false);
  });

  it('ID не зависят от глав, дубль номера на форуме получает суффикс', () => {
    expect(all.some((n) => n.id === 'uk#a6.3')).toBe(true);
    expect(all.filter((n) => n.number === '16.15').map((n) => n.id)).toEqual(['uk#a16.15', 'uk#a16.15~2']);
  });
});

describe('Уголовный кодекс (Mirage) — другой формат', () => {
  const body = fx('mirage_uk_410588.html').split('<div class="bbWrapper">')[1]!;
  const res = buildDocument([{ title: 'Уголовный Кодекс Штата San-Andreas', locked: true, lastPage: 1,
    posts: [{ id: '1', url: '', author: 'A', isStaff: true, bodyHtml: `<div class="bbWrapper">${body}` }] }],
    { scope: 'server', serverId: 'mirage', category: 'НПА', threadId: 410588, sourceUrl: '', listTitle: '' }, NOW);
  const all = flat(res.doc.children);
  const p = (num: string) => all.find((n) => n.number === num)!;

  it('«(R)», «Приоритет розыска», «Наказывается…» и «Комментарий:» со списком', () => {
    expect(p('8.2')).toMatchObject({ jurisdiction: 'Региональная', wanted: [3, 3] });
    expect(p('8.2').punishments[0]!.kinds).toEqual(['prison', 'fine']);
    expect(p('8.2').annotations[0]!.type).toBe('explanation');
    expect(p('8.2').annotations[0]!.text).toContain('- Территория Форта Занкудо.');
    expect(p('8.2').text).not.toContain('Территория');
  });

  it('жирные подпункты «1. …» не превращаются в разделы и не забирают наказание', () => {
    expect(p('8.7').text).toContain('1. Участие в преступном объединении');
    expect(p('8.7').punishments).toHaveLength(1);
    expect(res.doc.stats.punishments).toBe(92);
  });

  it('оглавление и картинки-разделители не создают пустых узлов', () => {
    expect(all.filter((n) => n.kind === 'chapter').map((n) => n.number)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    expect(all.some((n) => n.kind === 'heading' && !n.children.length && !n.text)).toBe(false);
    expect(res.doc.stats.images).toBe(0);
  });
});

describe('Административный кодекс (Mirage) — штраф внутри предложения', () => {
  // Фрагмент реальной разметки темы 410587
  const red = (s: string) => `<b><span style="color: rgb(209, 72, 65)">${s}</span></b>`;
  const num = (s: string) => `<b><span style="color: rgb(41, 105, 176)">${s} </span></b>`;
  const html = `<div class="bbWrapper">
    <b><span style="font-size: 22px">Административный Кодекс Штата San Andreas</span></b><br>
    <b><span style="font-size: 18px">1 Статья. Общие положения</span></b><br>
    ${num('1.1 Административный кодекс')} — нормативный акт.<br>
    <b><span style="font-size: 18px">2 Статья. Правонарушения в сфере охраны общественного порядка</span></b><br>
    ${num('2.1')}<b>Оскорбления.</b><br>
    Оскорбление чести, достоинства или деловой репутации гражданских лиц влечет за собой наложение административного штрафа в размере ${red('от 5.000$.')}<br><br>
    ${num('2.2')}<b>Повреждение культурных сооружений.</b><br>
    Незаконное повреждение культурного сооружения влечет за собой наложение административного штрафа в размере ${red('4.000$')}, а также ${red('возмещением ущерба')}, нанесенного сооружению.<br><br>
    <b><span style="font-size: 18px">4 Статья. Правонарушения в сфере трудовых отношений</span></b><br>
    ${num('4.1')}<b>Дискриминация в сфере труда</b> влечет за собой наложение административного штрафа на работодателя в размере ${red('10.000$.')}<br>
    <b><span style="font-size: 18px">5 Статья. Дисциплинарные правонарушения государственных служащих</span></b><br>
    ${num('5.2')}<b>Халатное отношение государственным служащим</b> влечет за собой наложение дисциплинарного взыскания в виде штрафа ${red('в размере 10.000$ в доход бюджета Штата, а также объявление выговора на 7 дней.')}<br>
    ${red('Примечание:')} Под халатностью понимается неисполнение обязанностей.<br>
    <ul><li>Отказ снять маску влечет уголовную ответственность по статье 10.12 Уголовного кодекса.</li></ul>
  </div>`;
  const all = flat(parseStructure(htmlToLines(html), { docId: 'ak', title: 'Административный Кодекс Штата San Andreas' }));
  const p = (n: string) => all.find((x) => x.number === n)!;

  it('находит штраф в предложении и не ломает сам текст', () => {
    expect(p('2.1').punishments[0]!.raw).toBe('Наложение административного штрафа в размере от 5.000$.');
    expect(p('2.1').text).toContain('влечет за собой наложение административного штрафа');
    expect(p('4.1').punishments[0]!.kinds).toEqual(['fine']);
    expect(p('5.2').punishments[0]!.kinds).toEqual(['fine', 'reprimand']);
    expect(p('5.2').annotations[0]!.type).toBe('note');
  });

  it('«2 Статья. …» — группа пунктов, «влечет уголовную ответственность» — не штраф', () => {
    const group = all.find((n) => n.kind === 'chapter' && n.number === '2')!;
    expect(group).toMatchObject({ label: 'Статья', text: 'Правонарушения в сфере охраны общественного порядка' });
    expect(group.children.map((c) => c.number)).toEqual(['2.1', '2.2']);
    expect(all.reduce((a, n) => a + n.punishments.length, 0)).toBe(4);
  });
});

describe('Дорожный кодекс (Mirage) — «Санкции водителю:»', () => {
  const html = `<div class="bbWrapper">
    <b>Статья 3. Обязанности водителя за рулем транспортного средства</b><br>
    <b>3.3</b> Водитель обязан остановиться по первому требованию сотрудника правоохранительных органов.<br>
    <b>Санкции водителю:</b> штраф 5.000$ и/или уголовная статья согласно законодательству.<br>
    <b>3.3.1</b> Водитель остановился после второго требования: штраф 10.000$.<br>
    <b>3.3.3</b> Водитель скрылся/ушёл от погони/преследования: штраф 15.000$ на владельца авто.<br>
    <b>Исключение:</b> если данное авто было угнано.<br>
    <b>5.4</b> Нарушение правила парковки транспортного средства.<br>
    <b>Парковка транспортного средства запрещена:</b><ul><li>На пешеходном переходе.</li><li>На шоссе. Примечание: на обочине парковка не запрещена.</li></ul>
    <b>Санкции водителю:</b> штраф 8.000$ и, по усмотрению офицера, эвакуация транспортного средства.<br>
    <b>6.1</b> Пешеход обязан двигаться по тротуару или обочине.<br>
    <b>Санкции пешеходу:</b> штраф 2.500$.
  </div>`;
  const all = flat(parseStructure(htmlToLines(html), { docId: 'dk' }));
  const p = (n: string) => all.find((x) => x.number === n)!;

  it('санкции с адресатом и штраф после двоеточия в подпункте', () => {
    expect(p('3.3').punishments.map((x) => x.raw)).toEqual(['Водителю: штраф 5.000$ и/или уголовная статья согласно законодательству.']);
    expect(p('3.3.1').punishments[0]!.raw).toBe('Штраф 10.000$.');
    expect(p('3.3.3').annotations[0]).toMatchObject({ type: 'exception', text: 'если данное авто было угнано.' });
    expect(p('6.1').punishments[0]!.raw).toBe('Пешеходу: штраф 2.500$.');
  });

  it('список запретов остаётся текстом пункта, наказание у пункта одно', () => {
    expect(p('5.4').text).toContain('- На пешеходном переходе.');
    expect(p('5.4').punishments).toHaveLength(1);
    expect(p('5.4').punishments[0]!.kinds).toContain('fine');
  });
});

describe('Общие правила проекта', () => {
  const page = parseThreadPage(fx('raw_thread_406242.html'));
  const roots = parseStructure(htmlToLines(page.posts[0]!.bodyHtml), { docId: 'r', title: page.title });
  const all = flat(roots);
  const p = (num: string) => all.find((n) => n.number === num)!;

  it('пункты вкладываются по номеру: 2.7.1 внутри 2.7, подзаголовки внутри раздела', () => {
    expect(p('2.7').children.map((c) => c.number)).toEqual(['2.7.1']);
    const s2 = all.find((n) => n.kind === 'section' && n.number === '2')!;
    expect(s2.children.map((c) => c.text)).toEqual(['Игровые аккаунты', 'Игровое имущество', 'Игровые никнеймы']);
  });

  it('наказание после « | » отделяется от текста, перманентный бан помечается', () => {
    expect(p('2.3').text).toBe('Запрещена продажа / обмен игровых аккаунтов, а также передача своего аккаунта 3-м лицам.');
    expect(p('2.3').punishments[0]).toMatchObject({ severe: true });
    expect(p('2.3').punishments[0]!.kinds).toContain('permaban');
    expect(p('3.2').punishments.at(-1)!.severe).toBe(true); // «BAN от 1 до 30 дней | Навсегда.»
  });

  it('примечания и исключения привязываются к своему пункту', () => {
    expect(p('2.8.1').annotations.map((a) => a.type)).toEqual(['clarification', 'exception']);
    expect(p('5.1').annotations[0]).toMatchObject({ type: 'exception' });
    expect(p('5.1').annotations[0]!.text).toContain('- семейные мероприятия;');
  });

  it('баннеры-разделители не попадают в картинки', () => {
    expect(all.every((n) => n.images.length === 0)).toBe(true);
  });
});

describe('Поправки «Было / Стало»', () => {
  const page = parseThreadPage(fx('raw_thread_406242.html'));
  const [main, ...rest] = page.posts;
  const run = (now = NOW) => {
    const roots = parseStructure(htmlToLines(main!.bodyHtml), { docId: 'r', title: page.title });
    const loose: Amendment[] = [];
    const report = applyAmendments(roots, main!, rest, now, loose);
    return { all: flat(roots), report };
  };

  it('отличает применённые поправки от пунктов, которые на форуме остались старыми', () => {
    const { report, all } = run();
    expect(report.applied).toBe(12);
    expect(report.unmerged.sort()).toEqual(['2.1', '4.15', '7.6']);
    expect(report.conflicts).toEqual([]);
    const p21 = all.find((n) => n.number === '2.1')!;
    expect(p21.amendments[0]!.newText).toContain('Допускается наличие максимум 1 аккаунта');
    expect(p21.amendments[0]!.effectiveAt).toBe('2026-10-19T01:00:00.000Z'); // 04:00 МСК
  });

  it('если основной текст не трогали после поправки — показывает редакцию из поправки', () => {
    const untouched = { ...main!, editedAt: undefined };
    const roots = parseStructure(htmlToLines(main!.bodyHtml), { docId: 'r', title: page.title });
    const report = applyAmendments(roots, untouched, rest, NOW, []);
    expect(report.overlaid).toBe(3);
    const p21 = flat(roots).find((n) => n.number === '2.1')!;
    expect(p21.text).toContain('Допускается наличие максимум 1 аккаунта');
    expect(p21.amendments[0]!.status).toBe('overlaid');
  });

  it('поправка, которая ещё не вступила в силу, помечается как ожидающая', () => {
    const { report } = run(new Date('2026-11-07T23:30:00Z')); // до 08.11 04:00 МСК
    expect(report.pending).toBeGreaterThanOrEqual(2); // 4.15 и 7.7
  });
});

describe('Другие форматы законов (Гражданский, Трудовой кодекс, закон о СМИ)', () => {
  const html = `<div class="bbWrapper">
    <div style="text-align: center"><b><span style="color: rgb(44, 130, 201)">Гражданский кодекс</span></b></div><br>
    <h3 class="bbHeading"><span style="color: rgb(44, 130, 201)">Раздел I. Общие положения</span></h3>
    <h3 class="bbHeading"><span style="color: rgb(44, 130, 201)">Подраздел 1. Основные положения</span></h3><br>
    <span style="color: rgb(44, 130, 201)">Статья 1.</span> Основные начала гражданского законодательства<br>
    1. Гражданское законодательство основывается на признании равенства участников.<br>
    2. Граждане свободны в установлении своих прав.<br>
    <h2 class="bbHeading"><span style="color: rgb(84, 172, 210)">Часть II. Особые положения</span></h2>
    <h3 class="bbHeading"><span style="color: rgb(84, 172, 210)">Статья 2. Свобода массовой информации</span></h3>
    <b><span style="color: rgb(84, 172, 210)">ч. 1.</span></b> Поиск и распространение информации не ограничиваются.<br>
    <span style="color: rgb(44, 130, 201)">ч.2</span> Исключения устанавливаются законом.
  </div>`;
  const all = flat(parseStructure(htmlToLines(html), { docId: 'gk', title: 'Гражданский кодекс Штата San Andreas' }));

  it('«1. …» внутри статьи остаётся абзацем статьи, а не новым разделом', () => {
    const a1 = all.find((n) => n.kind === 'article' && n.number === '1')!;
    expect(a1.text).toContain('1. Гражданское законодательство основывается');
    expect(a1.text).toContain('2. Граждане свободны');
    expect(all.filter((n) => n.kind === 'section').map((n) => `${n.label} ${n.number}`)).toEqual(['Раздел I', 'Подраздел 1', 'Часть II']);
  });

  it('«Часть II» поднимается на верхний уровень, «ч.2» без пробела — часть статьи', () => {
    const a2 = all.find((n) => n.kind === 'article' && n.number === '2')!;
    expect(a2.text).toBe('Свобода массовой информации');
    expect(a2.children.map((c) => c.number)).toEqual(['1', '2']);
    expect(all.find((n) => n.label === 'Часть')!.id).toBe('gk#ptII');
  });
});

describe('Наказания', () => {
  it('распознаёт виды наказаний и не путает «бан» с «банда»/«банк»', () => {
    expect(classifyPunishment('JAIL от 60 до 120 минут или WARN.').kinds).toEqual(['warn', 'jail']);
    expect(classifyPunishment('Черный список проекта').severe).toBe(true);
    expect(splitPipePunishments('Запрещено грабить банк | BAN до 3 дней').text).toBe('Запрещено грабить банк');
    expect(splitPipePunishments('Члены банды | лидеры банды').punishments).toEqual([]);
  });
});

describe('Страницы форума', () => {
  it('находит серверы в блоке категории 21 и не путает их с другими разделами', () => {
    const servers = parseNodeList(fx('raw_category_21.html'), '.block--category21');
    expect(servers.map((s) => s.title)).toEqual(['Сервер | New Era', 'Сервер | Mirage', 'Сервер | Horizon']);
    expect(servers[1]!.url).toBe('https://forum.nova-rp.com/gta5/');
    expect(slugify('New Era')).toBe('new-era');
  });

  it('читает список тем со статусами и номером последней страницы', () => {
    const { threads, lastPage } = parseThreadList(fx('raw_forum_1478.html'));
    expect(threads).toHaveLength(21);
    expect(lastPage).toBe(2);
    expect(threads[0]).toMatchObject({ id: 411159, locked: true, sticky: true });
  });

  it('читает сообщения темы с авторами, админ-статусом и датами', () => {
    const page = parseThreadPage(fx('raw_thread_406242.html'));
    expect(page.locked).toBe(true);
    expect(page.posts).toHaveLength(6);
    expect(page.posts[1]).toMatchObject({ author: 'Deiman', isStaff: true });
    expect(page.posts[0]!.editedAt).toBe('2026-11-08T11:25:39.000Z');
  });

  it('распознаёт заглушку антибота, которая приходит с кодом 200', () => {
    expect(isChallengePage('<title>Checking your browser</title><p>Automated protection</p><b>React Labs</b> Security')).toBe(true);
    expect(isChallengePage(fx('raw_forum_1478.html'))).toBe(false);
  });
});

describe('Сборка документа', () => {
  it('принимает поправки только от администрации или автора темы', () => {
    const page = parseThreadPage(fx('raw_thread_406242.html'));
    const fake = { ...page.posts[1]!, id: '999', author: 'Игрок', isStaff: false, bodyHtml: '<div>Было: 1.1 x Стало: 1.1 Всё разрешено | BAN</div>' };
    const res = buildDocument([{ ...page, posts: [...page.posts, fake] }], {
      scope: 'project', category: 'Общие правила', threadId: 406242, sourceUrl: '', listTitle: '',
    }, NOW);
    const p11 = flat(res.doc.children).find((n) => n.number === '1.1')!;
    expect(p11.text).not.toContain('Всё разрешено');
    expect(p11.amendments).toEqual([]);
  });
});
