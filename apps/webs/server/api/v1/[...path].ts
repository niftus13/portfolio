const permittedPaths = new Set([
  "/api/v1/csrf-token",
  "/api/v1/auth/signup",
  "/api/v1/auth/login",
  "/api/v1/auth/me",
  "/api/v1/auth/logout",
]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (!permittedPaths.has(path)) {
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
  }
  const ip = getRequestIP(event) ?? (import.meta.dev ? "127.0.0.1" : undefined);
  if (!ip) {
    throw createError({
      statusCode: 503,
      statusMessage: "Client IP unavailable",
    });
  }
  const { apiInternalUrl } = useRuntimeConfig(event);
  return proxyRequest(event, `${apiInternalUrl}${path}`, {
    headers: { "x-forwarded-for": ip },
    streamRequest: true,
  });
});
