/**
 * ワークスペースの永続化（localStorage）と URL ハッシュ共有。
 *
 * 共有は依存を増やさず、標準の CompressionStream / DecompressionStream
 * （deflate-raw）を使います。非対応ブラウザでは無圧縮でフォールバックします。
 */

export type WorkspaceFile = { path: string; source: string };

export type WorkspaceState = {
  files: WorkspaceFile[];
  /** null は「ファイル内の model に従う」 */
  model: string | null;
};

const STORAGE_KEY = "nix-prompt:workspace:v1";
const HASH_PREFIX = "#s=";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 状態を localStorage から復元する。壊れていたら null。 */
export function loadWorkspace(): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    const files = parsed.files.filter((f) => typeof f?.path === "string" && typeof f?.source === "string");
    if (files.length === 0) return null;
    return { files, model: typeof parsed.model === "string" ? parsed.model : null };
  } catch {
    return null;
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 容量超過やプライベートモードでは黙って諦める
  }
}

export function clearWorkspace(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** HTML エスケープされた JSON 埋め込みではなく、TS 側で安全に比較するための正規化。 */
function sanitize(state: WorkspaceState): WorkspaceState {
  return {
    files: state.files.map((f) => ({ path: f.path, source: f.source })),
    model: state.model ?? null,
  };
}

/** 状態を共有用トークン（URL ハッシュの中身）へ。 */
export async function encodeShare(state: WorkspaceState): Promise<string> {
  const json = JSON.stringify(sanitize(state));
  const data = new TextEncoder().encode(json);
  if (typeof CompressionStream === "undefined") return bytesToBase64Url(data);
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return `z${bytesToBase64Url(compressed)}`;
  } catch {
    return bytesToBase64Url(data);
  }
}

export async function decodeShare(token: string): Promise<WorkspaceState | null> {
  try {
    const compressed = token.startsWith("z");
    let data: Uint8Array<ArrayBuffer> = base64UrlToBytes(compressed ? token.slice(1) : token);
    if (compressed) {
      if (typeof DecompressionStream === "undefined") return null;
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const parsed = JSON.parse(new TextDecoder().decode(data)) as WorkspaceState;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    const files = parsed.files.filter((f) => typeof f?.path === "string" && typeof f?.source === "string");
    if (files.length === 0) return null;
    return { files, model: typeof parsed.model === "string" ? parsed.model : null };
  } catch {
    return null;
  }
}

/** 現在の URL から共有トークンを取り出す（無ければ null）。 */
export function readShareToken(hash: string): string | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const token = hash.slice(HASH_PREFIX.length);
  return token.length > 0 ? token : null;
}

export function shareUrl(token: string): string {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}${HASH_PREFIX}${token}`;
}
