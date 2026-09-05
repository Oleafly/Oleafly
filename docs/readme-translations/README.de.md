<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly-Logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[English](../../README.md) | **Deutsch** | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md) | [العربية](README.ar.md)

<h2>Eine vollständige Forschungsumgebung, neu entwickelt für das KI-Zeitalter.</h2>

Schreibe, kompiliere und korrigiere Texte, durchsuche Fachliteratur, verwalte
Quellen, erstelle Abbildungen, prüfe PDFs und verfolge jede Änderung in Git.
Nutze gehostete KI, einen eigenen Endpunkt, lokales Ollama oder gar keine KI.
Oleafly speichert deine Projekte als normale Ordner auf deinem Computer.

[![Offene Issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=Issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)
**[Oleafly herunterladen](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Produktdokumentation lesen](https://oleafly.com/docs/overview/) ·
[Aus dem Quellcode bauen](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly bearbeitet das LLaMA-Forschungspapier in LaTeX. Quellbaum, Dokumentgliederung und kompiliertes PDF sind gleichzeitig geöffnet." width="100%" />
</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

## Forschung hat ohnehin schon genug bewegliche Teile

Ein technisches Dokument verteilt sich am Ende meist auf einen Editor, einen
Compiler, einen PDF-Viewer, ein Bibliographiewerkzeug, Git und einen KI-Chat,
der das eigentliche Projekt nicht sehen kann. Oleafly holt diese Arbeit in eine
Desktop-App und hält den Quelltext dabei für andere Editoren und
Kommandozeilenwerkzeuge lesbar.

Dieselbe Projektansicht funktioniert für einen Seminarbericht, ein
Journal-Paper oder eine hundertseitige Abschlussarbeit:

| Deine Arbeit | Was Oleafly übernimmt |
| --- | --- |
| Schreiben | Quelltext- und visuelle Bearbeitung, Autovervollständigung, Symbole, Zitate, Abbildungen, Tabellen und projektweite Code-Intelligenz |
| Kompilieren | Mitgelieferte LaTeX- und Typst-Engines, Markdown über Pandoc, ausgewertete Fehler, Logs und offline gecachte Builds |
| Betrachten | Eine schnelle PDF-Vorschau, Seiten- und Zoomsteuerung, Doppelseitenlayouts, Farbinversion und bidirektionales SyncTeX |
| Überarbeiten | Automatisches Speichern, echte Git-Historie, Diffs, Wiederherstellung und GitHub-Sync |
| Einreichen | ATS- und Barrierefreiheits-Preflight, Referenzprüfungen, Extraktion der Leseransicht und mehrere Exportformate |
| Hilfe holen | Ein optionaler projektbewusster KI-Assistent, lokale Ollama-Modelle, gehostete Anbieter und MCP-Clients |

Wenn du Overleafs Schreiben-und-Vorschau-Workflow magst, aber Kompilierung,
Dateien, Git und die Modellwahl auf deinem eigenen Rechner haben willst, ist
Oleafly genau dafür gemacht. Es kann außerdem einen Großteil des Setups rund um
einen lokalen Editor, eine TeX-Toolchain, einen PDF-Viewer und einen Git-Client
ersetzen.

Oleafly bietet heute kein gemeinsames Live-Editing im Browser. Git und GitHub
sind der aktuelle Weg zur Zusammenarbeit.

## Was du damit machen kannst

### Schreiben, mit dem Quelltext in Reichweite

- Arbeite mit LaTeX-, Typst- und Markdown-Projekten, einschließlich großer
  mehrteiliger Dokumente, Bilder, Includes und Bibliographien.
- Wechsle bei LaTeX und Markdown zwischen Code- und Visual-Ansicht. Nicht
  unterstützte Rich-Blöcke bleiben als editierbarer Quelltext sichtbar, statt
  zu verschwinden.
- Füge Überschriften, Listen, Links, Zitate, Querverweise, Gleichungen,
  Brüche, Abbildungen, Tabellen und Symbole über die Editor-Werkzeugleiste ein.
- Nutze Autovervollständigung für Befehle, Zitate, Labels, Dateien und
  Slash-Befehle.
- Suche und ersetze, klappe Abschnitte und Umgebungen ein, aktiviere
  Vim-Tastenbelegungen und führe Rechtschreib- und Grammatikprüfungen offline aus.
- Springe zu Definitionen, finde Referenzen, benenne Labels oder
  Zitierschlüssel projektweit um und sieh dir Definitionen per Hover an.

Die Projektkarte indiziert jeden Abschnitt, jedes Label, jeden Zitierschlüssel
und jede Umgebung im Projekt und hält sie über `file:line` adressierbar, sodass
Navigation und Umbenennungen über ein mehrteiliges Dokument hinweg funktionieren
statt nur in einem einzelnen Puffer.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="Oleaflys Quelltextbaum neben der Projektkarte, die Abschnitte und Labels mit Datei und Zeile auflistet (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="Oleaflys Quelltextbaum neben der Projektkarte, die Abschnitte und Labels mit Datei und Zeile auflistet (helles Theme)" /></td>
  </tr>
</table>

</div>

Die Zitatauswahl liest die `.bib`-Dateien des Projekts direkt, sodass jeder
Schlüssel mit Autor, Jahr, Titel und der Zeile kommt, in der er definiert wurde.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="Auswahl eines Zitierschlüssels aus geparsten BibTeX-Einträgen, jeweils mit Autoren, Jahr und Quellzeile (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="Auswahl eines Zitierschlüssels aus geparsten BibTeX-Einträgen, jeweils mit Autoren, Jahr und Quellzeile (helles Theme)" /></td>
  </tr>
</table>

</div>

Eine LaTeX-bewusste Wortzählung ignoriert das Markup und zählt nur, was ein
Leser tatsächlich sieht.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="Das Wortzähl-Popover mit Wörtern, Zeichen und Zeilen für das geöffnete Dokument (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="Das Wortzähl-Popover mit Wörtern, Zeichen und Zeilen für das geöffnete Dokument (helles Theme)" /></td>
  </tr>
</table>

</div>

### Kompilieren und lesen, ohne das Projekt zu verlassen

- Kompiliere LaTeX mit dem mitgelieferten Tectonic-Sidecar und Typst mit
  seiner mitgelieferten Engine. Für den Standard-Workflow ist keine
  vollständige TeX-Installation nötig.
- Sieh Compiler-Fehler als Editor-Diagnosen und lesbare Fehlerkarten, statt
  dich durch ein rohes Log zu wühlen.
- Lies das PDF neben dem Quelltext, mit fortlaufendem Scrollen, virtualisierten
  Seiten, Einzel- oder Doppelseitenlayout, Einpassen-Steuerung,
  Seitennavigation, Vollbild und einem optionalen abgekoppelten Vorschaufenster.
- Nutze SyncTeX in beide Richtungen: Springe vom Quelltext ins PDF oder
  klicke mit Cmd/Strg auf PDF-Text, um zur passenden Quelltextstelle
  zurückzukehren.
- Speichere das PDF ins Projekt oder exportiere den Quelltext als portables
  Archiv.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="Die Einstellungsseite für die LaTeX-Engine mit den mitgelieferten Engines und ihren Optionen (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="Die Einstellungsseite für die LaTeX-Engine mit den mitgelieferten Engines und ihren Optionen (helles Theme)" /></td>
  </tr>
</table>

</div>

Zoome heraus, und das ganze Dokument ist auf einmal auf dem Bildschirm – meist
der schnellste Weg zu prüfen, ob Floats, Abbildungen und Tabellen dort gelandet
sind, wo du sie haben wolltest.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="Ein dreiseitiges Dokument in der Vorschau, mit allen Abbildungen und Tabellen sichtbar (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="Ein dreiseitiges Dokument in der Vorschau, mit allen Abbildungen und Tabellen sichtbar (helles Theme)" /></td>
  </tr>
</table>

</div>

### Eine Historie führen, die du nachvollziehen kannst

Jedes Projekt ist ein echtes Git-Repository. Oleafly committet nach
erfolgreichen Kompilierungen und nach ruhigen Bearbeitungsphasen und zeigt die
nützlichen Teile dieser Historie direkt in der App.

- Sieh dir eine Commit-Zeitleiste und Diffs im Nebeneinander-Vergleich an.
- Stelle eine frühere Version einer Datei wieder her, ohne den Rest des
  Projekts zu ersetzen.
- Stage, verwirf, committe, pushe und pulle über das
  Quellcodeverwaltungs-Panel.
- Veröffentliche ein Projekt auf GitHub oder verbinde ein bestehendes
  Repository.
- Arbeite weiter im Terminal oder in einem anderen Editor; es gibt kein
  proprietäres Dokumentformat zum Entpacken.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Ein Quelltext-Diff im Nebeneinander-Vergleich in Oleaflys Git-Historie" width="84%" />
</div>

### Mit etwas Brauchbarem starten

Die Projektgalerie enthält editierbare Vorlagen für Paper, Abschlussarbeiten,
Berichte, Bücher, Präsentationen, Poster, Übungsblätter, Briefe,
Bibliographien, Lebensläufe und Diagramme. Filtere nach Dokument-Engine,
Offline-Tauglichkeit oder ATS-Eignung.
Optionale Vorlagenpakete und Schriften werden nur heruntergeladen, wenn du sie
auswählst.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="Oleaflys durchsuchbare Projektvorlagen-Galerie mit Live-Vorschaubildern, Kategorienzählern und Engine-Filtern (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="Oleaflys durchsuchbare Projektvorlagen-Galerie mit Live-Vorschaubildern, Kategorienzählern und Engine-Filtern (helles Theme)" /></td>
  </tr>
</table>

</div>

### Zwischen Recherche- und Publikationsaufgaben wechseln

- Füge ein Zitat über eine DOI, eine arXiv-ID, eine URL oder eine Titelsuche
  hinzu. Oleafly schreibt einen deduplizierten BibTeX-Eintrag und fügt das
  Zitat an der Cursorposition ein.
- Zeichne ein Diagramm auf einer visuellen Leinwand oder bearbeite sein TikZ
  direkt, und füge es dann als Vektorquelltext oder als Bild ein. Das
  gespeicherte TikZ lässt sich wieder öffnen und weiterbearbeiten.
- Importiere Word-Dokumente über Pandoc, rekonstruiere lokal ein editierbares
  LaTeX-Projekt aus einem PDF oder transkribiere ein Formelbild mit einem
  Vision-Modell.
- Exportiere PDF- und Quelltextarchive sowie Word, HTML, Markdown, Text,
  PowerPoint oder EPUB, wenn Dokument-Engine und Projekttyp es unterstützen.
- Stöbere in Konferenz-Deadlines und nutze optionale Literaturrecherchen, ohne
  den Projektordner in ein Cloud-Dokument zu verwandeln.

Die Zitationssuche fragt arXiv, Semantic Scholar, Crossref, PubMed, OpenAlex
und Google Scholar gemeinsam ab, führt doppelte Einträge zusammen und speichert
oder exportiert, was du behältst, als BibTeX. Sie kann außerdem das geöffnete
Dokument Absatz für Absatz durchgehen und Zitate für Aussagen vorschlagen, die
noch keines haben.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="Die Zitationssuche liefert deduplizierte Ergebnisse aus mehreren Indexen, jeweils mit Aktionen zum Speichern und BibTeX-Kopieren (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="Die Zitationssuche liefert deduplizierte Ergebnisse aus mehreren Indexen, jeweils mit Aktionen zum Speichern und BibTeX-Kopieren (helles Theme)" /></td>
  </tr>
</table>

</div>

Der Diagramm-Composer zeichnet auf einer Leinwand und kompiliert das TikZ
gleich daneben, sodass die eingefügte Abbildung echter Vektorquelltext ist, den
du weiterbearbeiten kannst.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="Der Diagramm-Composer mit einer Transformer-Architektur auf der Leinwand und der kompilierten TikZ-Vorschau daneben (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="Der Diagramm-Composer mit einer Transformer-Architektur auf der Leinwand und der kompilierten TikZ-Vorschau daneben (helles Theme)" /></td>
  </tr>
</table>

</div>

### Das Dokument prüfen, bevor es jemand anderes tut

Preflight betrachtet sowohl den Quelltext als auch die kompilierte Ausgabe. Es
findet defekte Referenzen, fehlende Assets, doppelte Labels, Probleme mit der
Lesereihenfolge, fehlende Metadaten, nicht barrierefreie Abbildungsmuster und
Lebenslauf-Layouts, die für Bewerbermanagementsysteme (ATS) schwer auszulesen
sind.

Es zeigt außerdem den Text, den ein Parser oder Screenreader extrahieren kann.
Diese Prüfungen sind praktische Hinweise für die Einreichung, keine formale
Barrierefreiheits-Zertifizierung.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="Preflight meldet einen Barrierefreiheits-Score mit konkreten Befunden zu Quelltext und kompilierter Ausgabe (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="Preflight meldet einen Barrierefreiheits-Score mit konkreten Befunden zu Quelltext und kompilierter Ausgabe (helles Theme)" /></td>
  </tr>
</table>

</div>

Referenzen und Zitate bekommen ein eigenes Panel: die Bibliographie, jedes im
Dokument verwendete Zitat und die Symbole, die das Projekt definiert.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="Das Referenzen-Panel listet Bibliographieeinträge nach Schlüssel und Jahr neben Quelltext und kompiliertem PDF (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="Das Referenzen-Panel listet Bibliographieeinträge nach Schlüssel und Jahr neben Quelltext und kompiliertem PDF (helles Theme)" /></td>
  </tr>
</table>

</div>

### KI am Projekt arbeiten lassen – wenn du das willst

Der Assistent kann Dateien lesen und bearbeiten, das Projekt durchsuchen,
kompilieren, das Log inspizieren und PDF-Text extrahieren, um sein eigenes
Ergebnis zu überprüfen. Er hilft außerdem bei Zitaten, importierten Dokumenten
und editierbaren TikZ-Abbildungen.

Ein mitgeliefertes Paket an Recherche-Skills bringt ihm die Schritte dieser
Arbeit einzeln bei: die Literatur durchsuchen, einen Abschnitt zum Stand der
Forschung entwerfen, prüfen, ob eine Aussage noch zu ihrer Quelle passt,
Abbildungen vorbereiten, ein Manuskript gegenlesen, es einreichfertig machen.
Tippe `/skill-id` im Chat, um einen Skill sofort zu nutzen. In den
Einstellungen schaltest du einen Skill für alle Projekte oder nur für das
geöffnete ein, schreibst eigene oder installierst weitere aus einem
zusätzlichen Online-Angebot.

Du wählst das Modell:

- Verbinde einen unterstützten gehosteten Anbieter mit deinem eigenen
  API-Schlüssel.
- Führe ein lokales Modell über Ollama aus.
- Lass die KI unkonfiguriert und nutze den Rest der App ganz normal.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="Das Assistenten-Panel mit Einstiegspunkten wie Paper zum Zitieren finden, eine Literaturübersicht schreiben und Quelltextfehler beheben (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="Das Assistenten-Panel mit Einstiegspunkten wie Paper zum Zitieren finden, eine Literaturübersicht schreiben und Quelltextfehler beheben (helles Theme)" /></td>
  </tr>
</table>

</div>

Dateiänderungen kommen mit einem Diff und Schaltflächen zum Annehmen oder
Ablehnen. „Immer erlauben“ kann gewöhnliche Schreibzugriffe für die aktuelle
Sitzung freigeben, während Löschvorgänge weiterhin zur Bestätigung anhalten.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="Eine Dateiänderung des Assistenten als rot-grüner Diff mit den Schaltflächen Ablehnen, Immer erlauben und Annehmen" width="88%" />
</div>

Nach der Freigabe landet die Änderung in der Datei, und das Dokument wird neu
kompiliert. Jede Antwort behält eine Aktion „Code auf den Stand vor dieser
Antwort zurücksetzen“.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="Eine freigegebene Assistenten-Änderung, angewendet auf das Dokument und sichtbar im neu kompilierten PDF" width="88%" />
</div>

Anbieter werden in den Einstellungen konfiguriert. Schlüssel bleiben auf dem
Rechner, und ein lokales Ollama-Modell funktioniert ganz ohne Schlüssel.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="Die Einstellungsseite des KI-Assistenten mit mehreren verbundenen Anbietern und einem ausgewählten lokalen Ollama-Modell (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="Die Einstellungsseite des KI-Assistenten mit mehreren verbundenen Anbietern und einem ausgewählten lokalen Ollama-Modell (helles Theme)" /></td>
  </tr>
</table>

</div>

Oleafly kann seine Projektwerkzeuge außerdem für Claude Desktop, Claude Code,
Cursor und andere MCP-Clients bereitstellen. MCP-Verbindungen unterstützen
einen Nur-Lese-Modus und drei Freigaberichtlinien: jede Änderung bestätigen,
Schreibzugriffe automatisch freigeben und Löschungen bestätigen, oder der
eigenen Freigabekontrolle des Clients vertrauen.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="Die MCP-Einstellungen mit dem lokalen Server, seinen Client-Anweisungen und den verfügbaren Freigaberichtlinien (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="Die MCP-Einstellungen mit dem lokalen Server, seinen Client-Anweisungen und den verfügbaren Freigaberichtlinien (helles Theme)" /></td>
  </tr>
</table>

</div>

Die aktuellen Anbieter, Werkzeuge und das Sicherheitsmodell findest du in der
[Funktionsreferenz](../features.md) und im [MCP-Setup](../mcp.md).

Alles ist von einer Stelle aus erreichbar: Die Omnibar durchsucht Projekte und
Dokumente, und mit einem `/` wird sie zur Befehlspalette.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="Die Omnibar mit Befehlen und zuletzt aktualisierten Projekten (dunkles Theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="Die Omnibar mit Befehlen und zuletzt aktualisierten Projekten (helles Theme)" /></td>
  </tr>
</table>

</div>

## Local-First, mit einer klaren Netzwerkgrenze

Weder ein Konto noch Telemetrie sind erforderlich. Die zentralen Projektdaten
bleiben auf deinem Rechner.

| Läuft oder bleibt lokal | Nutzt das Netzwerk nur, wenn du es willst |
| --- | --- |
| Projektdateien und Editor-Puffer | Ein gehosteter KI-Anbieter, den du verbindest |
| Git-Repositories und Historie | GitHub-Veröffentlichung, Push und Pull |
| Kompilierung mit gecachten Paketen | TeX-Pakete, die die erste Kompilierung benötigt |
| PDF-Rendering und Textextraktion | Optionale Downloads von Vorlagen, Schriften, Pandoc oder TinyTeX |
| Rechtschreibung, Grammatik und Preflight | Abfragen zu Zitaten, Literatur, Konferenz-Deadlines und Updates |
| Lokale KI über Ollama |  |

API-Schlüssel werden lokal gespeichert. Die einfachen Dokumentdateien bleiben
nutzbar, selbst wenn du Oleafly nicht mehr verwendest.

## Demnächst

Die Roadmap hält Oleafly offen, Local-First und für den gesamten
Forschungsablauf nützlich.

- **Lokalisierung der App.** Nutze Oleafly in weiteren Sprachen und arbeite in
  der Oberfläche, die sich für dich am natürlichsten anfühlt.
- **Autonome Forschungsagenten.** Verwandle eine Forschungsfrage und eine
  Quellensammlung in einen strukturierten ersten Entwurf.
- **Echtzeit-Zusammenarbeit und Kommentare.** Arbeite mit unbegrenzter,
  selbst gehosteter Zusammenarbeit im Forschungsteam.
- **Oleafly CLI.** Nutze ein schlankes, installierbares Kommandozeilenpaket für
  Forschungsabläufe, die keine grafische Oberfläche benötigen.
- **Bessere Typst- und Markdown-Unterstützung.** Nutze mehr Funktionen für
  Bearbeitung, Vorschau und Veröffentlichung in beiden Formaten.
- **Weitere Forschungsintegrationen.** Verbinde Mendeley und zusätzliche
  Literatur-, Bibliotheks- und Forschungsdienste.
- **Selbst gehostete Cloud-Synchronisierung.** Synchronisiere Projekte zwischen
  Geräten und nutze auf Wunsch eine bessere automatische GitHub-Synchronisierung.

## Installation

Lade den neuesten Build von
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest) herunter.

| Plattform | Installer |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` oder `-setup.exe` |
| Linux, x86_64 | `.AppImage`, `.deb` oder `.rpm` |

Die erste LaTeX-Kompilierung lädt möglicherweise Pakete herunter, die das
Dokument benötigt. Tectonic cacht sie für spätere Builds, und der Offline-Modus
beschränkt die Kompilierung auf diesen Cache.

So startest du aus dem Quellcode:

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

Voraussetzungen, Plattform-Setup und Produktions-Builds findest du im
[Entwicklungsleitfaden](../development.md).

Diese Skripte laden die mit Prüfsummen festgelegten Compiler-Sidecars für deine
aktuelle Plattform nach `src-tauri/binaries`. Das Argument `all` ist für CI und
Release-Pakete vorgesehen, bei denen jede unterstützte Plattform vorbereitet
werden muss.

Editorfunktionen über TexLab und Tinymist sind für einen lokalen Start optional.
Lade diese Language Server mit `pnpm language-servers:fetch` herunter. Angaben
zu Integrität, Lizenzen und Verteilung findest du in der
[Language-Server-Toolchain](../language-server-toolchain.md).

### Kommandozeile

`oleaflyc` verwaltet Oleafly-Projekte, ohne die Desktop-App zu starten. Das
Programm wird in diesem Repository aus dem Quellcode gebaut und noch nicht als
eigenständiges Paket veröffentlicht.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Die Befehle arbeiten im aktuellen Verzeichnis. Mit `-C <path>` wählst du ein
anderes Projekt. `oleaflyc --help` zeigt die vollständige Befehlsliste.

## Entwicklerdokumentation

Benutzerhandbücher findest du in der
[Oleafly-Produktdokumentation](https://oleafly.com/docs/overview/). Die folgenden
Referenzen richten sich an Mitwirkende, Integratoren und Release-Verantwortliche.

| Referenz | Inhalt |
| --- | --- |
| [Produkt-Engineering-Katalog](../README.md) | Funktionsinventare und Engineering-Verträge |
| [Funktionsreferenz](../features.md) | Die Produktoberfläche und unterstützte Workflows |
| [Dokument-Engines](../document-engines.md) | Fähigkeiten von LaTeX, Typst und Markdown |
| [Produktarchitektur](../architecture.md) | Systemgrenzen, Paketverantwortlichkeiten und Erweiterungspunkte |
| [Entwicklung](../development.md) | Lokales Setup, Tests und Beitrags-Workflow |
| [Language-Server-Toolchain](../language-server-toolchain.md) | Bezug, Integrität und Verteilungsrichtlinie |
| [MCP-Integration](../mcp.md) | Externe Clients, Zugriffstoken und Freigaberichtlinien |
| [Releases](../releasing.md) | Release-Workflow und Artefaktprüfungen |
| [Codesignierung](../signing.md) | Signaturanforderungen der Plattformen |
| [Auto-Updates](../updates.md) | Update-Manifeste, Signaturen und Rollback |

## Mitwirken

<table>
  <tr>
    <td width="38%" valign="top"><img src="../assets/oleafly-club.png" alt="Der Oleafly Club: eine offene Forschungsgemeinschaft, die Entwürfe, Überarbeitungen, Tests und erfolgreiche Einreichungen feiert" width="100%" /></td>
    <td width="62%" valign="top"><h3>Forschende verdienen Werkzeuge, die sie prüfen, erweitern und denen sie vertrauen können.</h3><p>Oleafly wird von <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> und Mitwirkenden offen entwickelt. Fehlerberichte, Fixes, Vorlagen, Dokumentation und durchdachtes Produktfeedback sind willkommen.</p></td>
  </tr>
</table>

1. Lies [CONTRIBUTING.md](../../CONTRIBUTING.md).
2. Eröffne vor einer großen Änderung ein Issue; kleine, fokussierte Fixes
   können direkt als Pull Request eingereicht werden.
3. Führe vor dem Einreichen die relevanten Checks aus:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

Bitte melde Sicherheitsprobleme vertraulich, wie in
[SECURITY.md](../../SECURITY.md) beschrieben. Für die Teilnahme gilt der
[Verhaltenskodex](../../CODE_OF_CONDUCT.md).

## Community und Support

- Stelle Fragen und teile Ideen in den [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- Melde Fehler und wünsche dir Funktionen in den [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- 🔔 Folge [@OleaflyHQ auf X](https://x.com/OleaflyHQ) für Produkt- und Release-Updates.

⭐ Wenn Oleafly dir hilft, gib dem [Repository einen Stern](https://github.com/Oleafly/Oleafly).
So finden mehr Forschende das Projekt, und du unterstützt die weitere Entwicklung.

## Sterneverlauf

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="Verlauf der GitHub-Sterne" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

## Danksagungen

Oleafly baut auf
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/) und
[Hunspell](https://hunspell.github.io/) auf.

Oleafly ist lizenziert unter
[AGPL-3.0-or-later](../../LICENSE). Hinweise zu Drittanbieterkomponenten sind in
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md) aufgeführt.
