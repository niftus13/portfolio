---
description: "테스트를 작성하거나 수정할 때 적용한다."
applyTo: "tests/**/*.{ts,js,mjs,cjs},evals/cases/**/*.ts"
---

# 테스트 지침

- 실제 MySQL 통합 테스트는 [통합 테스트 세부 지침](integration-testing.instructions.md)을 따른다.
- 브라우저 및 프록시 검증은 [E2E 세부 지침](e2e-testing.instructions.md)을 따른다.

- 단위·통합 테스트는 Vitest로 작성하고 `tests/unit/`, `tests/integration/`에 둔다.
- 사용자 흐름의 브라우저 검증은 Playwright로 작성하고 `tests/e2e/`에 둔다.
- 결정적이고 반복 가능한 회귀 평가 케이스는 `evals/cases/*.eval.test.ts`에 두고 Vitest로 실행한다.
- 테스트 이름에는 조건과 기대 결과가 드러나야 한다.
- 구현 상세보다 외부에서 관찰할 수 있는 동작을 검증한다.
- 정상 경로뿐 아니라 입력 오류, 권한 오류, 예외 경로를 검증한다.
- 실행 순서에 의존하지 않도록 데이터를 준비하고 정리한다.
- DB 동작이 중요한 트랜잭션·제약 조건은 적절한 통합 테스트로 검증한다.
- 테넌트 격리·DB 제약·경합은 분리된 실제 MySQL에서 확인하고, fixture 기반 E2E와 실제 API·DB E2E를 구분한다.
- 명세의 예상 결과와 실행 명령을 연결하고, 명령이 아직 없다면 미구현으로 표시한다.
- 실패를 숨기기 위해 단언을 제거하거나 테스트를 비활성화하지 않는다.
- 임의의 시간 대기 대신 상태 변화나 명시적 조건을 기다린다.
