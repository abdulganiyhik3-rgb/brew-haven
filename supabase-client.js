import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before using the website.");
}

const localHosts = ["localhost", "127.0.0.1", "[::1]"];
const isLocal = localHosts.includes(window.location.hostname);
const localApiBaseUrl = window.location.port === "3000" ? "" : "http://localhost:3000";

export function apiUrl(path) {
  if (isLocal) return `${localApiBaseUrl}${path}`;

  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  const adminResource = pathname.match(/^\/api\/admin\/(products|posts|orders)(\/.*)?$/);
  let functionName;
  let functionPath;

  if (pathname === "/api/health") {
    functionName = "health";
    functionPath = "/";
  } else if (pathname === "/api/admin/sales") {
    functionName = "orders";
    functionPath = "/admin/sales";
  } else if (adminResource) {
    functionName = adminResource[1];
    functionPath = `/admin${adminResource[2] || ""}`;
  } else if (/^\/api\/(products|posts)$/.test(pathname)) {
    functionName = pathname.endsWith("/products") ? "products" : "posts";
    functionPath = "/";
  } else if (pathname === "/api/orders") {
    functionName = "payments";
    functionPath = "/orders";
  } else if (pathname.startsWith("/api/payments/")) {
    functionName = "payments";
    functionPath = pathname.slice("/api/payments".length);
  } else {
    throw new Error(`No Supabase function is configured for ${pathname}.`);
  }

  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}${functionPath}${url.search}`;
}

export const supabaseApiKey = supabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
