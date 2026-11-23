<script lang="ts">
  // ПРЕДПРОСМОТР дизайна голосового вопроса к ИИ (только при разработке):
  // game.html?voice=listen|think|answer&voicev=a|b — a: «Разговор» (пузыри диалога), b: «Субтитры» (как в играх).
  // Логики пока нет — только вид.
  let { stage, variant = 'a' }: { stage: 'listen' | 'think' | 'answer'; variant?: 'a' | 'b' | 'c' } = $props();
  // «Голос» (c): ответ проявляется словами в такт озвучке — сказанные слова яркие, остальные приглушены
  const answer = 'В зелёной зоне на игроков нападать нельзя — грабить тоже. Это больница, мэрия, автосалоны и места появления.'.split(' ');
  const spoken = 9;
  const bars = Array.from({ length: 28 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));
  const q = 'Можно ли грабить игрока в зелёной зоне?';
</script>

{#snippet orb(mode: string)}
  <span class="orb {mode}" aria-hidden="true"><i></i><i></i><i></i><b></b></span>
{/snippet}

{#if variant === 'c'}
  <!-- «Голос»: свет от нижнего края экрана, капсула с живой волной, ответ проявляется в такт озвучке -->
  <div class="glow {stage}" aria-hidden="true"></div>
  <div class="vc">
    {#if stage === 'listen'}
      <div class="cap2">
        <span class="wave">{#each bars as h, i (i)}<i style="--h: {h}; --d: {(i % 7) * 70}ms"></i>{/each}</span>
        <span class="lbl">Говорите</span>
      </div>
    {:else if stage === 'think'}
      <div class="cap2 wide">
        <span class="blob sm" aria-hidden="true"><i></i></span>
        <span class="heard"><span class="shimmer">Можно ли грабить игрока в зелёной зоне?</span></span>
      </div>
    {:else}
      <div class="card2">
        <span class="blob" aria-hidden="true"><i></i></span>
        <div class="body">
          <p class="asked">Можно ли грабить игрока в зелёной зоне?</p>
          <p class="verd">Нет, так нельзя.</p>
          <p class="said2">{#each answer as w, i (i)}<span class:on={i < spoken}>{w}{' '}</span>{/each}</p>
          <p class="foot2"><span class="ref2">п. 2.14 Общих правил</span><span class="pun2">Jail · 60 минут</span></p>
        </div>
      </div>
    {/if}
  </div>
{:else if variant === 'a'}
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

  /* ── c: Голос ── */
  .glow { position: absolute; left: 0; right: 0; bottom: 0; height: 220px; pointer-events: none; background: radial-gradient(60% 100% at 50% 100%, rgba(255, 190, 40, 0.42), rgba(255, 170, 0, 0.12) 45%, transparent 75%); }
  .glow.listen { animation: pulse 1.2s ease-in-out infinite alternate; }
  .glow.think { opacity: 0.55; }
  .glow.answer { opacity: 0.3; height: 160px; }
  @keyframes pulse { from { opacity: 0.7; transform: scaleY(0.9); transform-origin: bottom; } to { opacity: 1; transform: scaleY(1.05); } }
  .vc { position: absolute; left: 50%; bottom: 56px; transform: translateX(-50%); display: flex; justify-content: center; }
  .cap2 { display: flex; align-items: center; gap: 14px; height: 56px; padding: 0 22px; border-radius: 999px; background: rgba(12, 13, 16, 0.86); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.06); color: #fff; white-space: nowrap; }
  .cap2.wide { padding: 0 24px 0 12px; }
  .wave { display: flex; align-items: center; gap: 3px; height: 30px; }
  .wave i { width: 3px; height: calc(var(--h) * 30px); border-radius: 3px; background: linear-gradient(#ffe28a, #ffb300); animation: lvl 0.6s ease-in-out var(--d) infinite alternate; }
  .lbl { font-size: 15px; font-weight: 700; color: rgba(255, 255, 255, 0.9); letter-spacing: 0.01em; }
  .heard { font-size: 15.5px; font-weight: 600; }
  .shimmer { background: linear-gradient(100deg, rgba(255, 255, 255, 0.55) 30%, #fff 45%, #ffe9a6 50%, #fff 55%, rgba(255, 255, 255, 0.55) 70%); background-size: 250% 100%; background-position: 60% 0; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shim 1.6s linear infinite; }
  @keyframes shim { from { background-position: 120% 0; } to { background-position: -20% 0; } }
  /* «Живой» шар: несколько слоёв света медленно вращаются */
  .blob { position: relative; width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; overflow: hidden; background: radial-gradient(circle at 30% 25%, #fff6d6, #ffcf3f 35%, #ff9d00 70%, #a85b00); box-shadow: 0 0 22px rgba(255, 180, 0, 0.45); }
  .blob i { position: absolute; inset: -30%; background: conic-gradient(from 0deg, transparent, rgba(255, 255, 255, 0.55), transparent 35%, rgba(255, 120, 0, 0.5), transparent 70%); animation: spin 3.5s linear infinite; mix-blend-mode: soft-light; }
  .blob.sm { width: 32px; height: 32px; }
  .blob.sm i { animation-duration: 1.2s; }
  .card2 { display: flex; gap: 14px; width: 560px; box-sizing: border-box; padding: 16px 20px 16px 16px; border-radius: 22px; background: rgba(12, 13, 16, 0.86); box-shadow: 0 14px 48px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.06); color: #fff; }
  .body { flex: 1; min-width: 0; }
  .asked { margin: 2px 0 0; font-size: 12.5px; font-weight: 600; color: rgba(255, 255, 255, 0.45); }
  .verd { margin: 4px 0 0; font-size: 21px; font-weight: 800; letter-spacing: -0.01em; color: #ffd75a; }
  .said2 { margin: 6px 0 0; font-size: 15px; line-height: 1.55; }
  .said2 span { color: rgba(255, 255, 255, 0.32); transition: color 0.2s; }
  .said2 span.on { color: rgba(255, 255, 255, 0.95); }
  .foot2 { display: flex; gap: 14px; margin: 10px 0 0; font-size: 12px; font-weight: 700; }
  .ref2 { color: rgba(255, 255, 255, 0.5); }
  .pun2 { color: #ff9ea1; }
</style>
