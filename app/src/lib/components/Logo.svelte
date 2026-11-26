<script lang="ts">
  /**
   * Знак NOVA HELPER (утверждён 27.11.2026): тёмная H на наклонной жёлтой плитке, угол наклона как у NOVA (~12°).
   * До 22 px — упрощённая версия без блика и сгиба, иначе мелкие детали превращаются в кашу.
   * Те же рисунки лежат в src-tauri/icons (иконка программы, трей, установщик).
   */
  let { size = 28 }: { size?: number } = $props();
  const small = $derived(size <= 22);
</script>

<svg class="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  {#if small}
    <path d="M1.00 99H78.13L99.00 1H21.87Z" fill="#FFC300" /><path d="M11.97 83H30.97L45.03 17H26.03Z M54.97 83H73.97L88.03 17H69.03Z M35.30 58H61.30L64.49 43H38.49Z" fill="#141000" />
  {:else}
    <defs><linearGradient id="nh-hl" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".38" /><stop offset=".22" stop-color="#fff" stop-opacity="0" /></linearGradient></defs>
    <path d="M4.00 96H76.40L96.00 4H23.60Z" fill="#FFC300" /><path d="M46.40 96H76.40L96.00 4Z" fill="#C09406" fill-opacity=".55" /><path d="M4.00 96H76.40L96.00 4H23.60Z" fill="url(#nh-hl)" /><path d="M17.61 80H32.61L45.39 20H30.39Z M54.61 80H69.61L82.39 20H67.39Z M36.51 57H60.51L63.28 44H39.28Z" fill="#141000" />
  {/if}
</svg>

<style>
  .logo { display: block; flex-shrink: 0; overflow: visible; }
</style>
