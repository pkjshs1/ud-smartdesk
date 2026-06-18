# 웅동중학교 스마트 데스크

Google Apps Script 기반 학교 스마트 데스크 웹앱입니다.

## 포함 파일

원본 소스는 GitHub 업로드 제한을 피하기 위해 Brotli 압축 후 Base64 조각으로 나누어 `source-parts/`에 저장되어 있습니다.

복원하려면 저장소를 내려받은 뒤 다음 명령을 실행하세요.

```bash
node restore-source.js
```

복원 결과는 아래 경로에 생성됩니다.

- `restored-source/Code.gs`: Apps Script 서버 코드
- `restored-source/index.html`: 교사용 스마트 데스크 화면
- `restored-source/lite.html`: 학생용/모바일 시간표 화면

자세한 내용은 `RESTORE.md`를 참고하세요.

## 적용된 변경

- 최초 접속 시 PIN 입력 화면 추가
- PIN 번호: `dndehd0025`
- 기존 코드 검토 중 확인한 일정/렌더링 관련 보완 반영
