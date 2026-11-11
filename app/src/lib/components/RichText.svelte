<script lang="ts">
  // Лёгкая разметка из парсера: строки, списки «- », ссылки [текст](url). Без HTML из сети.
  import { app } from '../state.svelte';
  let { text }: { text: string } = $props();

  type Part = { t: 'text'; v: string } | { t: 'link'; v: string; href: string };
  type Block = { list: boolean; parts: Part[] };

  const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

  function parts(line: string): Part[] {
    const out: Part[] = [];
    let last = 0;
    for (const m of line.matchAll(LINK)) {
      if (m.index! > last) out.push({ t: 'text', v: line.slice(last, m.index) });
      out.push({ t: 'link', v: m[1]!, href: m[2]! });
      last = m.index! + m[0].length;
    }
    if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
    return out;
  }

  const blocks = $derived<Block[]>(
    text.split('\n').filter((l) => l.trim()).map((l) => (l.startsWith('- ') ? { list: true, parts: parts(l.slice(2)) } : { list: false, parts: parts(l) })),
  );
</script>

{#each blocks as b, i (i)}
  <p class:li={b.list}>
    {#each b.parts as p, j (j)}
      {#if p.t === 'link'}
        <a href={p.href} onclick={(e) => { e.preventDefault(); app.openLink(p.href); }}>{p.v}</a>
      {:else}{p.v}{/if}
    {/each}
  </p>
{/each}

<style>
  p { margin: 0 0 4px; }
  p:last-child { margin-bottom: 0; }
  p.li { position: relative; padding-left: 16px; }
  p.li::before { content: ''; position: absolute; left: 4px; top: 0.72em; width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); }
</style>
