/* Tiny ZIP reader for standard ZIP files (store / deflate), without network dependencies.
   Uses the browser's built-in DecompressionStream. ZIP64 / encrypted ZIP are unsupported. */
(() => {
  'use strict';
  const MAX_FILES = 2000;
  const MAX_TOTAL = 150 * 1024 * 1024;
  const MAX_FILE = 80 * 1024 * 1024;
  const MAX_ARCHIVE = 100 * 1024 * 1024;
  const utf8 = new TextDecoder('utf-8');
  const error = (message) => { throw new Error(message); };

  async function inflateRaw(bytes, expected) {
    if (!('DecompressionStream' in window)) error('このブラウザはZIPの解凍に対応していません。フォルダを選んで読み込んでね。');
    let stream;
    try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { error('このZIPの圧縮形式には対応していません。'); }
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_FILE || size > expected) error('ZIP内のファイルサイズが上限を超えました。');
        chunks.push(value);
      }
    } catch (err) { await reader.cancel().catch(() => {}); throw err; }
    if (size !== expected) error('ZIP内のサイズ情報が一致しません。');
    return new Blob(chunks);
  }

  async function unpackZip(file) {
    if (file.size > MAX_ARCHIVE) error('ZIPファイルは100MB以下にしてね。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { eocd = i; break; }
    }
    if (eocd < 0) error('ZIPファイルが壊れているか、対応外の形式です。');
    const entries = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)) error('分割ZIPには対応していません。');
    if (entries === 65535 || directoryOffset === 0xffffffff) error('ZIP64には対応していません。');
    if (entries > MAX_FILES) error('ファイルは最大2,000個までです。');
    if (directoryOffset + directorySize > eocd) error('ZIPのデータ構造を読み取れません。');
    const out = [];
    let cursor = directoryOffset, total = 0;
    for (let i = 0; i < entries; i++) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) error('ZIPのファイル一覧を読み取れません。');
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const compressed = view.getUint32(cursor + 20, true);
      const uncompressed = view.getUint32(cursor + 24, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      if (cursor + 46 + nameLen + extraLen + commentLen > bytes.length) error('ZIP内のファイル名を読み取れません。');
      const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
      cursor += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop() === '.DS_Store') continue;
      if ((flags & 1) !== 0) error('パスワード付きZIPには対応していません。');
      if (method !== 0 && method !== 8) error('対応外のZIP圧縮形式が含まれています。');
      if (uncompressed > MAX_FILE || compressed > MAX_ARCHIVE || compressed === 0xffffffff || uncompressed === 0xffffffff) error('ZIP内のファイルが大きすぎます。');
      total += uncompressed;
      if (total > MAX_TOTAL) error('展開後の合計サイズは150MB以下にしてね。');
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) error('ZIP内のファイルを読み取れません。');
      const bodyOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      if (bodyOffset + compressed > bytes.length) error('ZIP内のファイルデータが不足しています。');
      const compressedBytes = bytes.subarray(bodyOffset, bodyOffset + compressed);
      const blob = method === 0 ? new Blob([compressedBytes]) : await inflateRaw(compressedBytes, uncompressed);
      if (blob.size !== uncompressed) error('ZIPファイルのサイズが一致しません。');
      out.push({ path: name, blob });
    }
    if (!out.length) error('ZIPにプレビューできるファイルが入っていません。');
    return out;
  }
  window.ASROZip = { unpackZip };
})();
