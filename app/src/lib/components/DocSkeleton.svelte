<script lang="ts">
  // Скелет документа: показываем, пока правила читаются с диска или скачиваются
  const rows = [92, 78, 85, 64, 88];
</script>

<div class="doc" aria-busy="true" aria-label="Загрузка правил">
  <span class="sk" style="width: 180px; height: 12px"></span>
  <span class="sk" style="width: 62%; height: 28px; margin-top: 12px; border-radius: 8px"></span>
  <div class="stats">
    {#each [0, 1, 2] as i (i)}
      <div class="stat"><span class="sk" style="width: 32px; height: 32px; border-radius: 7px"></span><span class="sk" style="width: 60%; height: 11px"></span><span class="sk" style="grid-column: 1 / -1; width: 48px; height: 24px"></span></div>
    {/each}
  </div>
  {#each [0, 1] as c (c)}
    <div class="card">
      <div class="head"><span class="sk" style="width: 40px; height: 40px; border-radius: 10px"></span><span class="sk" style="width: {c ? 38 : 52}%; height: 16px"></span></div>
      {#each rows.slice(c * 2, c * 2 + 3) as w, i (i)}
        <div class="row">
          <span class="sk" style="width: 54px; height: 28px; border-radius: 7px"></span>
          <div class="lines"><span class="sk" style="width: {w}%; height: 12px"></span><span class="sk" style="width: {w - 30}%; height: 12px"></span>{#if i === 1}<span class="sk" style="width: 140px; height: 26px; margin-top: 6px; border-radius: 7px"></span>{/if}</div>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .doc { max-width: 860px; padding: 22px 24px 64px; display: flex; flex-direction: column; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
  .stat { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px 10px; padding: 14px 16px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); }
  .card { margin-top: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .row { display: flex; gap: 14px; padding: 14px 16px; }
  .row + .row { border-top: 1px solid var(--border); }
  .lines { flex: 1; display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
  @media (max-width: 639px) { .doc { padding: 16px 14px; } }
</style>
