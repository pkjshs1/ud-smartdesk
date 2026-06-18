# 웅동중학교 스마트 데스크

Google Apps Script 기반 학교 스마트 데스크 웹앱입니다.

## 포함 파일

- `Code.gs`: Apps Script 서버 코드
- `index.html`: 교사용 스마트 데스크 화면
- `lite.html`: 학생용/모바일 시간표 화면
- `source-parts/`: 원본 소스 백업용 Brotli/Base64 조각
- `restore-source.js`: `source-parts/`에서 원본 파일을 다시 복원하는 스크립트

백업 조각에서 다시 복원하려면 다음 명령을 실행하세요.

```bash
node restore-source.js
```

자세한 내용은 `RESTORE.md`를 참고하세요.

## 적용된 변경

- 최초 접속 시 PIN 입력 화면 추가
- PIN 번호: `dndehd0025`
- 기존 코드 검토 중 확인한 일정/렌더링 관련 보완 반영
