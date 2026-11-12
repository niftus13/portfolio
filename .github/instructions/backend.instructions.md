---
description: "백엔드 API, 데이터베이스, 인증 및 서비스 로직을 구현하거나 수정할 때 적용한다."
applyTo: "apps/api/**/*.{ts,sql}"
---

# 백엔드 개발 지침

## 디렉토리별 세부 지침

- `src/routes/`, `src/controllers/`, `src/middleware/`: [HTTP 경계](backend-http.instructions.md)
- `src/services/`: [서비스](backend-service.instructions.md)
- `src/repositories/`: [repository](backend-repository.instructions.md)
- `migrations/`: [MySQL migration](database-migrations.instructions.md)
- 루트 `scripts/`: [운영 스크립트](operational-scripts.instructions.md)
- 루트 `specs/`: [명세와 API 계약](specifications.instructions.md)

경로는 `apps/api/` 기준이며 필요한 계층만 생성한다. 기존 도메인 helper는 관련 작업 없이 이동하지 않는다. 구조 결정과 현재 구현 상태는 [디렉토리 결정 기록](../../docs/decisions/002-implementation-directory-layout.md)을 따른다.

## 설계

- 기존 route, controller, service, repository의 책임을 유지한다.
- controller는 요청과 응답을 처리하고 비즈니스 규칙은 service에 둔다.
- repository는 데이터 접근에 집중한다.
- 단순 기능에 불필요한 추상 계층이나 디자인 패턴을 추가하지 않는다.

## API 입력과 출력

- 기능 정책과 API 계약은 `specs/`를 먼저 확인하고, 확정되지 않은 동작은 임의로 결정하지 않는다.
- params, query, body를 신뢰 경계에서 검증한다.
- 인증 및 권한 검사를 수행한 뒤 보호된 작업을 실행한다.
- API 응답과 오류는 프로젝트의 공통 계약을 따른다.
- API 계약을 변경하면 관련 문서와 호출자를 함께 확인한다.

## 테넌트 격리

- 테넌트 식별값을 클라이언트 입력만으로 신뢰하지 않는다.
- 인증된 사용자와 검증된 멤버십을 통해 접근 가능 여부를 확인한다.
- 테넌트 소유 데이터의 조회·변경에 테넌트 범위를 적용한다.
- 관계 데이터가 다른 테넌트에 속하지 않는지 확인한다.
- 다른 테넌트에 대한 접근 거부 테스트를 추가한다.

## 데이터 무결성

- 함께 성공하거나 실패해야 하는 DB 변경은 트랜잭션으로 처리한다.
- 문서 생성 시 최초 이력을 함께 저장하고, 수정 시 revision 검사와 이력 저장을 해당 기능과 함께 구현한다.
- 성공한 멤버 변경과 감사 기록은 함께 커밋한다. 권한 거부·로그인 실패 기록은 롤백되는 업무 트랜잭션과 분리하고 인증 성공·로그아웃은 확정된 정책을 따른다.
- 동시 요청과 중복 요청이 데이터에 미치는 영향을 검토한다.
- 스키마 변경은 프로젝트의 migration 정책을 따른다.
- 기존 데이터가 있는 환경에 적용 가능한지 검토한다.

## 오류 처리와 검증

- 예상 가능한 도메인 오류와 예상하지 못한 서버 오류를 구분한다.
- 내부 예외와 민감한 정보를 외부 응답에 노출하지 않는다.
- catch 후 오류를 무시하거나 성공 응답으로 바꾸지 않는다.
- 정상 요청, 입력 오류, 인증 실패, 권한 실패를 테스트한다.
- 테넌트 관련 작업은 교차 테넌트 접근 테스트를 추가한다.
- 변경 범위에 맞는 테스트와 타입 검사를 실행한다.
