<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Logotipo do Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Português** | [Русский](README.ru.md) | [中文](README.zh.md)

<h2>Um ambiente de pesquisa completo, reprojetado para a era da IA.</h2>

Escreva, compile e revise textos, pesquise a literatura, gerencie citações,
crie figuras, confira PDFs e acompanhe cada alteração no Git. Use IA hospedada,
um endpoint próprio, Ollama local ou nenhuma IA. O Oleafly mantém seus projetos
em pastas comuns no seu computador.

[![Issues abertas](https://img.shields.io/github/issues/Oleafly/Oleafly?label=Issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)
**[Baixar o Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Ler a documentação do produto](https://oleafly.com/docs/overview/) ·
[Compilar a partir do código-fonte](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly editando o artigo de pesquisa LLaMA em LaTeX, com a árvore de arquivos, o sumário do documento e o PDF compilado abertos ao mesmo tempo" width="100%" />
</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

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

Consulte a [referência de funcionalidades](../features.md) e a
[configuração de MCP](../mcp.md) para os provedores, ferramentas e modelo de
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

## Em breve

O roteiro mantém o Oleafly aberto, local-first e útil em todo o fluxo de
pesquisa.

- **Localização do aplicativo.** Use o Oleafly em mais idiomas e trabalhe com
  a interface que parecer mais natural para você.
- **Habilidades e plugins para agentes.** Adicione fluxos de IA focados e
  reutilizáveis que reenviam menos contexto e usam menos tokens.
- **Agentes autônomos de pesquisa.** Transforme uma pergunta de pesquisa e um
  conjunto de fontes em um primeiro rascunho estruturado.
- **Colaboração em tempo real e comentários.** Trabalhe em equipe com
  colaboração ilimitada e auto-hospedada.
- **Oleafly CLI.** Use um pacote leve e instalável de linha de comando para
  fluxos de pesquisa que não precisam de interface gráfica.
- **Melhor suporte a Typst e Markdown.** Leve mais recursos de edição,
  visualização e publicação do Oleafly aos dois formatos.
- **Mais integrações de pesquisa.** Conecte o Mendeley e outros serviços de
  referências, bibliotecas e pesquisa.
- **Sincronização em nuvem auto-hospedada.** Mantenha projetos sincronizados
  entre dispositivos e melhore a sincronização automática com o GitHub.

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
pnpm install
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
pnpm tauri dev
```

Consulte o [guia de desenvolvimento](../development.md) para pré-requisitos,
configuração por plataforma e builds de produção.

Esses scripts baixam para `src-tauri/binaries` os executáveis auxiliares do
compilador, fixados por checksum, para a plataforma atual. O argumento `all`
serve para CI e pacotes de lançamento, quando todas as plataformas compatíveis
precisam ser preparadas.

A inteligência do editor por TexLab e Tinymist é opcional em uma execução
local. Baixe esses servidores de linguagem com
`pnpm language-servers:fetch`. Consulte a
[cadeia de ferramentas dos servidores de linguagem](../language-server-toolchain.md)
para conhecer as políticas de integridade, licença e distribuição.

### Linha de comando

`oleaflyc` gerencia projetos do Oleafly sem abrir o aplicativo de desktop. Ele
é compilado a partir do código deste repositório e ainda não é publicado como
um pacote independente.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Os comandos usam o diretório atual. Passe `-C <path>` para indicar outro
projeto. Execute `oleaflyc --help` para ver a lista completa de comandos.

## Documentação para desenvolvedores

Os guias do usuário estão na
[documentação do produto Oleafly](https://oleafly.com/docs/overview/). As
referências abaixo são para colaboradores, integradores e responsáveis por lançamentos.

| Referência | Cobre |
| --- | --- |
| [Catálogo de engenharia de produto](../README.md) | Inventários de funcionalidades e contratos de engenharia |
| [Referência de funcionalidades](../features.md) | A superfície do produto e os fluxos de trabalho suportados |
| [Motores de documento](../document-engines.md) | Capacidades de LaTeX, Typst e Markdown |
| [Arquitetura do produto](../architecture.md) | Fronteiras do sistema, responsabilidade por pacotes e pontos de extensão |
| [Desenvolvimento](../development.md) | Configuração local, testes e fluxo de contribuição |
| [Toolchain de servidores de linguagem](../language-server-toolchain.md) | Política de obtenção, integridade e distribuição |
| [Integração MCP](../mcp.md) | Clientes externos, tokens de acesso e políticas de aprovação |
| [Lançamentos](../releasing.md) | Fluxo de release e verificação de artefatos |
| [Assinatura de código](../signing.md) | Requisitos de assinatura por plataforma |
| [Atualizações automáticas](../updates.md) | Manifestos de atualização, assinaturas e rollback |

## Contribuindo

<table>
  <tr>
    <td width="38%" valign="top"><img src="../assets/oleafly-club.png" alt="O Clube Oleafly: uma comunidade aberta de pesquisa que celebra rascunhos, revisões, testes e submissões bem-sucedidas" width="100%" /></td>
    <td width="62%" valign="top"><h3>Pesquisadores merecem ferramentas que possam inspecionar, ampliar e usar com confiança.</h3><p>O Oleafly é construído abertamente por <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> e colaboradores. Relatos de bugs, correções, modelos, documentação e feedback criterioso sobre o produto são bem-vindos.</p></td>
  </tr>
</table>

1. Leia o [CONTRIBUTING.md](../../CONTRIBUTING.md).
2. Abra uma issue antes de uma mudança grande; correções pequenas e focadas
   podem ir direto para um pull request.
3. Execute as verificações relevantes antes de submeter:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

Por favor, relate problemas de segurança de forma privada, conforme descrito em
[SECURITY.md](../../SECURITY.md). A participação é regida pelo
[Código de Conduta](../../CODE_OF_CONDUCT.md).

## Comunidade e suporte

- Faça perguntas e compartilhe ideias nas [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- Relate bugs e solicite recursos nas [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- 🔔 Siga [@OleaflyHQ no X](https://x.com/OleaflyHQ) para novidades do produto e das versões.

⭐ Se o Oleafly ajuda no seu trabalho, considere [dar uma estrela ao repositório](https://github.com/Oleafly/Oleafly).
Esse pequeno gesto ajuda mais pesquisadores a encontrar o projeto e apoia o desenvolvimento contínuo.

## Histórico de estrelas

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="Gráfico do histórico de estrelas" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

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
[AGPL-3.0-or-later](../../LICENSE). Os avisos de terceiros estão listados em
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).
