<script lang="ts" module>
  export type IconName =
    | 'search' | 'close' | 'minus' | 'square' | 'squares' | 'settings' | 'spark' | 'menu' | 'book' | 'history'
    | 'refresh' | 'external' | 'copy' | 'check' | 'chevron' | 'alert' | 'keyboard' | 'download' | 'window' | 'shield'
    | 'gavel' | 'info' | 'users' | 'building' | 'calendar' | 'mask' | 'chat' | 'collapse' | 'list' | 'ban' | 'layers' | 'exception';
</script>

<script lang="ts">
  // Набор иконок интерфейса (линейные, 20×20, толщина 1.6) — без внешних библиотек
  let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'search'}<circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.8 3.8" />
  {:else if name === 'close'}<path d="m5 5 10 10M15 5 5 15" />
  {:else if name === 'minus'}<path d="M5 10h10" />
  {:else if name === 'square'}<rect x="5" y="5" width="10" height="10" rx="1.5" />
  {:else if name === 'squares'}<rect x="4.5" y="7" width="8.5" height="8.5" rx="1.5" /><path d="M7.5 4.5h6.5a1.5 1.5 0 0 1 1.5 1.5v6.5" />
  {:else if name === 'settings'}<circle cx="10" cy="10" r="2.6" /><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" />
  {:else if name === 'spark'}<path d="M10 3.2c.6 3.2 1.9 4.6 5.2 5.2-3.3.6-4.6 2-5.2 5.2-.6-3.2-1.9-4.6-5.2-5.2 3.3-.6 4.6-2 5.2-5.2Z" /><path d="M15.4 13.3c.3 1.4.8 1.9 2.1 2.2-1.3.3-1.8.8-2.1 2.2-.3-1.4-.8-1.9-2.1-2.2 1.3-.3 1.8-.8 2.1-2.2Z" />
  {:else if name === 'menu'}<path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  {:else if name === 'book'}<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v11.5H5.5A1.5 1.5 0 0 0 4 16V4.5Z" /><path d="M4 16a1.5 1.5 0 0 0 1.5 1.5H16v-3" />
  {:else if name === 'history'}<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" /><path d="M3.2 3.8v2.6h2.6" /><path d="M10 6.5V10l2.4 1.6" />
  {:else if name === 'refresh'}<path d="M16 9.5A6 6 0 0 0 5 6.3" /><path d="M4.5 3.5v3h3" /><path d="M4 10.5a6 6 0 0 0 11 3.2" /><path d="M15.5 16.5v-3h-3" />
  {:else if name === 'external'}<path d="M11 4h5v5" /><path d="m16 4-7 7" /><path d="M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" />
  {:else if name === 'copy'}<rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 4.5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" />
  {:else if name === 'check'}<path d="m4.5 10.5 3.5 3.5 7.5-8" />
  {:else if name === 'chevron'}<path d="m8 5 5 5-5 5" />
  {:else if name === 'alert'}<path d="M10 3.5 17.5 16.5h-15L10 3.5Z" /><path d="M10 8.5v3.5M10 14.3v.2" />
  {:else if name === 'keyboard'}<rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M5.5 8h1M8.5 8h1M11.5 8h1M14.5 8h0M6 12h8" />
  {:else if name === 'download'}<path d="M10 3.5v9M6.5 9 10 12.5 13.5 9" /><path d="M4 15.5h12" />
  {:else if name === 'window'}<rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M3 7.5h14" />
  {:else if name === 'shield'}<path d="M10 2.8 16 5v4.6c0 3.6-2.5 6.3-6 7.6-3.5-1.3-6-4-6-7.6V5l6-2.2Z" /><path d="m7.3 10 1.9 1.9 3.6-3.8" />
  {:else if name === 'gavel'}<path d="m11.2 3.6 5.2 5.2" /><path d="m9.4 5.4 5.2 5.2" /><path d="m10.3 4.5-3.6 3.6 5.2 5.2 3.6-3.6" /><path d="m8.4 9.8-5 5a1.4 1.4 0 0 0 2 2l5-5" /><path d="M11 17h6" />
  {:else if name === 'info'}<circle cx="10" cy="10" r="7" /><path d="M10 9v4.5M10 6.4v.1" />
  {:else if name === 'exception'}<circle cx="10" cy="10" r="7" /><path d="m7 10.3 2 2 4-4.3" />
  {:else if name === 'users'}<circle cx="7.5" cy="7" r="2.6" /><path d="M2.8 16c.5-2.5 2.4-4 4.7-4s4.2 1.5 4.7 4" /><path d="M12.8 4.6a2.6 2.6 0 0 1 0 4.8" /><path d="M14.4 12.2c1.5.5 2.5 1.8 2.8 3.8" />
  {:else if name === 'building'}<path d="M3 7.5 10 3.5l7 4" /><path d="M4.5 8v6.5M8 8v6.5M12 8v6.5M15.5 8v6.5" /><path d="M2.8 16.5h14.4" />
  {:else if name === 'calendar'}<rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /><path d="M7 12h2" />
  {:else if name === 'mask'}<path d="M2.8 7.2c2.3-.9 4.7-.9 7.2.4 2.5-1.3 4.9-1.3 7.2-.4-.2 3.9-1.9 6.3-4.2 6.3-1.3 0-2.2-.8-3-2-.8 1.2-1.7 2-3 2-2.3 0-4-2.4-4.2-6.3Z" /><path d="M6 9.6h1.6M12.4 9.6H14" />
  {:else if name === 'chat'}<path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 2.5V14H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" /><path d="M6.5 8h7M6.5 10.8h4.5" />
  {:else if name === 'collapse'}<path d="m11 5-5 5 5 5" /><path d="m15.5 5-5 5 5 5" />
  {:else if name === 'list'}<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" /><path d="M3.5 5.5h.1M3.5 10h.1M3.5 14.5h.1" />
  {:else if name === 'ban'}<circle cx="10" cy="10" r="7" /><path d="m5.1 14.9 9.8-9.8" />
  {:else if name === 'layers'}<path d="m10 3 7 3.8-7 3.8-7-3.8L10 3Z" /><path d="m3 10.2 7 3.8 7-3.8" /><path d="m3 13.6 7 3.8 7-3.8" />
  {/if}
</svg>
