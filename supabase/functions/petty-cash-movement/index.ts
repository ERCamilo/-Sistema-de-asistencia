import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FIREBASE_API_KEY = "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA";
const MAX_BODY_BYTES = 256 * 1024;

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

function requiredId(value: unknown, label: string) {
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error(`INVALID_${label}`);
    return id;
}

function optionalText(value: unknown, maxLength: number) {
    const text = String(value || "").trim();
    return text ? text.slice(0, maxLength) : null;
}

function sourceTimestamp(value: unknown) {
    const millis = Number(value);
    if (!Number.isFinite(millis) || millis <= 0) throw new Error("INVALID_SOURCE_TIMESTAMP");
    return new Date(millis).toISOString();
}

function invoiceDate(movement: Record<string, unknown>) {
    const value = String(movement.fechaEmision || movement.date || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return respond({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
        return respond({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    try {
        const body = safeObject(await request.json());
        const idToken = String(body.idToken || "");
        const action = String(body.action || "upsert");
        const movement = safeObject(body.movement);
        if (!idToken) return respond({ ok: false, error: "MISSING_ID_TOKEN" }, 401);
        if (!["upsert", "delete"].includes(action)) {
            return respond({ ok: false, error: "INVALID_ACTION" }, 400);
        }

        const uid = await verifyFirebaseToken(idToken);
        const transactionId = requiredId(movement.id || body.transactionId, "TRANSACTION_ID");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!supabaseUrl || !serviceRoleKey) throw new Error("MISSING_SERVER_CONFIGURATION");
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        if (action === "delete" && (!movement.projectId || !movement.periodId)) {
            const { error } = await supabase
                .from("petty_cash_movements")
                .update({
                    deleted_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("firebase_uid", uid)
                .eq("transaction_id", transactionId);
            if (error) throw error;
            return respond({ ok: true, transactionId, deleted: true });
        }

        const projectId = requiredId(movement.projectId, "PROJECT_ID");
        const periodId = requiredId(movement.periodId, "PERIOD_ID");
        const recordNumber = Number(movement.recordNumber);
        const amount = Number(movement.amount);
        const movementType = String(movement.type || "");
        if (!Number.isInteger(recordNumber) || recordNumber <= 0) {
            throw new Error("INVALID_RECORD_NUMBER");
        }
        if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_AMOUNT");
        if (!["gasto", "reposicion"].includes(movementType)) {
            throw new Error("INVALID_MOVEMENT_TYPE");
        }

        const now = new Date().toISOString();
        const row = {
            firebase_uid: uid,
            transaction_id: transactionId,
            project_id: projectId,
            period_id: periodId,
            record_number: recordNumber,
            movement_type: movementType,
            amount,
            invoice_date: invoiceDate(movement),
            provider: optionalText(movement.paidTo || movement.description, 200),
            ncf: optionalText(movement.ncf, 80),
            rnc_emisor: optionalText(movement.rncEmisor, 32),
            source_created_at: sourceTimestamp(movement.createdAt),
            source_updated_at: sourceTimestamp(movement.updatedAt || movement.createdAt),
            deleted_at: action === "delete" ? now : null,
            payload: movement,
            updated_at: now,
        };
        const { error } = await supabase
            .from("petty_cash_movements")
            .upsert(row, { onConflict: "firebase_uid,transaction_id" });
        if (error) throw error;
        return respond({ ok: true, transactionId, deleted: action === "delete" });
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        const status = message === "INVALID_FIREBASE_TOKEN"
            ? 401
            : message === "PAYLOAD_TOO_LARGE"
            ? 413
            : message.startsWith("INVALID_")
            ? 400
            : 500;
        console.error("petty-cash-movement", message);
        return respond({ ok: false, error: message }, status);
    }
});
