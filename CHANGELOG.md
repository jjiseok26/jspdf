# Changelog

All notable changes to JSPDF are documented here. Version numbers follow [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-09-01

### Added
- 페이지 회전: 현재 페이지 또는 전체 페이지를 시계/반시계 방향 90° 회전

### Fixed
- Windows 연결 프로그램 목록에 **JSPDF**로 표시되도록 exe 메타데이터·파일 연결 이름 수정

## [0.1.2] - 2026-09-01

### Added
- 인쇄 기능 (주석 포함 PDF 출력)
- 파일 크기 축소 (JPEG 압축, 낮음/보통/높음)
- 다른 이름으로 저장 (저장은 기존 경로 덮어쓰기)

### Fixed
- 설치 후 바탕화면·시작 메뉴 아이콘이 JS로 표시되도록 exe 아이콘 임베드 (rcedit afterPack)

## [0.1.1] - 2026-09-01

### Fixed
- 텍스트 삽입·메모·본문 수정이 보이지 않던 글자 크기 오류 수정
- 메모 내용 표시 및 선택 삭제 지원
- 본문 수정: 영역 드래그 지정 후 기존 글자를 배경색으로 덮고 새 텍스트 삽입
- 프레젠테이션 모드 동작 (전체화면, 키보드·클릭 페이지 이동)
- Windows 제목 표시줄 JS 아이콘 (다중 해상도 ICO + AppUserModelId)

### Added
- 주석 이동 도구: 개체 선택·이동·크기 조절·삭제 (선택 삭제 버튼, Delete 키)
- 상세 도움말 내용 확장

## [0.1.0] - 2026-09-01

### Added
- Windows desktop PDF editor (Electron)
- Ribbon UI: 파일, 홈, 편집, 보기, 문서, 주석, 변환, 도움말 탭
- PDF 열기/저장, 확대·축소, 프레젠테이션 모드
- 주석: 펜, 형광펜, 메모, 본문 수정, 전자인장
- 페이지 썸네일 패널 및 드래그로 순서 변경
- PDF 병합, 워터마크, 이미지/텍스트 변환, 역변환(TXT/HTML)
- OCR (Tesseract) 및 텍스트 선택·복사
- 드래그 앤 드롭으로 PDF 열기
- Windows 연결 프로그램 등록 (PDF 우클릭 → JSPDF)
- NSIS 설치 파일 빌드 (`npm run dist`)

[0.1.3]: https://github.com/jjiseok26/jspdf/releases/tag/v0.1.3
[0.1.2]: https://github.com/jjiseok26/jspdf/releases/tag/v0.1.2
[0.1.1]: https://github.com/jjiseok26/jspdf/releases/tag/v0.1.1
[0.1.0]: https://github.com/jjiseok26/jspdf/releases/tag/v0.1.0
