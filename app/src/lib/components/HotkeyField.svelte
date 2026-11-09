<script lang="ts">
  import { backend } from '../backend';
  import { app } from '../state.svelte';
  import { keys, pretty, recordHotkey } from '../hotkey';

  let recording = $state(false);
  let error = $state('');
  let saved = $state(false);
  let box: HTMLButtonElement | undefined = $state();

  async function start() {
    error = '';
    saved = false;
    recording = true;
    // Пока записываем, текущая клавиша не должна срабатывать и прятать окно
    await backend.suspendHotkey(true).catch(() => {});
    box?.focus();
  }

  async function stop() {
    recording = false;
    await backend.suspendHotkey(false).catch(() => {});
  }

  async function onKey(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const r = recordHotkey(e);
    if (r.ok === null) return;
    if (r.ok === false) {
      error = r.reason;
      await stop();
      return;
    }
    recording = false;
    try {
      app.settings = await backend.setHotkey(r.hotkey);
      saved = true;
    } catch (err) {
      error = String(err);
      await backend.suspendHotkey(false).catch(() => {});
    }
  }
</script>

<div class="field">
  <button
    bind:this={box}
    class="keys"
    class:recording
    onclick={() => (recording ? stop() : start())}
    onkeydown={onKey}
    onblur={() => recording && stop()}
    aria-label={recording ? 'Нажмите новое сочетание клавиш' : `Клавиша вызова: ${pretty(app.settings?.hotkey ?? '')}. Нажмите, чтобы изменить`}
  >
    {#if recording}
      <span class="wait">Нажмите сочетание…</span>
    {:else}
      {#each keys(app.settings?.hotkey ?? '') as k, i (i)}{#if i}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}
    {/if}
  </button>
  <button class="btn" onclick={() => (recording ? stop() : start())}>{recording ? 'Отмена' : 'Изменить'}</button>
</div>
{#if error}<p class="msg error" role="alert">{error}</p>
{:else if saved}<p class="msg ok">Готово. Теперь окно открывается на {pretty(app.settings?.hotkey ?? '')}.</p>
{:else if recording}<p class="msg muted">Например, Alt + Q или F8. Esc — отмена.</p>{/if}

<style>
  .field { display: flex; gap: 8px; align-items: center; }
  .keys {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    text-align: left;
  }
  .keys kbd { font-size: var(--fs-sm); padding: 2px 10px; }
  .keys.recording { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .wait { color: var(--accent-soft); font-size: var(--fs-sm); font-weight: 600; }
  .plus { color: var(--text-muted); font-size: var(--fs-xs); }
  .msg { margin: 6px 0 0; font-size: var(--fs-xs); }
  .msg.error { color: var(--danger); }
  .msg.ok { color: var(--success); }
</style>
