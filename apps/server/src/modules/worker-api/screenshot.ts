import { MAX_SCREENSHOT_BYTES, type TaskScreenshot } from "@kickrocks/shared";
import { AppError } from "../../core/errors.js";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const SIGNATURES: Record<TaskScreenshot["mime"], readonly number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

function invalid(message: string): AppError {
  return new AppError(400, "invalid_screenshot", message);
}

/**
 * Decodes a screenshot a worker or agent sent as base64. Node's decoder skips characters it does
 * not understand, so the text is checked first, and the bytes must start the way the declared
 * type says, because the review queue serves them back to the person's browser as that type.
 */
export function decodeScreenshot(screenshot: TaskScreenshot): {
  mime: TaskScreenshot["mime"];
  data: Buffer;
} {
  const text = screenshot.dataBase64;
  if (text.length % 4 !== 0 || !BASE64.test(text)) {
    throw invalid("The screenshot is not valid base64");
  }
  const data = Buffer.from(text, "base64");
  if (data.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new AppError(400, "screenshot_too_large", "The screenshot is too large");
  }
  const signature = SIGNATURES[screenshot.mime];
  if (!signature.every((byte, index) => data[index] === byte)) {
    throw invalid(`The screenshot is not a ${screenshot.mime} image`);
  }
  return { mime: screenshot.mime, data };
}
