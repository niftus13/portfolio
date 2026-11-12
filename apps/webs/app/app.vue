<template>
  <div class="console-shell">
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <NuxtLink class="brand" to="/" aria-label="Portfolio 콘솔 홈">
        <span class="brand-mark" aria-hidden="true">P</span>
        <span>portfolio<span class="brand-accent">.</span></span>
        <span class="brand-divider" aria-hidden="true" />
        <span class="brand-subtitle">Workspace Console</span>
      </NuxtLink>
      <div class="topbar-right">
        <span class="topbar-context">조직 문서 워크스페이스</span>
        <NuxtLink class="topbar-account" to="/login">
          <span class="account-avatar" aria-hidden="true">●</span>
          계정
        </NuxtLink>
      </div>
    </header>
    <div class="console-body">
      <aside class="sidebar">
        <p class="sidebar-caption">WORKSPACE</p>
        <nav aria-label="주 메뉴" class="sidebar-nav">
          <NuxtLink to="/" exact-active-class="nav-active">
            <span class="nav-icon" aria-hidden="true">▦</span> 대시보드
          </NuxtLink>
          <NuxtLink to="/documents" active-class="nav-active">
            <span class="nav-icon" aria-hidden="true">▤</span> 조직과 문서
          </NuxtLink>
          <NuxtLink to="/login" active-class="nav-active">
            <span class="nav-icon" aria-hidden="true">◉</span> 계정
          </NuxtLink>
        </nav>
        <div class="sidebar-footer">
          <span class="sidebar-footer-label">PORTFOLIO MVP</span>
          <p>팀의 지식을 한곳에서 안전하게 관리하세요.</p>
        </div>
      </aside>
      <div id="main-content" class="console-content" tabindex="-1">
        <NuxtPage />
      </div>
    </div>
  </div>
</template>

<style src="./assets/console.css"></style>
