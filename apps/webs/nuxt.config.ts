export default defineNuxtConfig({
  devtools: { enabled: false },
  runtimeConfig: {
    apiInternalUrl: "http://127.0.0.1:4000",
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
});
