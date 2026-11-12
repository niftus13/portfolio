---
description: "Vitest 통합 테스트에서 실제 MySQL, API, 트랜잭션, 테넌트 격리 및 동시성을 검증할 때 사용한다."
applyTo: "tests/integration/**/*.{ts,js,mjs,cjs}"
---

# 통합 테스트 지침

- `tests/integration/`에는 컴포넌트 간 동작을 검증하는 Vitest 테스트를 둔다. 요구사항과 기대 결과는 [MVP 체크리스트](../../specs/multitenant-mvp-checklist.md)에 연결한다.
- DB 제약·트랜잭션·경합은 분리된 실제 MySQL로 확인한다. 애플리케이션이나 다른 사용자의 DB·볼륨을 정리 대상으로 사용하지 않는다.
- 격리·실패 주입·동시 요청의 결과를 명시적으로 단언하고 테스트별 데이터와 연결을 정리한다. mock만으로 DB 무결성 검증이 완료됐다고 보고하지 않는다.
- 현재 명령은 `pnpm test:integration`이다. 실제 MySQL 준비와 실행 방식이 추가되면 관련 README와 CI를 함께 갱신한다.
