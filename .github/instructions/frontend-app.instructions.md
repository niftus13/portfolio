---
description: "Nuxt 페이지, Vue 컴포넌트 및 composable의 사용자 흐름, 상태, 폼과 API 연동을 구현할 때 사용한다."
applyTo: "apps/webs/app/{pages,components,composables}/**/*.{vue,ts}"
---

# 프론트엔드 앱 디렉토리 지침

- `pages/`는 경로와 화면 흐름을, `components/`는 재사용 가능한 표시·입력을, `composables/`는 재사용되는 상태와 로직을 담당한다. 필요할 때만 분리하고 단일 사용 코드를 미리 추상화하지 않는다.
- [MVP 명세](../../specs/multitenant-mvp.md)와 관련 API 계약을 먼저 확인하고 인증·역할의 최종 판정은 서버에 맡긴다.
- 폼은 로딩·빈 상태·실패·재시도와 중복 제출을 다루고, revision 충돌 시 미저장 내용을 보존한다.
- Markdown과 링크는 MVP 명세의 허용 범위에 따라 안전하게 표시한다.
- 의미 있는 HTML, 입력 이름·오류 안내, 키보드 접근과 주요 화면 크기를 확인한다. 사용자 흐름의 실제 API 검증과 fixture 검증을 구분한다.
