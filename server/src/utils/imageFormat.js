export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16384;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const inspectPng = (buffer) => {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  if (buffer.lastIndexOf(PNG_IEND) < buffer.length - 16) return null;
  return { mimeType: 'image/png', extension: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

const inspectJpeg = (buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  if (buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) < 2) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > buffer.length) return null;
      return { mimeType: 'image/jpeg', extension: 'jpg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
};

const inspectWebp = (buffer) => {
  if (buffer.length < 30 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') return null;
  if (buffer.readUInt32LE(4) + 8 > buffer.length) return null;
  const chunk = buffer.toString('latin1', 12, 16);
  const base = { mimeType: 'image/webp', extension: 'webp' };
  if (chunk === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return { ...base, width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { ...base, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { ...base, width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return null;
};

export const inspectImage = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const image = inspectPng(buffer) || inspectJpeg(buffer) || inspectWebp(buffer);
  if (!image) return null;
  const validSide = (side) => Number.isInteger(side) && side >= 1 && side <= MAX_IMAGE_SIDE;
  return validSide(image.width) && validSide(image.height) ? image : null;
};

export default { inspectImage, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE };
