import { describe, it, expect } from "vitest";
import { decode, encode } from "fast-png";
import { toGrayscale } from "@lib/image-processing";

/**
 * Build a PNG from a 2D grid of RGBA pixels.
 * `pixels[y][x]` is `[r, g, b, a]`.
 */
function makePng(pixels: number[][][]): Uint8Array {
  const height = pixels.length;
  const width = pixels[0].length;
  const channels = 4;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * channels;
      data[idx] = pixels[y][x][0];
      data[idx + 1] = pixels[y][x][1];
      data[idx + 2] = pixels[y][x][2];
      data[idx + 3] = pixels[y][x][3];
    }
  }
  return encode({ width, height, data, channels, depth: 8 });
}

/**
 * Read back the RGBA values of every pixel from a PNG buffer.
 */
function readPixels(buf: Uint8Array): number[][][] {
  const { width, height, data, channels } = decode(buf);
  const pixels: number[][][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[][] = [];
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * channels;
      row.push([data[idx], data[idx + 1], data[idx + 2], channels >= 4 ? data[idx + 3] : 255]);
    }
    pixels.push(row);
  }
  return pixels;
}

/**
 * Parse just the PNG header to read dimensions.
 */
function readDimensions(buf: Uint8Array): { width: number; height: number } {
  const { width, height } = decode(buf);
  return { width, height };
}

describe("toGrayscale", () => {
  it("converts pure red (255,0,0) to luma ~76", () => {
    const input = makePng([[[255, 0, 0, 255]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    // Rec. 601: 0.299*255 + 0.587*0 + 0.114*0 ≈ 76
    expect(pixel[0]).toBe(76);
    expect(pixel[1]).toBe(76);
    expect(pixel[2]).toBe(76);
    expect(pixel[3]).toBe(255);
  });

  it("converts pure green (0,255,0) to luma ~150", () => {
    const input = makePng([[[0, 255, 0, 255]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    // Rec. 601: 0.299*0 + 0.587*255 + 0.114*0 ≈ 150
    expect(pixel[0]).toBe(150);
    expect(pixel[1]).toBe(150);
    expect(pixel[2]).toBe(150);
  });

  it("converts pure blue (0,0,255) to luma ~29", () => {
    const input = makePng([[[0, 0, 255, 255]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    // Rec. 601: 0.299*0 + 0.587*0 + 0.114*255 ≈ 29
    expect(pixel[0]).toBe(29);
    expect(pixel[1]).toBe(29);
    expect(pixel[2]).toBe(29);
  });

  it("pure white stays white", () => {
    const input = makePng([[[255, 255, 255, 255]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(255);
    expect(pixel[2]).toBe(255);
  });

  it("pure black stays black", () => {
    const input = makePng([[[0, 0, 0, 255]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    expect(pixel[0]).toBe(0);
    expect(pixel[1]).toBe(0);
    expect(pixel[2]).toBe(0);
  });

  it("preserves the alpha channel", () => {
    const input = makePng([[[200, 100, 50, 128]]]);
    const output = toGrayscale(input);
    const [[pixel]] = readPixels(output);
    expect(pixel[3]).toBe(128);
    // All RGB channels should be equal (grayscale)
    expect(pixel[0]).toBe(pixel[1]);
    expect(pixel[1]).toBe(pixel[2]);
  });

  it("preserves image dimensions", () => {
    const input = makePng([
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
      ],
      [
        [128, 128, 128, 255],
        [64, 64, 64, 255],
        [200, 100, 50, 255],
      ],
    ]);
    const output = toGrayscale(input);
    const { width, height } = readDimensions(output);
    expect(width).toBe(3);
    expect(height).toBe(2);
  });

  it("is idempotent on an already-grayscale image (within ±1 rounding)", () => {
    // Start with a grayscale pixel
    const input = makePng([[[128, 128, 128, 255]]]);
    const once = toGrayscale(input);
    const twice = toGrayscale(once);
    const [[p1]] = readPixels(once);
    const [[p2]] = readPixels(twice);
    expect(Math.abs(p1[0] - p2[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(p1[1] - p2[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(p1[2] - p2[2])).toBeLessThanOrEqual(1);
  });

  it("rejects on a non-PNG buffer", () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(() => toGrayscale(garbage)).toThrow();
  });
});
