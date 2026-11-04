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

## v1 마이그레이션 (구현: `electron/legacy/`)

- 첫 실행에 v2 데이터가 없고 `%APPDATA%\Keyhub\datafiles1`에 `shyunku` 계정이 있으면 가져오기 화면을 띄운다. `nanoRIPE`는 무시한다.
- v1 검증값은 `hex(sha256(hex(sha256(utf8(pw)))))`다. 0.5.7 배포 번들에는 sha256@0.2.0의 브라우저 빌드(UTF-8)가 들어 있다(2026-11-04 번들 확인). Node 빌드(latin1)로 만든 값도 대비해 두 방식을 모두 시도한다.
- v1 값은 CryptoJS 암호문(`Salted__`, EVP_BytesToKey MD5, AES-256-CBC)이며 암호 문구는 첫 sha256 hex다. Node 내장 crypto로 복호화하고, 결과가 올바른 UTF-8이 아니면 실패로 본다. crypto-js@4.0.0 실제 출력으로 테스트한다.
- v1 DB는 임시 사본에서 읽기 전용으로 연다. 새 파일은 `tessera.db.migrating`으로 만들고, 다시 열어 모든 값을 원본과 대조한 뒤 이름을 바꾼다. 실패하면 임시 파일을 지우고 v1은 그대로 둔다.
- 값 하나라도 복호화에 실패하면 전체를 멈춘다. 삭제된 항목에 남아 있던 키(v1 버그)는 건너뛰고 개수를 보고한다. 부모가 없는 폴더·항목은 최상위로 옮긴다.
- 항목의 즐겨찾기, 조회수, 마지막 조회, 생성 시각을 유지한다. 비밀번호는 v1과 같은 것을 쓴다.

## 툴체인 메모 (2026-11-04)

- Electron 45.2.2 / Node 24.22.2 / Chromium 156. SQLite는 내장 `node:sqlite`(3.53.4)를 써서 네이티브 모듈이 없다.
- Electron 45 패키지에는 바이너리 다운로드 install 스크립트가 없어 `postinstall`에서 `node_modules/electron/install.js`를 직접 실행한다.
- 이 개발 환경에는 `ELECTRON_RUN_AS_NODE=1`이 설정되어 있어 `scripts/dev.mjs`, `scripts/start.mjs`에서 지우고 실행한다.
- dev 모드 데이터는 레포의 `.devdata/`, 이전 데이터는 레포의 `datafiles/v1/`(또는 `TESSERA_LEGACY_DIR`)을 쓴다.
- 패키징 때 Electron fuse(RunAsNode, NODE_OPTIONS, inspect 인자 끄기)와 asar 무결성 검사를 켠다(#12).

## 미결정 사항

- 없음.
