/**
 * スモークテスト用の SSR エントリ。
 *
 * ブラウザが無い環境でも「App が描画できて、コンパイラが動いている」ことを
 * 確認するために、Svelte のサーバー描画で App を HTML にします。
 * （操作の検証ではなく、初期表示の検証です）
 */
import { render } from "svelte/server";
import App from "../src/lib/App.svelte";

export function renderApp(): { body: string } {
  return render(App);
}
