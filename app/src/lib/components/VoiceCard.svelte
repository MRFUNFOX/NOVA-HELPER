<script lang="ts">
  // Голосовой вопрос поверх игры (дизайн утверждён 23.11.2026): плашка «Слушаю / Думаю» и карточка ответа.
  // Мышь проходит насквозь — слой окон не мешает играть.
  import { fade } from 'svelte/transition';
  import { voice } from '../voice.svelte';
  import { app } from '../state.svelte';
  import { pretty } from '../hotkey';

  const key = $derived(pretty(app.settings?.voiceHotkey || 'Alt+Q'));
  const bars = [0.35, 0.7, 1, 0.6, 0.85, 0.45, 0.75, 0.3, 0.55];
  const a = $derived(voice.answer);
  /** Слова ответа: прочитанные — светлые (в такт озвучке) */
  const words = $derived(a ? `${a.rest}`.split(/\s+/).filter(Boolean) : []);
  const spoken = $derived.by(() => {
    if (!a) return 0;
    if (!a.speak || a.error) return words.length;
    const v = a.verdict.split(/\s+/).length;
    return Math.round(voice.said * (v + words.length)) - v;
  });
  /** «2.14» → «п. 2.14»; «ст. 4 ч. 1» — как есть */
  const refLabel = (num: string) => (/^\d/.test(num) ? `п. ${num}` : num);
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
</script>

{#if voice.stage !== 'idle'}
  <div class="dw" transition:fade={{ duration: 160 }}>
    {#if voice.stage === 'listen' || voice.stage === 'think'}
      <div class="dpill" class:think={voice.stage === 'think'}>
        <span class="dmic">
          {#if voice.stage === 'listen'}<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="7.3" y="2.8" width="5.4" height="9.4" rx="2.7" /><path d="M4.8 9.6a5.2 5.2 0 0 0 10.4 0M10 14.8v2.6" /></svg>
          {:else}<span class="dspin" aria-hidden="true"></span>{/if}
        </span>
        {#if voice.stage === 'listen'}
          <span class="dtxt"><b>Слушаю</b><small>отпустите {key}, когда закончите</small></span>
          <span class="dlvl" aria-hidden="true">{#each bars as h, i (i)}<i style="height: {Math.max(4, h * 24 * (0.25 + voice.level))}px"></i>{/each}</span>
        {:else}
          <span class="dtxt"><b>Думаю</b><small>{voice.heard ? `«${voice.heard}»` : 'распознаю речь…'}</small></span>
        {/if}
      </div>
    {:else if voice.stage === 'missing' || voice.stage === 'error'}
      <div class="dpill think">
        <span class="dmic warn">!</span>
        <span class="dtxt"><b>{voice.stage === 'missing' ? 'Голос не установлен' : 'Не получилось'}</b><small>{voice.stage === 'missing' ? 'Настройки → Голосовой вопрос → Установить' : voice.error}</small></span>
      </div>
    {:else if a}
      <div class="dcard">
        <div class="dhead">
          <span class="dname"><span class="ddot"></span>ИИ-помощник</span>
          <span class="dsrc">{a.scope === 'laws' ? 'по законам штата' : 'по правилам проекта'}</span>
          {#if a.speak && !a.error && voice.said < 1}<span class="dspk"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.6h2.8l4-3.3v11.4l-4-3.3H3.5V7.6Z" /><path d="M13.3 7.4a3.6 3.6 0 0 1 0 5.2" /></svg>читаю вслух</span>{/if}
        </div>
        <p class="dq">Вы спросили: {lower(a.q)}</p>
        <p class="dverd">{a.verdict}</p>
        {#if words.length}<p class="dwhy">{#each words as w, i (i)}<span class:on={i < spoken}>{w}{' '}</span>{/each}</p>{/if}
        {#if a.refs.length || a.pun}
          <div class="drefs">
            {#each a.refs as r (r.num + r.doc)}<span class="dref">{refLabel(r.num)} · {r.doc}</span>{/each}
            {#if a.pun}<span class="dpun">{a.pun}</span>{/if}
            <span class="dmore">весь ответ — в окне ИИ</span>
          </div>
        {/if}
        {#if a.speak && !a.error}<span class="dprog" aria-hidden="true"><i style="width: {voice.said * 100}%"></i></span>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dw { position: absolute; top: 26px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; justify-content: center; pointer-events: none; font-family: var(--font-ui, inherit); }
  .dpill { display: flex; align-items: center; gap: 12px; padding: 8px 18px 8px 8px; border-radius: 999px; background: rgba(14, 15, 19, 0.92); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.07); color: #fff; white-space: nowrap; }
  .dmic { position: relative; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #141007; flex-shrink: 0; font-weight: 900; }
  .dmic::before { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.5); animation: ring 1.4s ease-out infinite; }
  .dpill.think .dmic { background: rgba(255, 195, 0, 0.14); color: var(--accent); }
  .dpill.think .dmic::before { display: none; }
  .dmic.warn { background: rgba(255, 90, 95, 0.2); color: #ff9ea1; }
  .dspin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.25); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  .dtxt { display: flex; flex-direction: column; gap: 1px; }
  .dtxt b { font-size: 15px; font-weight: 800; }
  .dtxt small { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.55); max-width: 460px; overflow: hidden; text-overflow: ellipsis; }
  .dpill.think .dtxt small { font-size: 13px; color: rgba(255, 255, 255, 0.8); }
  .dlvl { display: flex; align-items: center; gap: 3px; height: 24px; margin-left: 4px; }
  .dlvl i { width: 3px; border-radius: 2px; background: var(--accent); transition: height 0.07s linear; }
  .dcard { position: relative; width: 480px; box-sizing: border-box; padding: 14px 18px 18px; border-radius: 16px; background: rgba(14, 15, 19, 0.92); box-shadow: 0 14px 44px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.07); color: #fff; overflow: hidden; white-space: normal; }
  .dhead { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; }
  .dname { display: inline-flex; align-items: center; gap: 6px; color: var(--accent-soft); }
  .ddot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px rgba(255, 195, 0, 0.8); }
  .dsrc { flex: 1; color: rgba(255, 255, 255, 0.45); font-weight: 600; }
  .dspk { display: inline-flex; align-items: center; gap: 5px; color: rgba(255, 255, 255, 0.55); font-weight: 600; }
  .dq { margin: 12px 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.5); font-weight: 600; }
  .dverd { margin: 4px 0 0; font-size: 21px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.25; }
  .dwhy { margin: 6px 0 0; font-size: 14.5px; line-height: 1.55; }
  .dwhy span { color: rgba(255, 255, 255, 0.38); transition: color 0.2s; }
  .dwhy span.on { color: rgba(255, 255, 255, 0.92); }
  .drefs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  .dref { padding: 4px 9px; border-radius: 7px; background: rgba(255, 255, 255, 0.07); font-size: 12px; font-weight: 700; color: #d5d7dc; }
  .dpun { padding: 4px 9px; border-radius: 7px; background: rgba(255, 90, 95, 0.22); color: #ffb3b6; font-size: 12px; font-weight: 800; }
  .dmore { margin-left: auto; font-size: 11.5px; color: rgba(255, 255, 255, 0.4); font-weight: 600; }
  .dprog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.06); }
  .dprog i { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; transition: width 0.1s linear; }
  @keyframes ring { from { transform: scale(0.85); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
