---
description: "MySQL SQL migration과 데이터 이관을 작성하거나 변경할 때 사용한다."
applyTo: "apps/api/migrations/**/*.{sql,ts,js,mjs}"
---

# MySQL migration 지침

- 버전 관리되는 순방향 migration으로 기존 데이터와 적용 이력을 보존한다. 운영 데이터베이스·볼륨 초기화나 자동 파괴적 downgrade를 포함하지 않는다.
- 변경 전에 기존 스키마와 [MVP 명세](../../specs/multitenant-mvp.md)를 확인하고 테넌트 복합 FK, 삭제 제한, 문자 비교와 인덱스 영향을 검토한다.
- 빈 DB 적용, 재실행·부분 실패와 기존 데이터 영향을 격리된 실제 MySQL에서 확인한다. 복구가 필요하면 명시적인 운영 절차로 다룬다.
- 실행기와 명령이 구현되면 실제 실행 방법과 실패·복구 절차를 `apps/api/migrations/README.md` 및 관련 문서에 기록한다. 현재 실행기가 있다고 가정하지 않는다.
