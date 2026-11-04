# Plans

## 진행 단계 (2026-11-01 기준)

1. 문서 정리 (#1)
2. 전면 리디자인 시안 확정 (#2)
3. 툴체인 현대화와 보안 구조 (#3)
4. 암호화 모듈 → v2 저장소 → v1 마이그레이션 (#4, #5, #6)
5. 시안 기준 UI 구현 (#7)
6. 기능 추가: 계정 관리, 보안 편의, 정리 기능, 백업/복원 (#8 ~ #11)
7. 패키징과 통합 검증 (#12, #13)

## v2 암호화 설계 초안

- KDF: scrypt (N=2^17, r=8, p=1, 128MiB). Electron 45(Node 24.22)는 BoringSSL을 써서 `crypto.argon2`가 'Argon2 algorithm not supported'로 실패하므로 Argon2id는 쓰지 않는다(2026-11-04 확인). scrypt는 Node 내장이라 의존성이 없다. 파라미터는 KDF 이름과 함께 저장해서 나중에 올릴 수 있게 한다.
- KEK = KDF(password, salt 16B). DEK = 랜덤 32B.
- wrapped_dek = AES-256-GCM(KEK, iv 12B, DEK, aad = `keyhub:v2:dek:<account_uuid>`).
- 필드 암호화: AES-256-GCM(DEK, 랜덤 iv 12B, plaintext, aad = `<table>:<column>:<row uuid>`). 행 사이에서 암호문을 바꿔치기하지 못하게 한다.
- 세션 동안 DEK는 메인 프로세스 메모리에만 둔다. 잠금·로그아웃 시 버퍼를 0으로 덮어쓴다.

## 마이그레이션 설계 초안

- 로그인 시 v2 계정이 없고 v1 계정이 있으면 `sha256(sha256(pw))` 검증 후 변환한다.
- v1 DB를 읽기 전용으로 열고, 새 v2 DB를 임시 파일로 만들어 채운 뒤 전부 다시 복호화해서 원본과 대조한다. 성공하면 rename으로 확정한다.
- 변환이 성공하면 core v1의 해당 계정을 수정하지 않고, v2 쪽에 `migrated_from_v1` 기록만 남긴다.

## 툴체인 메모 (2026-11-04)

- Electron 45.2.2 / Node 24.22.2 / Chromium 156. SQLite는 내장 `node:sqlite`(3.53.4)를 써서 네이티브 모듈이 없다.
- Electron 45 패키지에는 바이너리 다운로드 install 스크립트가 없어 `postinstall`에서 `node_modules/electron/install.js`를 직접 실행한다.
- 이 개발 환경에는 `ELECTRON_RUN_AS_NODE=1`이 설정되어 있어 `scripts/dev.mjs`, `scripts/start.mjs`에서 지우고 실행한다.
- dev 모드 데이터는 레포의 `.devdata/`, 이전 데이터는 레포의 `datafiles/v1/`(또는 `TESSERA_LEGACY_DIR`)을 쓴다.
- 패키징 때 Electron fuse(RunAsNode, NODE_OPTIONS, inspect 인자 끄기)와 asar 무결성 검사를 켠다(#12).

## 미결정 사항

- 없음. 세부 파라미터는 #4에서 측정 후 확정한다.
