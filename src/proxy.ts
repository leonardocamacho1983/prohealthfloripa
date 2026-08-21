import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/handoff(.*)",
  "/api/handoff(.*)",
  "/api/inbox(.*)",
  "/metrics(.*)",
  "/api/metrics(.*)",
  "/api/notifications(.*)",
  "/profile(.*)",
  "/api/profile(.*)",
  "/admin(.*)",
  "/api/admin(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    // The proxy verifies the Clerk session. Every server mutation must still
    // enforce its role/permission because proxy checks are defense in depth.
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
