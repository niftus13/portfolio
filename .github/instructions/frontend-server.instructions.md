---
description: "Nuxt 서버 API, same-origin 프록시, 쿠키·CSRF와 백엔드 응답 전달을 구현할 때 사용한다."
applyTo: "apps/webs/server/**/*.{ts,js,mjs}"
---

# Nuxt 서버 및 프록시 지침

- `server/` 코드는 서버에서 실행되며 내부 API 주소와 서버 전용 설정을 브라우저 번들에 노출하지 않는다.
- 프록시는 확정된 계약에 따라 HTTP 메서드·본문, 쿠키·필요한 헤더, 상태 코드와 오류를 보존한다. 필요한 헤더를 명시적으로 처리하고 신뢰할 수 없는 전달 헤더를 무조건 신뢰하지 않는다.
- 로그인 전·후 CSRF, Origin 검증과 세션 쿠키 전달은 [MVP 명세](../../specs/multitenant-mvp.md) 및 확정된 API 계약을 따른다.
- 프록시 오류를 성공 응답으로 바꾸지 않는다. 브라우저에서 실제 API를 통한 인증·쿠키·CSRF 흐름을 검증하고 fixture 기반 테스트와 구분한다.
