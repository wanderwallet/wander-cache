import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set(["global-stg.transak.com", "global.transak.com"]);

const ERROR_RESPONSES = {
  MISSING_TO: NextResponse.json(
    { error: "Missing 'to' query parameter" },
    { status: 400 }
  ),
  INVALID_URL: NextResponse.json(
    { error: "Invalid target URL - only Transak domains are allowed" },
    { status: 400 }
  ),
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const target = searchParams.get("to");

  if (!target) return ERROR_RESPONSES.MISSING_TO;

  try {
    const targetUrl = new URL(target);

    // if (
    //   targetUrl.protocol !== "https:" ||
    //   !ALLOWED_HOSTS.has(targetUrl.hostname)
    // ) {
    //   return ERROR_RESPONSES.INVALID_URL;
    // }

    for (const [key, value] of searchParams) {
      if (key !== "to") {
        targetUrl.searchParams.set(key, value);
      }
    }

    const redirectUrl = targetUrl.toString();

    // Optimized HTML with minimal content and faster redirect
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting...</title><script>window.onload = function() { location.href = '${redirectUrl}'; }</script></head><body></body></html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Referer: request.nextUrl.origin,
        ReferrerPolicy: "strict-origin-when-cross-origin",
      },
    });
  } catch {
    return ERROR_RESPONSES.INVALID_URL;
  }
}
