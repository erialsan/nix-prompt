<script lang="ts">
  /** コンパイル結果の出力（positive / negative / notes / JSON）。 */
  import { copyText, downloadText } from "./dom";
  import { tabText, type CompileOutcome, type OutputTab } from "./engine";

  type Props = {
    outcome: CompileOutcome;
    onNotify?: (message: string) => void;
  };

  let { outcome, onNotify }: Props = $props();

  let tab = $state<OutputTab>("positive");

  const tabs: { id: OutputTab; label: string }[] = [
    { id: "positive", label: "positive" },
    { id: "negative", label: "negative" },
    { id: "notes", label: "notes" },
    { id: "json", label: "JSON" },
  ];

  const text = $derived(tabText(outcome, tab));

  function itemCount(value: string): number {
    const trimmed = value.trim();
    if (trimmed === "") return 0;
    return trimmed.split(",").length;
  }

  async function copy() {
    const ok = await copyText(text);
    onNotify?.(ok ? `${tab} をコピーしました` : "コピーできませんでした");
  }

  function download() {
    const name = tab === "json" ? "prompt.json" : `${tab}.txt`;
    downloadText(name, text, tab === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
  }
</script>

<section class="panel output">
  <header class="panel-head">
    <nav class="tabs" aria-label="出力の種類">
      {#each tabs as entry (entry.id)}
        <button
          type="button"
          class="tab"
          class:active={tab === entry.id}
          onclick={() => (tab = entry.id)}
        >
          {entry.label}
          {#if entry.id === "positive" && outcome.positive}
            <span class="count">{itemCount(outcome.positive)}</span>
          {:else if entry.id === "negative" && outcome.negative}
            <span class="count">{itemCount(outcome.negative)}</span>
          {:else if entry.id === "notes" && outcome.notes.length > 0}
            <span class="count">{outcome.notes.length}</span>
          {/if}
        </button>
      {/each}
    </nav>
    <div class="panel-actions">
      <button type="button" class="ghost" onclick={copy} disabled={text === ""}>コピー</button>
      <button type="button" class="ghost" onclick={download}>保存</button>
    </div>
  </header>

  {#if outcome.ok}
    {#if tab === "notes"}
      {#if outcome.notes.length === 0}
        <p class="empty">正規化のメモはありません。</p>
      {:else}
        <ul class="notes">
          {#each outcome.notes as note, i (i)}
            <li>{note}</li>
          {/each}
        </ul>
      {/if}
    {:else}
      <pre class="output-text" class:json={tab === "json"}>{text}</pre>
    {/if}
  {:else}
    <p class="empty danger-text">コンパイルに失敗しました。左のエラーを確認してください。</p>
  {/if}
</section>
