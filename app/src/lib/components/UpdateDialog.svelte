<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';

  const c = $derived(app.check);
  const total = $derived((c?.changedDocs ?? 0) + (c?.addedDocs ?? 0) + (c?.removedDocs ?? 0));

  function plural(n: number, one: string, few: string, many: string) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  }
</script>

{#if app.updateDialog && c}
  <div class="backdrop">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="upd-title">
      {#if c.status === 'appTooOld'}
        <h2 id="upd-title">Нужна новая версия программы</h2>
        <p>Правила на сервере обновились в новом формате, который эта версия не понимает. Обновите программу — правила подтянутся после перезапуска.</p>
        <div class="actions">
          <button class="btn ghost" onclick={() => (app.updateDialog = false)}>Позже</button>
        </div>
      {:else}
        <div class="icon"><Icon name="book" size={22} /></div>
        <h2 id="upd-title">Правила проекта обновились</h2>
        <p>Администрация изменила правила на форуме. Обновление касается только базы правил в программе — сама программа и ваши настройки не меняются.</p>
        {#if total || c.summary[0]}
          <p class="what">
            {#if total}Затронуто {total} {plural(total, 'документ', 'документа', 'документов')}.{/if}
            {#if c.summary[0]}<br />{c.summary[0].charAt(0).toUpperCase() + c.summary[0].slice(1)}.{/if}
          </p>
        {/if}
        <p class="warn"><Icon name="alert" size={15} /> Пока не обновите, программа показывает старую редакцию — за нарушение новой можно получить наказание.</p>
        {#if app.updateError}<p class="error" role="alert">{app.updateError}</p>{/if}
        <div class="actions">
          <button class="btn ghost" onclick={() => (app.updateDialog = false)} disabled={app.updating}>Позже</button>
          <button class="btn primary" onclick={async () => { if (await app.applyUpdate()) app.view = { kind: 'changes' }; }} disabled={app.updating}>
            {#if app.updating}<span class="spinner" aria-hidden="true"></span>Обновляю…{:else}<Icon name="download" size={16} />Обновить правила{/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if app.appUpdateDialog && app.appUpdate}
  <div class="backdrop">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-title">
      <div class="icon"><Icon name="download" size={22} /></div>
      <h2 id="app-title">Вышла новая версия NOVA HELPER {app.appUpdate.version}</h2>
      <p>Программа обновится сама и перезапустится — удалять и устанавливать заново не нужно. Правила и настройки сохранятся.</p>
      {#if app.appUpdate.notes}<p class="what">{app.appUpdate.notes}</p>{/if}
      {#if app.appUpdateProgress !== null}
        <div class="bar" role="progressbar" aria-valuenow={Math.round(app.appUpdateProgress * 100)}><span style="width: {Math.max(4, app.appUpdateProgress * 100)}%"></span></div>
      {/if}
      <div class="actions">
        <button class="btn ghost" onclick={() => (app.appUpdateDialog = false)} disabled={app.appUpdateProgress !== null}>Позже</button>
        <button class="btn primary" onclick={() => app.installAppUpdate()} disabled={app.appUpdateProgress !== null}>
          {app.appUpdateProgress !== null ? 'Скачиваю…' : 'Обновить и перезапустить'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: absolute; inset: var(--titlebar) 0 0 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, 0.6); }
  .dialog { width: 100%; max-width: 440px; padding: 22px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55); }
  .icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--accent-tint); color: var(--accent); margin-bottom: 14px; }
  h2 { margin: 0 0 8px; font-size: var(--fs-lg); font-weight: 800; line-height: 1.3; }
  p { margin: 0 0 10px; font-size: var(--fs-sm); color: var(--text-dim); }
  .what { color: var(--text); font-weight: 600; }
  .warn { display: flex; gap: 8px; align-items: flex-start; color: var(--accent-soft); }
  .warn :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .error { color: var(--danger); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .bar { height: 6px; border-radius: 6px; background: var(--surface-3); overflow: hidden; margin: 12px 0 4px; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
  .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(0, 0, 0, 0.25); border-top-color: var(--on-accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
