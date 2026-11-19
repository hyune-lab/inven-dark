# 기술 설계

- 프로젝트: inven-dark
- 작성일: 2026-11-19 / 상태: 승인됨 (사용자 지시로 바로 구축)

## 기술 묶음
- 크롬 확장 프로그램 매니페스트 3판(Manifest V3). 빌드 도구 없이 순수 JS·CSS (ADR 0001)
- 화면이 아이콘 창 하나뿐이라 React를 쓰지 않는다 (공용 기본값 React의 예외, ADR 0001)

## 구조
```
manifest.json          content_scripts: matches *.inven.co.kr, run_at document_start
src/dark.css           모든 규칙이 html[data-inven-dark="on"] 아래에만 걸림
src/content.js         모드를 읽어 <html>에 data-inven-dark 속성을 붙이고 떼는 일만 함
src/mode.js            모드 → on/off 판정 순수 함수 (단위 시험 대상)
src/popup.html/.js     자동·켜기·끄기 선택, chrome.storage.sync에 저장
icons/
```

## 동작 원리
1. 브라우저는 매니페스트의 주소 조건에 맞는 인벤 페이지에서만 `dark.css`와 `content.js`를 넣는다 → 다른 사이트 영향 0 (F-01)
2. `dark.css`는 페이지가 그려지기 전에 들어가지만 `html[data-inven-dark="on"]`일 때만 효과가 있다
3. `content.js`는 문서 시작 시점에 실행되어 **동기적으로** 모드를 정한다 (F-03):
   - 저장소(chrome.storage)는 비동기라 늦을 수 있으므로, 마지막 모드를 인벤 도메인의 localStorage에 복사해 두고 그 값을 먼저 읽는다
   - 자동 모드는 `matchMedia('(prefers-color-scheme: dark)')`로 판정
   - 이후 chrome.storage 값을 읽어 다르면 고치고, `storage.onChanged`와 시스템 설정 변경을 듣고 즉시 반영 (F-04)
4. 전용 스타일이 없는 영역은 보완 규칙(F-05)으로 어둡게 한다. 사진·동영상·iframe은 건드리지 않는다

## 시험 계획 (test-strategy)
- 단위: `node --test` — 모드 판정 함수(자동/켜기/끄기 × 시스템 다크 여부)
- 화면: 플레이라이트로 확장을 실제로 넣은 크로미움을 띄워 인벤 게시판 목록·글 보기 캡처, 다른 사이트에서 속성이 붙지 않음 확인
- 실행 명령은 README에 적는다

## 환경과 배포
- 로컬: 크롬 `chrome://extensions` → 개발자 모드 → "압축 해제된 확장 프로그램 로드"로 저장소 폴더 선택
- 배포: 2단계에서 크롬 웹 스토어 (사용자 승인 후). 환경 변수 없음

## 위험 지점
- 인벤 화면 구조 파악: 서로 다른 게임 게시판 2~3곳에서 확인 (사용자: 대부분 같은 구조, 스크린샷 게시판 등 일부만 조금 다름)
- 인벤 인라인 스타일(배경색이 태그에 직접 적힌 경우)은 `!important`로 덮는다
