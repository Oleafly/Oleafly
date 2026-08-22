<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly のロゴ" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | **日本語** | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md)

**自分の手元にある AI ワークスペースで、研究を執筆・コンパイル・公開する。**

LaTeX、Typst、Markdown で執筆できます。ソースのすぐ隣でコンパイルできます。
すべての変更履歴を Git に残せます。AI は自分の条件で使えます。

Oleafly は macOS、Windows、Linux 向けの無料かつ 100% オープンソースの
デスクトップアプリです。ローカルファーストで、アカウント不要で動作し、
プレーンなプロジェクトファイルをあなたのコンピュータ上に保持します。

[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)

**[Oleafly をダウンロード](https://github.com/Oleafly/Oleafly/releases/latest) ·
[エンジニアリングドキュメントを読む](../README.md) ·
[ソースからビルドする](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-light.png" alt="LaTeX エディタとコンパイル済み PDF を並べて開いた Oleafly（ライトテーマ）" width="92%" />
  <br /><br />
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor.png" alt="LaTeX エディタとコンパイル済み PDF を並べて開いた Oleafly（ダークテーマ）" width="92%" />
</div>

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf.png" alt="プロジェクトを色分けされた本として表示し、エンジン・種類・最終更新のラベルを付けた Oleafly のライブラリ（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf-light.png" alt="プロジェクトを色分けされた本として表示し、エンジン・種類・最終更新のラベルを付けた Oleafly のライブラリ（ライトテーマ）" /></td>
  </tr>
</table>

</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

> [!NOTE]
> Oleafly は日常的なドキュメント作成にすぐ使える状態ですが、プロジェクトは
> まだ急速に発展しています。高度なパッケージ互換性や一部のプラットフォーム
> 連携は現在も強化中です。macOS ビルドは署名・公証済みですが、Windows
> ビルドはまだ署名されていません。ダウンロードは必ず公式リリースページ
> からのみ行い、未署名のプレビュービルドをインストールする前には
> リリースノートをご確認ください。

## 研究には、ただでさえ考えることが多すぎる

技術文書の作成は、たいていエディタ、コンパイラ、PDF ビューア、文献管理
ツール、Git、そして実際のプロジェクトが見えない AI チャットに散らばって
しまいます。Oleafly はこれらの作業をひとつのデスクトップアプリにまとめつつ、
ソースは他のエディタやコマンドラインツールからも読める状態に保ちます。

同じプロジェクトビューが、講義レポートにも、学術誌論文にも、100 ページの
学位論文にも使えます。

| あなたの作業 | Oleafly が担うこと |
| --- | --- |
| 執筆 | ソース編集とビジュアル編集、オートコンプリート、記号、引用、図、表、プロジェクト全体のコードインテリジェンス |
| コンパイル | 同梱の LaTeX・Typst エンジン、Pandoc 経由の Markdown、解析済みエラー、ログ、オフラインキャッシュビルド |
| 確認 | 高速な PDF プレビュー、ページ・ズーム操作、見開きレイアウト、色反転、双方向 SyncTeX |
| 改訂 | 自動保存、本物の Git 履歴、差分表示、復元、GitHub 同期 |
| 提出 | ATS（応募者追跡システム）とアクセシビリティのプリフライト、参照チェック、リーダービュー抽出、複数のエクスポート形式 |
| 支援 | オプションのプロジェクト認識型 AI アシスタント、ローカルの Ollama モデル、ホスト型プロバイダー、MCP クライアント |

Overleaf の「書いてプレビューする」ループが好きで、コンパイル、ファイル、
Git、モデルの選択を自分のマシン上で行いたいなら、Oleafly はまさにその
ワークフローのために作られています。ローカルのエディタ、TeX ツールチェーン、
PDF ビューア、Git クライアントを組み合わせたセットアップの多くも置き換えられます。

Oleafly は現時点で、ブラウザ上でのリアルタイム複数人編集は提供していません。
現在のコラボレーション手段は Git と GitHub です。

## できること

### ソースを手元に置いたまま執筆する

- LaTeX、Typst、Markdown のプロジェクトを扱えます。複数ファイルにまたがる
  大規模な文書、画像、インクルード、参考文献にも対応します。
- LaTeX と Markdown はコードビューとビジュアルビューを切り替えられます。
  未対応のリッチブロックは消えてしまうのではなく、編集可能なソースとして
  表示され続けます。
- 見出し、リスト、リンク、引用、相互参照、数式、分数、図、表、記号を
  エディタツールバーから挿入できます。
- コマンド、引用、ラベル、ファイル、スラッシュコマンドの各オートコンプリート
  を利用できます。
- 検索と置換、セクションや環境の折りたたみ、Vim キーバインドの有効化、
  オフラインのスペル・文法チェックが行えます。
- 定義へのジャンプ、参照の検索、プロジェクト全体でのラベルや引用キーの
  リネーム、ホバーによる定義の確認ができます。

プロジェクトマップは、プロジェクト内のすべてのセクション、ラベル、引用キー、
環境をインデックス化し、`file:line` 形式で参照できる状態に保ちます。
そのため、ナビゲーションやリネームは 1 つのバッファ単位ではなく、
複数ファイルにまたがる文書全体で機能します。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="ソースツリーの隣に、セクションとラベルをファイルと行番号付きで一覧するプロジェクトマップを表示した Oleafly（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="ソースツリーの隣に、セクションとラベルをファイルと行番号付きで一覧するプロジェクトマップを表示した Oleafly（ライトテーマ）" /></td>
  </tr>
</table>

</div>

引用ピッカーはプロジェクトの `.bib` ファイルを直接読み込むため、各キーには
著者、年、タイトル、そして定義されている行が表示されます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="解析済みの BibTeX エントリから引用キーを選択している画面。各エントリに著者、年、ソース行が表示されている（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="解析済みの BibTeX エントリから引用キーを選択している画面。各エントリに著者、年、ソース行が表示されている（ライトテーマ）" /></td>
  </tr>
</table>

</div>

LaTeX を理解する単語カウントは、マークアップを無視して読者の目に入る
テキストだけを数えます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="開いている文書の単語数、文字数、行数を表示する単語カウントのポップオーバー（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="開いている文書の単語数、文字数、行数を表示する単語カウントのポップオーバー（ライトテーマ）" /></td>
  </tr>
</table>

</div>

### プロジェクトを離れずにコンパイルして読む

- LaTeX は同梱の Tectonic サイドカーで、Typst は同梱のエンジンで
  コンパイルできます。デフォルトのワークフローに TeX のフルインストールは
  不要です。
- コンパイラの失敗は、生のログを漁るのではなく、エディタ上の診断表示と
  読みやすいエラーカードとして確認できます。
- ソースの隣で PDF を読めます。連続スクロール、仮想化ページ、単一ページ・
  見開きレイアウト、フィット調整、ページナビゲーション、フルスクリーン、
  オプションの分離プレビューウィンドウに対応しています。
- SyncTeX は双方向に使えます。ソースから PDF へジャンプすることも、
  PDF のテキストを Cmd/Ctrl クリックして対応するソースへ戻ることもできます。
- PDF をプロジェクト内に保存したり、ソースをポータブルなアーカイブとして
  エクスポートしたりできます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="同梱エンジンとそのオプションを表示した LaTeX エンジン設定ページ（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="同梱エンジンとそのオプションを表示した LaTeX エンジン設定ページ（ライトテーマ）" /></td>
  </tr>
</table>

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-figures.png" alt="プロット、カラーマップされた誤差曲面、結果の表を LaTeX ソースの隣に表示したコンパイル済みページ" width="88%" />
</div>

ズームアウトすれば文書全体が一画面に収まります。フロート、図、表が
意図した位置に収まっているかを確認するには、たいていこれが一番速い方法です。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="すべての図と表が見える状態でプレビューに並べられた 3 ページの文書（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="すべての図と表が見える状態でプレビューに並べられた 3 ページの文書（ライトテーマ）" /></td>
  </tr>
</table>

</div>

### 中身を確認できる履歴を残す

すべてのプロジェクトは本物の Git リポジトリです。Oleafly はコンパイルの
成功後と編集が落ち着いたタイミングで自動的にコミットし、その履歴の
役立つ部分をアプリ内で見られるようにします。

- コミットのタイムラインと左右並列の差分を確認できます。
- プロジェクトの他の部分に手を付けずに、以前のファイルだけを復元できます。
- ソース管理パネルからステージ、破棄、コミット、プッシュ、プルが行えます。
- プロジェクトを GitHub に公開したり、既存のリポジトリに接続したりできます。
- ターミナルや別のエディタからの作業もそのまま続けられます。展開が必要な
  独自ドキュメント形式はありません。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Oleafly の Git 履歴における左右並列のソース差分" width="84%" />
</div>

### 使えるひな形から始める

プロジェクトギャラリーには、論文、学位論文、レポート、書籍、プレゼン
テーション、ポスター、課題、レター、参考文献リスト、履歴書、図表のための
編集可能なスターターが用意されています。ドキュメントエンジン、オフライン
対応度、ATS 適合性で絞り込めます。オプションのテンプレートパックと
フォントは、選択したときにのみダウンロードされます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="ライブサムネイル、カテゴリ数、エンジンフィルタを備えた Oleafly の検索可能なプロジェクトテンプレートギャラリー（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="ライブサムネイル、カテゴリ数、エンジンフィルタを備えた Oleafly の検索可能なプロジェクトテンプレートギャラリー（ライトテーマ）" /></td>
  </tr>
</table>

</div>

### 研究作業と出版作業を行き来する

- DOI、arXiv ID、URL、タイトル検索から引用を追加できます。Oleafly は
  重複を除去した BibTeX エントリを書き込み、カーソル位置に引用を挿入します。
- ビジュアルキャンバスで図を描くことも、その TikZ を直接編集することもでき、
  ベクターソースまたは画像として挿入できます。保存した TikZ は再度開いて
  編集できます。
- Word 文書を Pandoc 経由でインポートしたり、PDF から編集可能な LaTeX
  プロジェクトをローカルで再構築したり、数式画像をビジョンモデルで
  書き起こしたりできます。
- PDF とソースアーカイブに加え、ドキュメントエンジンとプロジェクト種別が
  対応していれば Word、HTML、Markdown、テキスト、PowerPoint、EPUB へ
  エクスポートできます。
- プロジェクトフォルダをクラウドドキュメント化することなく、学会の締切を
  閲覧したり、オプションの文献検索を使ったりできます。

引用検索は arXiv、Semantic Scholar、Crossref、PubMed、OpenAlex、
Google Scholar をまとめて照会し、重複レコードを統合して、残したものを
BibTeX として保存またはエクスポートします。開いている文書を段落ごとに
スキャンし、まだ出典のない主張に対して引用を提案することもできます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="複数のインデックスから重複除去された結果を返す引用検索。各結果に保存と BibTeX コピーのアクションが付いている（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="複数のインデックスから重複除去された結果を返す引用検索。各結果に保存と BibTeX コピーのアクションが付いている（ライトテーマ）" /></td>
  </tr>
</table>

</div>

図表コンポーザーはキャンバス上で描画しながら、その隣で TikZ をコンパイル
します。挿入される図は、その後も編集し続けられる本物のベクターソースです。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="キャンバス上のトランスフォーマーアーキテクチャと、その隣のコンパイル済み TikZ プレビューを表示した図表コンポーザー（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="キャンバス上のトランスフォーマーアーキテクチャと、その隣のコンパイル済み TikZ プレビューを表示した図表コンポーザー（ライトテーマ）" /></td>
  </tr>
</table>

</div>

### 誰かに指摘される前に文書をチェックする

プリフライトはソースとコンパイル済み出力の両方を検査します。壊れた参照、
欠落したアセット、重複ラベル、読み上げ順序の問題、メタデータの欠落、
アクセシブルでない図のパターン、そして応募者追跡システムが解析しにくい
履歴書レイアウトを検出します。

パーサーやスクリーンリーダーが抽出できるテキストも表示します。これらの
チェックは提出前の実践的なガイダンスであり、正式なアクセシビリティ認証
ではありません。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="ソースとコンパイル済み出力の具体的な指摘とともにアクセシビリティスコアを報告するプリフライト（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="ソースとコンパイル済み出力の具体的な指摘とともにアクセシビリティスコアを報告するプリフライト（ライトテーマ）" /></td>
  </tr>
</table>

</div>

参考文献と引用には専用のパネルがあります。文献リスト、文書内で使われて
いるすべての引用、そしてプロジェクトが定義する記号を確認できます。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="ソースとコンパイル済み PDF の隣で、文献エントリをキーと年で一覧する参考文献パネル（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="ソースとコンパイル済み PDF の隣で、文献エントリをキーと年で一覧する参考文献パネル（ライトテーマ）" /></td>
  </tr>
</table>

</div>

### 望むなら、AI にプロジェクトの作業を任せる

アシスタントはファイルの読み書き、プロジェクト検索、コンパイル、ログの
確認、そして結果を自己検証するための PDF テキスト抽出が行えます。引用、
インポートした文書、編集可能な TikZ 図の作業も手伝えます。

モデルは自分で選べます。

- 対応しているホスト型プロバイダーを自分の API キーで接続する。
- Ollama 経由でローカルモデルを動かす。
- AI を未設定のままにして、アプリの他の機能を普通に使う。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="引用する論文の検索、文献レビューの執筆、ソースエラーの修正といった出発点を提示するアシスタントパネル（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="引用する論文の検索、文献レビューの執筆、ソースエラーの修正といった出発点を提示するアシスタントパネル（ライトテーマ）" /></td>
  </tr>
</table>

</div>

ファイルの変更には差分と「承認」「却下」の操作が付きます。「常に許可」を
選ぶと、現在のセッション中は通常の書き込みを自動承認しつつ、削除だけは
引き続き確認を求めます。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="却下・常に許可・承認の操作とともに赤と緑の差分で表示されたアシスタントによるファイル変更" width="88%" />
</div>

承認されると編集がファイルに反映され、文書が再コンパイルされます。
どの応答にも「この応答より前の状態にコードを戻す」アクションが残ります。

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="承認されたアシスタントの編集が文書に適用され、再コンパイルされた PDF に反映された様子" width="88%" />
</div>

プロバイダーは設定画面で構成します。キーはマシン上に保存され、ローカルの
Ollama モデルならキーはまったく不要です。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="複数のプロバイダーを接続し、ローカルの Ollama モデルを選択した AI アシスタント設定ページ（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="複数のプロバイダーを接続し、ローカルの Ollama モデルを選択した AI アシスタント設定ページ（ライトテーマ）" /></td>
  </tr>
</table>

</div>

Oleafly はプロジェクトツールを Claude Desktop、Claude Code、Cursor、
その他の MCP クライアントに公開することもできます。MCP 接続は読み取り
専用モードと 3 つの承認ポリシーに対応しています。すべての変更を確認する、
削除のみ確認して書き込みは自動承認する、またはクライアント自身の承認
ゲートを信頼する、のいずれかです。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="ローカルサーバー、クライアント向けの設定手順、選択可能な承認ポリシーを表示した MCP 設定画面（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="ローカルサーバー、クライアント向けの設定手順、選択可能な承認ポリシーを表示した MCP 設定画面（ライトテーマ）" /></td>
  </tr>
</table>

</div>

現在のプロバイダー、ツール、セキュリティモデルについては
[機能リファレンス](../features.md)と [MCP セットアップ](../mcp.md)を
ご覧ください。

すべての機能にひとつの場所から到達できます。オムニバーはプロジェクトと
文書を検索し、`/` を入力するとコマンドパレットに変わります。

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="コマンドと最近更新されたプロジェクトを一覧するオムニバー（ダークテーマ）" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="コマンドと最近更新されたプロジェクトを一覧するオムニバー（ライトテーマ）" /></td>
  </tr>
</table>

</div>

## ローカルファースト、そして明確なネットワーク境界

アカウントもテレメトリも不要です。プロジェクトの中核データはあなたの
マシン上にとどまります。

| ローカルで動作・保持されるもの | 自分が求めたときだけネットワークを使うもの |
| --- | --- |
| プロジェクトファイルとエディタバッファ | 自分で接続したホスト型 AI プロバイダー |
| Git リポジトリと履歴 | GitHub への公開、プッシュ、プル |
| キャッシュ済みパッケージによるコンパイル | 初回コンパイルに必要な TeX パッケージ |
| PDF レンダリングとテキスト抽出 | オプションのテンプレート、フォント、Pandoc、TinyTeX のダウンロード |
| スペルチェック、文法チェック、プリフライト | 引用、文献、学会締切、アップデートの各照会 |
| Ollama によるローカル AI |  |

API キーはローカルに保存されます。プレーンなドキュメントファイルは、
Oleafly の利用をやめても引き続き使えます。

## インストール

最新ビルドは
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest)
からダウンロードしてください。

| プラットフォーム | インストーラー |
| --- | --- |
| macOS、Apple Silicon | `.dmg` |
| Windows、x86_64 | `.msi` または `-setup.exe` |
| Linux、x86_64 | `.AppImage`、`.deb`、または `.rpm` |

初回の LaTeX コンパイルでは、文書に必要なパッケージがダウンロードされる
ことがあります。Tectonic はそれらを以降のビルドのためにキャッシュし、
オフラインモードではコンパイルをそのキャッシュ内に限定します。

ソースから実行するには次のようにします。

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
./scripts/fetch-tectonic.sh all
./scripts/fetch-typst.sh all
pnpm install
pnpm tauri dev
```

前提条件、プラットフォームごとのセットアップ、プロダクションビルドに
ついては[開発ガイド](../development.md)をご覧ください。

## ドキュメント

このリポジトリでは、公開のエンジニアリング・プロダクトリファレンスを
コードのすぐそばに置いています。エンドユーザー向けのタスクガイドは、
この公開インデックスとは別に管理されています。

| リファレンス | 内容 |
| --- | --- |
| [プロダクトエンジニアリングカタログ](../README.md) | 機能インベントリとエンジニアリング上の取り決め |
| [機能リファレンス](../features.md) | プロダクトの提供範囲とサポートされるワークフロー |
| [ドキュメントエンジン](../document-engines.md) | LaTeX、Typst、Markdown の各機能 |
| [プロダクトアーキテクチャ](../architecture.md) | システム境界、パッケージの責務、拡張ポイント |
| [開発](../development.md) | ローカルセットアップ、テスト、コントリビューションのワークフロー |
| [言語サーバーツールチェーン](../language-server-toolchain.md) | 取得、整合性検証、配布のポリシー |
| [MCP 連携](../mcp.md) | 外部クライアント、アクセストークン、承認ポリシー |
| [リリース](../releasing.md) | リリースワークフローと成果物チェック |
| [コード署名](../signing.md) | プラットフォームごとの署名要件 |
| [自動アップデート](../updates.md) | アップデートマニフェスト、署名、ロールバック |

## コントリビューション

Oleafly は
[Prajwal S Venkateshmurthy](https://github.com/prajwal-svm) と
コントリビューターによってオープンに開発されています。バグ報告、修正、
テンプレート、ドキュメント、丁寧なプロダクトフィードバックを歓迎します。

1. [CONTRIBUTING.md](../../CONTRIBUTING.md) をお読みください。
2. 大きな変更の前には Issue を立ててください。小さく焦点の絞られた修正は
   そのままプルリクエストで構いません。
3. 提出前に関連するチェックを実行してください。

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

セキュリティ上の問題は
[SECURITY.md](../../SECURITY.md) の記載に従って非公開でご報告ください。
参加にあたっては[行動規範](../../CODE_OF_CONDUCT.md)が適用されます。

## クレジット

Oleafly は次のプロジェクトの上に築かれています。
[Tauri](https://tauri.app/)、
[React](https://react.dev/)、
[CodeMirror](https://codemirror.net/)、
[Tectonic](https://tectonic-typesetting.github.io/)、
[Typst](https://typst.app/)、
[pdf.js](https://mozilla.github.io/pdf.js/)、
[Zustand](https://github.com/pmndrs/zustand)、
[Tailwind CSS](https://tailwindcss.com/)、
[Harper](https://writewithharper.com/)、
[Hunspell](https://hunspell.github.io/)。

Oleafly は
[AGPL-3.0-or-later](../../LICENSE) の下でライセンスされています。サードパーティの
表示事項は [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md) に記載されています。
