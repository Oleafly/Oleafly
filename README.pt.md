<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Logotipo do Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Português** | [Русский](README.ru.md) | [中文](README.zh.md)

**Escreva, compile e publique pesquisas com um espaço de trabalho de IA que é seu.**

Escreva em LaTeX, Typst ou Markdown. Compile ao lado do código-fonte. Mantenha
cada revisão no Git. Use IA nos seus próprios termos.

O Oleafly é um aplicativo de desktop gratuito e 100% open source para macOS,
Windows e Linux. É local-first, funciona sem conta e mantém arquivos de projeto
em texto simples no seu computador.

[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)

**[Baixar o Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Ler a documentação de engenharia](docs/README.md) ·
[Compilar a partir do código-fonte](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-light.png" alt="Oleafly com um editor LaTeX e o PDF compilado abertos lado a lado (tema claro)" width="92%" />
  <br /><br />
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor.png" alt="Oleafly com um editor LaTeX e o PDF compilado abertos lado a lado (tema escuro)" width="92%" />
</div>

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf.png" alt="A biblioteca do Oleafly exibindo projetos como livros coloridos, com rótulos de motor, tipo e última modificação (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf-light.png" alt="A biblioteca do Oleafly exibindo projetos como livros coloridos, com rótulos de motor, tipo e última modificação (tema claro)" /></td>
  </tr>
</table>

</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

> [!NOTE]
> O Oleafly já está pronto para documentos do dia a dia, mas o projeto ainda
> evolui rapidamente. A compatibilidade com pacotes avançados e algumas
> integrações de plataforma ainda estão sendo consolidadas. As builds para
> macOS são assinadas e notarizadas; as builds para Windows ainda não são
> assinadas. Baixe apenas da página oficial de releases e leia as notas de
> lançamento antes de instalar uma versão de pré-visualização não assinada.

## A pesquisa já tem partes móveis demais

Um documento técnico costuma acabar espalhado entre um editor, um compilador,
um visualizador de PDF, uma ferramenta de bibliografia, o Git e um chat de IA
que não consegue ver o projeto de verdade. O Oleafly reúne esse trabalho em um
único aplicativo de desktop, mantendo o código-fonte legível em outros editores
e ferramentas de linha de comando.

A mesma visão de projeto serve para um relatório de disciplina, um artigo de
periódico ou uma tese de cem páginas:

| Seu trabalho | O que o Oleafly cuida |
| --- | --- |
| Escrever | Edição em código e visual, autocompletar, símbolos, citações, figuras, tabelas e inteligência de código em todo o projeto |
| Compilar | Motores LaTeX e Typst embutidos, Markdown via Pandoc, erros interpretados, logs e builds offline com cache |
| Inspecionar | Uma pré-visualização de PDF rápida, controles de página e zoom, layouts de duas páginas, inversão de cores e SyncTeX bidirecional |
| Revisar | Salvamento automático, histórico Git de verdade, diffs, restauração e sincronização com o GitHub |
| Submeter | Preflight de ATS e acessibilidade, verificação de referências, extração em modo de leitura e vários formatos de exportação |
| Pedir ajuda | Um assistente de IA opcional com contexto do projeto, modelos locais via Ollama, provedores hospedados e clientes MCP |

Se você gosta do ciclo de escrever e pré-visualizar do Overleaf, mas quer
compilação, arquivos, Git e escolha de modelo na sua própria máquina, o Oleafly
foi feito para esse fluxo de trabalho. Ele também pode substituir boa parte da
configuração em torno de um editor local, uma toolchain TeX, um visualizador de
PDF e um cliente Git.

Hoje o Oleafly não oferece edição multiusuário ao vivo no navegador. Git e
GitHub são o caminho atual de colaboração.

## O que você pode fazer

### Escreva com o código-fonte ao alcance

- Trabalhe com projetos LaTeX, Typst e Markdown, incluindo documentos grandes
  com vários arquivos, imagens, includes e bibliografias.
- Alterne LaTeX e Markdown entre as visões Código e Visual. Blocos ricos sem
  suporte permanecem visíveis como código-fonte editável em vez de desaparecer.
- Insira títulos, listas, links, citações, referências cruzadas, equações,
  frações, figuras, tabelas e símbolos pela barra de ferramentas do editor.
- Use autocompletar de comandos, citações, rótulos, arquivos e comandos de
  barra.
- Localize e substitua, dobre seções e ambientes, ative os atalhos do Vim e
  execute verificação ortográfica e gramatical offline.
- Vá até definições, encontre referências, renomeie rótulos ou chaves de
  citação em todo o projeto e inspecione definições ao passar o mouse.

O mapa do projeto indexa cada seção, rótulo, chave de citação e ambiente do
projeto e os mantém endereçáveis por `arquivo:linha`, de modo que a navegação e
as renomeações funcionam em um documento com vários arquivos, e não apenas em
um buffer por vez.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="A árvore de arquivos do Oleafly ao lado do mapa do projeto, listando seções e rótulos com seu arquivo e linha (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="A árvore de arquivos do Oleafly ao lado do mapa do projeto, listando seções e rótulos com seu arquivo e linha (tema claro)" /></td>
  </tr>
</table>

</div>

O seletor de citações lê diretamente os arquivos `.bib` do projeto, então cada
chave vem com autor, ano, título e a linha em que foi definida.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="Escolhendo uma chave de citação a partir de entradas BibTeX interpretadas, cada uma mostrando autores, ano e linha de origem (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="Escolhendo uma chave de citação a partir de entradas BibTeX interpretadas, cada uma mostrando autores, ano e linha de origem (tema claro)" /></td>
  </tr>
</table>

</div>

Uma contagem de palavras que entende LaTeX ignora a marcação e conta apenas o
que o leitor vê.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="O popover de contagem de palavras informando palavras, caracteres e linhas do documento aberto (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="O popover de contagem de palavras informando palavras, caracteres e linhas do documento aberto (tema claro)" /></td>
  </tr>
</table>

</div>

### Compile e leia sem sair do projeto

- Compile LaTeX com o sidecar Tectonic embutido e Typst com seu motor
  embutido. Uma instalação completa de TeX não é necessária para o fluxo de
  trabalho padrão.
- Veja as falhas do compilador como diagnósticos no editor e cartões de erro
  legíveis, em vez de caçar no log bruto.
- Leia o PDF ao lado do código-fonte com rolagem contínua, páginas
  virtualizadas, layouts de uma ou duas páginas, controles de ajuste,
  navegação por páginas, tela cheia e uma janela de pré-visualização destacada
  opcional.
- Use o SyncTeX nos dois sentidos: salte do código-fonte para o PDF, ou dê
  Cmd/Ctrl+clique no texto do PDF para voltar ao trecho correspondente do
  código.
- Salve o PDF dentro do projeto ou exporte o código-fonte como um arquivo
  compactado portátil.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="A página de configurações do motor LaTeX mostrando os motores embutidos e suas opções (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="A página de configurações do motor LaTeX mostrando os motores embutidos e suas opções (tema claro)" /></td>
  </tr>
</table>

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-figures.png" alt="Uma página compilada mostrando gráficos, uma superfície de erro com mapa de cores e uma tabela de resultados ao lado do código LaTeX" width="88%" />
</div>

Diminua o zoom e o documento inteiro cabe na tela de uma vez, o que costuma
ser o jeito mais rápido de conferir se floats, figuras e tabelas caíram onde
você queria.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="Um documento de três páginas disposto na pré-visualização com todas as figuras e tabelas visíveis (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="Um documento de três páginas disposto na pré-visualização com todas as figuras e tabelas visíveis (tema claro)" /></td>
  </tr>
</table>

</div>

### Mantenha um histórico que você pode inspecionar

Cada projeto é um repositório Git de verdade. O Oleafly faz commits após
compilações bem-sucedidas e após períodos de edição sem atividade, e então
expõe no aplicativo as partes úteis desse histórico.

- Revise uma linha do tempo de commits e diffs lado a lado.
- Restaure uma versão anterior de um arquivo sem substituir o resto do
  projeto.
- Faça stage, descarte, commit, push e pull pelo painel de Controle de Versão.
- Publique um projeto no GitHub ou conecte um repositório existente.
- Continue trabalhando pelo terminal ou por outro editor; não há formato de
  documento proprietário para desempacotar.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Um diff de código lado a lado no histórico Git do Oleafly" width="84%" />
</div>

### Comece a partir de algo útil

A galeria de projetos inclui modelos editáveis para artigos, teses, relatórios,
livros, apresentações, pôsteres, trabalhos de aula, cartas, bibliografias,
currículos e diagramas. Filtre por motor de documento, prontidão offline ou
adequação a ATS (sistemas de triagem de currículos). Pacotes de modelos e
fontes opcionais só são baixados quando você os escolhe.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="A galeria pesquisável de modelos de projeto do Oleafly com miniaturas ao vivo, contagens por categoria e filtros de motor (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="A galeria pesquisável de modelos de projeto do Oleafly com miniaturas ao vivo, contagens por categoria e filtros de motor (tema claro)" /></td>
  </tr>
</table>

</div>

### Transite entre pesquisa e publicação

- Adicione uma citação a partir de um DOI, ID do arXiv, URL ou busca por
  título. O Oleafly grava uma entrada BibTeX sem duplicatas e insere a citação
  na posição do cursor.
- Desenhe um diagrama em uma tela visual ou edite o TikZ diretamente, e então
  insira-o como código vetorial ou como imagem. O TikZ salvo pode ser reaberto
  e editado.
- Importe documentos do Word via Pandoc, reconstrua localmente um projeto
  LaTeX editável a partir de um PDF ou transcreva a imagem de uma equação com
  um modelo de visão.
- Exporte PDF e arquivos compactados do código-fonte, além de Word, HTML,
  Markdown, texto, PowerPoint ou EPUB quando o motor de documento e o tipo de
  projeto derem suporte.
- Consulte prazos de conferências e use buscas de literatura opcionais sem
  transformar a pasta do projeto em um documento na nuvem.

A busca de citações consulta arXiv, Semantic Scholar, Crossref, PubMed,
OpenAlex e Google Scholar em conjunto, combina registros duplicados e salva ou
exporta o que você mantiver como BibTeX. Ela também pode varrer o documento
aberto parágrafo por parágrafo e sugerir citações para afirmações que ainda não
têm uma.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="Busca de citações retornando resultados sem duplicatas de vários índices, cada um com ações de salvar e copiar BibTeX (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="Busca de citações retornando resultados sem duplicatas de vários índices, cada um com ações de salvar e copiar BibTeX (tema claro)" /></td>
  </tr>
</table>

</div>

O compositor de diagramas desenha em uma tela e compila o TikZ ao lado, de modo
que a figura inserida é código vetorial de verdade que você pode continuar
editando.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="O compositor de diagramas com uma arquitetura transformer na tela e a pré-visualização do TikZ compilado ao lado (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="O compositor de diagramas com uma arquitetura transformer na tela e a pré-visualização do TikZ compilado ao lado (tema claro)" /></td>
  </tr>
</table>

</div>

### Verifique o documento antes que outra pessoa o faça

O Preflight analisa tanto o código-fonte quanto a saída compilada. Ele detecta
referências quebradas, recursos ausentes, rótulos duplicados, problemas de
ordem de leitura, metadados faltando, padrões de figuras inacessíveis e
layouts de currículo difíceis de interpretar por sistemas de triagem de
candidatos.

Ele também mostra o texto que um parser ou leitor de tela consegue extrair.
Essas verificações são uma orientação prática de submissão, não uma
certificação formal de acessibilidade.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="Preflight relatando uma pontuação de acessibilidade com apontamentos específicos no código-fonte e na saída compilada (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="Preflight relatando uma pontuação de acessibilidade com apontamentos específicos no código-fonte e na saída compilada (tema claro)" /></td>
  </tr>
</table>

</div>

Referências e citações ganham um painel próprio: a bibliografia, cada citação
usada no documento e os símbolos que o projeto define.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="O painel de referências listando entradas da bibliografia por chave e ano, ao lado do código-fonte e do PDF compilado (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="O painel de referências listando entradas da bibliografia por chave e ano, ao lado do código-fonte e do PDF compilado (tema claro)" /></td>
  </tr>
</table>

</div>

### Deixe a IA trabalhar no projeto, se você quiser

O assistente pode ler e editar arquivos, pesquisar no projeto, compilar,
inspecionar o log e extrair o texto do PDF para conferir o próprio resultado.
Ele também pode ajudar com citações, documentos importados e figuras TikZ
editáveis.

Você escolhe o modelo:

- Conecte um provedor hospedado compatível com sua própria chave de API.
- Rode um modelo local via Ollama.
- Deixe a IA sem configurar e use o resto do aplicativo normalmente.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="O painel do assistente oferecendo pontos de partida como encontrar artigos para citar, escrever uma revisão de literatura e corrigir erros no código-fonte (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="O painel do assistente oferecendo pontos de partida como encontrar artigos para citar, escrever uma revisão de literatura e corrigir erros no código-fonte (tema claro)" /></td>
  </tr>
</table>

</div>

As alterações em arquivos vêm com um diff e controles de Aprovar ou Rejeitar.
"Sempre permitir" pode aprovar gravações comuns durante a sessão atual,
enquanto exclusões continuam parando para confirmação.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="Uma alteração de arquivo do assistente exibida como diff em vermelho e verde, com controles de Rejeitar, Sempre permitir e Aprovar" width="88%" />
</div>

Depois de aprovada, a edição entra no arquivo e o documento é recompilado. Toda
resposta mantém uma ação de "Restaurar o código para antes desta resposta".

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="Uma edição aprovada do assistente aplicada ao documento e refletida no PDF recompilado" width="88%" />
</div>

Os provedores são configurados nas Configurações. As chaves ficam na sua
máquina, e um modelo local via Ollama funciona sem chave nenhuma.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="A página de configurações do Assistente de IA com vários provedores conectados e um modelo local do Ollama selecionado (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="A página de configurações do Assistente de IA com vários provedores conectados e um modelo local do Ollama selecionado (tema claro)" /></td>
  </tr>
</table>

</div>

O Oleafly também pode expor suas ferramentas de projeto para o Claude Desktop,
o Claude Code, o Cursor e outros clientes MCP. As conexões MCP suportam modo
somente leitura e três políticas de aprovação: confirmar cada alteração,
aprovar gravações automaticamente enquanto exclusões são confirmadas, ou
confiar no mecanismo de aprovação do próprio cliente.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="Configurações de MCP mostrando o servidor local, as instruções para clientes e as políticas de aprovação disponíveis (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="Configurações de MCP mostrando o servidor local, as instruções para clientes e as políticas de aprovação disponíveis (tema claro)" /></td>
  </tr>
</table>

</div>

Consulte a [referência de funcionalidades](docs/features.md) e a
[configuração de MCP](docs/mcp.md) para os provedores, ferramentas e modelo de
segurança atuais.

Tudo fica acessível a partir de um único lugar: a omnibar pesquisa projetos e
documentos, e digitar `/` a transforma em uma paleta de comandos.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="A omnibar listando comandos e projetos atualizados recentemente (tema escuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="A omnibar listando comandos e projetos atualizados recentemente (tema claro)" /></td>
  </tr>
</table>

</div>

## Local-first, com uma fronteira de rede clara

Nenhuma conta e nenhuma telemetria são exigidas. Os dados essenciais do projeto
permanecem na sua máquina.

| Roda ou permanece local | Usa a rede apenas quando você pede |
| --- | --- |
| Arquivos do projeto e buffers do editor | Um provedor de IA hospedado que você conectar |
| Repositórios Git e histórico | Publicação, push e pull no GitHub |
| Compilação com pacotes em cache | Pacotes TeX necessários na primeira compilação |
| Renderização de PDF e extração de texto | Downloads opcionais de modelos, fontes, Pandoc ou TinyTeX |
| Verificação ortográfica, gramática e preflight | Consultas de citações, literatura, prazos de conferências e atualizações |
| IA local via Ollama |  |

As chaves de API são armazenadas localmente. Os arquivos de documento em texto
simples continuam utilizáveis mesmo se você parar de usar o Oleafly.

## Instalação

Baixe a versão mais recente em
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest).

| Plataforma | Instalador |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` ou `-setup.exe` |
| Linux, x86_64 | `.AppImage`, `.deb` ou `.rpm` |

A primeira compilação LaTeX pode baixar pacotes exigidos pelo documento. O
Tectonic os mantém em cache para as próximas builds, e o modo Offline restringe
a compilação a esse cache.

Para rodar a partir do código-fonte:

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
./scripts/fetch-tectonic.sh all
./scripts/fetch-typst.sh all
pnpm install
pnpm tauri dev
```

Consulte o [guia de desenvolvimento](docs/development.md) para pré-requisitos,
configuração por plataforma e builds de produção.

## Documentação

O repositório mantém as referências públicas de engenharia e de produto perto
do código. Os guias de tarefas para o usuário final são mantidos separadamente
deste índice público.

| Referência | Cobre |
| --- | --- |
| [Catálogo de engenharia de produto](docs/README.md) | Inventários de funcionalidades e contratos de engenharia |
| [Referência de funcionalidades](docs/features.md) | A superfície do produto e os fluxos de trabalho suportados |
| [Motores de documento](docs/document-engines.md) | Capacidades de LaTeX, Typst e Markdown |
| [Vindo do LaTeX Workshop](docs/ComingFromLatexWorkshop.md) | Mapeamento de funcionalidades e atalhos para usuários de VS Code + LaTeX Workshop |
| [Arquitetura do produto](docs/Architecture.md) | Fronteiras do sistema, responsabilidade por pacotes e pontos de extensão |
| [Desenvolvimento](docs/development.md) | Configuração local, testes e fluxo de contribuição |
| [Toolchain de servidores de linguagem](docs/language-server-toolchain.md) | Política de obtenção, integridade e distribuição |
| [Integração MCP](docs/mcp.md) | Clientes externos, tokens de acesso e políticas de aprovação |
| [Lançamentos](docs/releasing.md) | Fluxo de release e verificação de artefatos |
| [Assinatura de código](docs/signing.md) | Requisitos de assinatura por plataforma |
| [Atualizações automáticas](docs/updates.md) | Manifestos de atualização, assinaturas e rollback |

## Contribuindo

O Oleafly é construído abertamente por
[Prajwal S Venkateshmurthy](https://github.com/prajwalsvenkatesh) e
colaboradores. Relatos de bugs, correções, modelos, documentação e feedback de
produto criterioso são bem-vindos.

1. Leia o [CONTRIBUTING.md](CONTRIBUTING.md).
2. Abra uma issue antes de uma mudança grande; correções pequenas e focadas
   podem ir direto para um pull request.
3. Execute as verificações relevantes antes de submeter:

   ```bash
   pnpm build
   pnpm test
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   ```

Por favor, relate problemas de segurança de forma privada, conforme descrito em
[SECURITY.md](SECURITY.md). A participação é regida pelo
[Código de Conduta](CODE_OF_CONDUCT.md).

## Créditos

O Oleafly é construído sobre
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/) e
[Hunspell](https://hunspell.github.io/).

O Oleafly é licenciado sob a
[AGPL-3.0-or-later](LICENSE). Os avisos de terceiros estão listados em
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
