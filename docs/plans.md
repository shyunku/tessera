# Plans

## 진행 단계 (2026-11-01 기준)

1. 문서 정리 (#1)
2. 전면 리디자인 시안 확정 (#2)
3. 툴체인 현대화와 보안 구조 (#3)
4. 암호화 모듈 → v2 저장소 → v1 마이그레이션 (#4, #5, #6)
5. 시안 기준 UI 구현 (#7)
6. 기능 추가: 계정 관리, 보안 편의, 정리 기능, 백업/복원 (#8 ~ #11)
7. 패키징과 통합 검증 (#12, #13)

## v2 암호화 설계 (구현: `electron/crypto/vault-crypto.js`)

- KDF: scrypt (N=2^17, r=8, p=1, 128MiB, Electron에서 약 0.6초). Electron 45(Node 24.22)는 BoringSSL이라 `crypto.argon2`가 'Argon2 algorithm not supported'로 실패해서 Argon2id는 쓰지 않는다(2026-11-04 확인). 파라미터는 키링에 같이 저장하고, 읽을 때 메모리 512MiB·작업량 상한으로 검사한다(조작된 파일이 Electron 프로세스를 죽이지 못하게).
- KEK = scrypt(password NFC, salt 16B). DEK = 랜덤 32B(`Buffer.alloc`, 공유 풀 밖). wrapped_dek = AES-256-GCM(KEK, DEK, AAD `tessera:dek`).
- 봉인 형식: `[형식 1B][IV 12B][태그 16B][암호문]`. 형식 바이트도 AAD에 포함한다.
- 필드 AAD: `tessera:<table>:<column>:<rowId>`. 키 이름·값의 rowId는 `itemId/fieldId`라서 다른 항목으로 옮겨 붙이면 감지된다. table/column/rowId 형식을 검사한다.
- 오답 비밀번호(GCM 태그 실패)와 손상·알 수 없는 형식(`CorruptDataError`)을 구분한다. 손상을 오답으로 알려 사용자가 초기화하는 일을 막는다.
- 비밀번호 변경 시 DEK를 새로 만들고 모든 이름·값을 다시 암호화한다. 예전 파일 사본 + 예전 비밀번호로 이후 데이터를 열 수 없다(이미 만든 백업은 예전 비밀번호로 열린다).
- 평문으로 남는 것: 폴더 구조·순서, 즐겨찾기, 조회수, 시각, 항목별 키 개수. 폴더·항목의 위치 관계는 인증하지 않는다(오프라인으로 파일을 고치면 구조를 바꿀 수 있음, 내용은 못 읽음).
- 버퍼 지우기는 최선 노력이다. JS 문자열(비밀번호, 화면에 보인 값)과 라이브러리 내부 사본은 지울 수 없다.
- 2026-11-04 적대적 리뷰 반영: KDF 곱 상한, 손상/오답 구분, 중간 평문 버퍼 제거, sealString 타입 검사, AAD 입력 검사, Uint8Array 일관 처리, 깨진 유니코드 비밀번호 거부, DEK 교체, 필드-항목 바인딩, 형식 바이트 인증, Electron 런타임 테스트(`npm run test:electron`).

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

- 없음.
