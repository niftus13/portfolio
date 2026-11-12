---
description: "Playwright 브라우저 E2E에서 Nuxt 프록시, 인증, 실제 API와 사용자 흐름을 검증할 때 사용한다."
applyTo: "tests/e2e/**/*.{ts,js,mjs,cjs}"
---

# 브라우저 E2E 지침

- `tests/e2e/`에는 사용자 관점의 Playwright 흐름을 둔다. 명세의 정상·실패 결과와 접근 가능한 화면 상태를 단언한다.
- fixture 기반 테스트와 브라우저→Nuxt→실제 API→MySQL 테스트를 구분한다. 현재 `pnpm test:e2e`의 health fixture는 실제 API·DB 검증이 아니다.
- 인증 기능이 구현되면 실제 API의 쿠키·CSRF·만료·로그아웃을 브라우저에서 검증하고, 문서 기능부터 실제 API 문서 E2E를 추가한다.
- 임의의 대기 시간이나 기존 서비스 재사용에 의존하지 않는다. 실제 API E2E 실행 구성이 추가되면 root 명령과 `tests/e2e/README.md`에 준비·정리 방법을 기록한다.
