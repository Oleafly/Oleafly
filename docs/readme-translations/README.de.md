<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-app-icon-pastel-256.png" alt="Oleafly-Logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

**Deutsch** | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md) | [العربية](README.ar.md)

[![Für macOS (Apple Silicon) herunterladen](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Für Windows herunterladen](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Für Linux herunterladen](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest)

[![Offene Issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml) [![SonarQube Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Oleafly_Oleafly) [![Code-Abdeckung](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=coverage)](https://sonarcloud.io/component_measures?id=Oleafly_Oleafly&metric=coverage) [![Entwicklungsstatus: extrem aktiv](https://img.shields.io/badge/status-ultra_active-22c55e)](https://github.com/Oleafly/Oleafly/pulse) [![Letzter Commit](https://img.shields.io/github/last-commit/Oleafly/Oleafly?label=last%20commit&color=22c55e)](https://github.com/Oleafly/Oleafly/commits/main) [![Lizenz: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE) [![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2Fkt9bcCjgkP%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=&color=5865F2&logo=discord&logoColor=white&cacheSeconds=600)](https://oleafly.com/discord) [![Sterne](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**Ein LaTeX-, Typst- und Markdown-Editor für die Forschung, mit Zusammenarbeit in Echtzeit.**

Oleafly ist ein leistungsstarker Editor für Forschungsarbeiten und Dissertationen in LaTeX, Typst und Markdown. Quelltext, PDF, Zitate, Abbildungen, Prüfungen und Git-Historie eines Projekts liegen an einem Ort. Schreibe in Echtzeit mit deinen Mitautor:innen, halte deine Projekte auf all deinen Computern synchron und hol Claude Code, Codex oder ein beliebiges Modell deiner Wahl ins Projekt.

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>Kostenlos herunterladen</strong></a>
· <a href="https://oleafly.com/docs/">Anleitungen lesen</a> · <a href="https://github.com/Oleafly/oleafly-server">Server betreiben</a> · <a href="../development.md">Aus dem Quellcode bauen</a>
</p>


Für immer kostenlos · Open Source · Kein Oleafly-Konto · Kein Tracking

</div>

<div align="center">
  <img src="../assets/readme/hero-collab.png" alt="Oleafly mit einem geöffneten LaTeX-Forschungspaper: links Dateibaum, Gliederung und Struktur, daneben der Quelltext mit den Cursorn und hervorgehobenen Kommentaren von fünf Mitautor:innen sowie das kompilierte PDF" width="100%" />
</div>

## Warum Oleafly

Alles hier ist kostenlos, auch das, wofür andere Editoren einen Bezahltarif verlangen: Zusammenarbeit in Echtzeit mit so vielen Mitautor:innen, wie du einlädst, vollständige Versionshistorie, Synchronisierung mit Git und GitHub, Zotero, Grammatikprüfung und KI.

- Schreibe in Echtzeit mit deinen Mitautor:innen, mit gemeinsamen Cursorn und Kommentaren, auf einem Server, den deine Arbeitsgruppe mit einem einzigen Befehl einrichtet.
- Ein Editor für lange Dokumente: Vervollständigung für Labels, Zitate und Befehle, Fehlerprüfung während des Schreibens, eine Gliederung des ganzen Projekts, Vim- und Emacs-Tastenbelegung, ein visueller Modus und eine durchsuchbare Palette mit 236 LaTeX-Symbolen.
- Kompiliere auf deinem eigenen Computer. Tectonic, Typst und Pandoc sind eingebaut, und TeX Live, MacTeX, MiKTeX oder TinyTeX übernehmen, wenn ein Projekt eine vollständige Distribution braucht.
- Ein Klick ins PDF springt zum Quelltext und wieder zurück, und das letzte fehlerfreie PDF bleibt sichtbar, während du einen Fehler behebst.
- Jedes Projekt ist ein Git-Repository, das du zu GitHub, GitLab, Gitea, Forgejo, Codeberg oder deinem eigenen Git-Server pushen kannst, und Checkpoints speichern nach jeder erfolgreichen Kompilierung einen Snapshot.
- Zitiere beim Schreiben aus deiner Zotero-Bibliothek und durchsuche arXiv, Semantic Scholar, Crossref, PubMed und OpenAlex, ohne den Editor zu verlassen.
- Rechtschreib- und Grammatikprüfung, abgestimmt auf wissenschaftliches Schreiben, laufen auf deinem Computer.
- Preflight findet vor der Einreichung defekte Referenzen, fehlende Abbildungen, nicht eingebettete Schriften, Lücken bei der Barrierefreiheit und alles, was in einer Blindbegutachtung die Anonymität aufheben würde.
- Zeichne Abbildungen, die als TikZ-, Typst- oder Mermaid-Code erhalten bleiben, und beginne mit einer von mehr als 1.700 Vorlagen für Paper, Dissertationen, Folien, Poster und Lebensläufe.
- Importiere aus Word, einem PDF, einer arXiv-Quelle, einem Git-Repository oder einem Online-LaTeX-Konto.
- Der Befehl `oleafly` kompiliert, prüft und synchronisiert deine Projekte aus jedem Terminal oder CI-Job heraus, mit denselben Compilern und Einstellungen wie die App.
- Die Cloud-Synchronisierung hält deine Projekte auf jedem Computer bereit, den du nutzt, und du kannst offline weiterschreiben.
- Claude Code, Codex und 12 weitere Agenten arbeiten direkt in deinem Projekt, oder du verbindest ein beliebiges Modell, auch lokale. KI ist optional, und jede Änderung, die sie vornimmt, ist ein Diff, den du prüfen und rückgängig machen kannst.
- Rechercheaufgaben führen eine Literaturübersicht, einen Evidenz-Audit oder eine Überarbeitung in einer separaten Kopie des Projekts aus, während du weiterschreibst, und du wählst, welche geänderten Dateien du behältst. Sie sind experimentell und standardmäßig ausgeschaltet; unter „Einstellungen > Experimente“ schaltest du sie ein.

## Gemeinsam live schreiben

Teile ein Projekt auf den Oleafly Server deiner Arbeitsgruppe, und alle bearbeiten gleichzeitig dieselben Dateien. Du siehst Cursor und Auswahl jeder Person, wer online ist und was sich geändert hat, während du weg warst. Klicke auf den Avatar einer Person, um zu der Zeile zu springen, an der sie gerade arbeitet.

<p align="center">
  <img src="../assets/readme/live-comments.png" alt="Zwei Mitautor:innen bearbeiten in Oleafly dieselbe LaTeX-Datei, mit ihren Cursorn, Avataren und dem Bereich für Personen und Aktivität" width="100%" />
</p>

- Kommentiere jede Auswahl in LaTeX, Typst oder Markdown, antworte dann, erwähne jemanden, löse einen Kommentar auf oder öffne ihn wieder. Wer erwähnt wird, bekommt eine E-Mail und kann diese E-Mails abschalten.
- Änderungen, die du offline machst, werden zusammengeführt, sobald du wieder verbunden bist. Überschneiden sie sich mit denen einer anderen Person, zeigt Oleafly dir beide und fragt, bevor es etwas übernimmt.
- Auch KI-Änderungen, Zotero-Zitate, Umbenennungen, Löschungen und Abbildungen werden übertragen. Ersetzen zwei Personen gleichzeitig dieselbe Abbildung, bleiben beide Versionen erhalten.
- Hauptdatei, Compiler, Sprache der Rechtschreibprüfung und Typst-Optionen werden geteilt, sodass das ganze Team das Projekt auf dieselbe Weise kompiliert.
- Jedes Projekt hat Rollen für Eigentümer, Bearbeiter, Gutachter, Kommentatoren und Betrachter. Bearbeitungen von Gutachtern werden zu Vorschlägen, und auch Eigentümer und Bearbeiter können in den Modus Vorschlagen wechseln. Gäste, die per E-Mail eingeladen werden, sehen nur die Projekte, zu denen sie eingeladen wurden.
- Jedes geteilte Projekt hat einen Chat und einen Verlauf, in dem du Versionen vergleichen, eine davon wiederherstellen oder ihr einen Namen geben kannst.
- Mitautor:innen können ein geteiltes Projekt in ihrem Browser öffnen, wenn der Browserzugriff auf dem Server eingeschaltet ist, und das PDF der letzten Kompilierung lesen.

### Den Server selbst betreiben

Oleafly Server lässt sich mit einem Befehl auf einem Linux-Rechner installieren, ob das eine Workstation im Labor, eine VM der Universität oder ein kleiner Cloud-Server ist:

```bash
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

Es ist eine einzelne Rust-Binärdatei, die SQLite nutzt, Dateien auf der Festplatte oder in einem beliebigen S3-kompatiblen Speicher ablegt und E-Mails über SMTP verschickt, wenn du das einrichtest. Angemeldet wird mit GitHub oder einem beliebigen OpenID-Connect-Anbieter, sodass das Single Sign-on deiner Universität funktioniert. Es gibt fertige Konfigurationen für Docker Compose, Coolify, Render und systemd sowie Anleitungen für Railway, Cloudflare Tunnel und Zertifikate von Universitäten.

Admins bekommen in Oleafly eine Konsole für Personen, Zugriffsregeln, Projekte, E-Mail und das Sicherheitsprotokoll. Jedes Gerät signiert seine Änderungen, und der Server baut jeden Snapshot aus dieser signierten Historie auf, statt hochgeladenen Dateien zu vertrauen.

<p align="center">
  <img src="../assets/readme/server-admin.png" alt="Admin-Konsole von Oleafly Server mit Personen, Zugriffsregeln und dem Sicherheitsprotokoll" width="100%" />
</p>

Im [Server-Leitfaden](https://github.com/Oleafly/oleafly-server) findest du Einrichtung, Backups und die vollständige Liste, wer was tun darf.

## Cloud-Synchronisierung zwischen deinen Computern

Schalte die Cloud-Synchronisierung ein, und die Projekte deiner Bibliothek sowie deine App-Einstellungen begleiten dich von einem Computer zum nächsten. Jeder Download wird mit seinem Eintrag abgeglichen, bevor er eine Datei ersetzt, und eine geöffnete Datei mit ungespeicherten Änderungen wird nie überschrieben.

<p align="center">
  <img src="../assets/readme/cloud-sync-dropbox.png" alt="Oleafly-Einstellungen zur Cloud-Synchronisierung mit der Dropbox-Karte und einer Liste dessen, was synchronisiert wird" width="100%" />
</p>

- Bearbeiten zwei Computer dieselbe Datei, bleiben beide Versionen erhalten, jeweils nach dem Computer benannt, der sie geschrieben hat.
- Löschst du den größten Teil eines Projekts auf einmal, wird die Löschung zurückgehalten, bis du sie bestätigst, damit ein einziger Fehlgriff das Projekt nicht überall leert.
- Dateien, die auf einem anderen Computer gelöscht werden, landen hier im Papierkorb, statt zu verschwinden.
- Auf einem neuen Computer fragt Oleafly einmal, ob die Einstellungen dieses Computers oder die synchronisierten gelten sollen.

## Deine Projekte mitnehmen

Du wechselst von einem Online-LaTeX-Editor? Melde dich einmal aus Oleafly heraus bei deinem Konto an, wähle die gewünschten Projekte aus, und sie kommen mit ihren Dateien, ihrem Compiler und ihrer Hauptdatei herüber, bereit zum Kompilieren. Das funktioniert auch mit dem eigenen Server einer Universität.

Mit einem Git-Token aus diesem Konto kann Oleafly ein importiertes Projekt in beide Richtungen synchron halten, sodass Mitautor:innen, die online bleiben, weiterarbeiten wie bisher. Die Synchronisierung in beide Richtungen nutzt die eigene Git-Integration des Dienstes, die auf dem Konto der Person, der das Projekt gehört, einen kostenpflichtigen Tarif oder einen Universitätstarif voraussetzt.

<p align="center">
  <img src="../assets/readme/import-dialog.png" alt="Oleafly-Dialog zum Importieren eines Projekts mit Optionen für lokale Dateien, arXiv, GitHub und ein Online-LaTeX-Konto" width="100%" />
</p>

Du kannst auch mit einem Projekt-ZIP, einem GitHub-Repository, einem Word-Dokument, einem arXiv-Quellpaket oder einem PDF beginnen, das Oleafly als bearbeitbares LaTeX neu aufbaut. Oder öffne einen Ordner dort, wo er bereits liegt.

## KI-Agenten, die in deinem Projekt arbeiten

Wähle einen Agenten aus dem Katalog, und er arbeitet in deinem Projekt, mit Quelltext, PDF und Kompilierungsprotokoll in Reichweite. Jeder Agent meldet sich mit seinem eigenen Konto an und nutzt sein eigenes Modell. Oleafly gibt ihm das Projekt und die Werkzeuge drumherum.

<p align="center">
  <img src="../assets/readme/ai-agents.png" alt="Ein KI-Agent in Oleafly überarbeitet einen Abschnitt eines LaTeX-Papers, die vorgeschlagene Änderung ist als Diff zu sehen" width="100%" />
</p>

<div align="center">
<table>
  <tr>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/anthropic" alt="" width="40" height="40" /><br />Claude&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="https://api.iconify.design/logos:openai-icon.svg" alt="" width="40" height="40" /><br />Codex&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/googlegemini" alt="" width="40" height="40" /><br />Gemini&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="https://pi.dev/favicon.svg" alt="" width="40" height="40" /><br />Pi</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/opencode" alt="" width="40" height="40" /><br />OpenCode</td>
    <td align="center" valign="top" width="135"><img src="https://openclaw.ai/favicon.svg" alt="" width="40" height="40" /><br />OpenClaw</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/cline" alt="" width="40" height="40" /><br />Cline</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="https://hermes-agent.nousresearch.com/favicon.ico" alt="" width="40" height="40" /><br />Hermes&nbsp;Agent</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/codebuddy" alt="" width="40" height="40" /><br />CodeBuddy</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/kimi" alt="" width="40" height="40" /><br />Kimi&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="https://grok.com/images/favicon.svg" alt="" width="40" height="40" /><br />Grok&nbsp;Build</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/cursor" alt="" width="40" height="40" /><br />Cursor</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/deepseek" alt="" width="40" height="40" /><br />DeepSeek Harness</td>
    <td align="center" valign="top" width="135"><img src="https://qoder.com/favIcon.svg" alt="" width="40" height="40" /><br />Qoder</td>
  </tr>
</table>
</div>

<p align="center"><sub>Diese Markierungen kennzeichnen kompatible Werkzeuge und bleiben Eigentum der jeweiligen Rechteinhaber. Sie stellen keine Empfehlung dar.</sub></p>

Lieber ein Chat-Assistent? Verbinde einen gehosteten Anbieter, einen beliebigen OpenAI-kompatiblen Endpunkt oder ein lokales Ollama-Modell.

- Jede Dateiänderung ist ein Diff. Gib jede einzeln frei, lass den Assistenten selbstständig arbeiten oder lege Regeln pro Werkzeug fest, und mache eine einzelne Datei oder einen ganzen Durchlauf rückgängig.
- Im Plan mode erfasst der Assistent das Projekt, bevor irgendetwas geschrieben wird.
- Eine Literaturübersicht oder eine Überarbeitung kann in einem eigenen Git-Worktree laufen, während du weiterschreibst. Du entscheidest, welche geänderten Dateien du behältst.
- 39 Skills für die Forschung werden mit der App ausgeliefert, darunter Literatursichtung, verwandte Arbeiten, Prüfung von Behauptungen und Antwortschreiben an Gutachter:innen.
- Ein lokaler MCP-Server lässt einen externen KI-Client dieselben Projektwerkzeuge nutzen. Er lauscht nur auf 127.0.0.1.
- `oleafly mcp` stellt Claude Code, Codex, Cursor und Gemini CLI die Projektwerkzeuge über stdio bereit, ob die App offen ist oder nicht.

KI ist optional. Editor, Compiler, PDF, Zitate, Korrektur und Prüfungen funktionieren alle auch mit ausgeschalteter KI.

## LaTeX, Typst und Markdown, kompiliert auf deinem Computer

Tectonic, Typst und Pandoc werden mit der App ausgeliefert, sodass ein neues Projekt kompiliert, ohne dass du etwas installieren musst. Braucht ein Projekt eine vollständige TeX-Distribution, stelle es auf latexmk mit TeX Live, MacTeX, MiKTeX oder einem TinyTeX um, das Oleafly für dich installiert.

<p align="center">
  <img src="../assets/readme/editor-and-pdf.png" alt="Oleafly-Quelltexteditor und kompiliertes PDF nebeneinander, mit einer Kompilierungsdiagnose, die mit ihrer Quelltextzeile verknüpft ist" width="100%" />
</p>

- Klicke ins PDF, um zum Quelltext zu springen, und wieder zurück. LaTeX nutzt dafür SyncTeX, Typst ab Version 0.13 nutzt Tinymist.
- Kompilierungsfehler verweisen auf die Zeile, die sie verursacht hat, und das letzte fehlerfreie PDF bleibt sichtbar, während du sie behebst.
- Im visuellen Modus bearbeitest du eine seitenähnliche Ansicht, und der Quelltext ist nur einen Klick entfernt.
- Vervollständigung und Live-Diagnosen für Labels, Zitate, Befehle, Umgebungen und Dateipfade im ganzen Projekt.
- Rechtschreib- und Grammatikprüfung laufen lokal und sind auf wissenschaftliches Schreiben abgestimmt.
- XeLaTeX, LuaLaTeX sowie upLaTeX oder pLaTeX für japanische Dokumente.
- Quarto- und Calepin-Dokumente führen ihren R-, Python- oder Julia-Code aus, sobald du Code für das Projekt erlaubst. Oleafly kann beide Werkzeuge für dich herunterladen.

## Zitate, Abbildungen, Prüfungen und Vorlagen

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/citations.png" alt="Einen Zotero-Eintrag im Oleafly-Editor durch Eingabe von @ zitieren" width="100%" />
      <h3>Beim Schreiben aus Zotero zitieren</h3>
      Tippe <code>@</code> und einen Teil eines Autors, Titels oder Jahres, um aus deiner Zotero-Bibliothek zu zitieren. Oleafly fügt nur diesen einen Eintrag zur <code>.bib</code> des Projekts hinzu. Citation Search deckt arXiv, Semantic Scholar, Crossref, PubMed und OpenAlex ab.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/diagrams.png" alt="Oleafly Diagram Composer mit Arbeitsfläche und TikZ-Code nebeneinander" width="100%" />
      <h3>Abbildungen zeichnen, die Code bleiben</h3>
      Diagram Composer zeichnet auf einer Arbeitsfläche und schreibt TikZ, fletcher für Typst oder Mermaid. Ändere die Zeichnung oder den Code, und das jeweils andere zieht nach.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/preflight.png" alt="Oleafly Preflight mit Befunden zu Referenzen, Abbildungen und Barrierefreiheit" width="100%" />
      <h3>Vor der Einreichung prüfen</h3>
      Preflight findet defekte Referenzen, fehlende Abbildungen, nicht eingebettete Schriften, Lücken bei der Barrierefreiheit und alles, was in einer Blindbegutachtung die Autor:innen verraten würde. Es gibt Profile für arXiv, IEEE, ACM, Zeitschriften und Dissertationen.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/templates.png" alt="Oleafly-Vorlagengalerie mit gerenderten Vorschauen von Papern, Dissertationen und Folien" width="100%" />
      <h3>Mit über 1.700 Vorlagen beginnen</h3>
      Artikel, Dissertationen, Beamer-Vorträge, Poster, Lebensläufe und Paper im Stil von Konferenzen und Zeitschriften, jeweils mit gerenderter Vorschau, bevor du das Projekt erstellst.
    </td>
  </tr>
</table>

## Git, Historie und ein Terminal

Jedes Projekt ist ein normaler Ordner mit einem normalen Git-Repository. Über das Source-Control-Panel kannst du Änderungen stagen, Diffs ansehen, committen, pushen, pullen und auf GitHub, GitLab, Gitea, Forgejo, Codeberg oder deinem eigenen Server veröffentlichen, oder du nutzt dein eigenes Terminal, denn vor ihm ist nichts verborgen. Checkpoints speichern nach jeder erfolgreichen Kompilierung einen lokalen Snapshot, sodass du zu einem früheren Stand zurückkehren kannst, ohne einen Commit zu machen.

<p align="center">
  <img src="../assets/readme/git-history.png" alt="Oleafly-Source-Control-Panel mit einem Diff, einem Branch-Diagramm und Commit-Steuerelementen" width="100%" />
</p>

Unter dem Editor sitzt ein Terminal-Dock mit bis zu zehn Tabs pro Projekt. Ein Cmd-Klick (Ctrl-Klick) auf einen Dateipfad in der Ausgabe öffnet die Datei an dieser Zeile.

Der Befehl `oleafly` arbeitet aus jedem Terminal mit denselben Projekten: kompilieren, bei jeder Änderung neu kompilieren, vor dem Einreichen prüfen, mit einem Online-LaTeX-Dienst synchronisieren oder den Oleafly-Agenten ausführen, ohne die App zu öffnen. Jeder Befehl kann JSON mit festen Exit-Codes für Skripte und CI ausgeben. Mehr dazu im [Leitfaden zur Kommandozeile](../cli.md).

## Und noch viel mehr

<details>
<summary>Über 40 Werkzeuge für Konvertierung, Zitate und Mathematik</summary>

Die Tools-Galerie befindet sich in der Beta und ist standardmäßig ausgeschaltet. Schalte sie unter „Einstellungen > Experimente > LaTeX-Werkzeuge“ ein.

#### Import und Formatkonvertierung

| Tool | Verwendung |
| --- | --- |
| PDF to LaTeX | Aus einem PDF bearbeitbares LaTeX rekonstruieren, wobei Mathematik, Abbildungen und Struktur erhalten bleiben, soweit die Quelle dies zulässt |
| arXiv to LaTeX | Ein arXiv-Quellpaket per ID herunterladen oder ein gespeichertes Archiv von der Festplatte entpacken |
| Image to LaTeX | Ein Bild mit Notizen, Gleichungen oder einer Tabelle in bearbeitbares LaTeX umwandeln |
| Equation to LaTeX | Getippten mathematischen Text oder ein Gleichungsbild in LaTeX konvertieren |
| Excel to LaTeX | Ein Excel-, CSV- oder TSV-Blatt in eine maskierte LaTeX-Tabelle konvertieren |
| HTML to LaTeX | Eingefügtes HTML in ein eigenständiges LaTeX-Dokument konvertieren |
| Image to Typst | Ein Bild mit Notizen, Gleichungen oder einer Tabelle in bearbeitbares Typst umwandeln |
| LaTeX to HTML | LaTeX mit MathML-Gleichungen in eigenständiges HTML konvertieren |
| LaTeX to Image | Eine Gleichung rendern und als PNG oder SVG exportieren |
| LaTeX to Markdown | Ein LaTeX-Dokument in portables Markdown konvertieren |
| LaTeX to Typst | LaTeX in Typst-Quelltext konvertieren, den du kopieren, speichern oder als Projekt öffnen kannst |
| LaTeX to Word | Ein Word-Dokument erstellen, dessen Gleichungen als native Word-Mathematik gespeichert werden |
| Markdown to LaTeX | Markdown-Notizen in ein eigenständiges LaTeX-Dokument konvertieren |
| Markdown to Typst | Markdown-Notizen in Typst-Quelltext konvertieren |
| Mermaid to LaTeX | Ein Mermaid-Flussdiagramm in bearbeitbaren TikZ-Code konvertieren |
| PDF to Markdown | Textebene, Gleichungen und Abbildungen eines PDFs in Markdown extrahieren |
| PDF to Typst | Textebene, Gleichungen und Abbildungen eines PDFs in Typst extrahieren |
| Table to LaTeX | Eine LaTeX-Tabelle in einem visuellen Editor für Zeilen und Spalten erstellen |
| Typst Editor | Ein Typst-Projekt mit Quelltextbearbeitung, Live-Vorschau und PDF-Export starten |
| Visual Typst Editor | Ein Typst-Dokument im Projekteditor mit Live-Vorschau starten |
| Typst to LaTeX | Typst-Markup für Zeitschriften und Einreichungen in LaTeX konvertieren |
| arXiv to Typst | Ein arXiv-Quellpaket in Typst konvertieren, mit einer Kompilierprüfung, die auflistet, was nicht konvertiert wurde |
| CSV to Typst | CSV- oder TSV-Zeilen einfügen und eine maskierte Typst-Tabelle erhalten |
| Equation to Typst | Getippte LaTeX-Mathematik oder ein Gleichungsbild in Typst-Mathematik konvertieren |
| Excel to Typst | Ein Excel-, CSV- oder TSV-Blatt in eine maskierte Typst-Tabelle konvertieren |
| HTML to Typst | Eingefügtes HTML in ein eigenständiges Typst-Dokument konvertieren |
| Mermaid to Typst | Ein Mermaid-Flussdiagramm in bearbeitbaren fletcher-Code konvertieren |
| Typst to HTML | Typst-Markup in eigenständiges HTML mit MathML-Gleichungen konvertieren |
| Typst to Markdown | Typst-Markup in portables Markdown konvertieren |
| Typst to Word | Ein Word-Dokument erstellen, dessen Gleichungen als native Word-Mathematik gespeichert werden |
| Word to Typst | Ein Word-Dokument in Typst konvertieren und extrahierte Medien zusammenhalten |
| Word to LaTeX | Ein Word-Dokument in LaTeX konvertieren und extrahierte Medien zusammenhalten |

#### Mathematik, Tabellen, Schreiben und Validierung

| Tool | Verwendung |
| --- | --- |
| BibTeX Validator | `.bib`-Dateien auf Syntaxfehler, fehlende Pflichtfelder und doppelte Schlüssel prüfen |
| Statistics Calculators | p-Werte, Stichprobengrößen und Konfidenzintervalle lokal berechnen |
| Writing Generators | Mit dem Assistenten aus dem geöffneten Dokument ein Abstract, eine Zusammenfassung, eine Paraphrase oder eine Gliederung für eine Dissertation erstellen |
| Symbol Reference | LaTeX-Symbole durchsuchen und eines am Cursor einfügen oder in einer Typst-Datei seinen Typst-Namen |

#### Literatur, Referenzen und Recherche

| Tool | Verwendung |
| --- | --- |
| Find Citations | Wissenschaftliche Indizes durchsuchen, einen Entwurf auf fehlende Belege prüfen und BibTeX exportieren |
| arXiv Citation Generator | Eine arXiv-Arbeit suchen und ihr Zitat in acht Stilen formatieren |
| Bibliography Generator | Eine Bibliografie aus strukturierten Angaben oder BibTeX erstellen, validieren, sortieren und exportieren |
| Citation Generator | Aus Artikeldetails oder einer wissenschaftlichen Kennung ein formatiertes Zitat und BibTeX erstellen |
| Citation Generators by Style | Eine Referenz in APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA und ACS vergleichen |
| DOI to BibTeX | Einen DOI-Datensatz abrufen, seine Felder prüfen und BibTeX exportieren |
| ISBN to BibTeX | Buchmetadaten per ISBN abrufen, korrigieren und exportieren |
| PubMed to BibTeX | Einen PubMed-Datensatz per PMID abrufen, prüfen und exportieren |
| URL to BibTeX | DOI-, arXiv- und PubMed-Links erkennen oder ein bearbeitbares Webseitenzitat erstellen |
| Lab Search | Forschungseinrichtungen über das OpenAlex-Verzeichnis finden |
| Conference Deadlines | Konferenzfristen, überwiegend aus der Informatik, filtern und Countdowns anzeigen |

</details>

<details>
<summary>Die 39 Skills für die Forschung, die mit Oleafly ausgeliefert werden</summary>

Skills sind gewöhnliche `SKILL.md`-Ordner, die dem Agent-Skills-Format folgen. Führe einen mit einem Slash-Befehl aus, füge eigene hinzu oder teile sie mit kompatiblen CLI-Agenten auf demselben Computer.

Das gebündelte `research-core`-Paket enthält 39 Skills. Die folgenden Namen sind die IDs, die der Katalog und die Projekteinstellungen verwenden.

| Kategorie | Skills |
| --- | --- |
| Recherche und Literatur | `citation-management`, `exploratory-data-analysis`, `hypothesis-generation`, `literature-review`, `oleafly-experiment-loop`, `oleafly-literature-sweep`, `oleafly-research-loop`, `openresearch`, `paper-lookup`, `research-lookup`, `scientific-brainstorming`, `scientific-critical-thinking` |
| Manuskripterstellung und Analyse | `experimental-design`, `oleafly-data-analysis`, `oleafly-manuscript-scaffold`, `oleafly-related-work`, `scientific-writing`, `statistical-analysis`, `statistical-power`, `venue-templates` |
| Abbildungen und Visualisierung | `oleafly-figure-prep`, `scientific-schematics`, `scientific-visualization` |
| Review und Evidenz | `oleafly-response-letter`, `oleafly-review-manuscript`, `oleafly-verify-claims`, `peer-review`, `scholar-evaluation` |
| Einreichung | `oleafly-pre-submission` |
| Kommunikation | `oleafly-slides-and-posters`, `pptx-posters`, `research-grants`, `scientific-slides` |
| Werkzeuge und Automatisierung | `desktop-apps`, `import-refine`, `oleafly-cli`, `oleafly-latex-build`, `pdf-to-latex`, `template-generate` |

</details>

<details>
<summary>Details zum Editor</summary>

- Eine durchsuchbare Palette mit 236 LaTeX-Symbolen, die in Typst-Dateien die Typst-Namen einfügt.
- Vim- und Emacs-Tastenbelegung, Tabs für mehrere Dateien, Code-Faltung, projektweites Suchen und Ersetzen sowie Wortzählung.
- Benenne eine Datei um oder verschiebe sie, und Oleafly passt die Pfade an, die auf sie zeigen.
- Themes für den hellen und den dunklen Modus, jede installierte Schrift, bearbeitbare Syntaxfarben und der Zen-Modus.
- Die Oberfläche gibt es in 21 Sprachen.
- Befehlspalette unter Cmd+K (Ctrl+K) und ein einziges Suchfeld für Projekte, Dokumente, Einstellungen und Werkzeuge unter Cmd+Shift+F (Ctrl+Shift+F).

</details>

## Erste Schritte

1. [Lade Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) für deinen Computer herunter.
2. Erstelle ein Projekt aus einer Vorlage, importiere eines oder öffne einen Ordner, den du schon hast.
3. Drücke Cmd+Enter (Ctrl+Enter unter Windows und Linux), um zu kompilieren.
4. Um mit anderen zu schreiben, klicke auf **Teilen** und sende das Projekt an den Oleafly Server deiner Arbeitsgruppe.

| Plattform | Paket | Download |
| --- | --- | --- |
| macOS · Apple Silicon | DMG | [![Für macOS (Apple Silicon) herunterladen](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | MSI oder EXE | [![Für Windows herunterladen](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 | AppImage, DEB oder RPM | [![Für Linux (x86_64) herunterladen](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · ARM64 | AppImage, DEB oder RPM | [![Für Linux (ARM64) herunterladen](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |

Unter x86_64 benötigen die Linux-Pakete glibc 2.35 oder neuer (Ubuntu 22.04 oder später). ARM64-Pakete werden unter Ubuntu 24.04 gebaut. Releases enthalten signierte Update-Artefakte, und der In-App-Updater prüft die Signatur, bevor er etwas installiert.

## Häufige Fragen

<details>
<summary>Brauche ich ein Konto?</summary>

Kein Oleafly-Konto. Du kannst schreiben, kompilieren und Git nutzen, ohne dich irgendwo anzumelden. Für die Live-Zusammenarbeit meldest du dich mit GitHub oder der Anmeldung deiner Universität am Server deiner Arbeitsgruppe an, und die Cloud-Synchronisierung meldet sich bei deinem Cloud-Speicher an.

</details>

<details>
<summary>Funktioniert es offline?</summary>

Ja. Schreiben, Kompilieren, das PDF, Korrektur, Preflight, Git und Checkpoints laufen alle auf deinem Computer. LaTeX kompiliert offline, sobald die gebündelte Engine die benötigten Pakete hat, und Typst, sobald seine Pakete im Cache liegen. Geteilte Projekte behalten deine Änderungen und führen sie zusammen, sobald du wieder verbunden bist.

</details>

<details>
<summary>Was geht über das Netzwerk?</summary>

Nur das, was du anforderst: Teilen mit deinem Server, Cloud-Synchronisierung, Literatur- und DOI-Abfragen, GitHub, gehostete KI-Anbieter, MCP-Server, die du verbindest, sowie optionale Downloads von Engines, Paketen und Vorlagen. Release-Builds prüfen außerdem beim Start der App, ob ein Update vorliegt. Ein lokales Ollama-Modell hält den KI-Verkehr auf deinem Computer.

</details>

<details>
<summary>Kann meine Universität oder Firma den Server hosten?</summary>

Ja, genau dafür ist er gedacht. Oleafly Server läuft auf deinem eigenen Rechner oder in deinem Cloud-Konto, meldet Personen über GitHub oder einen beliebigen OpenID-Connect-Anbieter an und speichert Dateien auf der Festplatte oder in S3-kompatiblem Speicher. Der [Server-Leitfaden](https://github.com/Oleafly/oleafly-server) behandelt Installation, Backups und Rollen.

</details>

## Mehr erfahren

- [Produktanleitungen](https://oleafly.com/docs/)
- [Oleafly Server](https://github.com/Oleafly/oleafly-server)
- [Funktionsübersicht](../features.md)
- [Editor-Leitfaden](../Editor.md)
- [PDF-Vorschau](../PDFPreview.md)
- [Zitate und Literatur](../Citations.md)
- [Tools-Galerie](../Tools.md)
- [Preflight- und Barrierefreiheitsprüfungen](../Preflight.md)
- [Vorlagen](../Templates.md)
- [Diagram Composer](../DiagramComposer.md)
- [Git und Source Control](../SourceControl.md)
- [Checkpoints](../Checkpoints.md)
- [KI-Copilot](../AICopilot.md)
- [Skills](../Skills.md)
- [MCP-Integration](../mcp.md)
- [Kommandozeilen-Tool](../cli.md)
- [Entwicklungsumgebung](../development.md)
- [Changelog](../../CHANGELOG.md)

## Community und Support

Tritt der [Oleafly-Community auf Discord](https://oleafly.com/discord) bei: Stelle Fragen, hol dir Hilfe bei einem störrischen Build, zeig, woran du schreibst, und stimme darüber ab, was als Nächstes gebaut wird. Kostenlos und offen für alle. Lieber auf GitHub? Melde einen Fehler oder wünsche dir eine Funktion in den [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).

Oleafly wird von [Prajwal Murthy](https://github.com/prajwal-svm) und Mitwirkenden entwickelt. Beiträge zu Code, Vorlagen, Dokumentation und Feedback sind willkommen. Lies den [Leitfaden zum Mitwirken](../../CONTRIBUTING.md), wenn du dich beteiligen möchtest.

Wenn du Oleafly nutzt, hilft ein [GitHub-Stern](https://github.com/Oleafly/Oleafly) anderen Forschenden, es zu finden.

## Oleafly zitieren

<details>
<summary>Den BibTeX-Eintrag kopieren</summary>

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S. and {The Oleafly contributors}},
  title   = {Oleafly: a local-first workspace for research writing},
  year    = {2026},
  version = {0.4.7},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

</details>

[Sicherheit](../../SECURITY.md) · [Verhaltenskodex](../../CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](../../LICENSE)

## Star-Verlauf

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Star-Verlaufsdiagramm" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
