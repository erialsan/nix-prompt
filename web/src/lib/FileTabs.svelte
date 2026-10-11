<script lang="ts">
  /** 仮想FS のファイル一覧。`import ./x.np` で参照するファイルを増やせる。 */
  type Props = {
    files: { path: string; source: string }[];
    activeIndex: number;
    onSelect?: (index: number) => void;
    onAdd?: () => void;
    onRename?: (index: number) => void;
    onDelete?: (index: number) => void;
    onImport?: () => void;
  };

  let { files, activeIndex, onSelect, onAdd, onRename, onDelete, onImport }: Props = $props();
</script>

<div class="file-tabs">
  <div class="file-list" role="tablist" aria-label="ファイル">
    {#each files as file, i (file.path)}
      <div class="file-tab" class:active={i === activeIndex}>
        <button type="button" class="file-name" role="tab" aria-selected={i === activeIndex} onclick={() => onSelect?.(i)}>
          {file.path}
        </button>
        <button type="button" class="file-action" title="名前を変更" onclick={() => onRename?.(i)}>✎</button>
        <button
          type="button"
          class="file-action"
          title="削除"
          onclick={() => onDelete?.(i)}
          disabled={files.length <= 1}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
  <div class="file-actions">
    <button type="button" class="ghost" onclick={onAdd} title="仮想FS にファイルを追加">+ ファイル</button>
    <button type="button" class="ghost" onclick={onImport} title="手元の .np を読み込む">読み込み</button>
  </div>
</div>
