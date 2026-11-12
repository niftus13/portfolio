---
description: "Express 라우트, 컨트롤러, 미들웨어에서 입력 검증, 인증, 테넌트 컨텍스트와 HTTP 응답을 구현할 때 사용한다."
applyTo: "apps/api/src/{routes,controllers,middleware}/**/*.ts"
---

# 백엔드 HTTP 경계 지침

- `routes/`는 경로와 미들웨어를 연결하고, `controllers/`는 HTTP 입력·출력을 도메인 작업에 연결한다. 비즈니스 규칙과 SQL은 해당 서비스·repository에 둔다.
- `middleware/`는 인증과 검증된 멤버십 등 공통 요청 경계를 담당한다. 클라이언트가 보낸 조직 식별자를 인증된 테넌트 컨텍스트로 그대로 사용하지 않는다.
- params·query·body와 쿠키·헤더를 신뢰 경계에서 검증하고, 인증·권한과 오류 순서는 관련 [MVP 명세](../../specs/multitenant-mvp.md)와 기능 API 계약을 따른다.
- 보안 헤더, 세션, CSRF 및 프록시 처리에 대한 미확정 세부 정책을 임의로 정하지 않는다. 비밀이나 내부 예외를 응답과 로그에 노출하지 않는다.
- 요청·응답 계약이 바뀌면 호출자와 API 명세를 함께 갱신하고 정상·입력 오류·인증/권한 실패를 검증한다.
