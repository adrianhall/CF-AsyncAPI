/**
 * PNG grayscale conversion.
 *
 * @module
 */

import { decode, encode } from "fast-png";

/**
 * Converts an RGB(A) PNG buffer to grayscale by replacing each
 * pixel's R, G, B channels with the luma value computed via the
 * Rec. 601 formula.  The alpha channel is preserved.
 */
export function toGrayscale(input: Uint8Array): Uint8Array {
  const image = decode(input);
  const { width, height, data, channels } = image;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      data[idx] = luma;
      data[idx + 1] = luma;
      data[idx + 2] = luma;
      // alpha (if channels >= 4) at idx+3 untouched
    }
  }

  return encode(image);
}
