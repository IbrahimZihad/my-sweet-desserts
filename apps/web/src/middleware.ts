import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge check only. The API still verifies the JWT and session on every
 * request — a forged cookie gets a 401 from NestJS, not access.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("cf_access"));

  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/admin/login" && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
