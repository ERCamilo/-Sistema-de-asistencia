import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  APP_IMAGE_BUCKET,
  APP_IMAGE_SIGNED_URL_TTL_SECONDS,
  AppImageValidationError,
  assertIdentityMatches,
  assertVersionedStoragePath,
  deriveVersionedStoragePath,
  getImagePolicy,
  parseImageFile,
  planVersionCommit,
  validateAction,
  validateAssetCoordinates,
} from "./policy.js";
import { readBoundedJsonBody } from "./request.js";

const FIREBASE_API_KEY = "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA";
const MAX_REQUEST_BYTES = 14_500_000;
type AppSupabaseClient = ReturnType<typeof createClient<any>>;
const ASSET_SELECT = [
  "category",
  "owner_type",
  "owner_id",
  "asset_id",
  "variant",
  "mime_type",
  "file_size_bytes",
  "original_name",
  "uploaded_at",
  "updated_at",
  "storage_path",
].join(",");

function allowedOrigins() {
  return new Set(
    (Deno.env.get("APP_IMAGES_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function responseHeaders(request: Request) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function respond(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

async function verifyFirebaseToken(idToken: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) throw new AppImageValidationError("INVALID_FIREBASE_TOKEN");
  const payload = await response.json();
  const uid = payload?.users?.[0]?.localId;
  if (!uid) throw new AppImageValidationError("INVALID_FIREBASE_TOKEN");
  return String(uid);
}

function publicAsset(row: Record<string, unknown>) {
  return {
    category: row.category,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    assetId: row.asset_id,
    variant: row.variant,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    originalName: row.original_name,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

function trustedStoragePointer(
  value: unknown,
  uid: string,
  coordinates: ReturnType<typeof validateAssetCoordinates>,
) {
  try {
    return assertVersionedStoragePath(value, uid, coordinates);
  } catch {
    throw new Error("INVALID_STORED_POINTER");
  }
}

async function removeStorageObject(
  supabase: AppSupabaseClient,
  storagePath: string,
  operation: string,
) {
  const { error } = await supabase.storage.from(APP_IMAGE_BUCKET).remove([
    storagePath,
  ]);
  if (error) {
    console.error("app-images-cleanup", operation, error.message);
    return false;
  }
  return true;
}

function assetQuery(
  supabase: AppSupabaseClient,
  uid: string,
  coordinates: ReturnType<typeof validateAssetCoordinates>,
) {
  return supabase
    .from("app_images")
    .select(ASSET_SELECT)
    .eq("firebase_uid", uid)
    .eq("category", coordinates.category)
    .eq("owner_type", coordinates.ownerType)
    .eq("owner_id", coordinates.ownerId)
    .eq("asset_id", coordinates.assetId)
    .eq("variant", coordinates.variant);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins().has(origin)) {
      return respond(request, { ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    }
    return new Response(null, {
      status: 204,
      headers: responseHeaders(request),
    });
  }
  if (request.method !== "POST") {
    return respond(request, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const body = await readBoundedJsonBody(request, MAX_REQUEST_BYTES);
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    if (!idToken) throw new AppImageValidationError("MISSING_ID_TOKEN");

    const action = validateAction(body.action);
    const coordinates = validateAssetCoordinates(body);
    const uid = await verifyFirebaseToken(idToken);
    assertIdentityMatches(body, uid);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("MISSING_SERVER_CONFIGURATION");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "lookup") {
      const { data: asset, error } = await assetQuery(
        supabase,
        uid,
        coordinates,
      ).maybeSingle();
      if (error) throw new Error("ASSET_LOOKUP_FAILED");
      if (!asset) {
        return respond(request, { ok: false, error: "IMAGE_NOT_FOUND" }, 404);
      }
      const assetRecord = asset as unknown as Record<string, unknown>;

      const storagePath = trustedStoragePointer(
        assetRecord.storage_path,
        uid,
        coordinates,
      );
      const { data: signed, error: signedError } = await supabase.storage
        .from(APP_IMAGE_BUCKET)
        .createSignedUrl(storagePath, APP_IMAGE_SIGNED_URL_TTL_SECONDS);
      if (signedError || !signed?.signedUrl) {
        throw new Error("SIGNED_URL_FAILED");
      }
      return respond(request, {
        ok: true,
        asset: publicAsset(assetRecord),
        signedUrl: signed.signedUrl,
        expiresIn: APP_IMAGE_SIGNED_URL_TTL_SECONDS,
      });
    }

    if (action === "delete") {
      const { data: asset, error } = await assetQuery(
        supabase,
        uid,
        coordinates,
      ).maybeSingle();
      if (error) throw new Error("ASSET_LOOKUP_FAILED");
      if (!asset) {
        return respond(request, {
          ok: true,
          deleted: false,
          asset: null,
          cleanupPending: false,
        });
      }
      const assetRecord = asset as unknown as Record<string, unknown>;

      const storagePath = trustedStoragePointer(
        assetRecord.storage_path,
        uid,
        coordinates,
      );
      // Keep the authoritative pointer retryable until the exact physical
      // object is gone. A concurrent replacement changes the pointer and the
      // CAS below then safely refuses to delete that newer version.
      const removed = await removeStorageObject(
        supabase,
        storagePath,
        "delete",
      );
      if (!removed) {
        return respond(request, {
          ok: false,
          error: "STORAGE_DELETE_FAILED",
          retryable: true,
          cleanupPending: true,
        }, 503);
      }

      const { data: deleted, error: deleteError } = await supabase.rpc(
        "delete_app_image_pointer_cas",
        {
          p_firebase_uid: uid,
          p_category: coordinates.category,
          p_owner_type: coordinates.ownerType,
          p_owner_id: coordinates.ownerId,
          p_asset_id: coordinates.assetId,
          p_variant: coordinates.variant,
          p_expected_storage_path: storagePath,
        },
      );
      if (deleteError) throw new Error("METADATA_DELETE_FAILED");
      if (deleted !== true) {
        return respond(request, {
          ok: false,
          error: "IMAGE_VERSION_CONFLICT",
          retryable: true,
        }, 409);
      }

      return respond(request, {
        ok: true,
        deleted: true,
        asset: publicAsset(assetRecord),
        cleanupPending: false,
      });
    }

    const policy = getImagePolicy(coordinates.category);
    const file = parseImageFile(
      body.fileBase64 || body.imageBase64,
      body.mimeType,
      policy,
    );
    const versionId = crypto.randomUUID();
    const storagePath = deriveVersionedStoragePath(uid, coordinates, versionId);
    const { error: uploadError } = await supabase.storage
      .from(APP_IMAGE_BUCKET)
      .upload(storagePath, file.binary, {
        contentType: file.mimeType,
        upsert: false,
        cacheControl: "3600",
      });
    if (uploadError) throw new Error("STORAGE_UPLOAD_FAILED");

    const { data: asset, error: swapError } = await supabase.rpc(
      "swap_app_image_pointer",
      {
        p_firebase_uid: uid,
        p_category: coordinates.category,
        p_owner_type: coordinates.ownerType,
        p_owner_id: coordinates.ownerId,
        p_asset_id: coordinates.assetId,
        p_variant: coordinates.variant,
        p_storage_path: storagePath,
        p_mime_type: file.mimeType,
        p_file_size_bytes: file.binary.byteLength,
        p_original_name: typeof body.originalName === "string"
          ? body.originalName.slice(0, 255)
          : null,
      },
    ).single();
    if (swapError || !asset) {
      // The RPC outcome can be ambiguous after a network failure. Never remove
      // the new version here: it may already be the authoritative pointer.
      throw new Error("METADATA_SWAP_FAILED");
    }
    const assetRecord = asset as Record<string, unknown>;

    const committedStoragePath = trustedStoragePointer(
      assetRecord.current_storage_path,
      uid,
      coordinates,
    );
    if (committedStoragePath !== storagePath) {
      throw new Error("METADATA_SWAP_MISMATCH");
    }
    const previousStoragePath = assetRecord.previous_storage_path;
    if (
      previousStoragePath !== null && typeof previousStoragePath !== "string"
    ) {
      throw new Error("INVALID_PREVIOUS_STORAGE_POINTER");
    }
    const plan = planVersionCommit(
      uid,
      coordinates,
      versionId,
      previousStoragePath,
    );
    let cleanupPending = false;
    if (plan.cleanupStoragePath) {
      cleanupPending = !(await removeStorageObject(
        supabase,
        plan.cleanupStoragePath,
        "replacement",
      ));
    }
    return respond(request, {
      ok: true,
      upserted: true,
      asset: publicAsset(assetRecord),
      cleanupPending,
    });
  } catch (error) {
    if (error instanceof AppImageValidationError) {
      const status =
        ["MISSING_ID_TOKEN", "INVALID_FIREBASE_TOKEN"].includes(error.code)
          ? 401
          : error.code === "IDENTITY_MISMATCH"
          ? 403
          : ["IMAGE_TOO_LARGE", "PAYLOAD_TOO_LARGE"].includes(error.code)
          ? 413
          : 400;
      return respond(request, { ok: false, error: error.code }, status);
    }
    console.error(
      "app-images",
      error instanceof Error ? error.message : "UNKNOWN_ERROR",
    );
    return respond(request, { ok: false, error: "INTERNAL_SERVER_ERROR" }, 500);
  }
});
