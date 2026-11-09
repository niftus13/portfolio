export default defineEventHandler(async (event) => {
  const { apiInternalUrl } = useRuntimeConfig(event);

  try {
    return await $fetch(`${apiInternalUrl}/health/ready`);
  } catch (error) {
    console.error("Upstream API health request failed", error);
    throw createError({
      statusCode: 503,
      statusMessage: "Service health is unavailable",
    });
  }
});
