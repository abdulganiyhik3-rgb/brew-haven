import { createClient } from "npm:@supabase/supabase-js@2";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
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

function validPost(input: Record<string, unknown>) {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 150) return null;
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 5000) return null;
  const author = input.author === undefined ? "Brew Haven" : input.author;
  if (typeof author !== "string" || !author.trim() || author.length > 100) return null;
  return { title: input.title.trim(), content: input.content.trim(), author: author.trim() };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname.replace(/^\/posts/, "") || "/";
  const method = request.method.toUpperCase();
  try {
    if (method === "GET" && path === "/") {
      const data = failOnError(await getSupabase().from("posts")
        .select("id,title,content,author,created_at")
        .order("created_at", { ascending: false }));
      return json(data, 200, headers);
    }

    if (!path.startsWith("/admin")) throw new HttpError(404, "API endpoint not found.");
    await requireAdmin(request);
    const client = getSupabase();
    const postId = path.match(/^\/admin\/([^/]+)$/)?.[1];

    if (method === "GET" && path === "/admin") {
      return json(failOnError(await client.from("posts").select("*").order("created_at", { ascending: false })), 200, headers);
    }
    if (method === "POST" && path === "/admin") {
      const post = validPost(await readJson(request));
      if (!post) throw new HttpError(400, "Provide a title, content, and author with valid lengths.");
      return json(failOnError(await client.from("posts").insert(post).select().single()), 201, headers);
    }
    if (postId && (method === "PATCH" || method === "PUT")) {
      const post = validPost(await readJson(request));
      if (!post) throw new HttpError(400, "Provide a title, content, and author with valid lengths.");
      return json(failOnError(await client.from("posts").update(post).eq("id", postId).select().single()), 200, headers);
    }
    if (postId && method === "DELETE") {
      failOnError(await client.from("posts").delete().eq("id", postId));
      return new Response(null, { status: 204, headers });
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
