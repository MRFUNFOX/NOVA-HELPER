<script lang="ts">
  /**
   * Новость «Спроси правила голосом» (тест — 0.7.18). Показывается всем один раз после обновления.
   * Живая сцена: зажал кнопку-клавишу → «Слушаю» → «Думаю» → ответ, и Денис читает его вслух
   * (запись лежит в программе — слышно сразу, даже пока сам голос ещё скачивается).
   * Вопрос и ответ настоящие: п. 4.1 Общих правил (DM), JAIL до 120 минут.
   */
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { ai } from '../ai.svelte';
  import { pretty } from '../hotkey';
  import denis from '../../assets/denis-news.ogg';

  let { onDone }: { onDone: (result: 'open' | 'setup' | 'later' | 'esc', tried: number) => void } = $props();

  const voiceKey = $derived(pretty(app.settings?.voiceHotkey || 'Alt+Q'));
  const keys = $derived(voiceKey.split(' + '));
  const winKey = $derived(pretty(app.settings?.hotkey || 'Alt+X'));
  const moved = $derived(!!app.settings?.keysMoved);

  const Q = 'Можно ли убить человека без причины?';
  const VERDICT = 'Нет, это DM — убийство без причины.';
  const WHY = 'Убивать можно только в RP-ситуации, когда у вас есть весомая причина. За DM администрация даёт JAIL до 120 минут.';
  const words = WHY.split(' ');
  // Доля записи, на которой Денис заканчивает вывод и переходит к объяснению
  const VERDICT_END = 0.27;

  type Stage = 'idle' | 'listen' | 'short' | 'think' | 'answer';
  let stage = $state<Stage>('idle');
  let said = $state(0);
  let level = $state(0);
  let tried = $state(0);
  let held = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let raf = 0;
  const audio = typeof Audio !== 'undefined' ? new Audio(denis) : null;
  if (audio) audio.preload = 'auto';

  const spoken = $derived(Math.max(0, Math.round(((said - VERDICT_END) / (1 - VERDICT_END)) * words.length)));
  const bars = [0.35, 0.7, 1, 0.6, 0.85, 0.45, 0.75, 0.3, 0.55];

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(raf);
    if (audio) { audio.pause(); audio.currentTime = 0; }
  }

  // Громкость «голоса», пока держат кнопку: живая, но без микрофона
  function wobble() {
    level = 0.35 + 0.5 * Math.abs(Math.sin(performance.now() / 140)) * (0.6 + 0.4 * Math.random());
    raf = requestAnimationFrame(wobble);
  }

  function press() {
    if (stage === 'listen') return;
    clear();
    said = 0;
    stage = 'listen';
    held = performance.now();
    wobble();
  }

  function release() {
    if (stage !== 'listen') return;
    cancelAnimationFrame(raf);
    level = 0;
    if (performance.now() - held < 500) {
      stage = 'short';
      timers.push(setTimeout(() => (stage = 'idle'), 2200));
      return;
    }
    tried++;
    stage = 'think';
    timers.push(setTimeout(() => {
      stage = 'answer';
      if (!audio) { said = 1; return; }
      audio.currentTime = 0;
      audio.play().catch(() => (said = 1));
      const tick = () => {
        said = audio.duration ? audio.currentTime / audio.duration : 0;
        if (!audio.ended && !audio.paused) raf = requestAnimationFrame(tick);
        else said = 1;
      };
      raf = requestAnimationFrame(tick);
    }, 1100));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); clear(); onDone('esc', tried); }
  }
  // Кнопку можно «зажать» и с клавиатуры: пробел или Enter на ней
  function keyDown(e: KeyboardEvent) {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); }
  }
  function keyUp(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release(); }
  }

  function done(r: 'open' | 'setup' | 'later') { clear(); onDone(r, tried); }
  onDestroy(clear);
</script>

<svelte:window onkeydown={onKey} onpointerup={release} />

<div class="news">
  <div class="top">
    <span class="ver">Обновление {app.version}</span>
    <button class="x" aria-label="Закрыть" onclick={() => done('later')}><Icon name="close" size={16} /></button>
  </div>
  <h2>Спроси правила<br /><span class="acc">голосом</span></h2>
  <p class="sub">Зажми {voiceKey} в игре и спроси вслух — помощник найдёт пункт правил и прочитает ответ.</p>

  <div class="stage">
    <div class="city" aria-hidden="true"></div>

    <div class="over" aria-live="polite">
      {#if stage === 'listen' || stage === 'think'}
        <div class="pill" class:think={stage === 'think'}>
          <span class="mic">
            {#if stage === 'listen'}<Icon name="mic" size={15} />{:else}<span class="spin" aria-hidden="true"></span>{/if}
          </span>
          {#if stage === 'listen'}
            <span class="pt"><b>Слушаю</b><small>отпустите {voiceKey}, когда закончите</small></span>
            <span class="lvl" aria-hidden="true">{#each bars as h, i (i)}<i style="height: {Math.max(4, h * 20 * (0.25 + level))}px"></i>{/each}</span>
          {:else}
            <span class="pt"><b>Думаю</b><small>«{Q}»</small></span>
          {/if}
        </div>
      {:else if stage === 'answer'}
        <div class="card">
          <div class="ch">
            <span class="cn"><span class="dot"></span>ИИ-помощник</span>
            <span class="cs">по правилам проекта</span>
            {#if said < 1}<span class="spk"><Icon name="speaker" size={13} />читаю вслух</span>{/if}
          </div>
          <p class="cq">Вы спросили: {Q.charAt(0).toLowerCase() + Q.slice(1)}</p>
          <p class="cv">{VERDICT}</p>
          <p class="cw">{#each words as w, i (i)}<span class:on={i < spoken}>{w}{' '}</span>{/each}</p>
          <div class="refs"><span class="ref">п. 4.1 · Общие правила проекта</span><span class="pun">JAIL до 120 минут</span></div>
          <span class="prog" aria-hidden="true"><i style="width: {said * 100}%"></i></span>
        </div>
      {/if}
    </div>

    {#if stage === 'answer' && said >= 1}
      <button class="again" onclick={() => { clear(); stage = 'idle'; }}><Icon name="refresh" size={13} />Ещё раз</button>
    {/if}
    <div class="hold" class:mid={stage === 'idle' || stage === 'short'} class:gone={stage === 'answer'}>
      {#if stage === 'short'}<span class="tip">Держите, пока говорите</span>
      {:else if stage === 'idle' && !tried}<span class="tip bob">Зажми и держи</span>
      {/if}
      <button
        class="keys"
        class:down={stage === 'listen'}
        aria-label="Зажать {voiceKey} и задать вопрос голосом"
        onpointerdown={(e) => { e.preventDefault(); press(); }}
        onkeydown={keyDown}
        onkeyup={keyUp}
      >
        {#each keys as k, i (i)}{#if i}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}
      </button>
    </div>
  </div>

  <div class="facts">
    <div class="fact"><span class="fi"><Icon name="mic" size={15} /></span><span>Речь распознаётся прямо на компьютере, без ключей</span></div>
    <div class="fact"><span class="fi"><Icon name="speaker" size={15} /></span><span>Ответ читается вслух — можно выключить в настройках</span></div>
    <div class="fact"><span class="fi"><Icon name="download" size={15} /></span><span>Голос скачается сам, один раз — около 235 МБ</span></div>
  </div>

  <p class="more"><b>И ещё:</b> история вопросов, проверка ника по п. 2.13, «Спросить снова» и оценка ответа.</p>

  {#if moved}
    <p class="moved"><Icon name="info" size={15} /><span>Окно помощника теперь открывается на <b>{winKey}</b></span></p>
  {/if}

  <div class="cta">
    {#if ai.ready}
      <button class="btn primary" onclick={() => done('open')}><Icon name="chat" size={16} />Открыть ИИ-помощника</button>
    {:else}
      <button class="btn primary" onclick={() => done('setup')}><Icon name="chat" size={16} />Подключить ИИ-помощника</button>
    {/if}
    <button class="btn ghost" onclick={() => done('later')}>Позже</button>
  </div>
  {#if !ai.ready}<p class="need">Голос работает вместе с ИИ-помощником — подключение бесплатное, пара минут.</p>{/if}
</div>

<style>
  .news { display: flex; flex-direction: column; gap: 11px; color: var(--text); }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .ver { font-size: 11.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .x { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
  .x:hover { background: var(--surface-2); color: var(--text); }
  h2 { margin: 0; font-size: 28px; line-height: 1.08; font-weight: 800; letter-spacing: -0.025em; }
  .acc { color: var(--accent); }
  .sub { margin: -2px 0 2px; font-size: var(--fs-sm); line-height: 1.5; color: var(--text-dim); }

  /* Сцена: ночной город (рисованный), сверху — то, что игрок увидит в игре, снизу — «клавиша» */
  .stage { position: relative; height: 236px; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); user-select: none; }
  .city { position: absolute; inset: 0; background:
    radial-gradient(4px 4px at 12% 78%, rgba(255, 196, 90, 0.9), transparent), radial-gradient(5px 5px at 22% 86%, rgba(255, 150, 60, 0.8), transparent),
    radial-gradient(3px 3px at 35% 80%, rgba(255, 230, 160, 0.9), transparent), radial-gradient(6px 6px at 78% 84%, rgba(120, 170, 255, 0.7), transparent),
    radial-gradient(4px 4px at 90% 76%, rgba(255, 200, 120, 0.85), transparent), radial-gradient(3px 3px at 60% 90%, rgba(255, 240, 200, 0.8), transparent),
    radial-gradient(70% 30% at 50% 96%, rgba(255, 140, 50, 0.22), transparent), linear-gradient(180deg, #1b2333 0%, #2a3346 55%, #3a3640 75%, #191a1f 100%); }
  .over { position: absolute; top: 12px; left: 0; right: 0; display: flex; justify-content: center; padding: 0 12px; }

  .pill { display: flex; align-items: center; gap: 10px; max-width: 100%; box-sizing: border-box; padding: 6px 15px 6px 6px; border-radius: 999px; background: rgba(14, 15, 19, 0.92); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.07); color: #fff; white-space: nowrap; animation: pop 0.18s ease-out; }
  .mic { position: relative; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #141007; flex-shrink: 0; }
  .mic::before { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.5); animation: ring 1.4s ease-out infinite; }
  .pill.think .mic { background: rgba(255, 195, 0, 0.14); color: var(--accent); }
  .pill.think .mic::before { display: none; }
  .spin { width: 15px; height: 15px; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.25); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  .pt { display: flex; flex-direction: column; min-width: 0; }
  .pt b { font-size: 13.5px; font-weight: 800; }
  .pt small { font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.55); overflow: hidden; text-overflow: ellipsis; }
  .pill.think .pt small { color: rgba(255, 255, 255, 0.82); font-size: 12px; }
  .lvl { display: flex; align-items: center; gap: 3px; height: 20px; }
  .lvl i { width: 3px; border-radius: 2px; background: var(--accent); transition: height 0.07s linear; }

  .card { position: relative; width: 100%; max-width: 430px; box-sizing: border-box; padding: 11px 15px 14px; border-radius: 14px; background: rgba(14, 15, 19, 0.92); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.07); color: #fff; overflow: hidden; animation: pop 0.2s ease-out; }
  .ch { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; }
  .cn { display: inline-flex; align-items: center; gap: 5px; color: var(--accent-soft); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px rgba(255, 195, 0, 0.8); }
  .cs { flex: 1; color: rgba(255, 255, 255, 0.45); font-weight: 600; }
  .spk { display: inline-flex; align-items: center; gap: 4px; color: rgba(255, 255, 255, 0.55); font-weight: 600; }
  .cq { margin: 9px 0 0; font-size: 11.5px; color: rgba(255, 255, 255, 0.5); font-weight: 600; }
  .cv { margin: 3px 0 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.25; }
  .cw { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; }
  .cw span { color: rgba(255, 255, 255, 0.36); transition: color 0.2s; }
  .cw span.on { color: rgba(255, 255, 255, 0.92); }
  .refs { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .ref { padding: 3px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.07); font-size: 11px; font-weight: 700; color: #d5d7dc; }
  .pun { padding: 3px 8px; border-radius: 6px; background: rgba(255, 90, 95, 0.22); color: #ffb3b6; font-size: 11px; font-weight: 800; }
  .prog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.06); }
  .prog i { display: block; height: 100%; background: var(--accent); }

  .hold { position: absolute; left: 0; right: 0; bottom: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px; transition: bottom 0.25s ease, opacity 0.2s; }
  /* Пока ничего не происходит — клавиша в центре сцены, это главное, что нужно сделать */
  .hold.mid { bottom: 78px; }
  /* Пока звучит ответ, клавиша не мешает карточке */
  .hold.gone { opacity: 0; pointer-events: none; }
  .again { position: absolute; right: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: rgba(14, 15, 19, 0.85); color: var(--accent-soft); font-size: 12px; font-weight: 800; cursor: pointer; animation: pop 0.2s ease-out; }
  .again:hover { background: rgba(14, 15, 19, 0.95); }
  .tip { padding: 3px 10px; border-radius: 999px; background: rgba(14, 15, 19, 0.8); font-size: 11.5px; font-weight: 800; color: var(--accent-soft); pointer-events: none; }
  .tip.bob { animation: bob 1.6s ease-in-out infinite; }
  .keys { display: flex; align-items: center; gap: 7px; padding: 0; border: 0; background: none; cursor: pointer; touch-action: none; }
  .keys:focus-visible { outline: 2px solid var(--accent); outline-offset: 6px; border-radius: 10px; }
  kbd { min-width: 46px; height: 44px; box-sizing: border-box; padding: 0 12px; display: grid; place-items: center; border-radius: 10px; font: 800 16px/1 var(--font-ui, inherit); color: #1a1400; background: linear-gradient(180deg, #ffd84d, var(--accent)); box-shadow: 0 5px 0 #a87d00, 0 9px 18px rgba(0, 0, 0, 0.45); transition: transform 0.06s, box-shadow 0.06s; }
  .keys:hover kbd { filter: brightness(1.05); }
  .keys.down kbd { transform: translateY(4px); box-shadow: 0 1px 0 #a87d00, 0 3px 8px rgba(0, 0, 0, 0.4); }
  .plus { font-weight: 800; color: rgba(255, 255, 255, 0.6); }

  .facts { display: flex; flex-direction: column; gap: 7px; }
  .fact { display: flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 600; color: #dadce0; }
  .fi { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0; color: var(--accent); background: var(--accent-tint); }

  .more { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-dim); }
  .more b { color: var(--text); font-weight: 700; }

  .moved { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 10%, transparent); font-size: 13px; }
  .moved :global(svg) { color: var(--accent); flex-shrink: 0; }
  .cta { display: flex; gap: 6px; margin-top: 2px; }
  .cta .primary { flex: 1; height: 42px; font-size: 14px; }
  .cta .ghost { height: 42px; }
  .need { margin: -4px 0 0; font-size: 12px; color: var(--text-muted); text-align: center; }

  @keyframes ring { from { transform: scale(0.85); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { from { opacity: 0; transform: translateY(-6px); } }
  @keyframes bob { 50% { transform: translateY(-3px); } }
  @media (prefers-reduced-motion: reduce) { .tip.bob, .mic::before { animation: none; } }
  @media (max-width: 520px) { h2 { font-size: 25px; } }
</style>
