// Most filesystems (ext4, APFS) cap a file name at 255 bytes, not characters.
export const MAX_FILE_NAME_BYTES = 255;

// Truncate by UTF-8 bytes without splitting a code point.
export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let bytes = 0;
  let out = '';
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return out;
}

// Shorten `stem` so that `stem + suffix` fits in one file name.
export function fitFileName(
  stem: string,
  suffix: string,
  maxBytes = MAX_FILE_NAME_BYTES,
): string {
  return truncateUtf8(stem, maxBytes - Buffer.byteLength(suffix)) + suffix;
}
