function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400"
  });
  const origin = request.headers.get("origin");
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && (allowedOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

Deno.serve((request: Request): Response => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const path = new URL(request.url).pathname.replace(/^\/health/, "") || "/";
  if (request.method === "GET" && path === "/") {
    return new Response(JSON.stringify({ success: true, message: "Brew Haven API is running!" }), {
      headers: { ...Object.fromEntries(headers), "Content-Type": "application/json; charset=utf-8" }
    });
  }
  return new Response(JSON.stringify({ error: "API endpoint not found." }), {
    status: 404,
    headers: { ...Object.fromEntries(headers), "Content-Type": "application/json; charset=utf-8" }
  });
});
