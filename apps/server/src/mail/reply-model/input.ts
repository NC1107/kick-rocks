import { createHash } from "node:crypto";
import { stripQuoted } from "../reply-text.js";

/**
 * Bumped whenever {@link encoderText} changes, because a model is only right for the text it was
 * trained on. The manifest records the version it was trained with and the server refuses a mismatch.
 */
export const INPUT_FORMAT_VERSION = 1;

/** Longer replies are read only this far, so a hostile message cannot make the work slow. */
export const MAX_BODY_CHARS = 50_000;
const SUBJECT_CHARS = 300;

export interface ModelInput {
  subject: string;
  /** The sender's words, with the quoted request already removed. */
  body: string;
}

/** The single description of what the encoder reads. The server, the bench and training all use it. */
export function encoderText(input: ModelInput): string {
  return `Subject: ${input.subject.slice(0, SUBJECT_CHARS)}\n\n${input.body}`;
}

export function inputOf(message: { subject: string; text: string }): ModelInput {
  return { subject: message.subject, body: stripQuoted(message.text).slice(0, MAX_BODY_CHARS) };
}

export function inputSha256(input: ModelInput): string {
  return createHash("sha256").update(encoderText(input)).digest("hex");
}
