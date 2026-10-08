import { deflateSync } from "node:zlib";

const WIDTH = 720;
const HEIGHT = 440;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

type Rgb = readonly [number, number, number];

class Canvas {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  constructor(background: Rgb) {
    this.rect(0, 0, WIDTH, HEIGHT, background);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(WIDTH, x + w); col++) {
        const at = (row * WIDTH + col) * 3;
        this.pixels[at] = color[0];
        this.pixels[at + 1] = color[1];
        this.pixels[at + 2] = color[2];
      }
    }
  }

  outline(x: number, y: number, w: number, h: number, color: Rgb, thickness = 2): void {
    this.rect(x, y, w, thickness, color);
    this.rect(x, y + h - thickness, w, thickness, color);
    this.rect(x, y, thickness, h, color);
    this.rect(x + w - thickness, y, thickness, h, color);
  }
}

const INK: Rgb = [38, 42, 52];
const TEXT: Rgb = [196, 200, 210];
const LINE: Rgb = [214, 217, 224];
const PANEL: Rgb = [244, 245, 248];
const ACCENT: Rgb = [66, 99, 214];

function drawChallengeBox(canvas: Canvas): void {
  canvas.rect(380, 164, 280, 90, PANEL);
  canvas.outline(380, 164, 280, 90, LINE, 1);
  canvas.outline(398, 192, 32, 32, [150, 156, 170], 2);
  canvas.rect(446, 202, 120, 10, INK);
  canvas.rect(590, 180, 52, 52, ACCENT);
}

/** A generic web page with a challenge box in the middle: enough to stand in for a screenshot. */
export function fakeScreenshotPng(): Uint8Array {
  const canvas = new Canvas([255, 255, 255]);

  canvas.rect(0, 0, WIDTH, 44, PANEL);
  canvas.rect(0, 44, WIDTH, 1, LINE);
  for (const [index, color] of (
    [
      [236, 106, 94],
      [244, 190, 80],
      [98, 197, 84],
    ] as Rgb[]
  ).entries()) {
    canvas.rect(16 + index * 20, 16, 12, 12, color);
  }
  canvas.rect(120, 12, 360, 20, [255, 255, 255]);
  canvas.outline(120, 12, 360, 20, LINE, 1);

  canvas.rect(48, 80, 200, 18, INK);
  canvas.rect(48, 112, 420, 8, TEXT);
  canvas.rect(48, 128, 360, 8, TEXT);

  canvas.rect(48, 168, 120, 8, TEXT);
  canvas.outline(48, 184, 300, 34, LINE, 1);
  canvas.rect(48, 232, 120, 8, TEXT);
  canvas.outline(48, 248, 300, 34, LINE, 1);

  drawChallengeBox(canvas);

  canvas.rect(48, 312, 150, 38, ACCENT);

  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    raw[row * (WIDTH * 3 + 1)] = 0;
    raw.set(
      canvas.pixels.subarray(row * WIDTH * 3, (row + 1) * WIDTH * 3),
      row * (WIDTH * 3 + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
