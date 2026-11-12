const permittedPaths = new Set([
  "/api/v1/csrf-token",
  "/api/v1/auth/signup",
  "/api/v1/auth/login",
  "/api/v1/auth/me",
  "/api/v1/auth/logout",
]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const documentPath =
    path === "/api/v1/orgs" ||
    /^\/api\/v1\/orgs\/[^/]+\/documents(?:\/[0-9a-f-]{36}(?:\/versions(?:\/[0-9]+\/restore)?)?)?$/i.test(
      path,
    ) ||
    /^\/api\/v1\/orgs\/[^/]+\/categories(?:\/[0-9a-f-]{36}(?:\/restore)?)?$/i.test(
      path,
    ) ||
    /^\/api\/v1\/orgs\/[^/]+\/trash(?:\/[0-9a-f-]{36}\/restore)?$/i.test(path);
  if (!permittedPaths.has(path) && !documentPath) {
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
