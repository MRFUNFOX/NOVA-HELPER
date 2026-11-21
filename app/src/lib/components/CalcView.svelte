<script lang="ts">
  // Калькулятор прибыли: список профилей → профиль (сводка, записи, категории, график) → новая запись.
  // Утверждённый дизайн — прототип «Калькулятор прибыли» в Claude Design. Пока виден только в режиме разработчика.
  import { app } from '../state.svelte';
  import { calc } from '../calc.svelte';
  import {
    CATS, MAX_PROFILES, balanceOf, daysAgo, byCat, byDay, catOf, dateOfAgo, dayMonth, dayName, digits, groupDigits, hhmm, inPeriod,
    money, perDay, recWord, short, signed, totals, val, weekdayFull, weekdayShort, type Kind, type Period, type Profile,
  } from '../calc';

  let { page = false }: { page?: boolean } = $props();

  $effect(() => { calc.start(); });
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 60e3); return () => clearInterval(t); });

  const GREEN = '#6fdc9a', RED = '#ff8a8a';
  const AV = ['#ffc300', '#7aa2ff', '#5ad1c8', '#ff6fae', '#b48cff', '#ff9f5a'];
  const avColor = (p: Profile) => AV[Math.max(0, calc.profiles.indexOf(p)) % AV.length] ?? '#ffc300';
  const tint = (hex: string, a: string) => `background: ${hex}${a}; color: ${hex};`;
  const tone = (n: number) => (n > 0 ? GREEN : n < 0 ? RED : 'var(--text)');

  // ── Профиль ──
  let period = $state<Period>('week');
  let tab = $state<'list' | 'cats' | 'chart'>('list');
  let sel = $state(0);
  const prof = $derived(calc.profile);
  const all = $derived(prof?.entries ?? []);
  const list = $derived(inPeriod(all, period, now));
  const sum = $derived(totals(list));
  const days = $derived(byDay(list, now));
  const PERIODS: [Period, string][] = [['day', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']];
  const WORDS: Record<Period, string> = { day: 'за сегодня', week: 'за 7 дней', month: 'за 30 дней', all: 'за всё время' };

  // ── График ──
  const H = 206;
  const n = $derived(period === 'month' || period === 'all' ? 30 : 7);
  const per = $derived(perDay(all, n, now));
  const maxP = $derived(Math.max(1, ...per.map((p) => Math.max(0, p.net))));
  const maxN = $derived(Math.max(0, ...per.map((p) => Math.max(0, -p.net))));
  const scale = $derived(H / (maxP + maxN));
  const zero = $derived(Math.round(maxP * scale));
  const grid = $derived([
    { v: maxP, y: zero - maxP * scale }, { v: maxP / 2, y: zero - (maxP / 2) * scale }, { v: 0, y: zero },
    ...(maxN > maxP * 0.15 ? [{ v: -maxN, y: zero + maxN * scale }] : []),
  ]);
  const selDay = $derived(per.find((p) => p.ago === sel) ?? per[per.length - 1]!);
  const selTop = $derived(byCat(selDay.items, 'inc')[0]?.cat);
  const withData = $derived(per.filter((p) => p.net !== 0));
  const best = $derived(withData.length ? withData.reduce((a, b) => (b.net > a.net ? b : a)) : null);
  const worst = $derived(withData.length ? withData.reduce((a, b) => (b.net < a.net ? b : a)) : null);
  const avg = $derived(per.reduce((a, p) => a + p.net, 0) / n);

  // ── Новая запись ──
  let adding = $state(false);
  let kind = $state<Kind>('inc');
  let cat = $state('');
  let amount = $state('');
  let note = $state('');
  let when = $state<0 | 1>(0);
  const amt = $derived(digits(amount));
  const recent = $derived.by(() => {
    const seen = new Set<string>(), out: { name: string; cat: string; sum: number; note?: string }[] = [];
    for (const e of all) {
      if (e.k !== kind || out.length >= 3) continue;
      const key = e.cat + e.sum;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: `${e.note || e.cat} · ${money(e.sum)}`, cat: e.cat, sum: e.sum, note: e.note });
    }
    return out;
  });
  function openAdd() { adding = true; amount = ''; note = ''; cat = ''; when = 0; }
  function setKind(k: Kind) { kind = k; cat = ''; }
  function save(more: boolean) {
    if (!amt) return;
    calc.add({ at: when ? now - 86400e3 : Date.now(), k: kind, cat: cat || 'Другое', sum: amt, note });
    app.notify(`${kind === 'inc' ? 'Записал доход' : 'Записал расход'} ${money(amt)}`);
    amount = ''; note = '';
    if (!more) { adding = false; cat = ''; tab = 'list'; }
  }
  function delEntry(id: string) { calc.del(id); app.notify('Запись удалена'); }

  // ── Список профилей ──
  let creating = $state(false);
  let pName = $state('');
  let pStart = $state('');
  let menu = $state('');
  let dlg = $state<{ mode: 'ren' | 'del'; id: string } | null>(null);
  let rName = $state('');
  const startOk = $derived(/\d/.test(pStart));
  const dlgP = $derived(dlg ? calc.profiles.find((p) => p.id === dlg!.id) : undefined);
  const defName = $derived(`Профиль ${calc.profiles.length + 1}`);
  function openCreate() { if (calc.atLimit) return; creating = true; pName = ''; pStart = ''; menu = ''; }
  function create() {
    if (!startOk) return;
    if (calc.create(pName, digits(pStart))) { creating = false; tab = 'list'; sel = 0; app.notify('Профиль создан'); }
  }
  function openProfile(id: string) { calc.open(id); tab = 'list'; sel = 0; menu = ''; }
  function doDelete() {
    if (!dlgP) return;
    const name = dlgP.name;
    calc.remove(dlgP.id); dlg = null;
    app.notify(`Профиль «${name}» удалён`);
  }
  function doRename() { if (dlgP && rName.trim()) { calc.rename(dlgP.id, rName); dlg = null; app.notify('Название сохранено'); } }
  function weekOf(p: Profile) { return p.entries.filter((e) => daysAgo(e.at, now) < 7).reduce((a, e) => a + val(e), 0); }
  function lastOf(p: Profile) {
    if (!p.entries.length) return 'новый';
    const ago = Math.max(0, daysAgo(Math.max(...p.entries.map((e) => e.at)), now));
    return 'последняя ' + (ago === 0 ? 'сегодня' : ago === 1 ? 'вчера' : dayName(ago, now));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (dlg) dlg = null; else if (menu) menu = ''; else if (adding) adding = false; else if (creating && calc.profiles.length) creating = false; else return;
    e.preventDefault(); e.stopPropagation();
  }
  const fmtInput = (e: Event) => groupDigits(digits((e.currentTarget as HTMLInputElement).value));
</script>

{#snippet ico(path: string, size = 18)}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path} /></svg>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="calc" class:page onkeydown={onKey}>
  {#if page}
    <div class="ptitle"><h1>Калькулятор прибыли</h1><span class="xb" title="Функция в разработке: может меняться">Экспериментально</span></div>
  {/if}

  {#if prof}
    <!-- Сводка профиля -->
    <div class="top">
      <div class="row">
        <button class="pbtn" onclick={() => calc.toList()} title="Все профили">
          <span class="av" style={tint(avColor(prof), '26')}>{prof.name.charAt(0).toUpperCase()}</span>
          <span class="n">{prof.name}</span>
          {@render ico('M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7', 14)}
        </button>
        <span class="grow"></span>
        <div class="seg" role="radiogroup" aria-label="Период">
          {#each PERIODS as [id, label] (id)}
            <button class="chip" class:on={period === id} role="radio" aria-checked={period === id} onclick={() => { period = id; sel = 0; }}>{label}</button>
          {/each}
        </div>
      </div>
      <div class="sum">
        <div class="grow">
          <div class="cap">Прибыль {WORDS[period]}</div>
          <div class="net" style="color: {tone(sum.net)}">{signed(sum.net)}</div>
        </div>
        <div class="ie">
          <span>Заработал <b class="g">{money(sum.inc)}</b></span>
          <span>Потратил <b class="r">{money(sum.exp)}</b></span>
        </div>
      </div>
      <div class="bal">
        {@render ico('M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2', 15)}
        <span>Баланс сейчас <b>{money(balanceOf(prof))}</b></span>
        <span class="grow"></span>
        <span>начинали с {money(prof.start)}</span>
      </div>
      <button class="add" onclick={openAdd}>{@render ico('M12 5v14M5 12h14', 16)}Добавить доход или расход</button>
      <div class="tabs" role="tablist">
        {#each [['list', 'Записи'], ['cats', 'По категориям'], ['chart', 'График']] as [id, label] (id)}
          <button class="tab" class:on={tab === id} role="tab" aria-selected={tab === id} onclick={() => (tab = id as typeof tab)}>{label}</button>
        {/each}
      </div>
    </div>

    <div class="scroll">
      {#if !list.length}
        <div class="empty">{all.length ? 'За этот период записей нет.' : 'Записей пока нет. Заработали или потратили — нажмите «Добавить доход или расход», и баланс изменится.'}</div>
      {:else if tab === 'list'}
        {#each days as d (d.ago)}
          {@const tot = d.inc + d.exp || 1}
          <section class="dcard">
            <div class="dhead">
              <b>{dayName(d.ago, now)}</b>
              <small>{d.ago < 2 ? dayMonth(dateOfAgo(d.ago, now)) + ', ' : ''}{weekdayFull(dateOfAgo(d.ago, now))}</small>
              <span class="pill" class:neg={d.net < 0}>{signed(d.net)}</span>
            </div>
            <div class="split">
              {#if d.inc}<span style="flex: {d.inc / tot} 0 0; background: {GREEN};"></span>{/if}
              {#if d.exp}<span style="flex: {d.exp / tot} 0 0; background: {RED};"></span>{/if}
            </div>
            {#each d.items as e (e.id)}
              {@const c = catOf(e.k, e.cat)}
              <div class="rec">
                <span class="ico" style={tint(c.color, '22')}>{@render ico(c.icon)}</span>
                <span class="t"><b>{e.note || e.cat}</b><span>{e.note ? e.cat + ' · ' : ''}{hhmm(e.at)}</span></span>
                <span class="amt" style="color: {e.k === 'inc' ? GREEN : RED}">{e.k === 'inc' ? '+' : '−'}{money(e.sum)}</span>
                <button class="ib del" aria-label="Удалить запись" title="Удалить" onclick={() => delEntry(e.id)}>{@render ico('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', 15)}</button>
              </div>
            {/each}
          </section>
        {/each}
      {:else if tab === 'cats'}
        {#each [['inc', 'Откуда деньги', sum.inc, GREEN], ['exp', 'На что ушли', sum.exp, RED]] as [k, label, total, color] (k)}
          {@const rows = byCat(list, k as Kind)}
          {#if rows.length}
            <div class="sect"><span>{label}</span><span style="color: {color}">{money(total as number)}</span></div>
            {#each rows as r (r.cat)}
              {@const c = catOf(k as Kind, r.cat)}
              <div class="srow">
                <span class="ico sm" style={tint(c.color, '22')}>{@render ico(c.icon, 15)}</span>
                <span>{r.cat}</span>
                <span class="track"><span style="width: {Math.max(3, (r.sum / (rows[0]?.sum || 1)) * 100)}%; background: {c.color};"></span></span>
                <b style="color: {color}">{money(r.sum)}</b>
              </div>
            {/each}
          {/if}
        {/each}
      {:else}
        <div class="chart">
          <div class="chead">
            <b>{selDay.ago === 0 ? 'Сегодня, ' : selDay.ago === 1 ? 'Вчера, ' : ''}{dayMonth(dateOfAgo(selDay.ago, now))}, {weekdayFull(dateOfAgo(selDay.ago, now))}</b>
            <span class="grow"></span>
            <b class="big" style="color: {tone(selDay.net)}">{signed(selDay.net)}</b>
          </div>
          <div class="cline">
            <span>Заработал <b class="g">{money(selDay.inc)}</b></span>
            <span>Потратил <b class="r">{money(selDay.exp)}</b></span>
            <span class="grow right">{selDay.items.length ? (selTop ? `Больше всего: ${selTop}` : '') : 'Записей нет'}</span>
          </div>
          <div class="plot" style="height: {H + 30}px">
            {#each grid as g (g.v)}
              <div class="gl" class:zero={g.v === 0} style="top: {Math.round(g.y)}px"><span>{g.v === 0 ? '0' : short(g.v)}</span></div>
            {/each}
            <div class="cols" style="height: {H + 30}px">
              {#each per as p (p.ago)}
                {@const h = Math.max(p.net ? 3 : 0, Math.round(Math.abs(p.net) * scale))}
                {@const on = p.ago === selDay.ago}
                {@const d = dateOfAgo(p.ago, now)}
                <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                <div class="col" title="{dayName(p.ago, now)}: {signed(p.net)}" onmouseenter={() => (sel = p.ago)} onclick={() => (sel = p.ago)}>
                  <span class="hit" class:on style="height: {H}px"></span>
                  <span class="bar" class:neg={p.net < 0} style="height: {h}px; top: {p.net >= 0 ? zero - h : zero}px; opacity: {on ? 1 : 0.5}; {n === 7 ? 'left: 8px; right: 8px;' : ''}"></span>
                  <span class="lbl" class:on style="top: {H + 10}px">{n === 7 ? (p.ago === 0 ? 'сег.' : weekdayShort(d)) : p.ago % 5 === 0 ? d.getDate() : ''}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
        <div class="tiles">
          <div class="tile"><div>В среднем за день</div><b style="color: {tone(avg)}">{signed(avg)}</b></div>
          <div class="tile"><div>Лучший день</div><b class="g">{best && best.net > 0 ? signed(best.net) : '—'}</b></div>
          <div class="tile"><div>Худший день</div><b class="r">{worst && worst.net < 0 ? signed(worst.net) : '—'}</b></div>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Список профилей: с него калькулятор начинается -->
    <div class="plist">
      <div class="phead"><b>Профили</b><span class="grow"></span><span class="cnt">{calc.profiles.length} из {MAX_PROFILES}</span></div>
      <p class="pnote">Выберите, какой счёт вести. У каждого профиля свой баланс и свои записи.</p>
      <div class="scroll col">
        {#each calc.profiles as p (p.id)}
          {@const w = weekOf(p)}
          <div class="pcard">
            <button class="pmain" onclick={() => openProfile(p.id)}>
              <span class="av lg" style={tint(avColor(p), '26')}>{p.name.charAt(0).toUpperCase()}</span>
              <span class="t"><b>{p.name}</b><span>{recWord(p.entries.length)} · {lastOf(p)}</span></span>
              <span class="pr"><b>{money(balanceOf(p))}</b><span style="color: {w > 0 ? GREEN : w < 0 ? RED : 'var(--text-muted)'}">{w ? signed(w) + ' за неделю' : 'за неделю без изменений'}</span></span>
            </button>
            <button class="ib" aria-label="Действия с профилем" title="Переименовать или удалить" aria-expanded={menu === p.id} onclick={() => (menu = menu === p.id ? '' : p.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            {#if menu === p.id}
              <div class="pop" role="menu">
                <button role="menuitem" onclick={() => { menu = ''; rName = p.name; dlg = { mode: 'ren', id: p.id }; }}>{@render ico('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4', 15)}Переименовать</button>
                <button role="menuitem" class="danger" onclick={() => { menu = ''; dlg = { mode: 'del', id: p.id }; }}>{@render ico('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', 15)}Удалить</button>
              </div>
            {/if}
          </div>
        {/each}
        {#if !calc.profiles.length}
          <div class="empty">Профилей пока нет. Создайте первый — понадобится только ваш баланс в игре.</div>
        {/if}
        <button class="pnew" onclick={openCreate} disabled={calc.atLimit}>{@render ico('M12 5v14M5 12h14', 16)}{calc.atLimit ? 'Лимит профилей' : 'Новый профиль'}</button>
        {#if calc.atLimit}<p class="limit">Можно вести не больше {MAX_PROFILES} профилей. Удалите ненужный, чтобы создать новый.</p>{/if}
      </div>
    </div>
  {/if}

  <!-- Новая запись -->
  {#if adding && prof}
    <div class="sheet">
      <div class="shead"><button class="ib" aria-label="Назад" onclick={() => (adding = false)}>{@render ico('M15 6l-6 6 6 6')}</button><b>Новая запись</b></div>
      <div class="scroll pad">
        <div class="sw">
          <button class="inc" class:on={kind === 'inc'} onclick={() => setKind('inc')}>{@render ico('M12 19V5M6 11l6-6 6 6', 16)}Заработал</button>
          <button class="exp" class:on={kind === 'exp'} onclick={() => setKind('exp')}>{@render ico('M12 5v14M6 13l6 6 6-6', 16)}Потратил</button>
        </div>
        <div class="lbl"><span>Сколько</span></div>
        <div class="mbox">
          <span class="dollar" style="color: {amt ? (kind === 'inc' ? GREEN : RED) : '#55585f'}">$</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" inputmode="numeric" placeholder="0" value={amount} oninput={(e) => (amount = fmtInput(e))} onkeydown={(e) => { if (e.key === 'Enter') save(false); }} aria-label="Сумма" autofocus />
          {#if amt}<button class="ib" aria-label="Стереть сумму" onclick={() => (amount = '')}>{@render ico('M6 6l12 12M18 6L6 18', 16)}</button>{/if}
        </div>
        <div class="quick">
          {#each [10000, 50000, 100000, 500000] as q (q)}<button onclick={() => (amount = groupDigits(amt + q))}>+{short(q)}</button>{/each}
        </div>
        {#if recent.length}
          <div class="lbl"><span>Повторить недавнее</span></div>
          <div class="recent">
            {#each recent as r (r.name)}
              {@const c = catOf(kind, r.cat)}
              <button onclick={() => { amount = groupDigits(r.sum); cat = r.cat; note = r.note ?? ''; }}><i style={tint(c.color, '2a')}>{@render ico(c.icon, 13)}</i>{r.name}</button>
            {/each}
          </div>
        {/if}
        <div class="lbl"><span>{kind === 'inc' ? 'Откуда деньги' : 'На что потратил'}</span><span class="muted">не выбрали — будет «Другое»</span></div>
        <div class="cats">
          {#each CATS[kind] as c (c.name)}
            <button class="cat" style={cat === c.name ? `border-color: ${c.color}; background: ${c.color}14; color: var(--text);` : ''} aria-pressed={cat === c.name} onclick={() => (cat = cat === c.name ? '' : c.name)}>
              <span class="ico sm" style={tint(c.color, cat === c.name ? '33' : '1c')}>{@render ico(c.icon, 17)}</span>{c.name}
            </button>
          {/each}
        </div>
        <div class="nrow">
          <div class="grow">
            <div class="lbl"><span>Заметка <span class="muted">— необязательно</span></span></div>
            <input class="txt" type="text" maxlength="80" placeholder="Например: 40 алмазов" bind:value={note} aria-label="Заметка" />
          </div>
          <div class="seg">
            <button class="chip" class:on={when === 0} onclick={() => (when = 0)}>Сегодня</button>
            <button class="chip" class:on={when === 1} onclick={() => (when = 1)}>Вчера</button>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="go" disabled={!amt} onclick={() => save(false)}>{amt ? `${kind === 'inc' ? 'Записать доход +' : 'Записать расход −'}${money(amt)}` : 'Введите сумму'}</button>
        <button class="ghost" disabled={!amt} title="Записать и сразу ввести следующую" onclick={() => save(true)}>Записать и ещё</button>
      </div>
    </div>
  {/if}

  <!-- Новый профиль: сначала баланс -->
  {#if creating}
    <div class="sheet">
      <div class="shead">
        {#if calc.profiles.length}<button class="ib" aria-label="Назад" onclick={() => (creating = false)}>{@render ico('M15 6l-6 6 6 6')}</button>{/if}
        <b>Новый профиль</b>
      </div>
      <div class="scroll pad">
        <p class="pnote" style="margin: 0; padding: 0;">Профиль — отдельный счёт со своими записями. Например, один для обычной игры, другой — чтобы копить на дом или вести перепродажу.</p>
        <div class="lbl" style="margin-top: 22px;"><span>Сколько у вас денег сейчас?</span></div>
        <div class="mbox">
          <span class="dollar" style="color: {startOk ? 'var(--accent)' : '#55585f'}">$</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" inputmode="numeric" placeholder="0" value={pStart} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value.replace(/[^\d]/g, ''); pStart = v === '' ? '' : Number(v).toLocaleString('ru-RU'); }} onkeydown={(e) => { if (e.key === 'Enter') create(); }} aria-label="Сколько денег сейчас" autofocus />
        </div>
        <p class="hint">Наличные и банк вместе — посмотрите в игре. С этой суммы начнём считать, дальше баланс будет меняться от ваших записей.</p>
        <div class="lbl" style="margin-top: 22px;"><span>Название <span class="muted">— необязательно</span></span></div>
        <input class="txt" type="text" maxlength="40" placeholder={defName} bind:value={pName} aria-label="Название профиля" />
        <div class="sugg">
          {#each ['Основной', 'Коплю на дом', 'Перепродажа авто', 'Второй персонаж'] as g (g)}<button onclick={() => (pName = g)}>{g}</button>{/each}
        </div>
      </div>
      <div class="foot"><button class="go" disabled={!startOk || calc.atLimit} onclick={create}>{startOk ? `Создать профиль · баланс ${money(digits(pStart))}` : 'Введите, сколько у вас денег'}</button></div>
    </div>
  {/if}

  <!-- Переименовать / удалить -->
  {#if dlg && dlgP}
    <div class="dim">
      <div class="dlg" role="dialog" aria-modal="true" aria-label={dlg.mode === 'del' ? 'Удалить профиль' : 'Переименовать профиль'}>
        {#if dlg.mode === 'del'}
          <b>Удалить профиль «{dlgP.name}»?</b>
          <p>{dlgP.entries.length ? `Вместе с ним удалятся ${recWord(dlgP.entries.length)} и вся история. ` : ''}Вернуть профиль будет нельзя.</p>
          <div class="btns"><button class="ghost" onclick={() => (dlg = null)}>Отмена</button><button class="red" onclick={doDelete}>Удалить</button></div>
        {:else}
          <b>Переименовать профиль</b>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="txt" type="text" maxlength="40" bind:value={rName} aria-label="Новое название" autofocus onkeydown={(e) => { if (e.key === 'Enter') doRename(); }} />
          <div class="btns"><button class="ghost" onclick={() => (dlg = null)}>Отмена</button><button class="go" disabled={!rName.trim()} onclick={doRename}>Сохранить</button></div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .calc { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; color: var(--text); --g: #6fdc9a; --r: #ff8a8a; }
  .calc.page { height: calc(100vh - var(--topbar)); max-width: 680px; padding: 18px 24px 0; box-sizing: border-box; }
  .ptitle { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .ptitle h1 { margin: 0; font-size: var(--fs-xl); font-weight: 800; }
  .xb { padding: 3px 7px; border-radius: 6px; font-size: 11px; font-weight: 800; background: var(--accent); color: var(--on-accent); white-space: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .g { color: var(--g); } .r { color: var(--r); }
  .muted { font-weight: 600; color: #6c7078; }
  button { font-family: inherit; }
  .ib { width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .ib:hover { background: var(--surface-2); color: var(--text); }
  .scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 18px 18px; }
  .page .scroll { padding-left: 0; padding-right: 0; }
  .scroll.col { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
  .scroll.pad { padding: 10px 18px 14px; }
  .empty { padding: 40px 10px; text-align: center; color: var(--text-muted); font-size: 13px; line-height: 1.5; }

  /* Сводка */
  .top { padding: 14px 18px 0; flex-shrink: 0; }
  .page .top { padding-left: 0; padding-right: 0; }
  .row { display: flex; align-items: center; gap: 10px; }
  .pbtn { display: flex; align-items: center; gap: 8px; height: 36px; max-width: 230px; padding: 0 10px 0 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 13.5px; font-weight: 800; cursor: pointer; }
  .pbtn:hover { border-color: var(--border-strong); }
  .pbtn .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pbtn :global(svg) { flex-shrink: 0; color: var(--text-dim); }
  .av { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; font-size: 13px; font-weight: 800; }
  .av.lg { width: 40px; height: 40px; border-radius: 11px; font-size: 16px; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); flex-shrink: 0; }
  .chip { height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .chip.on { background: var(--surface-3); color: var(--text); }
  .sum { display: flex; align-items: flex-end; gap: 16px; margin-top: 14px; }
  .cap { font-size: 12px; font-weight: 800; color: var(--text-dim); }
  .net { font-size: 40px; font-weight: 800; letter-spacing: -1px; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .ie { display: flex; flex-direction: column; gap: 3px; text-align: right; font-size: 13px; padding-bottom: 6px; color: var(--text-muted); }
  .bal { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); font-size: 13px; color: var(--text-muted); }
  .bal b { color: var(--text); }
  .add { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 48px; margin-top: 12px; border: 1px dashed var(--accent-line); border-radius: 12px; background: rgba(255, 195, 0, 0.07); color: var(--accent-soft); font-size: 14px; font-weight: 800; cursor: pointer; }
  .add:hover { background: rgba(255, 195, 0, 0.13); }
  .tabs { display: flex; margin-top: 10px; border-bottom: 1px solid var(--border); }
  .tab { flex: 1; height: 36px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); font-size: 13px; font-weight: 700; cursor: pointer; }
  .tab.on { color: var(--text); border-bottom-color: var(--accent); }

  /* Записи */
  .dcard { margin-top: 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
  .dhead { display: flex; align-items: center; gap: 10px; padding: 11px 14px 10px; border-bottom: 1px solid var(--border); }
  .dhead b { font-size: 14px; font-weight: 800; }
  .dhead small { flex: 1; font-size: 12px; color: var(--text-muted); }
  .pill { height: 26px; padding: 0 10px; border-radius: 99px; display: inline-flex; align-items: center; font-size: 13px; font-weight: 800; background: rgba(111, 220, 154, 0.13); color: var(--g); }
  .pill.neg { background: rgba(255, 138, 138, 0.13); color: var(--r); }
  .split { display: flex; height: 4px; gap: 2px; margin: 8px 14px 2px; border-radius: 2px; overflow: hidden; }
  .split span { opacity: 0.7; }
  .rec { display: flex; align-items: center; gap: 12px; padding: 10px 8px 10px 14px; }
  .rec + .rec { border-top: 1px solid var(--border); }
  .rec:hover { background: var(--surface-2); }
  .rec .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .rec .t b { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rec .t span { font-size: 12px; color: var(--text-muted); }
  .rec .del { opacity: 0; width: 30px; height: 30px; }
  .rec:hover .del, .rec .del:focus-visible { opacity: 1; }
  .ico { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; }
  .ico.sm { width: 30px; height: 30px; border-radius: 9px; }
  .amt { font-size: 15px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* По категориям */
  .sect { font-size: 12px; font-weight: 800; color: var(--text-dim); padding: 16px 2px 8px; display: flex; justify-content: space-between; }
  .srow { display: grid; grid-template-columns: 30px 100px 1fr 92px; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
  .srow b { text-align: right; font-size: 13px; }
  .track { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
  .track span { display: block; height: 100%; border-radius: 5px; }

  /* График */
  .chart { margin-top: 14px; padding: 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
  .chead { display: flex; align-items: baseline; gap: 8px; font-size: 14px; }
  .chead .big { font-size: 18px; }
  .cline { display: flex; gap: 14px; margin-top: 4px; font-size: 12.5px; color: var(--text-muted); }
  .right { text-align: right; }
  .plot { position: relative; margin-top: 14px; padding-left: 44px; }
  .gl { position: absolute; left: 44px; right: 0; height: 0; border-top: 1px dashed #2f3035; }
  .gl.zero { border-top: 1px solid #44464d; }
  .gl span { position: absolute; left: -44px; top: -8px; width: 38px; text-align: right; font-size: 11px; color: #6c7078; }
  .cols { position: absolute; left: 44px; right: 0; top: 0; display: flex; gap: 5px; }
  .col { flex: 1; min-width: 0; position: relative; cursor: pointer; }
  .hit { position: absolute; left: -2px; right: -2px; top: 0; border-radius: 6px; }
  .hit.on { background: rgba(255, 255, 255, 0.05); }
  .bar { position: absolute; left: 0; right: 0; border-radius: 5px 5px 1px 1px; background: var(--g); }
  .bar.neg { border-radius: 1px 1px 5px 5px; background: var(--r); }
  .lbl { display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; color: var(--text-dim); margin: 16px 0 8px; }
  .col .lbl { position: absolute; left: -8px; right: -8px; margin: 0; display: block; text-align: center; font-size: 11.5px; font-weight: 600; color: #6c7078; }
  .col .lbl.on { font-weight: 800; color: var(--text); }
  .tiles { display: flex; gap: 8px; margin-top: 10px; }
  .tile { flex: 1; padding: 11px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .tile div { font-size: 11.5px; color: var(--text-muted); margin-bottom: 3px; }
  .tile b { font-size: 14.5px; }

  /* Профили */
  .plist { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .phead { display: flex; align-items: baseline; gap: 8px; padding: 18px 20px 6px; }
  .page .phead, .page .pnote { padding-left: 0; padding-right: 0; }
  .phead b { font-size: 18px; }
  .cnt { font-size: 12.5px; font-weight: 700; color: var(--text-muted); }
  .pnote { margin: 0; padding: 0 20px 4px; font-size: 13px; color: var(--text-muted); line-height: 1.45; }
  .plist .scroll { padding: 12px 20px 18px; }
  .page .plist .scroll { padding-left: 0; padding-right: 0; }
  .pcard { position: relative; display: flex; align-items: center; gap: 4px; padding-right: 6px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); flex-shrink: 0; }
  .pcard:hover { border-color: var(--border-strong); background: var(--surface-2); }
  .pmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 12px 6px 12px 14px; border: 0; background: transparent; color: var(--text); cursor: pointer; text-align: left; }
  .pmain .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .pmain .t b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pmain .t span { font-size: 12.5px; color: var(--text-muted); }
  .pr { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .pr b { font-size: 15px; font-variant-numeric: tabular-nums; }
  .pr span { font-size: 12px; font-weight: 700; }
  .pop { position: absolute; right: 8px; top: 48px; z-index: 7; width: 190px; padding: 5px; border-radius: 12px; background: #2a2b30; border: 1px solid var(--border-strong); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55); }
  .pop button { display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; font-weight: 700; cursor: pointer; }
  .pop button:hover { background: #34353b; }
  .pop .danger { color: var(--r); }
  .pnew { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; margin-top: 4px; flex-shrink: 0; border: 1px dashed var(--accent-line); border-radius: 14px; background: rgba(255, 195, 0, 0.06); color: var(--accent-soft); font-size: 14px; font-weight: 800; cursor: pointer; }
  .pnew:hover { background: rgba(255, 195, 0, 0.12); }
  .pnew:disabled { border-color: var(--border-strong); background: transparent; color: #6c7078; cursor: default; }
  .limit { margin: 0; text-align: center; font-size: 12.5px; color: var(--text-muted); }

  /* Новая запись / новый профиль — на всё окно */
  .sheet { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; background: #1b1c1f; }
  .page .sheet { left: 0; right: 0; }
  .shead { display: flex; align-items: center; gap: 6px; padding: 10px 10px 0 8px; flex-shrink: 0; }
  .shead b { font-size: 15px; }
  .sw { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 13px; background: #111214; }
  .sw button { height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--text-muted); font-size: 14px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .sw .inc.on { background: var(--g); color: #0d2416; }
  .sw .exp.on { background: var(--r); color: #2b0d0d; }
  .mbox { display: flex; align-items: center; gap: 4px; height: 72px; padding: 0 18px; border-radius: 14px; background: #111214; border: 1px solid var(--border-strong); }
  .mbox:focus-within { border-color: rgba(255, 195, 0, 0.7); }
  .mbox input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 34px; font-weight: 800; outline: none; font-variant-numeric: tabular-nums; }
  .dollar { font-size: 34px; font-weight: 800; }
  .quick { display: flex; gap: 6px; margin-top: 8px; }
  .quick button { flex: 1; height: 32px; border: 1px solid var(--border-strong); border-radius: 9px; background: transparent; color: #d5d7dc; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .quick button:hover, .recent button:hover, .sugg button:hover { background: var(--surface-2); }
  .recent, .sugg { display: flex; gap: 6px; flex-wrap: wrap; }
  .sugg { margin-top: 8px; }
  .recent button { height: 34px; padding: 0 12px 0 6px; border: 1px solid var(--border-strong); border-radius: 99px; background: transparent; color: #d5d7dc; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 7px; }
  .recent i { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; }
  .sugg button { height: 30px; padding: 0 11px; border: 1px solid var(--border-strong); border-radius: 99px; background: transparent; color: #d5d7dc; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .cat { height: 66px; border: 1px solid #2f3035; border-radius: 12px; background: #1a1b1e; color: #d5d7dc; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 0 4px; }
  .cat:hover { border-color: #44464d; }
  .nrow { display: flex; gap: 10px; align-items: flex-end; }
  .txt { width: 100%; box-sizing: border-box; height: 42px; padding: 0 14px; border-radius: 10px; background: #111214; border: 1px solid var(--border-strong); color: var(--text); font: inherit; font-size: 14px; outline: none; }
  .txt:focus { border-color: rgba(255, 195, 0, 0.7); }
  .hint { margin: 8px 0 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }
  .foot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }
  .go { flex: 1; height: 50px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-size: 15px; font-weight: 800; cursor: pointer; }
  .go:disabled, .ghost:disabled { opacity: 0.35; cursor: default; }
  .ghost { height: 50px; padding: 0 16px; border: 1px solid var(--border-strong); border-radius: 12px; background: transparent; color: #d5d7dc; font-size: 13.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .red { flex: 1; height: 46px; border: 0; border-radius: 12px; background: #e5484d; color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; }

  .dim { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 20px; background: rgba(12, 13, 15, 0.7); }
  .dlg { width: 100%; max-width: 400px; box-sizing: border-box; padding: 20px; border-radius: 16px; background: #212226; border: 1px solid var(--border-strong); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
  .dlg b { font-size: 16px; }
  .dlg p { margin: 10px 0 0; font-size: 13.5px; line-height: 1.5; color: #c8cad0; }
  .dlg .txt { margin-top: 14px; }
  .btns { display: flex; gap: 8px; margin-top: 18px; }
  .btns .ghost, .btns .go { flex: 1; height: 46px; }
</style>
