<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly 로고" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | **한국어** | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md)

<h2>AI 시대에 맞춰 다시 설계한 완전한 연구 환경.</h2>

작성, 컴파일, 교정, 문헌 검색, 인용 관리, 그림 제작, PDF 검토, Git 변경
추적을 한곳에서 처리하세요. 호스팅 AI, 사용자 지정 엔드포인트, 로컬 Ollama,
또는 AI 없이 작업할 수 있습니다. Oleafly는 프로젝트를 컴퓨터의 일반 폴더에
보관합니다.

[![열린 이슈](https://img.shields.io/github/issues/Oleafly/Oleafly?label=Issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)
**[Oleafly 다운로드](https://github.com/Oleafly/Oleafly/releases/latest) ·
[제품 문서 보기](https://oleafly.com/docs/overview/) ·
[소스에서 빌드하기](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="LLaMA 연구 논문을 LaTeX로 편집하면서 소스 트리, 문서 개요, 컴파일된 PDF를 함께 보여 주는 Oleafly" width="100%" />
</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

## 연구에는 이미 신경 쓸 것이 충분히 많습니다

기술 문서 작업은 보통 편집기, 컴파일러, PDF 뷰어, 참고문헌 도구, Git,
그리고 실제 프로젝트를 볼 수 없는 AI 채팅으로 뿔뿔이 흩어지기 마련입니다.
Oleafly는 이 모든 작업을 하나의 데스크톱 앱으로 모으면서도, 소스는 다른
편집기와 명령줄 도구에서 그대로 읽을 수 있게 유지합니다.

강의 리포트든 저널 논문이든 수백 쪽짜리 학위 논문이든, 같은 프로젝트
뷰에서 작업할 수 있습니다.

| 하려는 일 | Oleafly가 처리하는 것 |
| --- | --- |
| 작성 | 소스 및 비주얼 편집, 자동완성, 기호, 인용, 그림, 표, 프로젝트 전체 코드 인텔리전스 |
| 컴파일 | 내장 LaTeX·Typst 엔진, Pandoc을 통한 Markdown 처리, 파싱된 오류와 로그, 오프라인 캐시 빌드 |
| 확인 | 빠른 PDF 미리보기, 페이지·확대 컨트롤, 두 쪽 보기, 색 반전, 양방향 SyncTeX |
| 수정 | 자동 저장, 실제 Git 히스토리, diff, 복원, GitHub 동기화 |
| 제출 | ATS(지원자 추적 시스템) 및 접근성 사전 점검, 참조 검사, 리더 뷰 텍스트 추출, 다양한 내보내기 형식 |
| 도움받기 | 선택적인 프로젝트 인식 AI 어시스턴트, 로컬 Ollama 모델, 호스팅 제공자, MCP 클라이언트 |

Overleaf의 작성-미리보기 루프는 마음에 들지만 컴파일, 파일, Git, 모델
선택을 내 컴퓨터에서 직접 다루고 싶다면, Oleafly가 바로 그 워크플로를 위해
만들어졌습니다. 로컬 편집기, TeX 툴체인, PDF 뷰어, Git 클라이언트를
따로따로 맞추는 수고의 상당 부분도 대체할 수 있습니다.

현재 Oleafly는 브라우저 기반 실시간 다중 사용자 편집을 제공하지 않습니다.
지금의 협업 경로는 Git과 GitHub입니다.

## 할 수 있는 일

### 소스를 손닿는 곳에 두고 작성하기

- 대규모 다중 파일 문서, 이미지, include, 참고문헌을 포함한 LaTeX, Typst,
  Markdown 프로젝트를 다룰 수 있습니다.
- LaTeX와 Markdown을 코드 뷰와 비주얼 뷰 사이에서 전환할 수 있습니다.
  지원되지 않는 리치 블록도 사라지지 않고 편집 가능한 소스로 계속
  표시됩니다.
- 편집기 툴바에서 제목, 목록, 링크, 인용, 상호 참조, 수식, 분수, 그림,
  표, 기호를 삽입할 수 있습니다.
- 명령, 인용, 라벨, 파일, 슬래시 명령 자동완성을 사용할 수 있습니다.
- 찾기 및 바꾸기, 섹션과 환경 접기, Vim 키 바인딩, 오프라인 맞춤법·문법
  검사를 사용할 수 있습니다.
- 정의로 이동, 참조 찾기, 프로젝트 전체에서 라벨이나 인용 키 이름 바꾸기,
  마우스 오버로 정의 확인이 가능합니다.

프로젝트 맵은 프로젝트의 모든 섹션, 라벨, 인용 키, 환경을 색인하고
`file:line` 형태로 접근할 수 있게 유지하므로, 탐색과 이름 바꾸기가 버퍼
하나 단위가 아니라 다중 파일 문서 전체에 걸쳐 동작합니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="섹션과 라벨을 파일·행 번호와 함께 나열하는 프로젝트 맵과 나란히 놓인 Oleafly의 소스 트리 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="섹션과 라벨을 파일·행 번호와 함께 나열하는 프로젝트 맵과 나란히 놓인 Oleafly의 소스 트리 (라이트 테마)" /></td>
  </tr>
</table>

</div>

인용 선택기는 프로젝트의 `.bib` 파일을 직접 읽기 때문에, 각 키에 저자,
연도, 제목, 그리고 정의된 행 번호가 함께 표시됩니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="파싱된 BibTeX 항목에서 인용 키를 고르는 화면. 각 항목에 저자, 연도, 소스 행이 표시됨 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="파싱된 BibTeX 항목에서 인용 키를 고르는 화면. 각 항목에 저자, 연도, 소스 행이 표시됨 (라이트 테마)" /></td>
  </tr>
</table>

</div>

LaTeX를 이해하는 단어 수 세기는 마크업을 무시하고 독자가 실제로 읽는
내용만 셉니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="열린 문서의 단어, 문자, 줄 수를 보여주는 단어 수 팝오버 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="열린 문서의 단어, 문자, 줄 수를 보여주는 단어 수 팝오버 (라이트 테마)" /></td>
  </tr>
</table>

</div>

### 프로젝트를 떠나지 않고 컴파일하고 읽기

- LaTeX는 내장 Tectonic 사이드카로, Typst는 내장 엔진으로 컴파일합니다.
  기본 워크플로에는 전체 TeX 설치가 필요하지 않습니다.
- 컴파일 실패를 원시 로그를 뒤지는 대신 편집기 진단과 읽기 쉬운 오류
  카드로 확인할 수 있습니다.
- 연속 스크롤, 가상화된 페이지, 한 쪽·두 쪽 보기, 맞춤 컨트롤, 페이지
  이동, 전체 화면, 선택적인 분리형 미리보기 창으로 소스 옆에서 PDF를
  읽을 수 있습니다.
- SyncTeX를 양방향으로 사용할 수 있습니다. 소스에서 PDF로 이동하거나,
  PDF 텍스트를 Cmd/Ctrl 클릭해 해당 소스 위치로 돌아갈 수 있습니다.
- PDF를 프로젝트에 저장하거나 소스를 이식 가능한 아카이브로 내보낼 수
  있습니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="내장 엔진과 옵션을 보여주는 LaTeX 엔진 설정 페이지 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="내장 엔진과 옵션을 보여주는 LaTeX 엔진 설정 페이지 (라이트 테마)" /></td>
  </tr>
</table>

</div>

축소하면 문서 전체가 한 화면에 들어오므로, 플로트, 그림, 표가 의도한
자리에 놓였는지 확인하는 데 보통 이 방법이 가장 빠릅니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="모든 그림과 표가 보이도록 미리보기에 펼쳐진 세 쪽짜리 문서 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="모든 그림과 표가 보이도록 미리보기에 펼쳐진 세 쪽짜리 문서 (라이트 테마)" /></td>
  </tr>
</table>

</div>

### 들여다볼 수 있는 히스토리 유지하기

모든 프로젝트는 실제 Git 저장소입니다. Oleafly는 컴파일 성공 후와 편집이
잠잠해진 시점에 자동으로 커밋하고, 그 히스토리에서 유용한 부분을 앱 안에
보여줍니다.

- 커밋 타임라인과 나란히 놓인 diff를 검토할 수 있습니다.
- 프로젝트의 나머지를 건드리지 않고 이전 버전의 파일만 복원할 수 있습니다.
- 소스 제어 패널에서 스테이징, 변경 취소, 커밋, 푸시, 풀을 할 수 있습니다.
- 프로젝트를 GitHub에 게시하거나 기존 저장소에 연결할 수 있습니다.
- 터미널이나 다른 편집기에서도 계속 작업할 수 있습니다. 풀어내야 할
  비공개 문서 형식이 없습니다.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Oleafly의 Git 히스토리에서 나란히 표시되는 소스 diff" width="84%" />
</div>

### 쓸모 있는 것에서 시작하기

프로젝트 갤러리에는 논문, 학위 논문, 보고서, 책, 발표 자료, 포스터, 과제,
편지, 참고문헌, 이력서, 다이어그램용으로 편집 가능한 시작 템플릿이 들어
있습니다. 문서 엔진, 오프라인 사용 가능 여부, ATS 적합성으로 필터링할 수
있습니다. 선택적인 템플릿 팩과 글꼴은 직접 선택했을 때만 다운로드됩니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="실시간 섬네일, 카테고리별 개수, 엔진 필터를 갖춘 Oleafly의 검색 가능한 프로젝트 템플릿 갤러리 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="실시간 섬네일, 카테고리별 개수, 엔진 필터를 갖춘 Oleafly의 검색 가능한 프로젝트 템플릿 갤러리 (라이트 테마)" /></td>
  </tr>
</table>

</div>

### 연구와 출판 작업 사이를 오가기

- DOI, arXiv ID, URL, 제목 검색으로 인용을 추가할 수 있습니다. Oleafly가
  중복이 제거된 BibTeX 항목을 기록하고 커서 위치에 인용을 삽입합니다.
- 비주얼 캔버스에서 다이어그램을 그리거나 그 TikZ를 직접 편집한 다음,
  벡터 소스 또는 이미지로 삽입할 수 있습니다. 저장된 TikZ는 다시 열어
  편집할 수 있습니다.
- Word 문서는 Pandoc으로 가져오고, PDF에서 편집 가능한 LaTeX 프로젝트를
  로컬에서 재구성하고, 수식 이미지는 비전 모델로 받아쓸 수 있습니다.
- PDF와 소스 아카이브에 더해, 문서 엔진과 프로젝트 유형이 지원하는 경우
  Word, HTML, Markdown, 텍스트, PowerPoint, EPUB으로 내보낼 수 있습니다.
- 프로젝트 폴더를 클라우드 문서로 바꾸지 않고도 학회 마감일을 둘러보고
  선택적인 문헌 검색을 사용할 수 있습니다.

인용 검색은 arXiv, Semantic Scholar, Crossref, PubMed, OpenAlex,
Google Scholar를 한꺼번에 조회하고, 중복 레코드를 병합하며, 선택한 항목을
BibTeX로 저장하거나 내보냅니다. 또한 열려 있는 문서를 문단 단위로
훑으면서 아직 인용이 없는 주장에 대해 인용을 제안할 수도 있습니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="여러 색인에서 중복이 제거된 결과를 반환하는 인용 검색. 각 결과에 저장 및 BibTeX 복사 버튼이 있음 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="여러 색인에서 중복이 제거된 결과를 반환하는 인용 검색. 각 결과에 저장 및 BibTeX 복사 버튼이 있음 (라이트 테마)" /></td>
  </tr>
</table>

</div>

다이어그램 컴포저는 캔버스에 그림을 그리면서 그 옆에서 TikZ를 컴파일하기
때문에, 삽입하는 그림은 계속 편집할 수 있는 진짜 벡터 소스입니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="캔버스 위의 트랜스포머 아키텍처와 그 옆의 컴파일된 TikZ 미리보기를 보여주는 다이어그램 컴포저 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="캔버스 위의 트랜스포머 아키텍처와 그 옆의 컴파일된 TikZ 미리보기를 보여주는 다이어그램 컴포저 (라이트 테마)" /></td>
  </tr>
</table>

</div>

### 다른 사람보다 먼저 문서를 점검하기

사전 점검(Preflight)은 소스와 컴파일 결과물을 모두 살펴봅니다. 깨진 참조,
누락된 에셋, 중복 라벨, 읽기 순서 문제, 누락된 메타데이터, 접근성이
떨어지는 그림 패턴, 지원자 추적 시스템이 파싱하기 어려운 이력서 레이아웃을
잡아냅니다.

파서나 스크린 리더가 추출할 수 있는 텍스트도 그대로 보여줍니다. 이
검사들은 실용적인 제출 가이드일 뿐, 공식적인 접근성 인증은 아닙니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="접근성 점수와 함께 소스 및 컴파일 결과물에 대한 구체적인 발견 사항을 보고하는 사전 점검 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="접근성 점수와 함께 소스 및 컴파일 결과물에 대한 구체적인 발견 사항을 보고하는 사전 점검 (라이트 테마)" /></td>
  </tr>
</table>

</div>

참조와 인용에는 전용 패널이 있습니다. 참고문헌, 문서에서 사용된 모든
인용, 프로젝트에서 정의한 기호를 한곳에서 볼 수 있습니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="소스와 컴파일된 PDF 옆에서 참고문헌 항목을 키와 연도별로 나열하는 참조 패널 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="소스와 컴파일된 PDF 옆에서 참고문헌 항목을 키와 연도별로 나열하는 참조 패널 (라이트 테마)" /></td>
  </tr>
</table>

</div>

### 원한다면, AI가 프로젝트에서 일하게 하기

어시스턴트는 파일을 읽고 편집하고, 프로젝트를 검색하고, 컴파일하고, 로그를
확인하고, PDF 텍스트를 추출해 자신의 결과를 스스로 검증할 수 있습니다.
인용, 가져온 문서, 편집 가능한 TikZ 그림 작업도 도울 수 있습니다.

모델은 직접 선택합니다.

- 지원되는 호스팅 제공자를 본인의 API 키로 연결합니다.
- Ollama를 통해 로컬 모델을 실행합니다.
- AI를 설정하지 않은 채 앱의 나머지 기능을 평소대로 사용합니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="인용할 논문 찾기, 문헌 리뷰 작성, 소스 오류 수정 같은 시작점을 제안하는 어시스턴트 패널 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="인용할 논문 찾기, 문헌 리뷰 작성, 소스 오류 수정 같은 시작점을 제안하는 어시스턴트 패널 (라이트 테마)" /></td>
  </tr>
</table>

</div>

파일 변경에는 diff와 승인·거부 컨트롤이 함께 제공됩니다. “항상 허용”은
현재 세션 동안 일반적인 쓰기를 자동 승인할 수 있지만, 삭제는 여전히
확인을 거쳐야 합니다.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="거부, 항상 허용, 승인 컨트롤과 함께 빨강·초록 diff로 표시되는 어시스턴트의 파일 변경" width="88%" />
</div>

승인되면 편집이 파일에 반영되고 문서가 다시 컴파일됩니다. 모든 응답에는
“이 응답 이전 상태로 코드 복원” 동작이 유지됩니다.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="문서에 적용되어 다시 컴파일된 PDF에 반영된 승인된 어시스턴트 편집" width="88%" />
</div>

제공자는 설정에서 구성합니다. 키는 이 컴퓨터에만 저장되며, 로컬 Ollama
모델은 키가 전혀 없어도 동작합니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="여러 제공자가 연결되고 로컬 Ollama 모델이 선택된 AI 어시스턴트 설정 페이지 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="여러 제공자가 연결되고 로컬 Ollama 모델이 선택된 AI 어시스턴트 설정 페이지 (라이트 테마)" /></td>
  </tr>
</table>

</div>

Oleafly는 프로젝트 도구를 Claude Desktop, Claude Code, Cursor를 비롯한
다른 MCP 클라이언트에 노출할 수도 있습니다. MCP 연결은 읽기 전용 모드와
세 가지 승인 정책을 지원합니다. 모든 변경을 확인하거나, 삭제만 확인하면서
쓰기를 자동 승인하거나, 클라이언트 자체의 승인 게이트를 신뢰할 수
있습니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="로컬 서버, 클라이언트 설정 안내, 사용 가능한 승인 정책을 보여주는 MCP 설정 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="로컬 서버, 클라이언트 설정 안내, 사용 가능한 승인 정책을 보여주는 MCP 설정 (라이트 테마)" /></td>
  </tr>
</table>

</div>

현재 지원되는 제공자, 도구, 보안 모델은 [기능 레퍼런스](../features.md)와
[MCP 설정](../mcp.md)을 참고하시기 바랍니다.

모든 기능은 한곳에서 접근할 수 있습니다. 옴니바로 프로젝트와 문서를
검색하고, `/`를 입력하면 명령 팔레트로 바뀝니다.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="명령과 최근에 수정된 프로젝트를 나열하는 옴니바 (다크 테마)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="명령과 최근에 수정된 프로젝트를 나열하는 옴니바 (라이트 테마)" /></td>
  </tr>
</table>

</div>

## 로컬 우선, 그리고 명확한 네트워크 경계

계정도 원격 측정(telemetry)도 필요 없습니다. 핵심 프로젝트 데이터는 내
컴퓨터에 남습니다.

| 로컬에서 실행되거나 로컬에 남는 것 | 직접 요청할 때만 네트워크를 쓰는 것 |
| --- | --- |
| 프로젝트 파일과 편집기 버퍼 | 직접 연결한 호스팅 AI 제공자 |
| Git 저장소와 히스토리 | GitHub 게시, 푸시, 풀 |
| 캐시된 패키지를 이용한 컴파일 | 첫 컴파일에 필요한 TeX 패키지 |
| PDF 렌더링과 텍스트 추출 | 선택적인 템플릿, 글꼴, Pandoc, TinyTeX 다운로드 |
| 맞춤법·문법 검사와 사전 점검 | 인용, 문헌, 학회 마감일, 업데이트 조회 |
| Ollama를 통한 로컬 AI |  |

API 키는 로컬에 저장됩니다. 문서 파일은 평범한 형식이므로 Oleafly 사용을
그만두더라도 계속 쓸 수 있습니다.

## 공개 예정

앞으로도 Oleafly는 개방되고 로컬 우선이며, 전체 연구 워크플로에
유용한 작업 공간을 목표로 합니다.

- **앱 현지화.** 더 많은 언어로 Oleafly를 사용하고, 연구자에게 가장 편안한
  인터페이스 언어를 선택할 수 있게 합니다.
- **에이전트 스킬과 플러그인.** 반복 가능한 AI 워크플로를 추가해 같은 맥락을
  반복 전송하는 일과 토큰 사용량을 줄입니다.
- **자율 연구 에이전트.** 연구 질문과 출처 목록을 구조화된 첫 초안으로
  바꿔 연구의 출발점을 만듭니다.
- **실시간 협업과 댓글.** 연구팀을 위한 무제한 자체 호스팅 협업을 제공합니다.
- **Oleafly CLI.** GUI가 필요 없는 연구 워크플로에 가벼운 설치형 명령줄 패키지를
  제공합니다.
- **Typst와 Markdown 지원 강화.** 두 형식 모두에 더 많은 편집, 미리 보기,
  게시 기능을 제공합니다.
- **연구 연동 확대.** Mendeley와 추가 참고문헌, 라이브러리, 연구 서비스를
  연결합니다.
- **자체 호스팅 클라우드 동기화.** 여러 기기에서 프로젝트를 동기화하고,
  원할 때 GitHub 자동 동기화를 더 나은 방식으로 사용합니다.

## 설치

최신 빌드는
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest)에서
다운로드할 수 있습니다.

| 플랫폼 | 설치 파일 |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` 또는 `-setup.exe` |
| Linux, x86_64 | `.AppImage`, `.deb`, 또는 `.rpm` |

첫 LaTeX 컴파일 시 문서에 필요한 패키지가 다운로드될 수 있습니다.
Tectonic이 이후 빌드를 위해 패키지를 캐시하며, 오프라인 모드에서는 그
캐시만으로 컴파일합니다.

소스에서 실행하려면 다음과 같이 합니다.

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
pnpm tauri dev
```

사전 요구 사항, 플랫폼별 설정, 프로덕션 빌드는
[개발 가이드](../development.md)를 참고하시기 바랍니다.

이 스크립트는 현재 플랫폼용으로 체크섬이 고정된 컴파일러 사이드카를
`src-tauri/binaries`에 내려받습니다. `all` 인수는 지원하는 모든 플랫폼을
준비해야 하는 CI와 릴리스 패키징에 사용합니다.

TexLab과 Tinymist가 제공하는 편집기 지능 기능은 로컬 실행에서 선택 사항입니다.
`pnpm language-servers:fetch`로 이 언어 서버를 받을 수 있습니다. 무결성,
라이선스, 배포 정책은
[언어 서버 도구 체인](../language-server-toolchain.md)을 참고하세요.

### 명령줄

`oleaflyc`는 데스크톱 앱을 실행하지 않고 Oleafly 프로젝트를 관리합니다.
현재는 이 저장소의 소스에서 빌드하며 독립 패키지로는 아직 배포하지 않습니다.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

명령은 현재 디렉터리를 대상으로 실행됩니다. 다른 프로젝트를 지정하려면
`-C <path>`를 사용하세요. 전체 명령 목록은 `oleaflyc --help`에서 확인할 수
있습니다.

## 개발자 문서

사용자 가이드는 [Oleafly 제품 문서](https://oleafly.com/docs/overview/)에서
확인할 수 있습니다. 아래 자료는 기여자, 통합 개발자, 릴리스 관리자를 위한 것입니다.

| 레퍼런스 | 다루는 내용 |
| --- | --- |
| [제품 엔지니어링 카탈로그](../README.md) | 기능 목록과 엔지니어링 계약 |
| [기능 레퍼런스](../features.md) | 제품 표면과 지원되는 워크플로 |
| [문서 엔진](../document-engines.md) | LaTeX, Typst, Markdown 기능 |
| [제품 아키텍처](../architecture.md) | 시스템 경계, 패키지 소유권, 확장 지점 |
| [개발](../development.md) | 로컬 설정, 테스트, 기여 워크플로 |
| [언어 서버 툴체인](../language-server-toolchain.md) | 가져오기, 무결성, 배포 정책 |
| [MCP 연동](../mcp.md) | 외부 클라이언트, 액세스 토큰, 승인 정책 |
| [릴리스](../releasing.md) | 릴리스 워크플로와 산출물 검사 |
| [코드 서명](../signing.md) | 플랫폼별 서명 요구 사항 |
| [자동 업데이트](../updates.md) | 업데이트 매니페스트, 서명, 롤백 |

## 기여하기

<table>
  <tr>
    <td width="38%" valign="top"><img src="../assets/oleafly-club.png" alt="Oleafly Club: 초안, 수정, 테스트, 성공적인 투고를 함께 기념하는 공개 연구 커뮤니티" width="100%" /></td>
    <td width="62%" valign="top"><h3>연구자는 직접 살펴보고, 확장하고, 신뢰할 수 있는 도구를 누릴 자격이 있습니다.</h3><p>Oleafly는 <a href="https://github.com/prajwal-svm">Prajwal Murthy</a>와 기여자들이 공개적으로 개발하고 있습니다. 버그 리포트, 수정, 템플릿, 문서, 그리고 신중한 제품 피드백을 환영합니다.</p></td>
  </tr>
</table>

1. [CONTRIBUTING.md](../../CONTRIBUTING.md)를 읽어 주세요.
2. 큰 변경은 먼저 이슈를 열어 주세요. 작고 집중된 수정은 바로 풀
   리퀘스트로 보내도 됩니다.
3. 제출 전에 관련 검사를 실행해 주세요:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

보안 문제는 [SECURITY.md](../../SECURITY.md)에 안내된 대로 비공개로 제보해
주시기 바랍니다. 참여에는
[행동 강령](../../CODE_OF_CONDUCT.md)이 적용됩니다.

## 커뮤니티 및 지원

- 질문과 아이디어는 [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions)에 공유해 주세요.
- 버그와 기능 요청은 [GitHub Issues](https://github.com/Oleafly/Oleafly/issues)에 등록해 주세요.
- 🔔 제품 및 릴리스 소식은 [X의 @OleaflyHQ](https://x.com/OleaflyHQ)를 팔로우해 주세요.

⭐ Oleafly가 도움이 된다면 [저장소에 별을 눌러 주세요](https://github.com/Oleafly/Oleafly).
작은 클릭 하나가 더 많은 연구자에게 프로젝트를 알리고 지속적인 개발을 돕습니다.

## 스타 기록

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="GitHub 스타 기록 차트" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

## 크레딧

Oleafly는
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/),
[Hunspell](https://hunspell.github.io/) 위에서 만들어졌습니다.

Oleafly는
[AGPL-3.0-or-later](../../LICENSE) 라이선스를 따릅니다. 서드파티 고지는
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md)에 정리되어 있습니다.
