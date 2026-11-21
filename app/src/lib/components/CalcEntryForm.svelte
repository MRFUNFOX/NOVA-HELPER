<script lang="ts">
  // «Новая запись» калькулятора: одна форма для окна калькулятора и для быстрой записи у закреплённого «Итога».
  import { app } from '../state.svelte';
  import { calc } from '../calc.svelte';
  import { CATS, catOf, digits, groupDigits, money, short, type Kind, type Profile } from '../calc';

  let { prof, onclose, onsaved, title = 'Новая запись', closeIcon = 'back' }: {
    prof: Profile; onclose: () => void; onsaved?: () => void; title?: string; closeIcon?: 'back' | 'close';
  } = $props();

  const GREEN = '#6fdc9a', RED = '#ff8a8a';
  const tint = (hex: string, a: string) => `background: ${hex}${a}; color: ${hex};`;

  let kind = $state<Kind>('inc');
  let cat = $state('');
  let amount = $state('');
  let note = $state('');
  let when = $state<0 | 1>(0);
  const amt = $derived(digits(amount));
  /** «Повторить недавнее»: до трёх разных записей того же вида */
  const recent = $derived.by(() => {
    const seen = new Set<string>(), out: { name: string; cat: string; sum: number; note?: string }[] = [];
    for (const e of prof.entries) {
      if (e.k !== kind || out.length >= 3) continue;
      const key = e.cat + e.sum;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: `${e.note || e.cat} · ${money(e.sum)}`, cat: e.cat, sum: e.sum, note: e.note });
    }
    return out;
  });

  function setKind(k: Kind) { kind = k; cat = ''; }
  function save(more: boolean) {
    if (!amt) return;
    calc.add({ at: when ? Date.now() - 86400e3 : Date.now(), k: kind, cat: cat || 'Другое', sum: amt, note }, prof.id);
    app.notify(`${kind === 'inc' ? 'Записал доход' : 'Записал расход'} ${money(amt)}`);
    amount = ''; note = '';
    if (!more) { cat = ''; onsaved?.(); onclose(); }
  }
  const fmtInput = (e: Event) => groupDigits(digits((e.currentTarget as HTMLInputElement).value));
</script>

{#snippet ico(path: string, size = 18)}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path} /></svg>
{/snippet}

<div class="form">
  <div class="shead">
    {#if closeIcon === 'back'}<button class="ib" aria-label="Назад" onclick={onclose}>{@render ico('M15 6l-6 6 6 6')}</button>{/if}
    <b class="grow">{title}</b>
    {#if closeIcon === 'close'}<button class="ib" aria-label="Закрыть" onclick={onclose}>{@render ico('M6 6l12 12M18 6L6 18', 16)}</button>{/if}
  </div>
  <div class="scroll">
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
          <span class="ico" style={tint(c.color, cat === c.name ? '33' : '1c')}>{@render ico(c.icon, 17)}</span>{c.name}
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

<style>
  .form { flex: 1; min-height: 0; height: 100%; display: flex; flex-direction: column; color: var(--text); --g: #6fdc9a; --r: #ff8a8a; }
  button { font-family: inherit; }
  .grow { flex: 1; min-width: 0; }
  .muted { font-weight: 600; color: #6c7078; }
  .ib { width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); display: grid; place-items: center; cursor: pointer; }
  .ib:hover { background: var(--surface-2); color: var(--text); }
  .shead { display: flex; align-items: center; gap: 6px; padding: 10px 10px 0 8px; flex-shrink: 0; }
  .shead b { font-size: 15px; padding-left: 4px; }
  .scroll { flex: 1; min-height: 0; overflow: auto; padding: 10px 18px 14px; }
  .sw { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 13px; background: #111214; }
  .sw button { height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--text-muted); font-size: 14px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .sw .inc.on { background: var(--g); color: #0d2416; }
  .sw .exp.on { background: var(--r); color: #2b0d0d; }
  .lbl { display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; color: var(--text-dim); margin: 16px 0 8px; }
  .mbox { display: flex; align-items: center; gap: 4px; height: 72px; padding: 0 18px; border-radius: 14px; background: #111214; border: 1px solid var(--border-strong); }
  .mbox:focus-within { border-color: rgba(255, 195, 0, 0.7); }
  .mbox input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 34px; font-weight: 800; outline: none; font-variant-numeric: tabular-nums; }
  .dollar { font-size: 34px; font-weight: 800; }
  .quick { display: flex; gap: 6px; margin-top: 8px; }
  .quick button { flex: 1; height: 32px; border: 1px solid var(--border-strong); border-radius: 9px; background: transparent; color: #d5d7dc; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .quick button:hover, .recent button:hover { background: var(--surface-2); }
  .recent { display: flex; gap: 6px; flex-wrap: wrap; }
  .recent button { height: 34px; padding: 0 12px 0 6px; border: 1px solid var(--border-strong); border-radius: 99px; background: transparent; color: #d5d7dc; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 7px; }
  .recent i { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; }
  .cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .cat { height: 66px; border: 1px solid #2f3035; border-radius: 12px; background: #1a1b1e; color: #d5d7dc; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 0 4px; }
  .cat:hover { border-color: #44464d; }
  .ico { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0; }
  .nrow { display: flex; gap: 10px; align-items: flex-end; }
  .txt { width: 100%; box-sizing: border-box; height: 42px; padding: 0 14px; border-radius: 10px; background: #111214; border: 1px solid var(--border-strong); color: var(--text); font: inherit; font-size: 14px; outline: none; }
  .txt:focus { border-color: rgba(255, 195, 0, 0.7); }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); flex-shrink: 0; }
  .chip { height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--text-dim); font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .chip.on { background: var(--surface-3); color: var(--text); }
  .foot { display: flex; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }
  .go { flex: 1; height: 50px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-size: 15px; font-weight: 800; cursor: pointer; }
  .go:disabled, .ghost:disabled { opacity: 0.35; cursor: default; }
  .ghost { height: 50px; padding: 0 16px; border: 1px solid var(--border-strong); border-radius: 12px; background: transparent; color: #d5d7dc; font-size: 13.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
</style>
