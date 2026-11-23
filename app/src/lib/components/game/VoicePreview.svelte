<script lang="ts">
  // ПРЕДПРОСМОТР дизайна голосового вопроса к ИИ (только при разработке: game.html?voice=listen|think|answer).
  // Плашка сверху «Слушаю… / Думаю…» и окно ответа поверх игры на минуту. Логики пока нет — только вид.
  import Icon from '../Icon.svelte';
  let { stage }: { stage: 'listen' | 'think' | 'answer' } = $props();
  const q = 'Можно ли грабить игрока в зелёной зоне?';
</script>

{#if stage !== 'answer'}
  <div class="pill" class:think={stage === 'think'}>
    <span class="mic"><Icon name={stage === 'listen' ? 'mic' : 'chat'} size={16} /></span>
    {#if stage === 'listen'}
      <b>Слушаю…</b>
      <span class="bars" aria-hidden="true">{#each [0.5, 0.9, 0.6, 1, 0.7, 0.4, 0.8] as h, i (i)}<i style="--h: {h}; --d: {i * 90}ms"></i>{/each}</span>
      <span class="hint">отпустите <kbd>Alt</kbd>+<kbd>V</kbd></span>
    {:else}
      <b>Думаю…</b>
      <span class="said">«{q}»</span>
    {/if}
  </div>
{:else}
  <div class="ans">
    <div class="ah">
      <span class="tag"><Icon name="chat" size={13} />ИИ-помощник</span>
      <span class="src">Правила проекта</span>
      <span class="spk" title="Читаю ответ вслух"><Icon name="speaker" size={14} /><i></i><i></i><i></i></span>
    </div>
    <p class="aq">«{q}»</p>
    <p class="verdict">Нет, это нарушение.</p>
    <p class="why">В зелёной зоне запрещены любые нападения на игроков, в том числе ограбление. Зелёные зоны — больница, мэрия, автосалоны и места спавна.</p>
    <div class="refs">
      <span class="ref">п. 2.14 · Общие правила</span>
      <span class="pun">Jail 60 мин</span>
    </div>
    <div class="af">
      <span>Полный ответ — в окне ИИ</span>
      <span>0:42</span>
    </div>
    <span class="timer" aria-hidden="true"><i></i></span>
  </div>
{/if}

<style>
  .pill { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 18px 0 8px; border-radius: 999px; background: rgba(14, 15, 19, 0.92); border: 1px solid rgba(255, 195, 0, 0.35); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); color: #fff; white-space: nowrap; }
  .mic { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #111; position: relative; }
  .mic::after { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid rgba(255, 195, 0, 0.45); animation: ring 1.4s ease-out infinite; }
  .pill.think .mic { background: rgba(255, 195, 0, 0.18); color: var(--accent); }
  .pill.think .mic::after { border-color: transparent; border-top-color: var(--accent); animation: spin 0.9s linear infinite; inset: -3px; }
  .pill b { font-size: 15px; }
  .bars { display: flex; align-items: center; gap: 3px; height: 22px; }
  .bars i { width: 3px; height: calc(var(--h) * 22px); border-radius: 2px; background: var(--accent); animation: lvl 0.7s ease-in-out var(--d) infinite alternate; }
  .hint { font-size: 12px; color: var(--text-muted); font-weight: 600; }
  .hint kbd { padding: 1px 5px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); font-size: 11px; color: var(--text-dim); }
  .said { max-width: 420px; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; color: var(--text-dim); font-weight: 600; }
  @keyframes ring { from { transform: scale(0.85); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes lvl { from { transform: scaleY(0.35); } to { transform: scaleY(1); } }

  .ans { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); width: 460px; box-sizing: border-box; padding: 14px 16px 16px; border-radius: 14px; background: rgba(14, 15, 19, 0.92); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5); color: #fff; overflow: hidden; }
  .ah { display: flex; align-items: center; gap: 8px; }
  .tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px; background: rgba(255, 195, 0, 0.22); color: var(--accent-soft); font-size: 12px; font-weight: 800; }
  .src { font-size: 12px; color: var(--text-muted); font-weight: 600; flex: 1; }
  .spk { display: inline-flex; align-items: center; gap: 2px; color: var(--accent); }
  .spk i { width: 2px; height: 10px; border-radius: 1px; background: var(--accent); animation: lvl 0.5s ease-in-out infinite alternate; }
  .spk i:nth-child(3) { animation-delay: 0.15s; } .spk i:nth-child(4) { animation-delay: 0.3s; }
  .aq { margin: 10px 0 0; font-size: 12.5px; color: var(--text-muted); font-weight: 600; }
  .verdict { margin: 6px 0 0; font-size: 20px; font-weight: 800; line-height: 1.25; }
  .why { margin: 6px 0 0; font-size: 13.5px; line-height: 1.5; color: #d9dbe0; }
  .refs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .ref { padding: 3px 9px; border-radius: 6px; background: rgba(255, 255, 255, 0.07); font-size: 12px; font-weight: 700; color: #d5d7dc; }
  .pun { padding: 3px 9px; border-radius: 6px; background: rgba(255, 90, 95, 0.3); color: #ffc2c4; font-size: 12px; font-weight: 800; }
  .af { display: flex; justify-content: space-between; margin-top: 12px; font-size: 11.5px; color: var(--text-muted); font-weight: 600; }
  .timer { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.06); }
  .timer i { display: block; width: 70%; height: 100%; background: var(--accent); }
</style>
