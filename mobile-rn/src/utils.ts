// Decodes the base64 strings returned by Expo FileSystem into bytes for Supabase Storage uploads.
export function base64ToBytes(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s/g, '').replace(/=+$/, '');
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0, bits = 0, offset = 0;
  for (const char of clean) {
    const digit = alphabet.indexOf(char);
    // Invalid characters usually mean the recorded file could not be read correctly.
    if (digit < 0) throw new Error('The recorded audio could not be decoded. Record it again.');
    buffer = (buffer << 6) | digit; bits += 6;
    if (bits >= 8) { bits -= 8; output[offset++] = (buffer >> bits) & 0xff; buffer &= (1 << bits) - 1; }
  }
  // The allocated output may have a few unused bytes at the end; return only the decoded section.
  return output.slice(0, offset);
}
