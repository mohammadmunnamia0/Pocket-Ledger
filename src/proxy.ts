import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

const PUBLIC_PATHS = ["/login", "/setup"];

/**
 * Optimistic auth gate: redirect visitors without a valid session cookie to /login.
 * Every page, action and route handler still re-verifies the session via requireUser().
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const userId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  // API calls (e.g. offline sync) get a 401 they can handle, not a redirect to the sign-in page.
  if (!userId && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!userId && !isPublic) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (userId && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // PWA files (manifest, service worker, offline page) must load without a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline|.*\\.(?:png|svg|ico|webp)$).*)"],
};
