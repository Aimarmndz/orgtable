import "server-only";
import { messagesFor } from "@/app/i18n/config";
import { messageAt } from "@/app/i18n/format";

// Uniform JSON responses for the public API. Errors always have the shape
// `{ "error": "message" }`; data is returned as is. See docs/api/public-api.md.
//
// The API answers in English only: it is for programs, not people.

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function apiOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * 422 for the first zod issue. The shared schemas use message keys
 * ("errors.validation.titleRequired"), turned into the English text here; a message that
 * is not a key is zod's own default, already in English, and is returned as is.
 */
export function apiValidationError(issue: { message: string } | undefined): Response {
  const message = issue
    ? (messageAt(messagesFor("en"), issue.message) ?? issue.message)
    : "Invalid data.";
  return apiError(422, message);
}
