<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Logo Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](README.md) | [Español](README.es.md) | **Français** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md)

**Rédigez, compilez et publiez vos travaux de recherche dans un espace de travail IA qui vous appartient.**

Écrivez en LaTeX, Typst ou Markdown. Compilez à côté de votre source. Conservez
chaque révision dans Git. Utilisez l'IA à vos conditions.

Oleafly est une application de bureau gratuite et 100 % open source pour macOS,
Windows et Linux. Elle privilégie le local, fonctionne sans compte et conserve
vos projets sous forme de fichiers ordinaires sur votre ordinateur.

[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)

**[Télécharger Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Lire la documentation technique](docs/README.md) ·
[Compiler depuis les sources](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-light.png" alt="Oleafly avec un éditeur LaTeX et le PDF compilé ouverts côte à côte (thème clair)" width="92%" />
  <br /><br />
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor.png" alt="Oleafly avec un éditeur LaTeX et le PDF compilé ouverts côte à côte (thème sombre)" width="92%" />
</div>

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf.png" alt="La bibliothèque Oleafly présentant les projets sous forme de livres colorés avec le moteur, le type et la date de dernière modification (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf-light.png" alt="La bibliothèque Oleafly présentant les projets sous forme de livres colorés avec le moteur, le type et la date de dernière modification (thème clair)" /></td>
  </tr>
</table>

</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

> [!NOTE]
> Oleafly est prêt pour vos documents du quotidien, mais le projet évolue
> encore rapidement. La compatibilité avec les packages avancés et quelques
> intégrations spécifiques aux plateformes sont encore en cours de
> consolidation. Les builds macOS sont signés et notarisés ; les builds Windows
> ne sont pas encore signés. Téléchargez uniquement depuis la page officielle
> des versions et consultez les notes de version avant d'installer une version
> préliminaire non signée.

## La recherche a déjà bien assez de pièces mobiles

Un document technique finit généralement éparpillé entre un éditeur, un
compilateur, un lecteur PDF, un outil de bibliographie, Git et une conversation
IA qui ne voit pas le projet réel. Oleafly réunit tout ce travail dans une
seule application de bureau, tout en laissant la source lisible dans d'autres
éditeurs et outils en ligne de commande.

La même vue de projet convient aussi bien à un rapport de cours, un article de
revue ou une thèse de cent pages :

| Votre travail | Ce dont Oleafly s'occupe |
| --- | --- |
| Rédiger | Édition du source et édition visuelle, autocomplétion, symboles, citations, figures, tableaux et intelligence de code à l'échelle du projet |
| Compiler | Moteurs LaTeX et Typst intégrés, Markdown via Pandoc, erreurs analysées, journaux et compilations hors ligne à partir du cache |
| Inspecter | Un aperçu PDF rapide, contrôles de page et de zoom, affichage sur deux pages, inversion des couleurs et SyncTeX bidirectionnel |
| Réviser | Enregistrement automatique, un véritable historique Git, diffs, restauration et synchronisation GitHub |
| Soumettre | Vérifications préliminaires ATS et d'accessibilité, contrôle des références, extraction en vue lecteur et plusieurs formats d'export |
| Obtenir de l'aide | Un assistant IA optionnel conscient du projet, des modèles locaux Ollama, des fournisseurs hébergés et des clients MCP |

Si vous aimez la boucle écriture-aperçu d'Overleaf mais souhaitez garder la
compilation, les fichiers, Git et le choix du modèle sur votre propre machine,
Oleafly est fait pour ce flux de travail. Il peut aussi remplacer une bonne
partie de la configuration autour d'un éditeur local, d'une chaîne TeX, d'un
lecteur PDF et d'un client Git.

Oleafly ne propose pas aujourd'hui d'édition collaborative en temps réel dans
le navigateur. Git et GitHub constituent la voie de collaboration actuelle.

## Ce que vous pouvez faire

### Écrire avec la source à portée de main

- Travaillez sur des projets LaTeX, Typst et Markdown, y compris de grands
  documents multi-fichiers avec images, inclusions et bibliographies.
- Basculez LaTeX et Markdown entre les vues Code et Visuelle. Les blocs riches
  non pris en charge restent visibles sous forme de source éditable au lieu de
  disparaître.
- Insérez titres, listes, liens, citations, références croisées, équations,
  fractions, figures, tableaux et symboles depuis la barre d'outils de
  l'éditeur.
- Profitez de l'autocomplétion des commandes, citations, labels, fichiers et
  commandes slash.
- Recherchez et remplacez, repliez sections et environnements, activez les
  raccourcis Vim et lancez des vérifications orthographiques et grammaticales
  hors ligne.
- Accédez aux définitions, trouvez les références, renommez labels ou clés de
  citation dans tout le projet et inspectez les définitions au survol.

La carte du projet indexe chaque section, label, clé de citation et
environnement du projet et les garde adressables par `fichier:ligne`, si bien
que la navigation et les renommages fonctionnent à l'échelle d'un document
multi-fichiers plutôt qu'un tampon à la fois.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="L'arborescence des sources d'Oleafly à côté de la carte du projet, listant les sections et les labels avec leur fichier et leur ligne (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="L'arborescence des sources d'Oleafly à côté de la carte du projet, listant les sections et les labels avec leur fichier et leur ligne (thème clair)" /></td>
  </tr>
</table>

</div>

Le sélecteur de citations lit directement les fichiers `.bib` du projet, si
bien que chaque clé s'accompagne de son auteur, de son année, de son titre et
de la ligne où elle a été définie.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="Choix d'une clé de citation parmi des entrées BibTeX analysées, chacune affichant les auteurs, l'année et la ligne source (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="Choix d'une clé de citation parmi des entrées BibTeX analysées, chacune affichant les auteurs, l'année et la ligne source (thème clair)" /></td>
  </tr>
</table>

</div>

Un compteur de mots conscient de LaTeX ignore le balisage et ne compte que ce
que voit le lecteur.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="La fenêtre de comptage indiquant les mots, caractères et lignes du document ouvert (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="La fenêtre de comptage indiquant les mots, caractères et lignes du document ouvert (thème clair)" /></td>
  </tr>
</table>

</div>

### Compiler et lire sans quitter le projet

- Compilez LaTeX avec le sidecar Tectonic intégré et Typst avec son moteur
  intégré. Une installation TeX complète n'est pas nécessaire pour le flux de
  travail par défaut.
- Consultez les échecs du compilateur sous forme de diagnostics dans l'éditeur
  et de cartes d'erreur lisibles, plutôt que de fouiller un journal brut.
- Lisez le PDF à côté de la source avec défilement continu, pages
  virtualisées, affichage sur une ou deux pages, contrôles d'ajustement,
  navigation par page, plein écran et une fenêtre d'aperçu détachable en
  option.
- Utilisez SyncTeX dans les deux sens : passez de la source au PDF, ou faites
  Cmd/Ctrl-clic sur le texte du PDF pour revenir à la source correspondante.
- Enregistrez le PDF dans le projet ou exportez la source sous forme d'archive
  portable.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="La page de réglages du moteur LaTeX montrant les moteurs intégrés et leurs options (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="La page de réglages du moteur LaTeX montrant les moteurs intégrés et leurs options (thème clair)" /></td>
  </tr>
</table>

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-figures.png" alt="Une page compilée montrant des graphiques, une surface d'erreur en couleurs et un tableau de résultats à côté de la source LaTeX" width="88%" />
</div>

Dézoomez et le document entier tient à l'écran d'un seul coup, ce qui est
souvent le moyen le plus rapide de vérifier que flottants, figures et tableaux
ont atterri là où vous le vouliez.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="Un document de trois pages disposé dans l'aperçu avec toutes les figures et tous les tableaux visibles (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="Un document de trois pages disposé dans l'aperçu avec toutes les figures et tous les tableaux visibles (thème clair)" /></td>
  </tr>
</table>

</div>

### Garder un historique que vous pouvez inspecter

Chaque projet est un véritable dépôt Git. Oleafly effectue un commit après
chaque compilation réussie et après les périodes d'édition calmes, puis expose
les parties utiles de cet historique dans l'application.

- Parcourez une chronologie des commits et des diffs côte à côte.
- Restaurez un fichier antérieur sans remplacer le reste du projet.
- Indexez, annulez, validez, poussez et tirez depuis le panneau de contrôle de
  version.
- Publiez un projet sur GitHub ou connectez un dépôt existant.
- Continuez à travailler depuis le terminal ou un autre éditeur ; il n'y a
  aucun format de document propriétaire à déballer.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Un diff de source côte à côte dans l'historique Git d'Oleafly" width="84%" />
</div>

### Partir de quelque chose d'utile

La galerie de projets propose des modèles éditables pour articles, thèses,
rapports, livres, présentations, posters, devoirs, lettres, bibliographies, CV
et diagrammes. Filtrez par moteur de document, disponibilité hors ligne ou
compatibilité ATS. Les packs de modèles et polices optionnels ne se
téléchargent que lorsque vous les choisissez.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="La galerie de modèles de projets d'Oleafly, avec recherche, vignettes en direct, compteurs par catégorie et filtres par moteur (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="La galerie de modèles de projets d'Oleafly, avec recherche, vignettes en direct, compteurs par catégorie et filtres par moteur (thème clair)" /></td>
  </tr>
</table>

</div>

### Passer des tâches de recherche aux tâches de publication

- Ajoutez une citation à partir d'un DOI, d'un identifiant arXiv, d'une URL ou
  d'une recherche par titre. Oleafly écrit une entrée BibTeX dédupliquée et
  insère la citation au curseur.
- Dessinez un diagramme sur un canevas visuel ou éditez son TikZ directement,
  puis insérez-le comme source vectorielle ou comme image. Le TikZ enregistré
  peut être rouvert et modifié.
- Importez des documents Word via Pandoc, reconstruisez localement un projet
  LaTeX éditable à partir d'un PDF, ou transcrivez l'image d'une équation avec
  un modèle de vision.
- Exportez le PDF et des archives de sources, ainsi que Word, HTML, Markdown,
  texte, PowerPoint ou EPUB lorsque le moteur de document et le type de projet
  le permettent.
- Parcourez les échéances de conférences et utilisez les recherches
  bibliographiques optionnelles sans transformer le dossier du projet en
  document cloud.

La recherche de citations interroge à la fois arXiv, Semantic Scholar,
Crossref, PubMed, OpenAlex et Google Scholar, fusionne les doublons et
enregistre ou exporte ce que vous conservez au format BibTeX. Elle peut aussi
analyser le document ouvert paragraphe par paragraphe et suggérer des citations
pour les affirmations qui n'en ont pas encore.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="Recherche de citations renvoyant des résultats dédupliqués issus de plusieurs index, chacun avec une action d'enregistrement et de copie BibTeX (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="Recherche de citations renvoyant des résultats dédupliqués issus de plusieurs index, chacun avec une action d'enregistrement et de copie BibTeX (thème clair)" /></td>
  </tr>
</table>

</div>

Le compositeur de diagrammes dessine sur un canevas et compile le TikZ à côté,
si bien que la figure que vous insérez est une véritable source vectorielle que
vous pouvez continuer à modifier.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="Le compositeur de diagrammes avec une architecture transformer sur le canevas et son aperçu TikZ compilé à côté (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="Le compositeur de diagrammes avec une architecture transformer sur le canevas et son aperçu TikZ compilé à côté (thème clair)" /></td>
  </tr>
</table>

</div>

### Vérifier le document avant que quelqu'un d'autre ne le fasse

Le contrôle préliminaire (Preflight) examine à la fois la source et le résultat
compilé. Il détecte les références cassées, les ressources manquantes, les
labels en double, les problèmes d'ordre de lecture, les métadonnées absentes,
les figures inaccessibles et les mises en page de CV difficiles à analyser pour
les ATS (systèmes de suivi des candidatures).

Il montre aussi le texte qu'un analyseur ou un lecteur d'écran peut extraire.
Ces vérifications sont des conseils pratiques pour la soumission, pas une
certification formelle d'accessibilité.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="Le contrôle préliminaire affichant un score d'accessibilité avec des constats précis sur la source et le résultat compilé (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="Le contrôle préliminaire affichant un score d'accessibilité avec des constats précis sur la source et le résultat compilé (thème clair)" /></td>
  </tr>
</table>

</div>

Références et citations disposent de leur propre panneau : la bibliographie,
chaque citation utilisée dans le document et les symboles définis par le
projet.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="Le panneau des références listant les entrées bibliographiques par clé et par année, à côté de la source et du PDF compilé (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="Le panneau des références listant les entrées bibliographiques par clé et par année, à côté de la source et du PDF compilé (thème clair)" /></td>
  </tr>
</table>

</div>

### Laisser l'IA travailler sur le projet, si vous le souhaitez

L'assistant peut lire et modifier des fichiers, chercher dans le projet,
compiler, inspecter le journal et extraire le texte du PDF pour vérifier son
propre résultat. Il peut aussi vous aider avec les citations, les documents
importés et les figures TikZ éditables.

C'est vous qui choisissez le modèle :

- Connectez un fournisseur hébergé pris en charge avec votre propre clé API.
- Exécutez un modèle local via Ollama.
- Laissez l'IA non configurée et utilisez le reste de l'application
  normalement.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="Le panneau de l'assistant proposant des points de départ comme trouver des articles à citer, rédiger une revue de littérature et corriger des erreurs de source (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="Le panneau de l'assistant proposant des points de départ comme trouver des articles à citer, rédiger une revue de littérature et corriger des erreurs de source (thème clair)" /></td>
  </tr>
</table>

</div>

Chaque modification de fichier s'accompagne d'un diff et de boutons Approuver
ou Rejeter. « Toujours autoriser » peut approuver les écritures ordinaires pour
la session en cours, tandis que les suppressions continuent de demander
confirmation.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="Une modification de fichier de l'assistant affichée comme un diff rouge et vert avec les boutons Rejeter, Toujours autoriser et Approuver" width="88%" />
</div>

Une fois approuvée, la modification atterrit dans le fichier et le document se
recompile. Chaque réponse conserve une action « Restaurer le code tel qu'avant
cette réponse ».

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="Une modification approuvée de l'assistant appliquée au document et reflétée dans le PDF recompilé" width="88%" />
</div>

Les fournisseurs se configurent dans les Réglages. Les clés restent sur la
machine, et un modèle Ollama local fonctionne sans aucune clé.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="La page de réglages de l'assistant IA avec plusieurs fournisseurs connectés et un modèle Ollama local sélectionné (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="La page de réglages de l'assistant IA avec plusieurs fournisseurs connectés et un modèle Ollama local sélectionné (thème clair)" /></td>
  </tr>
</table>

</div>

Oleafly peut aussi exposer ses outils de projet à Claude Desktop, Claude Code,
Cursor et d'autres clients MCP. Les connexions MCP prennent en charge un mode
lecture seule et trois politiques d'approbation : confirmer chaque
modification, approuver automatiquement les écritures tout en confirmant les
suppressions, ou faire confiance au mécanisme d'approbation du client
lui-même.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="Les réglages MCP montrant le serveur local, ses instructions pour les clients et les politiques d'approbation disponibles (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="Les réglages MCP montrant le serveur local, ses instructions pour les clients et les politiques d'approbation disponibles (thème clair)" /></td>
  </tr>
</table>

</div>

Consultez la [référence des fonctionnalités](docs/features.md) et la
[configuration MCP](docs/mcp.md) pour les fournisseurs, outils et le modèle de
sécurité actuels.

Tout est accessible depuis un seul endroit : l'omnibarre recherche projets et
documents, et taper `/` la transforme en palette de commandes.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="L'omnibarre listant les commandes et les projets récemment modifiés (thème sombre)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="L'omnibarre listant les commandes et les projets récemment modifiés (thème clair)" /></td>
  </tr>
</table>

</div>

## Priorité au local, avec une frontière réseau claire

Aucun compte ni aucune télémétrie ne sont requis. Les données essentielles du
projet restent sur votre machine.

| S'exécute ou reste en local | N'utilise le réseau qu'à votre demande |
| --- | --- |
| Fichiers de projet et tampons de l'éditeur | Un fournisseur d'IA hébergé que vous connectez |
| Dépôts Git et historique | Publication, push et pull GitHub |
| Compilation avec packages en cache | Packages TeX nécessaires à la première compilation |
| Rendu PDF et extraction de texte | Téléchargements optionnels de modèles, polices, Pandoc ou TinyTeX |
| Orthographe, grammaire et contrôle préliminaire | Recherches de citations, de littérature, d'échéances de conférences et de mises à jour |
| IA locale via Ollama |  |

Les clés API sont stockées localement. Vos fichiers de document ordinaires
restent utilisables même si vous cessez d'utiliser Oleafly.

## Installation

Téléchargez la dernière version depuis
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest).

| Plateforme | Installateur |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` ou `-setup.exe` |
| Linux, x86_64 | `.AppImage`, `.deb` ou `.rpm` |

La première compilation LaTeX peut télécharger les packages requis par le
document. Tectonic les met en cache pour les compilations suivantes, et le mode
hors ligne restreint la compilation à ce cache.

Pour lancer depuis les sources :

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
./scripts/fetch-tectonic.sh all
./scripts/fetch-typst.sh all
pnpm install
pnpm tauri dev
```

Consultez le [guide de développement](docs/development.md) pour les
prérequis, la configuration par plateforme et les builds de production.

## Documentation

Le dépôt garde les références publiques d'ingénierie et de produit au plus près
du code. Les guides destinés aux utilisateurs finaux sont maintenus séparément
de cet index public.

| Référence | Contenu |
| --- | --- |
| [Catalogue produit-ingénierie](docs/README.md) | Inventaires des fonctionnalités et contrats d'ingénierie |
| [Référence des fonctionnalités](docs/features.md) | La surface produit et les flux de travail pris en charge |
| [Moteurs de document](docs/document-engines.md) | Capacités LaTeX, Typst et Markdown |
| [Venir de LaTeX Workshop](docs/ComingFromLatexWorkshop.md) | Correspondance des fonctionnalités et raccourcis pour les utilisateurs de VS Code + LaTeX Workshop |
| [Architecture produit](docs/Architecture.md) | Frontières du système, responsabilité des packages et points d'extension |
| [Développement](docs/development.md) | Installation locale, tests et flux de contribution |
| [Chaîne d'outils du serveur de langage](docs/language-server-toolchain.md) | Politique de récupération, d'intégrité et de distribution |
| [Intégration MCP](docs/mcp.md) | Clients externes, jetons d'accès et politiques d'approbation |
| [Publication de versions](docs/releasing.md) | Flux de publication et vérification des artefacts |
| [Signature du code](docs/signing.md) | Exigences de signature par plateforme |
| [Mises à jour automatiques](docs/updates.md) | Manifestes de mise à jour, signatures et retour arrière |

## Contribuer

Oleafly est développé au grand jour par
[Prajwal S Venkateshmurthy](https://github.com/prajwalsvenkatesh) et les
contributeurs. Rapports de bugs, correctifs, modèles, documentation et retours
produit réfléchis sont les bienvenus.

1. Lisez [CONTRIBUTING.md](CONTRIBUTING.md).
2. Ouvrez une issue avant tout changement d'ampleur ; les correctifs petits et
   ciblés peuvent aller directement en pull request.
3. Lancez les vérifications pertinentes avant de soumettre :

   ```bash
   pnpm build
   pnpm test
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   ```

Merci de signaler les problèmes de sécurité en privé, comme décrit dans
[SECURITY.md](SECURITY.md). La participation est régie par le
[code de conduite](CODE_OF_CONDUCT.md).

## Crédits

Oleafly s'appuie sur
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/) et
[Hunspell](https://hunspell.github.io/).

Oleafly est distribué sous licence
[AGPL-3.0-or-later](LICENSE). Les mentions relatives aux composants tiers sont
listées dans [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
