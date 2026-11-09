# Web application

The web app uses Nuxt 4, Vue 3, and TypeScript.

## Local development

Run `pnpm dev:web` to start the Nuxt development server on port `3000`.

The server-side `/api/health` endpoint forwards to the private runtime setting `NUXT_API_INTERNAL_URL` (default `http://127.0.0.1:4000`). The browser only requests the same-origin Nuxt route; it does not need database credentials or direct access to the API service.

Run `pnpm --filter @portfolio/webs build` to create the production `.output` server bundle or `pnpm --filter @portfolio/webs typecheck` to type-check the Nuxt application.
