# General Project Development Guidelines

- For behavior changes, add or update the relevant acceptance criteria in `specs/`.
- Keep automated checks close to their purpose: isolated logic in `tests/unit/`, cross-component behavior in `tests/integration/`, and representative regressions in `evals/cases/`.
- Prefer deterministic checks with explicit expected outcomes. Keep evaluation inputs and expected results reviewable.
- Run the narrowest relevant checks after a change using the root pnpm scripts. Document any newly introduced commands in the relevant README.
- Update architecture or decision records when a change materially changes system boundaries or an important technical choice.
- Follow the selected stack and tooling in `docs/decisions/001-stack-and-quality-tooling.md`; do not introduce alternatives without updating that decision.
- Match file-specific instructions to the actual paths: API code in `apps/api/`, web code in `apps/webs/`, and shared code in `packages/shared/`.
- Treat `pnpm verify` as the standard local gate. Browser E2E checks are separate because they require a running app and installed Playwright browser.

## 작업 전

- 관련 코드와 기존 구현 패턴을 먼저 확인한다.
- 변경 범위와 기존 동작에 미치는 영향을 파악한다.
- 중요한 요구사항이 불명확하면 추측하지 말고 확인한다.

## 구현

- 요청한 범위를 완결성 있게 구현하고 무관한 변경은 하지 않는다.
- 기존 아키텍처와 명명 규칙을 우선한다.
- 중복 로직을 추가하기 전에 기존 구현을 찾는다.
- 외부 입력은 신뢰 경계에서 검증한다.
- 오류를 숨기거나 성공처럼 처리하지 않는다.
- 비밀값과 인증 정보를 코드나 로그에 기록하지 않는다.
- 타입 안전성을 유지하고 불필요한 타입 단언을 피한다.

## 검증

- 변경한 기능의 정상·실패 경로를 테스트한다.
- 프로젝트에서 제공하는 관련 lint, 타입 검사, 테스트를 실행한다.
- 실행하지 못한 검증과 이유를 결과에 명시한다.
- 테스트가 없거나 placeholder인 경우 검증 완료라고 보고하지 않는다.

## 완료 보고

- 변경 내용
- 검증한 명령과 결과
- 남은 위험과 실행하지 못한 검증
