import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FIREBASE_API_KEY = "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA";
const BUCKET = "petty-cash-receipts";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
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

function parseImage(imageBase64: unknown, requestedMimeType: unknown) {
    let encoded = String(imageBase64 || "").trim();
    let mimeType = String(requestedMimeType || "image/jpeg").toLowerCase();
    const dataUrlMatch = encoded.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
    if (dataUrlMatch) {
        mimeType = dataUrlMatch[1].toLowerCase();
        encoded = dataUrlMatch[2];
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error("UNSUPPORTED_IMAGE_TYPE");
    if (!encoded || encoded.length > 7_000_000) throw new Error("IMAGE_TOO_LARGE");

    let binary: Uint8Array;
    try {
        binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
        throw new Error("INVALID_IMAGE_BASE64");
    }
    if (!binary.byteLength || binary.byteLength > MAX_FILE_BYTES) {
        throw new Error("IMAGE_TOO_LARGE");
    }
    return { binary, mimeType };
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return respond({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 7_500_000) {
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

        if (action === "lookup") {
            const { data: receipt, error: lookupError } = await supabase
                .from("petty_cash_receipts")
                .select("transaction_id, project_id, period_id, storage_bucket, storage_path, mime_type, file_size_bytes, original_name, ocr_data, movement_data, status, confirmed_at, uploaded_at")
                .eq("firebase_uid", uid)
                .eq("transaction_id", txId)
                .maybeSingle();
            if (lookupError) throw lookupError;
            if (!receipt) return respond({ ok: false, error: "RECEIPT_NOT_FOUND" }, 404);

            const { data: signed, error: signedError } = await supabase.storage
                .from(receipt.storage_bucket)
                .createSignedUrl(receipt.storage_path, 600);
            if (signedError) throw signedError;
            return respond({ ok: true, receipt, signedUrl: signed?.signedUrl || null });
        }

        if (action !== "upload") {
            return respond({ ok: false, error: "INVALID_ACTION" }, 400);
        }

        const image = parseImage(body.imageBase64, body.mimeType);
        // Ruta estable: reemplazar una foto JPEG por PNG no deja un objeto
        // huérfano con otra extensión.
        const storagePath = `${uid}/${txId}`;
        const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, image.binary, {
                contentType: image.mimeType,
                upsert: true,
                cacheControl: "3600",
            });
        if (uploadError) throw uploadError;

        const confirmedMillis = Number(body.userConfirmedAt);
        const confirmedAt = Number.isFinite(confirmedMillis) && confirmedMillis > 0
            ? new Date(confirmedMillis).toISOString()
            : new Date().toISOString();
        const row = {
            firebase_uid: uid,
            transaction_id: txId,
            project_id: body.projectId ? String(body.projectId) : null,
            period_id: body.periodId ? String(body.periodId) : null,
            storage_bucket: BUCKET,
            storage_path: storagePath,
            mime_type: image.mimeType,
            file_size_bytes: image.binary.byteLength,
            original_name: body.originalName ? String(body.originalName).slice(0, 255) : null,
            ocr_data: safeObject(body.ocr),
            movement_data: safeObject(body.movement),
            status: "confirmed",
            confirmed_at: confirmedAt,
            uploaded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        const { data: receipt, error: upsertError } = await supabase
            .from("petty_cash_receipts")
            .upsert(row, { onConflict: "firebase_uid,transaction_id" })
            .select("transaction_id, storage_bucket, storage_path, mime_type, file_size_bytes, status, confirmed_at, uploaded_at")
            .single();
        if (upsertError) throw upsertError;

        return respond({ ok: true, path: `${BUCKET}/${storagePath}`, receipt });
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        const status = message === "INVALID_FIREBASE_TOKEN" ? 401 : 500;
        console.error("petty-cash-receipt", message);
        return respond({ ok: false, error: message }, status);
    }
});
