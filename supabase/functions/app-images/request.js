import { AppImageValidationError } from "./policy.js";

function declaredContentLength(request) {
  const raw = request?.headers?.get?.("content-length");
  if (raw == null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseJsonBytes(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed;
  } catch {
    throw new AppImageValidationError("INVALID_JSON_BODY");
  }
}

export async function readBoundedJsonBody(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new AppImageValidationError("INVALID_REQUEST_LIMIT");
  }
  const declaredLength = declaredContentLength(request);
  if (declaredLength != null && declaredLength > maxBytes) {
    throw new AppImageValidationError("PAYLOAD_TOO_LARGE");
  }

  const reader = request?.body?.getReader?.();
  if (!reader) throw new AppImageValidationError("INVALID_JSON_BODY");

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !value || !ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1
      ) {
        throw new AppImageValidationError("INVALID_JSON_BODY");
      }
      const chunk = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel("PAYLOAD_TOO_LARGE");
        } catch {
          // The response is already rejected; cancellation is only best-effort.
        }
        throw new AppImageValidationError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJsonBytes(bytes);
}
