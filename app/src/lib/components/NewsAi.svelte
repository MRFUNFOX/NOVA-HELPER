<script lang="ts">
  /**
   * Новость «Помощник стал умнее»: показывается всем один раз после обновления.
   * Главное — вернуть тех, кто разочаровался в старом помощнике: «Было → Стало» рядом
   * (длинный старый ответ → короткий новый с «Подробнее», голосом и переключателем). Всё нарисовано, без снимков из игры.
   */
  import Icon from './Icon.svelte';
  import { ai } from '../ai.svelte';

  let { onDone }: { onDone: (result: 'open' | 'setup' | 'later' | 'esc') => void } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onDone('esc'); }
  }
  // Полоски «волны» голоса — разной высоты, чтобы было похоже на речь
  const wave = [5, 9, 14, 8, 16, 11, 6, 13, 9, 5, 10, 15, 7];
</script>

<svelte:window onkeydown={onKey} />

<div class="news">
  <div class="top">
    <span class="ver">Обновление ИИ-помощника</span>
    <button class="x" aria-label="Закрыть" onclick={() => onDone('later')}><Icon name="close" size={16} /></button>
  </div>
  <h2>Помощник стал<br /><span class="acc">заметно умнее</span></h2>
  <p class="sub">Мы переделали его почти целиком. Если раньше он ошибался или отвечал простынёй текста — дай ему второй шанс.</p>

  <div class="cmp" aria-hidden="true">
    <div class="q">Человек навёл на меня оружие, я его убил. Это DM?</div>
    <div class="cols">
      <div class="col before">
        <span class="lbl">Было</span>
        <p class="old">Нет, в данной ситуации ваши действия, скорее всего, не являются нарушением. Согласно пункту 4.1 Общих правил проекта, DM — это убийство без весомой IC-причины. К весомым IC-причинам относятся нападение, угроза жизни, прицеливание оружием и ряд других ситуаций. Поскольку человек навёл на вас оружие, это может рассматриваться как угроза жизни вашего персонажа. Однако многое зависит от обстоятельств: была ли RP-ситуация, кто начал конфликт…</p>
      </div>
      <div class="col after">
        <span class="lbl on">Стало</span>
        <div class="a">
          <p><b>Не DM.</b> Прицеливание оружием — весомая IC-причина для убийства <span class="ref">4.1</span></p>
          <div class="acts"><span class="more"><Icon name="chat" size={12} />Подробнее</span></div>
        </div>
        <div class="field">
          <span class="dot"></span>
          <span class="bars">{#each wave as h, i (i)}<i style="height: {h}px; animation-delay: {i * 70}ms"></i>{/each}</span>
          <span class="lis">Слушаю…</span>
        </div>
        <div class="scopes"><span class="on"><Icon name="scroll" size={11} />Правила</span><span><Icon name="scale" size={11} />Законы</span></div>
      </div>
    </div>
  </div>

  <div class="facts">
    <div class="fact"><span class="fi gold"><Icon name="spark" size={16} /></span><span><b>Сначала разбирается:</b> кто игрок, кто госник, кто админ, что произошло — и только потом ищет пункт</span></div>
    <div class="fact"><span class="fi green"><Icon name="check" size={16} /></span><span><b>Перепроверяет себя</b> на сложных ситуациях и отвечает коротко — логику покажет «Подробнее»</span></div>
    <div class="fact"><span class="fi gold"><Icon name="refresh" size={16} /></span><span><b>Без «лимит исчерпан»:</b> сам ждёт бесплатный лимит и не зависает в раздумьях</span></div>
  </div>
  <p class="also">Новое: вопрос голосом <Icon name="mic" size={12} />, переключатель «Правила проекта / Законы», проверка ника, история вопросов.</p>

  <div class="cta">
    {#if ai.ready}
      <button class="btn primary" onclick={() => onDone('open')}><Icon name="chat" size={16} />Спросить помощника</button>
    {:else}
      <button class="btn primary" onclick={() => onDone('setup')}><Icon name="spark" size={16} />Подключить помощника</button>
    {/if}
    <button class="btn ghost" onclick={() => onDone('later')}>Позже</button>
  </div>
</div>

<style>
  .news { display: flex; flex-direction: column; gap: 12px; color: var(--text); }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .ver { font-size: 11.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .x { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
  .x:hover { background: var(--surface-2); color: var(--text); }
  h2 { margin: 0; font-size: 30px; line-height: 1.08; font-weight: 800; letter-spacing: -0.025em; }
  .acc { color: var(--accent); }
  .sub { margin: -2px 0 2px; font-size: var(--fs-sm); line-height: 1.5; color: var(--text-dim); }

  /* Было → Стало */
  .cmp { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; border: 1px solid var(--border); background: var(--bg); user-select: none; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  .col { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .lbl { align-self: flex-start; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; background: var(--surface-3); color: var(--text-muted); }
  .lbl.on { background: var(--accent); color: var(--on-accent); }
  .old { position: relative; margin: 0; max-height: 168px; overflow: hidden; padding: 9px 11px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); font-size: 11.5px; line-height: 1.5; color: var(--text-muted);
    -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
  .q { align-self: flex-end; max-width: 82%; padding: 8px 12px; border-radius: 14px 14px 4px 14px; background: var(--accent); color: var(--on-accent); font-size: 12.5px; font-weight: 600; line-height: 1.4; }
  .a { padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
  .a p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text); }
  .a b { color: var(--accent-soft); }
  .ref { display: inline-flex; align-items: center; height: 18px; margin-left: 3px; padding: 0 5px; vertical-align: 1px; border-radius: 5px; background: var(--accent-tint); color: var(--accent); font-size: 10.5px; font-weight: 800; }
  .acts { display: flex; gap: 14px; margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
  .acts span { display: inline-flex; align-items: center; gap: 4px; }
  .acts .more { color: var(--accent-soft); }
  .scopes { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; border-radius: 9px; border: 1px solid var(--border-strong); }
  .scopes span { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 22px; border-radius: 6px; font-size: 11px; font-weight: 700; color: var(--text-dim); }
  .scopes .on { background: var(--accent); color: var(--on-accent); }
  .field { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: var(--radius); border: 1px solid rgba(255, 90, 95, 0.45); box-shadow: 0 0 0 3px rgba(255, 90, 95, 0.08); font-size: 12.5px; color: var(--text-dim); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger-line); box-shadow: 0 0 0 3px rgba(255, 90, 95, 0.18); }
  .bars { display: flex; align-items: center; gap: 2px; height: 16px; }
  .bars i { display: block; width: 3px; border-radius: 2px; background: var(--danger); animation: talk 0.9s ease-in-out infinite alternate; transform-origin: center; }
  @keyframes talk { from { transform: scaleY(0.45); } to { transform: scaleY(1); } }
  .lis { flex: 1; }

  .facts { display: flex; flex-direction: column; gap: 8px; }
  .fact { display: flex; align-items: center; gap: 10px; font-size: var(--fs-sm); line-height: 1.4; color: #dadce0; }
  .fact b { color: var(--text); }
  .fi { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; }
  .fi.gold { color: var(--accent); background: var(--accent-tint); }
  .fi.green { color: var(--success); background: var(--success-tint); }
  .also { margin: 0; font-size: var(--fs-xs); line-height: 1.5; color: var(--text-muted); }
  .also :global(svg) { vertical-align: -2px; color: var(--danger-line); }
  .cta { display: flex; gap: 6px; margin-top: 4px; }
  .cta .primary { flex: 1; height: 42px; font-size: 14px; }
  .cta .ghost { height: 42px; }
  @media (prefers-reduced-motion: reduce) { .bars i { animation: none; } }
  @media (max-width: 520px) { h2 { font-size: 25px; } .cols { grid-template-columns: 1fr; } }
</style>
