<script setup lang="ts">
interface HealthResponse {
  status: string;
  database: string;
}

const { data, error, status, refresh } =
  await useFetch<HealthResponse>("/api/health");
const hydrated = ref(false);

onMounted(() => {
  hydrated.value = true;
});
</script>

<template>
  <main>
    <h1>Portfolio</h1>
    <p>API and database service status</p>

    <section aria-live="polite">
      <p v-if="status === 'pending'">Checking service health…</p>
      <p v-else-if="error" role="alert">
        Service status is unavailable. Please try again.
      </p>
      <p v-else-if="data">
        API: {{ data.status }} · MySQL: {{ data.database }}
      </p>
      <button
        type="button"
        :disabled="!hydrated || status === 'pending'"
        @click="refresh()"
      >
        Check again
      </button>
    </section>
  </main>
</template>
