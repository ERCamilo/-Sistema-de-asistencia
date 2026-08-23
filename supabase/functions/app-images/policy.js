const MEBIBYTE = 1024 * 1024;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const APP_IMAGE_BUCKET = "app-images";
export const APP_IMAGE_SIGNED_URL_TTL_SECONDS = 600;

export const APP_IMAGE_POLICIES = Object.freeze({
  "employee-profile": Object.freeze({
    ownerTypes: Object.freeze(["employee"]),
    variants: Object.freeze(["thumbnail", "original"]),
    maxBytes: 5 * MEBIBYTE,
  }),
  "worksite-photo": Object.freeze({
    ownerTypes: Object.freeze(["worksite"]),
    variants: Object.freeze(["thumbnail", "original"]),
    maxBytes: 10 * MEBIBYTE,
  }),
  "company-image": Object.freeze({
    ownerTypes: Object.freeze(["company"]),
    variants: Object.freeze(["thumbnail", "original", "logo"]),
    maxBytes: 10 * MEBIBYTE,
  }),
});

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const VALID_ACTIONS = new Set(["upload", "lookup", "delete"]);

export class AppImageValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "AppImageValidationError";
    this.code = code;
  }
}

export function getImagePolicy(category) {
  const policy = APP_IMAGE_POLICIES[category];
  if (!policy) throw new AppImageValidationError("UNKNOWN_CATEGORY");
  return policy;
}

export function validateAction(value) {
  const action = value == null || value === "" ? "upload" : value;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    throw new AppImageValidationError("INVALID_ACTION");
  }
  return action;
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppImageValidationError(code);
  }
  return value;
}

function safeSegment(value, code) {
  const segment = requiredString(value, code);
  if (!SEGMENT_PATTERN.test(segment)) {
    throw new AppImageValidationError(code);
  }
  return segment;
}

export function validateAssetCoordinates(input) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const category = requiredString(source.category, "UNKNOWN_CATEGORY");
  const policy = APP_IMAGE_POLICIES[category];
  if (!policy) throw new AppImageValidationError("UNKNOWN_CATEGORY");

  const ownerType = requiredString(source.ownerType, "INVALID_OWNER_TYPE");
  if (!policy.ownerTypes.includes(ownerType)) {
    throw new AppImageValidationError("INVALID_OWNER_TYPE");
  }

  const variant = requiredString(source.variant, "INVALID_VARIANT");
  if (!policy.variants.includes(variant)) {
    throw new AppImageValidationError("INVALID_VARIANT");
  }

  return {
    category,
    ownerType,
    ownerId: safeSegment(source.ownerId, "INVALID_OWNER_ID"),
    assetId: safeSegment(source.assetId, "INVALID_ASSET_ID"),
    variant,
  };
}

function deriveLogicalStoragePrefix(authenticatedUid, coordinates) {
  if (
    typeof authenticatedUid !== "string" ||
    !FIREBASE_UID_PATTERN.test(authenticatedUid)
  ) {
    throw new AppImageValidationError("INVALID_AUTHENTICATED_UID");
  }
  const validated = validateAssetCoordinates(coordinates);
  return [
    authenticatedUid,
    validated.category,
    validated.ownerType,
    validated.ownerId,
    validated.assetId,
    validated.variant,
  ].join("/");
}

export function deriveVersionedStoragePath(
  authenticatedUid,
  coordinates,
  versionId,
) {
  if (typeof versionId !== "string" || !VERSION_ID_PATTERN.test(versionId)) {
    throw new AppImageValidationError("INVALID_VERSION_ID");
  }
  return `${
    deriveLogicalStoragePrefix(authenticatedUid, coordinates)
  }/versions/${versionId}`;
}

export function assertVersionedStoragePath(
  storagePath,
  authenticatedUid,
  coordinates,
) {
  if (typeof storagePath !== "string") {
    throw new AppImageValidationError("INVALID_STORAGE_POINTER");
  }
  const prefix = `${
    deriveLogicalStoragePrefix(authenticatedUid, coordinates)
  }/versions/`;
  const versionId = storagePath.slice(prefix.length);
  if (!storagePath.startsWith(prefix) || !VERSION_ID_PATTERN.test(versionId)) {
    throw new AppImageValidationError("INVALID_STORAGE_POINTER");
  }
  return storagePath;
}

/**
 * @param {string} authenticatedUid
 * @param {{category: string, ownerType: string, ownerId: string, assetId: string, variant: string}} coordinates
 * @param {string} versionId
 * @param {string | null} previousStoragePath
 */
export function planVersionCommit(
  authenticatedUid,
  coordinates,
  versionId,
  previousStoragePath = null,
) {
  const storagePath = deriveVersionedStoragePath(
    authenticatedUid,
    coordinates,
    versionId,
  );
  let cleanupStoragePath = null;
  if (previousStoragePath != null) {
    const previous = assertVersionedStoragePath(
      previousStoragePath,
      authenticatedUid,
      coordinates,
    );
    if (previous !== storagePath) cleanupStoragePath = previous;
  }
  return { storagePath, cleanupStoragePath };
}

export function assertIdentityMatches(input, authenticatedUid) {
  if (typeof authenticatedUid !== "string" || !authenticatedUid) {
    throw new AppImageValidationError("INVALID_AUTHENTICATED_UID");
  }
  const claimedUid = input && typeof input === "object"
    ? input.firebaseUid
    : undefined;
  if (claimedUid != null && claimedUid !== authenticatedUid) {
    throw new AppImageValidationError("IDENTITY_MISMATCH");
  }
  return authenticatedUid;
}

function hasImageSignature(binary, mimeType) {
  if (mimeType === "image/jpeg") {
    return binary.length >= 3 &&
      binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return binary.length >= 8 &&
      binary[0] === 0x89 && binary[1] === 0x50 &&
      binary[2] === 0x4e && binary[3] === 0x47 &&
      binary[4] === 0x0d && binary[5] === 0x0a &&
      binary[6] === 0x1a && binary[7] === 0x0a;
  }
  if (mimeType === "image/webp") {
    return binary.length >= 12 &&
      String.fromCharCode(...binary.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...binary.slice(8, 12)) === "WEBP";
  }
  return false;
}

function decodeBase64(encoded) {
  if (
    !encoded || encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new AppImageValidationError("INVALID_IMAGE_BASE64");
  }
  try {
    return Uint8Array.from(
      atob(encoded),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new AppImageValidationError("INVALID_IMAGE_BASE64");
  }
}

export function parseImageFile(fileBase64, requestedMimeType, policy) {
  if (
    !policy || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1
  ) {
    throw new AppImageValidationError("INVALID_IMAGE_POLICY");
  }

  let encoded = typeof fileBase64 === "string" ? fileBase64.trim() : "";
  let mimeType = typeof requestedMimeType === "string"
    ? requestedMimeType.trim().toLowerCase()
    : "";
  const dataUrl = encoded.match(/^data:([^;,]+);base64,(.*)$/s);
  if (dataUrl) {
    const embeddedMimeType = dataUrl[1].toLowerCase();
    if (mimeType && mimeType !== embeddedMimeType) {
      throw new AppImageValidationError("IMAGE_MIME_MISMATCH");
    }
    mimeType = embeddedMimeType;
    encoded = dataUrl[2];
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppImageValidationError("UNSUPPORTED_IMAGE_TYPE");
  }

  encoded = encoded.replace(/\s+/g, "");
  const maximumEncodedLength = Math.ceil(policy.maxBytes / 3) * 4 + 4;
  if (!encoded || encoded.length > maximumEncodedLength) {
    throw new AppImageValidationError("IMAGE_TOO_LARGE");
  }

  const binary = decodeBase64(encoded);
  if (binary.byteLength === 0 || binary.byteLength > policy.maxBytes) {
    throw new AppImageValidationError("IMAGE_TOO_LARGE");
  }
  if (!hasImageSignature(binary, mimeType)) {
    throw new AppImageValidationError("IMAGE_SIGNATURE_MISMATCH");
  }
  return { binary, mimeType };
}
