<script lang="ts">
  import Icon from './Icon.svelte';
  import { ai } from '../ai.svelte';
  import { EXAM, examScore } from '../exam';

  const x = $derived(ai.exam);
  const score = $derived(examScore(x.results));
  const counts = $derived({
    yes: x.results.filter((r) => r.match === 'yes').length,
    partly: x.results.filter((r) => r.match === 'partly').length,
    no: x.results.filter((r) => r.match === 'no').length,
    error: x.results.filter((r) => r.match === 'error').length,
  });
  const item = (id: string) => EXAM.find((e) => e.id === id);
  const LABEL = { yes: 'Верно', partly: 'Частично', no: 'Неверно', error: 'Ошибка' } as const;
  const when = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const minutes = Math.ceil(EXAM.length * 35 / 60);
</script>

<section class="exam">
  <div class="intro">
    <p><b>Экзамен помощника.</b> {EXAM.length} вопросов, на которые мы заранее знаем правильный ответ по нашим правилам. Помощник отвечает на каждый так же, как игроку, а вторая нейросеть сравнивает его ответ с эталоном.</p>
    <p class="small">Запускайте после изменений в помощнике или в правилах. Займёт около {minutes} минут и заметную часть дневного лимита вашего ключа {ai.status?.provider ?? 'Groq'}. Ваши вопросы в истории и статистике не появятся.</p>
    <div class="btns">
      {#if x.running}
        <button class="btn" onclick={() => ai.stopExam()}><Icon name="close" size={14} />Остановить</button>
      {:else}
        <button class="btn primary" disabled={!ai.ready || ai.busy} onclick={() => ai.runExam()}><Icon name="spark" size={14} />{x.results.length ? 'Сдать заново' : 'Начать экзамен'}</button>
        {#if !ai.ready}<span class="small">Сначала подключите нейросеть в панели помощника.</span>{/if}
      {/if}
    </div>
  </div>

  {#if x.running || x.results.length}
    <div class="summary">
      <div class="score" class:good={score >= 80} class:bad={score < 60}>
        <b>{score}%</b>
        <span>{x.running ? `Вопрос ${Math.min(x.done + 1, x.total)} из ${x.total}` : `${x.results.length} из ${x.total} · ${when(x.at)}`}{x.provider ? ` · ${x.provider}` : ''}</span>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={x.total} aria-valuenow={x.done}>
        {#each x.results as r (r.id)}<i class={r.match}></i>{/each}
        {#if x.running}<i class="now"></i>{/if}
      </div>
      <p class="legend"><span class="yes">Верно {counts.yes}</span><span class="partly">Частично {counts.partly}</span><span class="no">Неверно {counts.no}</span>{#if counts.error}<span class="error">Ошибка {counts.error}</span>{/if}</p>
    </div>

    <ol class="list">
      {#each x.results as r (r.id)}
        {@const it = item(r.id)}
        <li>
          <details>
            <summary>
              <span class="badge {r.match}">{LABEL[r.match]}</span>
              <span class="q">{it?.q ?? r.id}</span>
              {#if r.match !== 'error'}<span class="ref" class:miss={!r.citedOk} title={r.citedOk ? 'Сослался на нужный пункт' : `Не сослался на ${it?.refs.join(' или ')}`}>{r.citedOk ? 'пункт верный' : 'не тот пункт'}</span>{/if}
            </summary>
            <dl>
              <dt>Ответ помощника{r.fixed ? ' (поправлен перепроверкой)' : ''}</dt><dd class="selectable">{r.answer || '—'}</dd>
              {#if r.cited.length}<dt>Сослался на</dt><dd>{r.cited.join('; ')}</dd>{/if}
              {#if it}<dt>Эталон</dt><dd class="exp">{it.verdict}<br /><span class="small">{it.points.join(' · ')}</span></dd>{/if}
              <dt>Оценка</dt><dd>{r.why || '—'}</dd>
              <dd class="small">{[r.model, r.seconds !== undefined ? `${r.seconds} с` : ''].filter(Boolean).join(' · ')}</dd>
            </dl>
          </details>
        </li>
      {/each}
      {#if x.running}
        {@const it = item(x.current ?? '')}
        <li class="pending"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="q">{it?.q ?? 'Готовлю вопрос…'}</span></li>
      {/if}
    </ol>
  {/if}
</section>

<style>
  .intro { padding: 14px 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .intro p { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: var(--text-dim); }
  .intro b { color: var(--text); }
  .small { font-size: 12px; color: var(--text-muted); line-height: 1.45; }
  .btns { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 10px; }

  .summary { margin: 14px 0 10px; }
  .score { display: flex; align-items: baseline; gap: 10px; }
  .score b { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .score.good b { color: var(--success); }
  .score.bad b { color: var(--danger); }
  .score span { font-size: 12.5px; color: var(--text-muted); }
  .bar { display: flex; gap: 3px; height: 8px; margin: 8px 0 6px; }
  .bar i { flex: 1; border-radius: 3px; background: var(--surface-3); max-width: 40px; }
  .bar i.yes { background: var(--success); }
  .bar i.partly { background: var(--orange); }
  .bar i.no { background: var(--danger); }
  .bar i.error { background: var(--text-muted); }
  .bar i.now { background: var(--accent-line); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
  @media (prefers-reduced-motion: reduce) { .bar i.now { animation: none; } }
  .legend { display: flex; gap: 14px; margin: 0; font-size: 12px; font-weight: 700; }
  .legend .yes { color: var(--success); }
  .legend .partly { color: var(--orange); }
  .legend .no { color: var(--danger); }
  .legend .error { color: var(--text-muted); }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .list li { border-radius: 10px; background: var(--surface); border: 1px solid var(--border); }
  summary { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent-line); outline-offset: -2px; border-radius: 10px; }
  .q { flex: 1; min-width: 0; font-size: 13px; color: var(--text); line-height: 1.4; }
  .badge { flex-shrink: 0; min-width: 70px; text-align: center; padding: 2px 8px; border-radius: 5px; font-size: 11.5px; font-weight: 800; }
  .badge.yes { background: var(--success-tint); color: var(--success); }
  .badge.partly { background: var(--orange-tint); color: var(--orange); }
  .badge.no { background: var(--danger-tint); color: var(--danger); }
  .badge.error { background: var(--surface-3); color: var(--text-muted); }
  .ref { flex-shrink: 0; font-size: 11.5px; color: var(--text-muted); }
  .ref.miss { color: var(--danger); font-weight: 700; }
  dl { margin: 0; padding: 0 12px 12px 92px; }
  dt { font-size: 11.5px; font-weight: 800; color: var(--text-muted); margin: 8px 0 2px; }
  dd { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
  dd.exp { padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--border-strong); color: var(--text); }
  dd.small { margin-top: 8px; }
  .pending { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
  .pending .q { color: var(--text-muted); }
  .dots { display: inline-flex; gap: 3px; width: 70px; justify-content: center; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: pulse 1s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @media (max-width: 640px) { dl { padding-left: 12px; } }
</style>
