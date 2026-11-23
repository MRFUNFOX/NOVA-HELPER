<script lang="ts">
  // ПРЕДПРОСМОТР дизайна голосового вопроса к ИИ (только при разработке):
  // game.html?voice=listen|think|answer&voicev=a|b — a: «Разговор» (пузыри диалога), b: «Субтитры» (как в играх).
  // Логики пока нет — только вид.
  let { stage, variant = 'a' }: { stage: 'listen' | 'think' | 'answer'; variant?: 'a' | 'b' } = $props();
  const q = 'Можно ли грабить игрока в зелёной зоне?';
</script>

{#snippet orb(mode: string)}
  <span class="orb {mode}" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
{/snippet}

{#if variant === 'a'}
  <!-- «Разговор»: помощник — светящийся шар, реплики — как переписка -->
  <div class="talk">
    <div class="row me" class:hidden={stage === 'listen'}>
      <p class="bub me">{q}</p>
    </div>
    <div class="row ai">
      {@render orb(stage)}
      {#if stage === 'listen'}
        <p class="bub soft">Слушаю…</p>
      {:else if stage === 'think'}
        <p class="bub soft dots"><i></i><i></i><i></i></p>
      {:else}
        <div class="bub ai-ans">
          <p><b>Нет, так нельзя.</b> В зелёной зоне на игроков нападать запрещено — и грабить тоже. Это больница, мэрия, автосалоны и места появления.</p>
          <p class="note">п. 2.14 Общих правил · за это дают Jail на 60 минут</p>
        </div>
      {/if}
    </div>
    {#if stage === 'answer'}<span class="fade">исчезнет через минуту · весь разговор — в окне ИИ</span>{/if}
  </div>
{:else}
  <!-- «Субтитры»: шар сверху, текст снизу без рамок, как реплики в играх -->
  <div class="sub">
    {@render orb(stage)}
    {#if stage === 'listen'}
      <p class="cap dim">Слушаю…</p>
    {:else if stage === 'think'}
      <p class="cap dim">«{q}»</p>
    {:else}
      <p class="cap dim small">«{q}»</p>
      <p class="cap"><b>Нет, так нельзя.</b> В зелёной зоне на игроков нападать запрещено — и грабить тоже.</p>
      <p class="cap note">п. 2.14 Общих правил · Jail 60 минут</p>
    {/if}
  </div>
{/if}

<style>
  /* Шар помощника: дышит, когда слушает; крутится, когда думает; спокойно светится, когда отвечает */
  .orb { position: relative; width: 44px; height: 44px; flex-shrink: 0; display: grid; place-items: center; }
  .orb b { width: 26px; height: 26px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff3c4, #ffc300 45%, #c98a00 100%); box-shadow: 0 0 18px rgba(255, 195, 0, 0.55); }
  .orb i { position: absolute; inset: 6px; border-radius: 50%; border: 1.5px solid rgba(255, 195, 0, 0.5); opacity: 0; }
  .orb.listen b { animation: breathe 1.1s ease-in-out infinite alternate; }
  .orb.listen i { animation: wave 1.8s ease-out infinite; }
  .orb.listen i:nth-child(2) { animation-delay: 0.6s; } .orb.listen i:nth-child(3) { animation-delay: 1.2s; }
  .orb.think i:first-child { opacity: 1; inset: 2px; border-color: transparent; border-top-color: #ffc300; animation: spin 0.9s linear infinite; }
  .orb.answer b { box-shadow: 0 0 12px rgba(255, 195, 0, 0.35); }
  @keyframes breathe { from { transform: scale(0.85); } to { transform: scale(1.08); } }
  @keyframes wave { from { transform: scale(0.9); opacity: 0.9; } to { transform: scale(1.9); opacity: 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── a: Разговор ── */
  .talk { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); width: 520px; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: flex-end; gap: 10px; }
  .row.me { justify-content: flex-end; }
  .row.hidden { visibility: hidden; }
  .bub { margin: 0; padding: 10px 14px; border-radius: 18px; font-size: 14.5px; line-height: 1.5; color: #fff; background: rgba(14, 15, 19, 0.88); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
  .bub.me { max-width: 78%; border-bottom-right-radius: 6px; background: rgba(255, 195, 0, 0.92); color: #1b1606; font-weight: 600; }
  .bub.soft { border-bottom-left-radius: 6px; color: var(--text-dim); font-weight: 600; }
  .bub.ai-ans { max-width: 86%; border-bottom-left-radius: 6px; padding: 12px 15px; }
  .ai-ans p { margin: 0; }
  .ai-ans b { font-weight: 800; }
  .note { margin-top: 6px !important; font-size: 12.5px; color: var(--text-muted); font-weight: 600; }
  .dots { display: flex; gap: 5px; padding: 15px 16px; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); animation: dot 1s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay: 0.15s; } .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dot { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
  .fade { align-self: center; font-size: 11.5px; color: rgba(255, 255, 255, 0.55); font-weight: 600; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }

  /* ── b: Субтитры ── */
  .sub { position: absolute; top: 24px; left: 50%; transform: translateX(-50%); width: 760px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
  .cap { margin: 0; max-width: 680px; font-size: 19px; line-height: 1.45; color: #fff; font-weight: 600; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 14px rgba(0, 0, 0, 0.75); }
  .cap b { color: #ffd34d; font-weight: 800; }
  .cap.dim { color: rgba(255, 255, 255, 0.75); font-size: 16px; }
  .cap.small { font-size: 14px; }
  .cap.note { font-size: 13.5px; color: rgba(255, 255, 255, 0.7); }
</style>
