import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    buildUploadRow,
    deleteReceiptLogically,
    isReceiptDeleted,
    ReceiptActionError,
    receiptStoragePath,
    restoreReceipt,
    supersededVersion,
} from "./receipt-actions.js";

const FIREBASE_API_KEY = "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA";
const BUCKET = "petty-cash-receipts";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_LENGTH = 14_000_000;
const ALLOWED_MIME_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["application/pdf", "pdf"],
]);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function safeObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
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
    if (!response.ok) throw new Error("INVALID_FIREBASE_TOKEN");
    const payload = await response.json();
    const uid = payload?.users?.[0]?.localId;
    if (!uid) throw new Error("INVALID_FIREBASE_TOKEN");
    return String(uid);
}

function hasValidSignature(binary: Uint8Array, mimeType: string) {
    if (mimeType === "application/pdf") {
        return binary.length >= 5 &&
            binary[0] === 0x25 && binary[1] === 0x50 &&
            binary[2] === 0x44 && binary[3] === 0x46 && binary[4] === 0x2d;
    }
    if (mimeType === "image/jpeg") {
        return binary.length >= 3 &&
            binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff;
    }
    if (mimeType === "image/png") {
        return binary.length >= 8 &&
            binary[0] === 0x89 && binary[1] === 0x50 &&
            binary[2] === 0x4e && binary[3] === 0x47;
    }
    if (mimeType === "image/webp") {
        return binary.length >= 12 &&
            String.fromCharCode(...binary.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...binary.slice(8, 12)) === "WEBP";
    }
    return false;
}

function parseReceiptFile(fileBase64: unknown, requestedMimeType: unknown) {
    let encoded = String(fileBase64 || "").trim();
    let mimeType = String(requestedMimeType || "image/jpeg").toLowerCase();
    const dataUrlMatch = encoded.match(
        /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.+)$/s,
    );
    if (dataUrlMatch) {
        mimeType = dataUrlMatch[1].toLowerCase();
        encoded = dataUrlMatch[2];
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("UNSUPPORTED_FILE_TYPE");
    encoded = encoded.replace(/\s+/g, "");
    if (!encoded || encoded.length > MAX_BASE64_LENGTH) throw new Error("FILE_TOO_LARGE");

    let binary: Uint8Array;
    try {
        binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
        throw new Error("INVALID_FILE_BASE64");
    }
    if (!binary.byteLength || binary.byteLength > MAX_FILE_BYTES) {
        throw new Error("FILE_TOO_LARGE");
    }
    if (!hasValidSignature(binary, mimeType)) throw new Error("FILE_SIGNATURE_MISMATCH");
    return { binary, mimeType };
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return respond({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 14_500_000) {
        return respond({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    try {
        const body = safeObject(await request.json());
        const idToken = String(body.idToken || "");
        const txId = String(body.txId || "");
        const action = String(body.action || "upload");
        if (!idToken) return respond({ ok: false, error: "MISSING_ID_TOKEN" }, 401);
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(txId)) {
            return respond({ ok: false, error: "INVALID_TRANSACTION_ID" }, 400);
        }

        const uid = await verifyFirebaseToken(idToken);
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!supabaseUrl || !serviceRoleKey) throw new Error("MISSING_SERVER_CONFIGURATION");
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        // Adaptador de la lógica de retención (receipt-actions.js). Los cambios
        // de estado son CAS sobre uploaded_at; nunca se borra un objeto.
        const receiptStore = {
            async getReceipt(ownerUid: string, id: string) {
                const { data, error } = await supabase
                    .from("petty_cash_receipts")
                    .select("firebase_uid, transaction_id, storage_bucket, storage_path, mime_type, file_size_bytes, status, uploaded_at, deleted_at")
                    .eq("firebase_uid", ownerUid)
                    .eq("transaction_id", id)
                    .maybeSingle();
                if (error) throw error;
                return data;
            },
            async markDeleted(ownerUid: string, id: string, version: string, deletedAt: string) {
                const { data, error } = await supabase
                    .from("petty_cash_receipts")
                    .update({ status: "deleted", deleted_at: deletedAt, updated_at: deletedAt })
                    .eq("firebase_uid", ownerUid)
                    .eq("transaction_id", id)
                    .eq("uploaded_at", version)
                    .is("deleted_at", null)
                    .select("transaction_id, deleted_at")
                    .maybeSingle();
                if (error) throw error;
                return data;
            },
            async markRestored(ownerUid: string, id: string, version: string, restoredAt: string) {
                const { data, error } = await supabase
                    .from("petty_cash_receipts")
                    .update({ status: "confirmed", deleted_at: null, updated_at: restoredAt })
                    .eq("firebase_uid", ownerUid)
                    .eq("transaction_id", id)
                    .eq("uploaded_at", version)
                    .not("deleted_at", "is", null)
                    .select("transaction_id")
                    .maybeSingle();
                if (error) throw error;
                return data;
            },
        };

        if (action === "delete" || action === "restore") {
            const run = action === "delete" ? deleteReceiptLogically : restoreReceipt;
            const result = await run({ store: receiptStore, uid, txId, ifUploadedAt: body.ifUploadedAt });
            return respond(result.body, result.status);
        }

        if (action === "lookup") {
            const { data: receipt, error: lookupError } = await supabase
                .from("petty_cash_receipts")
                .select("transaction_id, project_id, period_id, storage_bucket, storage_path, mime_type, file_size_bytes, page_count, original_name, ocr_data, movement_data, status, confirmed_at, uploaded_at, deleted_at")
                .eq("firebase_uid", uid)
                .eq("transaction_id", txId)
                .maybeSingle();
            if (lookupError) throw lookupError;
            if (!receipt) return respond({ ok: false, error: "RECEIPT_NOT_FOUND" }, 404);
            if (isReceiptDeleted(receipt)) return respond({ ok: false, error: "RECEIPT_DELETED" }, 404);

            const { data: signed, error: signedError } = await supabase.storage
                .from(receipt.storage_bucket)
                .createSignedUrl(receipt.storage_path, 600);
            if (signedError) throw signedError;
            return respond({ ok: true, receipt, signedUrl: signed?.signedUrl || null });
        }

        if (action !== "upload") {
            return respond({ ok: false, error: "INVALID_ACTION" }, 400);
        }

        const file = parseReceiptFile(body.fileBase64 || body.imageBase64, body.mimeType);
        const requestedPageCount = body.pageCount == null ? null : Number(body.pageCount);
        if (
            requestedPageCount !== null &&
            (!Number.isInteger(requestedPageCount) || requestedPageCount < 1 || requestedPageCount > 10)
        ) {
            return respond({ ok: false, error: "INVALID_PAGE_COUNT" }, 400);
        }
        // Con uploadToken cada versión local tiene su propia ruta (el reintento de
        // la misma versión es idempotente y reemplazar la foto no sobrescribe la
        // anterior). Sin token (clientes anteriores) se mantiene la ruta estable.
        const uploadToken = body.uploadToken == null ? null : String(body.uploadToken);
        const storagePath = receiptStoragePath(uid, txId, uploadToken);
        const previous = await receiptStore.getReceipt(uid, txId);
        const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, file.binary, {
                contentType: file.mimeType,
                upsert: true,
                cacheControl: "3600",
            });
        if (uploadError) throw uploadError;

        const now = new Date();
        const archived = supersededVersion(previous, storagePath, now);
        if (archived) {
            const { error: archiveError } = await supabase
                .from("petty_cash_receipt_versions")
                .upsert(archived, { onConflict: "storage_bucket,storage_path", ignoreDuplicates: true });
            if (archiveError) throw archiveError;
        }
        const row = buildUploadRow({
            uid,
            txId,
            bucket: BUCKET,
            storagePath,
            file: { mimeType: file.mimeType, byteLength: file.binary.byteLength },
            body: { ...body, pageCount: requestedPageCount, ocr: safeObject(body.ocr), movement: safeObject(body.movement) },
            uploadToken,
            now,
        });
        const { data: receipt, error: upsertError } = await supabase
            .from("petty_cash_receipts")
            .upsert(row, { onConflict: "firebase_uid,transaction_id" })
            .select("transaction_id, storage_bucket, storage_path, mime_type, file_size_bytes, page_count, status, confirmed_at, uploaded_at")
            .single();
        if (upsertError) throw upsertError;

        return respond({ ok: true, path: `${BUCKET}/${storagePath}`, receipt });
    } catch (error) {
        if (error instanceof ReceiptActionError) {
            return respond({ ok: false, error: error.code }, error.status);
        }
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        const status = message === "INVALID_FIREBASE_TOKEN"
            ? 401
            : message === "FILE_TOO_LARGE"
            ? 413
            : [
                "UNSUPPORTED_FILE_TYPE",
                "INVALID_FILE_BASE64",
                "FILE_SIGNATURE_MISMATCH",
            ].includes(message)
            ? 400
            : 500;
        console.error("petty-cash-receipt", message);
        return respond({ ok: false, error: message }, status);
    }
});
