<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-app-icon-pastel-256.png" alt="Logo Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | **Français** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md) | [العربية](README.ar.md)

[![Télécharger pour macOS (Apple Silicon)](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Télécharger pour Windows](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Télécharger pour Linux](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest)

[![Problèmes ouverts](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Téléchargements](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml) [![Quality Gate SonarQube](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Oleafly_Oleafly) [![Couverture du code](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=coverage)](https://sonarcloud.io/component_measures?id=Oleafly_Oleafly&metric=coverage) [![État du développement : ultra-actif](https://img.shields.io/badge/status-ultra_active-22c55e)](https://github.com/Oleafly/Oleafly/pulse) [![Dernier commit](https://img.shields.io/github/last-commit/Oleafly/Oleafly?label=last%20commit&color=22c55e)](https://github.com/Oleafly/Oleafly/commits/main) [![Licence : AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE) [![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2Fkt9bcCjgkP%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=&color=5865F2&logo=discord&logoColor=white&cacheSeconds=600)](https://oleafly.com/discord) [![Étoiles](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**Un éditeur LaTeX, Typst et Markdown collaboratif en temps réel pour la recherche.**

Oleafly est un éditeur puissant pour rédiger des articles de recherche et des thèses en LaTeX, Typst et Markdown. La source, le PDF, les citations, les figures, les vérifications et l'historique Git d'un projet sont réunis au même endroit. Écrivez avec vos coauteurs en temps réel, gardez vos projets synchronisés entre vos ordinateurs et intégrez Claude Code, Codex ou le modèle de votre choix au projet.

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>Télécharger gratuitement</strong></a>
· <a href="https://oleafly.com/docs/">Lire les guides</a> · <a href="https://github.com/Oleafly/oleafly-server">Lancer un serveur</a> · <a href="../development.md">Compiler depuis les sources</a>
</p>


Gratuit pour toujours · Open source · Aucun compte Oleafly · Aucun suivi

</div>

<div align="center">
  <img src="../assets/readme/hero-collab.png" alt="Oleafly avec un article de recherche LaTeX ouvert : l'arborescence des fichiers, le plan et la structure à gauche, la source avec les curseurs de cinq coauteurs et des commentaires surlignés, et le PDF compilé" width="100%" />
</div>

## Pourquoi Oleafly

Tout ici est gratuit, y compris ce que d'autres éditeurs réservent à leurs offres payantes : la collaboration en temps réel avec autant de coauteurs que vous en invitez, l'historique complet des versions, la synchronisation Git et GitHub, Zotero, la vérification grammaticale et l'IA.

- Écrivez avec vos coauteurs en temps réel, avec des curseurs et des commentaires partagés, sur un serveur que votre laboratoire installe en une seule commande.
- Un éditeur conçu pour les longs documents : la complétion des labels, des citations et des commandes, la détection des erreurs en direct, un plan de tout le projet, les raccourcis Vim et Emacs, un mode visuel et une palette consultable de 236 symboles LaTeX.
- Compilez sur votre propre ordinateur. Tectonic, Typst et Pandoc sont intégrés, et TeX Live, MacTeX, MiKTeX ou TinyTeX prennent le relais quand un projet a besoin d'une distribution complète.
- Cliquez dans le PDF pour aller à la source et inversement, et le dernier PDF valide reste affiché pendant que vous corrigez une erreur.
- Chaque projet est un dépôt Git que vous pouvez pousser sur GitHub, GitLab, Gitea, Forgejo, Codeberg ou votre propre serveur Git, et les points de restauration enregistrent un instantané après chaque compilation réussie.
- Citez depuis votre bibliothèque Zotero pendant la saisie, et cherchez dans arXiv, Semantic Scholar, Crossref, PubMed et OpenAlex sans quitter l'éditeur.
- Les vérifications orthographiques et grammaticales, adaptées à l'écriture académique, s'exécutent sur votre ordinateur.
- Avant la soumission, Preflight repère les références rompues, les figures manquantes, les polices non incorporées, les lacunes d'accessibilité et tout ce qui lèverait l'anonymat d'une évaluation.
- Dessinez des figures qui restent du code TikZ, Typst ou Mermaid, et partez de plus de 1 700 modèles pour articles, thèses, présentations, posters et CV.
- Importez depuis Word, un PDF, une source arXiv, un dépôt Git ou un compte LaTeX en ligne.
- La commande `oleafly` compile, vérifie et synchronise vos projets depuis n'importe quel terminal ou job de CI, avec les mêmes compilateurs et réglages que l'application.
- La synchronisation cloud garde vos projets sur chaque ordinateur que vous utilisez, et vous pouvez continuer à écrire hors ligne.
- Claude Code, Codex et 12 autres agents travaillent dans votre projet, ou connectez n'importe quel modèle, y compris les modèles locaux. L'IA est facultative, et chaque modification qu'elle apporte est un diff que vous pouvez examiner et annuler.
- Les tâches de recherche mènent une revue de littérature, un audit des preuves ou une passe de révision dans une copie séparée du projet pendant que vous continuez à écrire, et vous choisissez les fichiers modifiés à conserver. Elles sont expérimentales et désactivées par défaut. Paramètres > Expérimentation permet de les activer.

## Écrivez ensemble, en direct

Partagez un projet sur l'Oleafly Server de votre laboratoire et tout le monde modifie les mêmes fichiers en même temps. Vous voyez le curseur et la sélection de chacun, qui est en ligne et ce qui a changé pendant votre absence. Cliquez sur l'avatar d'une personne pour aller à la ligne sur laquelle elle travaille.

<p align="center">
  <img src="../assets/readme/live-comments.png" alt="Deux coauteurs modifiant le même fichier LaTeX dans Oleafly, avec leurs curseurs, leurs avatars et le panneau des personnes et de l'activité" width="100%" />
</p>

- Commentez n'importe quelle sélection en LaTeX, Typst ou Markdown, puis répondez, mentionnez quelqu'un, résolvez ou rouvrez la discussion. Un coauteur mentionné reçoit un seul e-mail et peut désactiver ces notifications.
- Les modifications faites hors ligne fusionnent quand vous vous reconnectez. Si elles recoupent celles de quelqu'un d'autre, Oleafly vous montre les deux versions et vous demande avant d'appliquer quoi que ce soit.
- Les modifications de l'IA, les citations Zotero, les renommages, les suppressions et les figures sont aussi partagés. Si deux personnes remplacent la même figure en même temps, les deux versions sont conservées.
- Le fichier principal, le compilateur, la langue de vérification orthographique et les options Typst sont partagés, donc toute l'équipe compile le projet de la même façon.
- Chaque projet a un propriétaire, des éditeurs, des relecteurs, des commentateurs et des lecteurs. Les modifications des relecteurs deviennent des suggestions, et les propriétaires et les éditeurs peuvent aussi passer en mode Suggestion. Les invités ajoutés par e-mail ne voient que les projets auxquels ils ont été invités.
- Chaque projet partagé a un chat et un historique où vous pouvez comparer des versions, en restaurer une ou lui donner un nom.
- Les coauteurs peuvent ouvrir un projet partagé dans leur navigateur quand l'accès par navigateur est activé sur le serveur, et lire le PDF de la dernière compilation.

### Hébergez le serveur vous-même

Oleafly Server s'installe en une seule commande sur une machine Linux, qu'il s'agisse d'une station de travail du laboratoire, d'une VM universitaire ou d'un petit serveur cloud :

```bash
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

C'est un seul binaire Rust qui utilise SQLite, conserve les fichiers sur disque ou dans n'importe quel stockage compatible S3 et envoie des e-mails par SMTP si vous le configurez. Les utilisateurs se connectent avec GitHub ou n'importe quel fournisseur OpenID Connect, donc l'authentification unique de votre université fonctionne. Des configurations prêtes à l'emploi existent pour Docker Compose, Coolify, Render et systemd, ainsi que des guides pour Railway, Cloudflare Tunnel et les certificats universitaires.

Les administrateurs disposent dans Oleafly d'une console pour les utilisateurs, les règles d'accès, les projets, les e-mails et le journal de sécurité. Chaque appareil signe ses modifications, et le serveur construit chaque instantané à partir de cet historique signé au lieu de faire confiance aux fichiers envoyés.

<p align="center">
  <img src="../assets/readme/server-admin.png" alt="Console d'administration d'Oleafly Server montrant les utilisateurs, les règles d'accès et le journal de sécurité" width="100%" />
</p>

Consultez le [guide du serveur](https://github.com/Oleafly/oleafly-server) pour l'installation, les sauvegardes et la liste complète de qui peut faire quoi.

## Synchronisation cloud entre vos ordinateurs

Activez la synchronisation cloud et les projets de votre bibliothèque ainsi que les réglages de l'application vous suivent d'un ordinateur à l'autre. Chaque téléchargement est vérifié par rapport à son enregistrement avant de remplacer un fichier, et un fichier ouvert avec des modifications non enregistrées n'est jamais écrasé.

Vous pouvez synchroniser avec Dropbox, avec Google Drive ou avec votre propre bucket sur Amazon S3, Google Cloud Storage, MinIO ou un autre service compatible S3.

<p align="center">
  <img src="../assets/readme/cloud-sync-dropbox.png" alt="Paramètres de synchronisation cloud d'Oleafly avec la carte Dropbox et la liste de ce qui est synchronisé" width="100%" />
</p>

- Quand deux ordinateurs modifient le même fichier, les deux versions sont conservées, chacune nommée d'après l'ordinateur qui l'a écrite.
- Supprimer d'un coup la majeure partie d'un projet le met en attente jusqu'à votre confirmation, pour qu'une fausse manœuvre ne puisse pas le vider partout.
- Les fichiers supprimés sur un autre ordinateur vont dans la Corbeille de celui-ci au lieu de disparaître.
- Sur un nouvel ordinateur, Oleafly demande une seule fois s'il faut garder les réglages de cet ordinateur ou ceux qui ont été synchronisés.

## Apportez vos projets avec vous

Vous quittez un éditeur LaTeX en ligne ? Connectez-vous une fois à votre compte depuis Oleafly, choisissez les projets voulus, et ils arrivent avec leurs fichiers, leur compilateur et leur fichier principal, prêts à compiler. Cela fonctionne aussi avec le serveur propre à une université.

Avec un jeton Git de ce compte, Oleafly peut garder un projet importé synchronisé dans les deux sens, pour que les coauteurs qui restent en ligne continuent à travailler comme aujourd'hui. La synchronisation bidirectionnelle utilise l'intégration Git du service lui-même, qui nécessite une offre payante ou universitaire sur le compte du propriétaire du projet.

<p align="center">
  <img src="../assets/readme/import-dialog.png" alt="Boîte de dialogue Importer un projet d'Oleafly avec des options pour les fichiers locaux, arXiv, GitHub et un compte LaTeX en ligne" width="100%" />
</p>

Vous pouvez aussi partir d'un ZIP de projet, d'un dépôt GitHub, d'un document Word, d'un paquet de sources arXiv ou d'un PDF qu'Oleafly reconstruit en LaTeX modifiable. Ou ouvrir un dossier là où il se trouve déjà.

## Des agents IA qui travaillent dans votre projet

Choisissez un agent dans le catalogue et il travaille dans votre projet, avec la source, le PDF et le journal de compilation à portée de main. Chaque agent se connecte avec son propre compte et utilise son propre modèle. Oleafly lui fournit le projet et les outils qui l'entourent.

<p align="center">
  <img src="../assets/readme/ai-agents.png" alt="Un agent IA dans Oleafly révisant une section d'un article LaTeX, avec la modification proposée affichée sous forme de diff" width="100%" />
</p>

<div align="center">
<table>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/claude-code.svg" alt="" width="40" height="40" /><br />Claude&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codex.svg" alt="" width="40" height="40" /><br />Codex&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/gemini-cli.svg" alt="" width="40" height="40" /><br />Gemini&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/pi.svg" alt="" width="40" height="40" /><br />Pi</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/opencode.svg" alt="" width="40" height="40" /><br />OpenCode</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/openclaw.svg" alt="" width="40" height="40" /><br />OpenClaw</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cline.svg" alt="" width="40" height="40" /><br />Cline</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/hermes-agent.svg" alt="" width="40" height="40" /><br />Hermes&nbsp;Agent</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codebuddy.svg" alt="" width="40" height="40" /><br />CodeBuddy</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/kimi-code.svg" alt="" width="40" height="40" /><br />Kimi&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/grok.svg" alt="" width="40" height="40" /><br />Grok&nbsp;Build</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cursor.svg" alt="" width="40" height="40" /><br />Cursor</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/deepseek-harness.png" alt="" width="40" height="40" /><br />DeepSeek Harness</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/qoder.svg" alt="" width="40" height="40" /><br />Qoder</td>
  </tr>
</table>
</div>

<p align="center"><sub>Ces marques identifient des outils compatibles et restent la propriété de leurs détenteurs respectifs. Elles n'impliquent aucun parrainage.</sub></p>

Vous préférez un assistant de chat ? Connectez un fournisseur hébergé, n'importe quel endpoint compatible OpenAI ou un modèle Ollama local.

- Chaque modification de fichier est un diff. Approuvez-les une par une, laissez l'assistant travailler seul ou définissez des règles par outil, et annulez un seul fichier ou tout un tour.
- Le mode Plan cartographie le projet avant que quoi que ce soit ne soit écrit.
- Une revue de littérature ou une passe de révision peut s'exécuter dans son propre worktree Git pendant que vous continuez à écrire. Vous choisissez les fichiers modifiés à conserver.
- L'application inclut 39 skills de recherche, dont l'exploration de la littérature, les travaux connexes, la vérification des affirmations et les lettres de réponse aux évaluateurs. `npx skills add Oleafly/Oleafly` les installe aussi dans Claude Code, Codex et d'autres agents.
- Un serveur MCP local permet à un client IA externe d'utiliser les mêmes outils de projet. Il n'écoute que sur 127.0.0.1.
- `oleafly mcp` donne à Claude Code, Codex, Cursor et Gemini CLI les outils du projet via stdio, que l'application soit ouverte ou fermée.
- Chaque version inclut `oleafly.mcpb`. Ouvrez-le et Claude Desktop installe Oleafly comme extension. Le registre MCP le référence sous `io.github.Oleafly/oleafly`.

L'IA est facultative. L'éditeur, le compilateur, le PDF, les citations, la relecture et les vérifications fonctionnent tous quand elle est désactivée.

## LaTeX, Typst et Markdown, compilés sur votre ordinateur

Tectonic, Typst et Pandoc sont fournis avec l'application, donc un nouveau projet compile sans rien installer. Quand un projet a besoin d'une distribution TeX complète, passez-le à latexmk avec TeX Live, MacTeX, MiKTeX ou un TinyTeX qu'Oleafly installe pour vous.

<p align="center">
  <img src="../assets/readme/editor-and-pdf.png" alt="Éditeur source d'Oleafly et PDF compilé côte à côte, avec un diagnostic de compilation lié à sa ligne source" width="100%" />
</p>

- Cliquez dans le PDF pour aller à la source, et inversement. LaTeX utilise SyncTeX, et Typst 0.13 ou plus récent utilise Tinymist.
- Les erreurs de compilation renvoient à la ligne qui les a causées, et le dernier PDF valide reste affiché pendant que vous les corrigez.
- Le mode visuel vous permet de modifier le document dans une vue proche de la page, avec la source à un clic.
- Complétion et diagnostics en direct pour les labels, citations, commandes, environnements et chemins de fichiers dans tout le projet.
- Les vérifications orthographiques et grammaticales s'exécutent en local et sont adaptées à l'écriture académique.
- XeLaTeX, LuaLaTeX, et upLaTeX ou pLaTeX pour les documents en japonais.
- Les documents Quarto et Calepin exécutent leur code R, Python ou Julia dès que vous autorisez le code pour le projet. Oleafly peut télécharger l'un ou l'autre de ces outils pour vous.

## Citations, figures, vérifications et modèles

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/citations.png" alt="Citation d'une entrée Zotero en tapant @ dans l'éditeur Oleafly" width="100%" />
      <h3>Citez depuis Zotero pendant la saisie</h3>
      Tapez <code>@</code> puis une partie d'un auteur, d'un titre ou d'une année pour citer depuis votre bibliothèque Zotero. Oleafly n'ajoute que cette entrée au <code>.bib</code> du projet. Citation Search couvre arXiv, Semantic Scholar, Crossref, PubMed et OpenAlex.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/diagrams.png" alt="Diagram Composer d'Oleafly avec un canevas et le code TikZ côte à côte" width="100%" />
      <h3>Dessinez des figures qui restent du code</h3>
      Diagram Composer dessine sur un canevas et écrit du TikZ, du fletcher pour Typst ou du Mermaid. Modifiez le dessin ou le code, et l'autre suit.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/preflight.png" alt="Preflight d'Oleafly listant des résultats sur les références, les figures et l'accessibilité" width="100%" />
      <h3>Vérifiez avant de soumettre</h3>
      Preflight trouve les références rompues, les figures manquantes, les polices non incorporées, les lacunes d'accessibilité et tout ce qui révélerait les auteurs lors d'une évaluation anonyme. Il propose des profils pour arXiv, IEEE, ACM, les revues et les thèses.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/templates.png" alt="Galerie de modèles Oleafly avec des aperçus rendus d'articles, de thèses et de présentations" width="100%" />
      <h3>Partez de plus de 1 700 modèles</h3>
      Articles, thèses, présentations Beamer, posters, CV et articles au style de revues ou de conférences, chacun avec un aperçu rendu avant que vous ne créiez le projet.
    </td>
  </tr>
</table>

## Git, historique et terminal

Chaque projet est un dossier ordinaire avec un dépôt Git ordinaire. Indexez, comparez, faites des commits, push, pull et publiez sur GitHub, GitLab, Gitea, Forgejo, Codeberg ou votre propre serveur depuis le panneau Source Control, ou utilisez votre propre terminal, car rien ne lui est caché. Les points de restauration enregistrent un instantané local après chaque compilation réussie, pour que vous puissiez revenir en arrière sans faire de commit.

<p align="center">
  <img src="../assets/readme/git-history.png" alt="Panneau Source Control d'Oleafly avec un diff, un graphe des branches et les contrôles de commit" width="100%" />
</p>

Un dock de terminal se trouve sous l'éditeur, avec jusqu'à dix onglets par projet. Cmd-cliquez (Ctrl-clic) sur un chemin de fichier dans sa sortie pour l'ouvrir à cette ligne.

La commande `oleafly` travaille sur les mêmes projets depuis n'importe quel terminal : compiler, recompiler à chaque modification, vérifier avant la soumission, synchroniser avec un service LaTeX en ligne ou lancer l'agent Oleafly sans ouvrir l'application. Chaque commande peut afficher du JSON avec des codes de sortie stables pour les scripts et la CI. Consultez le [guide de la ligne de commande](../cli.md).

## Et bien plus encore

<details>
<summary>Plus de 40 outils de conversion, de citation et de mathématiques</summary>

La galerie Tools est en bêta et désactivée par défaut. Activez-la dans Paramètres > Expérimentation > Outils LaTeX.

#### Importation et conversion de formats

| Outil | Utilisation |
| --- | --- |
| PDF to LaTeX | Reconstruire un LaTeX modifiable à partir d'un PDF, en conservant les mathématiques, les figures et la structure lorsque la source le permet |
| arXiv to LaTeX | Télécharger un paquet de sources arXiv par identifiant ou décompresser une archive enregistrée sur le disque |
| Image to LaTeX | Transformer une image de notes, d'équations ou d'un tableau en LaTeX modifiable |
| Equation to LaTeX | Convertir des mathématiques saisies ou une image d'équation en LaTeX |
| Excel to LaTeX | Convertir une feuille Excel, CSV ou TSV en tableau LaTeX avec échappement |
| HTML to LaTeX | Convertir du HTML collé en document LaTeX autonome |
| Image to Typst | Transformer une image de notes, d'équations ou d'un tableau en Typst modifiable |
| LaTeX to HTML | Convertir du LaTeX en HTML autonome avec des équations MathML |
| LaTeX to Image | Rendre une équation et exporter un PNG ou un SVG |
| LaTeX to Markdown | Convertir un document LaTeX en Markdown portable |
| LaTeX to Typst | Convertir du LaTeX en source Typst que vous pouvez copier, enregistrer ou ouvrir comme projet |
| LaTeX to Word | Créer un document Word avec des équations enregistrées comme mathématiques Word natives |
| Markdown to LaTeX | Convertir des notes Markdown en document LaTeX autonome |
| Markdown to Typst | Convertir des notes Markdown en source Typst |
| Mermaid to LaTeX | Convertir un organigramme Mermaid en code TikZ modifiable |
| PDF to Markdown | Extraire la couche de texte, les équations et les figures d'un PDF vers Markdown |
| PDF to Typst | Extraire la couche de texte, les équations et les figures d'un PDF vers Typst |
| Table to LaTeX | Construire un tableau LaTeX dans un éditeur visuel en lignes et colonnes |
| Typst Editor | Commencer un projet Typst avec édition de la source, aperçu en direct et export PDF |
| Visual Typst Editor | Commencer un document Typst dans l'éditeur de projet avec aperçu en direct |
| Typst to LaTeX | Convertir le balisage Typst en LaTeX pour les revues et les soumissions |
| arXiv to Typst | Convertir un paquet de sources arXiv en Typst, avec une vérification de compilation qui liste ce qui n'a pas été converti |
| CSV to Typst | Coller des lignes CSV ou TSV et obtenir un tableau Typst avec échappement |
| Equation to Typst | Convertir des mathématiques LaTeX saisies ou une image d'équation en mathématiques Typst |
| Excel to Typst | Convertir une feuille Excel, CSV ou TSV en tableau Typst avec échappement |
| HTML to Typst | Convertir du HTML collé en document Typst autonome |
| Mermaid to Typst | Convertir un organigramme Mermaid en code fletcher modifiable |
| Typst to HTML | Convertir le balisage Typst en HTML autonome avec des équations MathML |
| Typst to Markdown | Convertir le balisage Typst en Markdown portable |
| Typst to Word | Créer un document Word avec des équations enregistrées comme mathématiques Word natives |
| Word to Typst | Convertir un document Word en Typst et conserver les médias extraits ensemble |
| Word to LaTeX | Convertir un document Word en LaTeX et conserver les médias extraits ensemble |

#### Mathématiques, tableaux, rédaction et validation

| Outil | Utilisation |
| --- | --- |
| BibTeX Validator | Vérifier les erreurs de syntaxe, les champs obligatoires manquants et les clés en double dans les fichiers `.bib` |
| Statistics Calculators | Calculer localement les p-values, les tailles d'échantillon et les intervalles de confiance |
| Writing Generators | Préparer avec l'assistant un résumé, une synthèse, une paraphrase ou un plan de thèse à partir du document ouvert |
| Symbol Reference | Parcourir les symboles LaTeX et en insérer un à la position du curseur, ou son nom Typst dans un fichier Typst |

#### Littérature, références et recherche

| Outil | Utilisation |
| --- | --- |
| Find Citations | Rechercher dans les index scientifiques, analyser un brouillon pour trouver les références manquantes et exporter du BibTeX |
| arXiv Citation Generator | Rechercher un article arXiv et formater sa citation selon huit styles |
| Bibliography Generator | Construire, valider, trier et exporter une bibliographie à partir de détails structurés ou de BibTeX |
| Citation Generator | Transformer les détails d'un article ou un identifiant scientifique en citation et BibTeX formatés |
| Citation Generators by Style | Comparer une référence en APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA et ACS |
| DOI to BibTeX | Récupérer une notice DOI, examiner ses champs et exporter du BibTeX |
| ISBN to BibTeX | Récupérer les métadonnées d'un livre depuis son ISBN et les corriger avant d'exporter du BibTeX |
| PubMed to BibTeX | Récupérer une notice PubMed depuis son PMID, l'examiner et exporter du BibTeX |
| URL to BibTeX | Reconnaître les liens DOI, arXiv et PubMed, ou construire une citation modifiable pour une page web |
| Lab Search | Trouver des institutions de recherche dans l'annuaire OpenAlex |
| Conference Deadlines | Filtrer les échéances de conférences, surtout en informatique, et afficher les comptes à rebours |

</details>

<details>
<summary>Les 39 skills de recherche fournies avec Oleafly</summary>

Les skills sont des dossiers `SKILL.md` ordinaires qui suivent la structure Agent Skills. Lancez-en une avec une commande slash, ajoutez les vôtres ou partagez-les avec des agents CLI compatibles sur le même ordinateur.

Le pack inclus `research-core` fournit 39 skills. Les noms ci-dessous sont les identifiants utilisés par le catalogue et les réglages du projet.

| Catégorie | Skills |
| --- | --- |
| Recherche et littérature | `citation-management`, `exploratory-data-analysis`, `hypothesis-generation`, `literature-review`, `oleafly-experiment-loop`, `oleafly-literature-sweep`, `oleafly-research-loop`, `openresearch`, `paper-lookup`, `research-lookup`, `scientific-brainstorming`, `scientific-critical-thinking` |
| Rédaction et analyse de manuscrits | `experimental-design`, `oleafly-data-analysis`, `oleafly-manuscript-scaffold`, `oleafly-related-work`, `scientific-writing`, `statistical-analysis`, `statistical-power`, `venue-templates` |
| Figures et visualisation | `oleafly-figure-prep`, `scientific-schematics`, `scientific-visualization` |
| Relecture et preuves | `oleafly-response-letter`, `oleafly-review-manuscript`, `oleafly-verify-claims`, `peer-review`, `scholar-evaluation` |
| Soumission | `oleafly-pre-submission` |
| Communication | `oleafly-slides-and-posters`, `pptx-posters`, `research-grants`, `scientific-slides` |
| Outils et automatisation | `desktop-apps`, `import-refine`, `oleafly-cli`, `oleafly-latex-build`, `pdf-to-latex`, `template-generate` |

</details>

<details>
<summary>Détails de l'éditeur</summary>

- Une palette consultable de 236 symboles LaTeX, qui insère les noms Typst dans les fichiers Typst.
- Raccourcis Vim et Emacs, onglets multi-fichiers, pliage du code, recherche et remplacement dans tout le projet, et comptage des mots.
- Renommez ou déplacez un fichier, et Oleafly met à jour les chemins qui le désignent.
- Thèmes pour le mode clair et le mode sombre, n'importe quelle police installée, couleurs syntaxiques modifiables et mode Zen.
- L'interface est disponible en 21 langues.
- Palette de commandes sur Cmd+K (Ctrl+K), et un seul champ de recherche pour les projets, documents, paramètres et outils sur Cmd+Shift+F (Ctrl+Shift+F).

</details>

## Pour commencer

1. [Téléchargez Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) pour votre ordinateur.
2. Créez un projet à partir d'un modèle, importez-en un ou ouvrez un dossier que vous avez déjà.
3. Appuyez sur Cmd+Enter (Ctrl+Enter sous Windows et Linux) pour compiler.
4. Pour écrire à plusieurs, cliquez sur **Partager** et envoyez le projet sur l'Oleafly Server de votre laboratoire.

| Plateforme | Paquet | Télécharger |
| --- | --- | --- |
| macOS · Apple Silicon | DMG | [![Télécharger pour macOS (Apple Silicon)](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | MSI ou EXE | [![Télécharger pour Windows](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 | AppImage, DEB ou RPM | [![Télécharger pour Linux (x86_64)](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · ARM64 | AppImage, DEB ou RPM | [![Télécharger pour Linux (ARM64)](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |

Sur x86_64, les paquets Linux nécessitent glibc 2.35 ou une version plus récente (Ubuntu 22.04 ou plus récent). Les paquets ARM64 sont construits sur Ubuntu 24.04. Les versions incluent des artefacts de mise à jour signés, et le programme de mise à jour intégré vérifie la signature avant d'installer quoi que ce soit.

## Questions fréquentes

<details>
<summary>Ai-je besoin d'un compte ?</summary>

Pas d'un compte Oleafly. Vous pouvez écrire, compiler et utiliser Git sans vous connecter à quoi que ce soit. La collaboration en direct vous connecte au serveur de votre laboratoire avec GitHub ou l'authentification de votre université, et la synchronisation cloud se connecte à votre stockage cloud.

</details>

<details>
<summary>Fonctionne-t-il hors ligne ?</summary>

Oui. La rédaction, la compilation, le PDF, la relecture, Preflight, Git et les points de restauration s'exécutent tous sur votre ordinateur. LaTeX compile hors ligne une fois que le moteur inclus dispose des paquets nécessaires, et Typst une fois ses paquets en cache. Les projets partagés conservent vos modifications et les fusionnent quand vous vous reconnectez.

</details>

<details>
<summary>Qu'est-ce qui passe par le réseau ?</summary>

Seulement ce que vous demandez : le partage avec votre serveur, la synchronisation cloud, la recherche bibliographique et de DOI, GitHub, les fournisseurs IA hébergés, les serveurs MCP que vous connectez et les téléchargements facultatifs de moteurs, de paquets et de modèles. Les versions publiées vérifient aussi la présence d'une mise à jour au démarrage de l'application. Un modèle Ollama local garde le trafic IA sur votre ordinateur.

</details>

<details>
<summary>Mon université ou mon entreprise peut-elle héberger le serveur ?</summary>

Oui, c'est le principe. Oleafly Server tourne sur votre propre machine ou votre compte cloud, connecte les utilisateurs via GitHub ou n'importe quel fournisseur OpenID Connect, et stocke les fichiers sur disque ou dans un stockage compatible S3. Le [guide du serveur](https://github.com/Oleafly/oleafly-server) couvre l'installation, les sauvegardes et les rôles.

</details>

## En savoir plus

- [Guides produit](https://oleafly.com/docs/)
- [Oleafly Server](https://github.com/Oleafly/oleafly-server)
- [Carte des fonctionnalités](../features.md)
- [Guide de l'éditeur](../Editor.md)
- [Aperçu PDF](../PDFPreview.md)
- [Citations et littérature](../Citations.md)
- [Galerie d'outils](../Tools.md)
- [Preflight et contrôles d'accessibilité](../Preflight.md)
- [Modèles](../Templates.md)
- [Diagram Composer](../DiagramComposer.md)
- [Git et contrôle de code source](../SourceControl.md)
- [Points de restauration](../Checkpoints.md)
- [AI Copilot](../AICopilot.md)
- [Skills](../Skills.md)
- [Intégration MCP](../mcp.md)
- [Outil en ligne de commande](../cli.md)
- [Configuration du développement](../development.md)
- [Journal des modifications](../../CHANGELOG.md)

## Communauté et assistance

Rejoignez la [communauté Oleafly sur Discord](https://oleafly.com/discord) pour poser vos questions, obtenir de l'aide sur une compilation récalcitrante, montrer ce que vous écrivez et voter pour ce qui sera développé ensuite. C'est gratuit et ouvert à tout le monde. Si vous préférez GitHub, signalez un bug ou demandez une fonctionnalité dans les [Issues GitHub](https://github.com/Oleafly/Oleafly/issues).

Oleafly est développé par [Prajwal Murthy](https://github.com/prajwal-svm) et des contributeurs. Les contributions au code, aux modèles, à la documentation et aux retours sont les bienvenues. Consultez le [guide de contribution](../../CONTRIBUTING.md) pour participer.

Si vous utilisez Oleafly, une [étoile GitHub](https://github.com/Oleafly/Oleafly) aide d'autres chercheurs à le découvrir.

## Citer Oleafly

<details>
<summary>Copier l'entrée BibTeX</summary>

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S. and {The Oleafly contributors}},
  title   = {Oleafly: a local-first workspace for research writing},
  year    = {2026},
  version = {0.4.8},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

</details>

[Sécurité](../../SECURITY.md) · [Code de conduite](../../CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](../../LICENSE)

## Historique des étoiles

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Graphique de l'historique des étoiles" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
