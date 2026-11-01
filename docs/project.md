# Keyhub 프로젝트 명세

## 목적

Keyhub는 로컬 전용 데스크톱 비밀번호/키 관리자다. PasswordHub 프로젝트의 후속작이며, 계정별로 분리된 금고(vault)에 `폴더 → 항목 → 키페어(key/value)` 구조로 비밀값을 저장한다. 네트워크 동기화는 하지 않는다.

## 사용자

- 현재 production 사용자는 개발자 본인 1명이다.
- 기존 데이터 위치: `%APPDATA%\Keyhub\datafiles\v1` (계정 `shyunku`, `nanoRIPE`).

## 확정 요구사항 (2026-11-01)

### 암호화

- 봉투(envelope) 암호화를 사용한다.
  - 계정별 랜덤 salt + 메모리 하드 KDF(Argon2id 우선, 불가 시 scrypt)로 비밀번호에서 KEK를 유도한다.
  - 랜덤 256비트 마스터키(DEK)를 KEK로 AES-256-GCM 래핑하여 저장한다.
  - 비밀번호 검증은 DEK 언래핑 성공 여부로 한다. 빠른 해시 검증값을 따로 저장하지 않는다.
- 값뿐 아니라 키 이름, 항목 이름, 폴더 이름까지 모두 DEK로 AES-256-GCM 암호화한다.
- 암·복호화는 메인 프로세스에서만 수행한다. 렌더러는 비밀번호와 평문 값을 필요한 순간에만 다룬다.
- 비밀번호 변경은 DEK 재래핑만으로 처리한다.

### 마이그레이션

- v1(평문 이름 + CryptoJS AES/sha256) → v2(새 암호화) 변환은 계정별 최초 로그인 시 자동으로 수행한다.
- v1 파일은 수정하지 않고 백업으로 보존한다. 로그인하지 않은 계정은 v1 상태로 대기한다.

### 툴체인

- Electron 최신 안정판, Vite, React 19(함수형 컴포넌트)로 전면 현대화한다.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox`, preload + `contextBridge` 구조를 사용하고 `@electron/remote`를 제거한다.
- 팝업은 별도 BrowserWindow 대신 앱 내부 모달로 구현한다.
- Windows 설치 파일은 NSIS x64로 만든다. 패키지 매니저는 npm을 유지한다.

### 기능

- 계정 관리: 로그아웃/계정 전환, 비밀번호 변경, 계정 삭제.
- 보안 편의: 유휴 자동 잠금, 값 클립보드 복사 후 자동 삭제, 값 보기/숨김, 설정 탭.
- 정리 기능: 즐겨찾기, 최근 본 항목, 항목/폴더 이동.
- 백업/복원: 암호화된 백업 파일 내보내기/가져오기.

### 디자인

- 로그인, 홈, 모달, 설정 전체를 새로 디자인한다. 다크 모드를 포함한다.
- 구현 전에 HTML 시안(`docs/designs/*-mock.html`)으로 확정받는다.

## 구조 (현대화 이전, v0.5.7 기준)

| 영역 | 경로 | 설명 |
| --- | --- | --- |
| Electron 메인 | `public/electron/main.js` | 창 생성, IPC 핸들러, 팝업 창 관리 |
| DB 계층 | `public/electron/sqlite.js`, `core-query.js`, `user-query.js` | core DB(계정) / 계정별 DB(폴더·항목·키페어) |
| 경로 | `public/electron/path.js`, `file-manage.js` | dev: 레포 루트 `datafiles/v1`, build: `userData/datafiles/v1` |
| 렌더러 | `src/components/pages/Login.js`, `Home.js` | 로그인, 탐색기 + 키페어 패널 |
| 팝업 | `src/components/parts/AlertPopup.js`, `AskPopup.js` | 별도 창 팝업 |

### v1 데이터 형식

- core DB `user_master(user_id, name, encrypted_pw)`: `encrypted_pw = sha256_hex(sha256_hex(password))`.
- user DB `folder_master(fid, parent_fid, name)`, `item_master(iid, fid, name, view_cnt, last_viewed_timestamp, favorite_flag, created_timestamp)`, `keypair_master(kpid, iid, key, encrypted_value)`.
- `encrypted_value = CryptoJS.AES.encrypt(value, sha256_hex(password))` (OpenSSL `Salted__` 형식, EVP_BytesToKey MD5, AES-256-CBC).
- 루트 폴더는 가상(`fid = NULL`)이며 템플릿에 `일반` 최상위 폴더가 기본으로 들어 있다.
