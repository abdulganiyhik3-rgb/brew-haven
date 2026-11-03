import { createClient } from "npm:@supabase/supabase-js@2";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const statuses = ["new", "preparing", "ready", "completed", "cancelled"];

function json(body: unknown, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400"
  });
  const origin = request.headers.get("origin");
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim());
  if (origin && (allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 32 * 1024) throw new HttpError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 32 * 1024) throw new HttpError(413, "Request body is too large.");
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "A JSON object is required.");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "A valid JSON body is required.");
  }
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(503, "Supabase configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function failOnError<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function requireAdmin(request: Request): Promise<void> {
  const allowedEmails = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!allowedEmails.length) throw new HttpError(503, "Set ADMIN_EMAILS in Supabase function secrets.");
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in with an admin account to continue.");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new HttpError(503, "Supabase Auth configuration is incomplete.");
  const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session is invalid or has expired. Sign in again.");
  if (!data.user.email || !allowedEmails.includes(data.user.email.toLowerCase())) {
    throw new HttpError(403, "This account is not authorized to use the admin dashboard.");
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/orders/, "") || "/";
  const method = request.method.toUpperCase();
  try {
    if (!path.startsWith("/admin")) throw new HttpError(404, "API endpoint not found.");
    await requireAdmin(request);
    const client = getSupabase();

    if (method === "GET" && path === "/admin") {
      return json(failOnError(await client.from("orders").select("*").order("created_at", { ascending: false })), 200, headers);
    }
    if (method === "GET" && path === "/admin/sales") {
      const orders = failOnError(await client.from("orders")
        .select("id,total,status,payment_status,created_at")
        .eq("payment_status", "paid")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false }));
      return json({
        total: orders.reduce((sum, order) => sum + Number(order.total), 0),
        order_count: orders.length,
        orders
      }, 200, headers);
    }

    const orderId = path.match(/^\/admin\/([^/]+)$/)?.[1];
    if (orderId && method === "PATCH") {
      const body = await readJson(request);
      const status = body.status;
      if (!statuses.includes(status as string)) throw new HttpError(400, "Choose a valid order status.");
      const order = failOnError(await client.from("orders").select("payment_status").eq("id", orderId).single());
      if (order.payment_status !== "paid") throw new HttpError(409, "Only verified paid orders can be processed.");
      return json(failOnError(await client.from("orders").update({ status }).eq("id", orderId).select().single()), 200, headers);
    }
    throw new HttpError(404, "API endpoint not found.");
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    const message = status < 500 && error instanceof Error ? error.message
      : status === 503 && error instanceof Error ? error.message
      : "The request could not be completed. Check the function logs and backend configuration.";
    return json({ error: message }, status, headers);
  }
});
