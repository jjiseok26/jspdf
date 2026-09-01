# JSPDF

Windows 설치형(Electron) PDF 편집기. PDF 열기·주석·본문 수정·병합·변환·역변환·이미지 저장·워터마크·인쇄·파일 축소·프레젠테이션·전자인장을 지원합니다.

**Copyright © 2026 jiseok**

## 버전

현재 버전: **0.1.2** (`package.json`, `VERSION`, Git 태그 `v0.1.2`)

변경 이력은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

## 실행 / 빌드

```bash
npm install
npm start                # 개발 실행
npm run smoke            # 렌더링·PDF 기능 자동 점검
npm run dist             # dist/ 에 Windows NSIS 설치파일 생성
```

설치파일은 `dist/JSPDF Setup 0.1.2.exe` 로 생성되며, 설치 경로 선택과 바탕화면 바로가기를 지원합니다.

## 기능

| 기능 | 설명 |
| --- | --- |
| PDF 열기 / 저장 / 다른 이름으로 저장 | 주석 포함 PDF 저장, 경로 덮어쓰기 또는 새 이름 저장 |
| 인쇄 | 현재 문서(주석 포함)를 프린터로 출력 |
| 파일 축소 | JPEG 압축으로 PDF 용량 줄이기 |
| 펜 / 형광펜 / 메모 / 텍스트 삽입 | 자유 곡선, 하이라이트, 메모, 텍스트 삽입 |
| 본문 수정 | 영역 지정 후 기존 글자를 덮고 새 텍스트 삽입 |
| 전자인장 | 이름 또는 이미지로 인장 배치 |
| PDF 병합 / 워터마크 / 변환 / 역변환 | 병합, 워터마크, 이미지·텍스트 변환 |
| 프레젠테이션 | 전체화면 페이지 넘김 |
| OCR / 텍스트 선택·복사 | 스캔 PDF 글자 인식 및 복사 |
| 페이지 순서 변경 | 좌측 썸네일 드래그 |
| 드래그 앤 드롭 / 연결 프로그램 | PDF 열기 |

## 라이선스

[MIT License](LICENSE) — Copyright © 2026 jiseok
