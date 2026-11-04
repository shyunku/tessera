# Tessera 프로젝트 명세

## 목적

Tessera(구 Keyhub)는 로컬 전용 데스크톱 비밀번호/키 관리자다. PasswordHub 프로젝트의 후속작이며, `폴더 → 항목 → 키페어(key/value)` 구조로 비밀값을 저장한다. 네트워크 동기화는 하지 않는다.

- 0.6.0부터 앱·프로젝트 이름을 Keyhub에서 Tessera로 바꾼다. (2026-11-04 사용자 결정)
  - 제품명 `Tessera`, 앱 ID `com.shyunku.tessera`, 데이터 폴더 `%APPDATA%\Tessera`, 백업 파일 확장자 `.tessera`.
  - 이전 데이터는 `%APPDATA%\Keyhub\datafiles1`에서 읽는다. 앱 ID가 달라 기존 Keyhub 0.5.7 설치본은 덮어쓰지 않으며 사용자가 직접 제거한다.
  - 로고는 2×2 모자이크 타일(한 칸은 비움) 마크다.
- 한 PC(OS 사용자 데이터 폴더)에는 데이터가 한 벌만 있다. 계정 선택 화면은 없고 마스터 비밀번호로 잠금을 해제한다. (2026-11-04 확정)
- 화면 문구에 '금고'라는 말을 쓰지 않는다. 'Tessera', '데이터', '마스터 비밀번호'로 표현한다. 코드 내부 식별자는 vault를 써도 된다. (2026-11-04 사용자 결정)

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

- v2 데이터가 없고 v1 데이터가 있으면 첫 실행 화면에서 v1 계정 `shyunku`의 비밀번호를 받아 v2 형식으로 변환한다. 비밀번호는 그대로 이어서 쓴다.
- v1 계정 `nanoRIPE`는 변환하지 않는다. (2026-11-04 사용자 결정)
- 가져오기 화면에는 '가져오지 않고 새로 시작하기' 링크를 둔다(비밀번호를 잊었을 때 빠져나갈 길, 시안 외 추가).
- v1 파일은 수정·삭제하지 않는다. 설정 화면에는 v1 원본을 표시하지 않는다.

### 툴체인

- Electron 최신 안정판, Vite, React 19(함수형 컴포넌트)로 전면 현대화한다.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox`, preload + `contextBridge` 구조를 사용하고 `@electron/remote`를 제거한다.
- 팝업은 별도 BrowserWindow 대신 앱 내부 모달로 구현한다.
- Windows 설치 파일은 NSIS x64로 만든다. 패키지 매니저는 npm을 유지한다.
- 이번 개편 버전은 0.6.0으로 올린다. (2026-11-04 사용자 지시)

### 기능

- 데이터 관리: 지금 잠그기, 마스터 비밀번호 변경, 데이터 초기화(확인 절차 포함).
- 보안 편의: 유휴 자동 잠금, 값 클립보드 복사 후 자동 삭제, 값 보기/숨김, 설정 탭.
- 정리 기능: 즐겨찾기, 최근 본 항목, 항목/폴더 이동. 이동은 이동 대화상자와 드래그 앤 드롭 모두 지원한다.
  - 항목은 폴더에 놓아 옮기고, '모든 항목'에 놓으면 최상위로 꺼낸다. 항목 순서는 이름순이다.
  - 폴더는 폴더 안에 놓거나 폴더 사이에 놓아 위치와 순서를 바꾼다(삽입선 들여쓰기로 단계 표시). 자기 자신·하위 폴더로는 옮길 수 없다. 폴더 순서는 저장된다.
  - 놓으면 바로 옮기고 '실행 취소' 알림을 띄운다. Ctrl+Z로 실행 취소, Ctrl+Y / Ctrl+Shift+Z로 다시 실행한다.
  - 실행 취소는 이동·순서 변경만 대상이다. 그 사이에 다른 작업(저장, 키 추가, 삭제, 즐겨찾기 등)이 있으면 그 지점에서 멈춘다.
- 백업/복원: 암호화된 백업 파일 내보내기/가져오기.
- 확정 UI 동작: 값은 가림표 + 보기 버튼, 키는 행 목록, 잠금 해제 중에는 저장할 때 비밀번호를 다시 묻지 않음. 기본값은 자동 잠금 5분, 클립보드 자동 삭제 30초, 기본 창 1100 × 720.

### 디자인

- 로그인, 홈, 모달, 설정 전체를 새로 디자인한다. 다크 모드를 포함한다.
- 확정 시안 결정 (2026-11-04): 포인트 색 틸(#1b6c80), 폴더 탐색은 사이드바 트리 + 연결선, 백업 가져오기는 '새 폴더에 추가'와 '모든 데이터 교체' 중 선택.
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
