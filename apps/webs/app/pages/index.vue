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
  <main class="page dashboard-page">
    <div class="breadcrumb">Workspace <span>/</span> 대시보드</div>
    <div class="page-heading">
      <div>
        <p class="eyebrow">WORKSPACE OVERVIEW</p>
        <h1>Portfolio</h1>
        <p class="page-description">
          조직의 문서를 관리하고 서비스 상태를 확인하세요.
        </p>
      </div>
      <NuxtLink class="button button-primary" to="/documents">
        문서 워크스페이스 <span aria-hidden="true">→</span>
      </NuxtLink>
    </div>

    <section class="welcome-banner" aria-labelledby="welcome-heading">
      <div>
        <p class="banner-label">YOUR KNOWLEDGE, ORGANIZED</p>
        <h2 id="welcome-heading">팀의 지식을 더 쉽게 공유하세요</h2>
        <p>조직별 문서와 변경 이력을 한곳에서 살펴볼 수 있습니다.</p>
        <NuxtLink to="/login">
          로그인 및 회원가입 <span aria-hidden="true">→</span>
        </NuxtLink>
      </div>
      <div class="banner-graphic" aria-hidden="true">
        <span class="graphic-line" /><span class="graphic-line" /><span
          class="graphic-line"
        />
        <span class="graphic-square">P</span>
      </div>
    </section>

    <div class="section-heading">
      <div>
        <p class="eyebrow">GET STARTED</p>
        <h2>워크스페이스</h2>
      </div>
      <span class="section-caption">자주 사용하는 작업</span>
    </div>
    <section class="quick-grid" aria-label="워크스페이스 바로가기">
      <NuxtLink class="quick-card" to="/documents">
        <span class="quick-icon" aria-hidden="true">▤</span>
        <span class="quick-card-text">
          <strong>조직과 문서</strong>
          <small>문서 검색, 작성 및 이력 관리</small>
        </span>
        <span class="quick-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
      <NuxtLink class="quick-card" to="/login">
        <span class="quick-icon quick-icon-blue" aria-hidden="true">◉</span>
        <span class="quick-card-text">
          <strong>계정 관리</strong>
          <small>로그인 및 계정 상태 확인</small>
        </span>
        <span class="quick-arrow" aria-hidden="true">↗</span>
      </NuxtLink>
    </section>

    <section class="panel health-panel" aria-live="polite">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">SYSTEM STATUS</p>
          <h2>서비스 상태</h2>
        </div>
        <span
          class="health-indicator"
          :class="{ 'health-indicator-ok': data && !error }"
        >
          <span aria-hidden="true" />
          {{
            error ? "확인 필요" : status === "pending" ? "확인 중" : "상태 확인"
          }}
        </span>
      </div>
      <p class="muted">API and database service status</p>
      <div class="health-result">
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
      </div>
    </section>
  </main>
</template>
