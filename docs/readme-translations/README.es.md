<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Logotipo de Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | **Español** | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md)

<h2>Un entorno de investigación completo, rediseñado para la era de la IA.</h2>

Escribe, compila y corrige textos, busca bibliografía, gestiona citas, crea
figuras, revisa archivos PDF y sigue cada cambio en Git. Usa una IA alojada,
un endpoint propio, Ollama en local o ninguna IA. Oleafly guarda tus proyectos
en carpetas normales de tu equipo.

[![Issues abiertos](https://img.shields.io/github/issues/Oleafly/Oleafly?label=Issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)
**[Descargar Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Leer la documentación del producto](https://oleafly.com/docs/overview/) ·
[Compilar desde el código fuente](../development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly editando el artículo de investigación de LLaMA en LaTeX, con el árbol de archivos, el esquema del documento y el PDF compilado abiertos a la vez" width="100%" />
</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

## La investigación ya tiene suficientes piezas en movimiento

Un documento técnico suele acabar repartido entre un editor, un compilador, un
visor de PDF, una herramienta de bibliografía, Git y un chat de IA que no puede
ver el proyecto real. Oleafly reúne todo ese trabajo en una sola aplicación de
escritorio, dejando el código fuente legible en otros editores y herramientas
de línea de comandos.

La misma vista de proyecto sirve para un informe de curso, un artículo de
revista o una tesis de cien páginas:

| Tu trabajo | De qué se encarga Oleafly |
| --- | --- |
| Escribir | Edición en código y visual, autocompletado, símbolos, citas, figuras, tablas e inteligencia de código a nivel de todo el proyecto |
| Compilar | Motores de LaTeX y Typst integrados, Markdown mediante Pandoc, errores interpretados, registros y compilaciones sin conexión con caché |
| Inspeccionar | Una vista previa de PDF rápida, controles de página y zoom, disposición a doble página, inversión de color y SyncTeX bidireccional |
| Revisar | Guardado automático, historial real de Git, diffs, restauración y sincronización con GitHub |
| Enviar | Verificación previa de accesibilidad y de ATS (sistemas de seguimiento de candidatos), comprobación de referencias, extracción en vista de lectura y varios formatos de exportación |
| Obtener ayuda | Un asistente de IA opcional con contexto del proyecto, modelos locales con Ollama, proveedores en la nube y clientes MCP |

Si te gusta el ciclo de escribir y previsualizar de Overleaf pero quieres la
compilación, los archivos, Git y la elección de modelo en tu propia máquina,
Oleafly está hecho para ese flujo de trabajo. También puede sustituir buena
parte de la configuración habitual de editor local, cadena de herramientas TeX,
visor de PDF y cliente de Git.

Hoy por hoy, Oleafly no ofrece edición multiusuario en vivo desde el navegador.
Git y GitHub son la vía de colaboración actual.

## Qué puedes hacer

### Escribe con el código fuente al alcance

- Trabaja con proyectos de LaTeX, Typst y Markdown, incluidos documentos
  grandes de varios archivos, imágenes, inclusiones y bibliografías.
- Alterna LaTeX y Markdown entre las vistas de código y visual. Los bloques
  enriquecidos no compatibles permanecen visibles como código editable en lugar
  de desaparecer.
- Inserta encabezados, listas, enlaces, citas, referencias cruzadas,
  ecuaciones, fracciones, figuras, tablas y símbolos desde la barra de
  herramientas del editor.
- Usa el autocompletado de comandos, citas, etiquetas, archivos y comandos de
  barra (`/`).
- Busca y reemplaza, pliega secciones y entornos, activa los atajos de Vim y
  ejecuta correcciones ortográficas y gramaticales sin conexión.
- Salta a definiciones, encuentra referencias, renombra etiquetas o claves de
  cita en todo el proyecto e inspecciona definiciones al pasar el cursor.

El mapa del proyecto indexa cada sección, etiqueta, clave de cita y entorno del
proyecto y los mantiene localizables por `archivo:línea`, de modo que la
navegación y los renombrados funcionan sobre un documento de varios archivos y
no búfer a búfer.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="El árbol de archivos de Oleafly junto al mapa del proyecto, que lista secciones y etiquetas con su archivo y línea (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="El árbol de archivos de Oleafly junto al mapa del proyecto, que lista secciones y etiquetas con su archivo y línea (tema claro)" /></td>
  </tr>
</table>

</div>

El selector de citas lee directamente los archivos `.bib` del proyecto, así que
cada clave aparece con su autor, año, título y la línea donde se definió.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="Elección de una clave de cita entre entradas de BibTeX interpretadas, cada una con autores, año y línea de origen (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="Elección de una clave de cita entre entradas de BibTeX interpretadas, cada una con autores, año y línea de origen (tema claro)" /></td>
  </tr>
</table>

</div>

Un contador de palabras que entiende LaTeX ignora el marcado y cuenta solo lo
que ve el lector.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="El panel de recuento de palabras informando de palabras, caracteres y líneas del documento abierto (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="El panel de recuento de palabras informando de palabras, caracteres y líneas del documento abierto (tema claro)" /></td>
  </tr>
</table>

</div>

### Compila y lee sin salir del proyecto

- Compila LaTeX con el motor Tectonic integrado y Typst con su propio motor
  incluido. El flujo de trabajo predeterminado no requiere una instalación
  completa de TeX.
- Ve los fallos del compilador como diagnósticos en el editor y tarjetas de
  error legibles en lugar de rebuscar en un registro sin procesar.
- Lee el PDF junto al código fuente con desplazamiento continuo, páginas
  virtualizadas, disposición de una o dos páginas, controles de ajuste,
  navegación por páginas, pantalla completa y una ventana de vista previa
  independiente opcional.
- Usa SyncTeX en ambas direcciones: salta del código al PDF, o haz
  Cmd/Ctrl-clic en el texto del PDF para volver al punto correspondiente del
  código.
- Guarda el PDF dentro del proyecto o exporta el código fuente como un archivo
  comprimido portable.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="La página de ajustes del motor de LaTeX mostrando los motores integrados y sus opciones (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="La página de ajustes del motor de LaTeX mostrando los motores integrados y sus opciones (tema claro)" /></td>
  </tr>
</table>

</div>

Aleja el zoom y tendrás el documento completo en pantalla de una vez, que suele
ser la forma más rápida de comprobar que los flotantes, las figuras y las
tablas quedaron donde querías.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="Un documento de tres páginas desplegado en la vista previa con todas las figuras y tablas visibles (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="Un documento de tres páginas desplegado en la vista previa con todas las figuras y tablas visibles (tema claro)" /></td>
  </tr>
</table>

</div>

### Mantén un historial que puedas inspeccionar

Cada proyecto es un repositorio de Git de verdad. Oleafly confirma cambios tras
cada compilación correcta y tras periodos de inactividad en la edición, y luego
muestra las partes útiles de ese historial dentro de la aplicación.

- Revisa una cronología de commits y diffs lado a lado.
- Restaura una versión anterior de un archivo sin reemplazar el resto del
  proyecto.
- Prepara, descarta, confirma, envía y trae cambios desde el panel de control
  de versiones.
- Publica un proyecto en GitHub o conecta un repositorio existente.
- Sigue trabajando desde la terminal u otro editor; no hay ningún formato de
  documento propietario que desempaquetar.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="Un diff de código lado a lado en el historial de Git de Oleafly" width="84%" />
</div>

### Empieza desde algo útil

La galería de proyectos incluye plantillas editables para artículos, tesis,
informes, libros, presentaciones, pósteres, tareas, cartas, bibliografías,
currículums y diagramas. Filtra por motor de documento, disponibilidad sin
conexión o compatibilidad con ATS. Los paquetes de plantillas y las fuentes
opcionales solo se descargan cuando tú lo decides.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="La galería de plantillas de proyecto de Oleafly, con búsqueda, miniaturas en vivo, recuentos por categoría y filtros por motor (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="La galería de plantillas de proyecto de Oleafly, con búsqueda, miniaturas en vivo, recuentos por categoría y filtros por motor (tema claro)" /></td>
  </tr>
</table>

</div>

### Alterna entre tareas de investigación y de publicación

- Añade una cita a partir de un DOI, un identificador de arXiv, una URL o una
  búsqueda por título. Oleafly escribe una entrada de BibTeX sin duplicados e
  inserta la cita en el cursor.
- Dibuja un diagrama en un lienzo visual o edita su TikZ directamente, y luego
  insértalo como código vectorial o como imagen. El TikZ guardado se puede
  reabrir y seguir editando.
- Importa documentos de Word mediante Pandoc, reconstruye localmente un
  proyecto LaTeX editable a partir de un PDF o transcribe la imagen de una
  ecuación con un modelo de visión.
- Exporta el PDF y archivos comprimidos del código fuente, además de Word,
  HTML, Markdown, texto, PowerPoint o EPUB cuando el motor de documento y el
  tipo de proyecto lo permitan.
- Consulta fechas límite de congresos y usa búsquedas bibliográficas
  opcionales sin convertir la carpeta del proyecto en un documento en la nube.

La búsqueda de citas consulta a la vez arXiv, Semantic Scholar, Crossref,
PubMed, OpenAlex y Google Scholar, combina los registros duplicados y guarda o
exporta como BibTeX lo que decidas conservar. También puede recorrer el
documento abierto párrafo a párrafo y sugerir citas para las afirmaciones que
aún no tienen una.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="La búsqueda de citas devolviendo resultados sin duplicados de varios índices, cada uno con acciones para guardar y copiar el BibTeX (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="La búsqueda de citas devolviendo resultados sin duplicados de varios índices, cada uno con acciones para guardar y copiar el BibTeX (tema claro)" /></td>
  </tr>
</table>

</div>

El compositor de diagramas dibuja sobre un lienzo y compila el TikZ a su lado,
de modo que la figura que insertas es código vectorial real que puedes seguir
editando.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="El compositor de diagramas con la arquitectura de un transformer en el lienzo y la vista previa de su TikZ compilado al lado (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="El compositor de diagramas con la arquitectura de un transformer en el lienzo y la vista previa de su TikZ compilado al lado (tema claro)" /></td>
  </tr>
</table>

</div>

### Revisa el documento antes de que lo haga otra persona

La verificación previa (Preflight) examina tanto el código fuente como el
resultado compilado. Detecta referencias rotas, recursos ausentes, etiquetas
duplicadas, problemas de orden de lectura, metadatos que faltan, patrones de
figuras inaccesibles y diseños de currículum difíciles de interpretar para los
sistemas de seguimiento de candidatos.

También muestra el texto que un analizador o un lector de pantalla puede
extraer. Estas comprobaciones son una guía práctica para el envío, no una
certificación formal de accesibilidad.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="La verificación previa informando de una puntuación de accesibilidad con hallazgos concretos en el código y en el resultado compilado (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="La verificación previa informando de una puntuación de accesibilidad con hallazgos concretos en el código y en el resultado compilado (tema claro)" /></td>
  </tr>
</table>

</div>

Las referencias y las citas tienen su propio panel: la bibliografía, cada cita
usada en el documento y los símbolos que define el proyecto.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="El panel de referencias listando las entradas de la bibliografía por clave y año junto al código y al PDF compilado (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="El panel de referencias listando las entradas de la bibliografía por clave y año junto al código y al PDF compilado (tema claro)" /></td>
  </tr>
</table>

</div>

### Deja que la IA trabaje en el proyecto, si tú quieres

El asistente puede leer y editar archivos, buscar en el proyecto, compilar,
inspeccionar el registro y extraer el texto del PDF para comprobar su propio
resultado. También puede ayudar con citas, documentos importados y figuras
TikZ editables.

El modelo lo eliges tú:

- Conecta un proveedor en la nube compatible con tu propia clave de API.
- Ejecuta un modelo local a través de Ollama.
- Deja la IA sin configurar y usa el resto de la aplicación con normalidad.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="El panel del asistente ofreciendo puntos de partida como buscar artículos para citar, redactar una revisión bibliográfica y corregir errores del código (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="El panel del asistente ofreciendo puntos de partida como buscar artículos para citar, redactar una revisión bibliográfica y corregir errores del código (tema claro)" /></td>
  </tr>
</table>

</div>

Los cambios en archivos llegan con un diff y controles de aprobar o rechazar.
«Permitir siempre» puede aprobar las escrituras ordinarias durante la sesión
actual, mientras que los borrados siguen deteniéndose para pedir confirmación.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="Un cambio de archivo del asistente mostrado como un diff en rojo y verde con controles para rechazar, permitir siempre y aprobar" width="88%" />
</div>

Una vez aprobada, la edición se aplica al archivo y el documento se recompila.
Cada respuesta conserva una acción de «Restaurar el código a antes de esta
respuesta».

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="Una edición aprobada del asistente aplicada al documento y reflejada en el PDF recompilado" width="88%" />
</div>

Los proveedores se configuran en Ajustes. Las claves se quedan en tu máquina, y
un modelo local de Ollama funciona sin clave alguna.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="La página de ajustes del asistente de IA con varios proveedores conectados y un modelo local de Ollama seleccionado (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="La página de ajustes del asistente de IA con varios proveedores conectados y un modelo local de Ollama seleccionado (tema claro)" /></td>
  </tr>
</table>

</div>

Oleafly también puede exponer sus herramientas de proyecto a Claude Desktop,
Claude Code, Cursor y otros clientes MCP. Las conexiones MCP admiten un modo de
solo lectura y tres políticas de aprobación: confirmar cada cambio, aprobar
automáticamente las escrituras confirmando los borrados, o confiar en el
mecanismo de aprobación del propio cliente.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="Los ajustes de MCP mostrando el servidor local, sus instrucciones para clientes y las políticas de aprobación disponibles (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="Los ajustes de MCP mostrando el servidor local, sus instrucciones para clientes y las políticas de aprobación disponibles (tema claro)" /></td>
  </tr>
</table>

</div>

Consulta la [referencia de funcionalidades](../features.md) y la
[configuración de MCP](../mcp.md) para conocer los proveedores, las
herramientas y el modelo de seguridad actuales.

Todo está al alcance desde un mismo sitio: la omnibarra busca proyectos y
documentos, y al escribir `/` se convierte en una paleta de comandos.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="La omnibarra listando comandos y proyectos actualizados recientemente (tema oscuro)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="La omnibarra listando comandos y proyectos actualizados recientemente (tema claro)" /></td>
  </tr>
</table>

</div>

## Local primero, con una frontera de red clara

No se requiere cuenta ni telemetría. Los datos esenciales del proyecto
permanecen en tu máquina.

| Se ejecuta o permanece en local | Usa la red solo cuando tú lo pides |
| --- | --- |
| Los archivos del proyecto y los búferes del editor | Un proveedor de IA en la nube que tú conectes |
| Los repositorios de Git y su historial | Publicar, enviar y traer cambios de GitHub |
| La compilación con paquetes en caché | Los paquetes de TeX necesarios para la primera compilación |
| El renderizado del PDF y la extracción de texto | Las descargas opcionales de plantillas, fuentes, Pandoc o TinyTeX |
| La ortografía, la gramática y la verificación previa | Las consultas de citas, bibliografía, fechas límite de congresos y actualizaciones |
| La IA local a través de Ollama |  |

Las claves de API se guardan en local. Los archivos de documento en texto
plano siguen siendo utilizables aunque dejes de usar Oleafly.

## Próximamente

La hoja de ruta mantiene Oleafly abierto, local primero y útil durante todo el
flujo de investigación.

- **Localización de la aplicación.** Usa Oleafly en más idiomas y trabaja con
  la interfaz que te resulte más natural.
- **Habilidades y plugins para agentes.** Añade flujos de IA específicos y
  reutilizables que repiten menos contexto y consumen menos tokens.
- **Agentes de investigación autónomos.** Convierte una pregunta de
  investigación y un conjunto de fuentes en un primer borrador estructurado.
- **Colaboración en tiempo real y comentarios.** Trabaja en equipo con
  colaboración ilimitada y autoalojada.
- **Oleafly CLI.** Usa un paquete ligero e instalable para flujos de
  investigación que no necesitan una interfaz gráfica.
- **Mejor compatibilidad con Typst y Markdown.** Lleva más funciones de edición,
  vista previa y publicación de Oleafly a ambos formatos.
- **Más integraciones de investigación.** Conecta Mendeley y otros servicios de
  referencias, bibliotecas e investigación.
- **Sincronización autoalojada en la nube.** Sincroniza proyectos entre
  dispositivos, con una mejor sincronización automática de GitHub cuando la quieras.

## Instalación

Descarga la última versión desde
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest).

| Plataforma | Instalador |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` o `-setup.exe` |
| Linux, x86_64 | `.AppImage`, `.deb` o `.rpm` |

La primera compilación de LaTeX puede descargar los paquetes que necesite el
documento. Tectonic los guarda en caché para compilaciones posteriores, y el
modo sin conexión restringe la compilación a esa caché.

Para ejecutar desde el código fuente:

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

Consulta la [guía de desarrollo](../development.md) para conocer los
requisitos, la configuración por plataforma y las compilaciones de producción.

Estos scripts descargan en `src-tauri/binaries` los ejecutables auxiliares del
compilador, fijados mediante suma de comprobación, para tu plataforma actual.
El argumento `all` está pensado para CI y los paquetes de lanzamiento, donde
deben prepararse todas las plataformas compatibles.

La inteligencia del editor mediante TexLab y Tinymist es opcional para una
ejecución local. Descarga esos servidores de lenguaje con
`pnpm language-servers:fetch`. Consulta la
[cadena de herramientas de servidores de lenguaje](../language-server-toolchain.md)
para conocer su integridad, licencias y política de distribución.

### Línea de comandos

`oleaflyc` administra proyectos de Oleafly sin abrir la aplicación de
escritorio. Se compila desde el código fuente de este repositorio y todavía no
se publica como paquete independiente.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Los comandos se ejecutan sobre el directorio actual. Usa `-C <path>` para
señalar otro proyecto. Ejecuta `oleaflyc --help` para ver la lista completa.

## Documentación para desarrolladores

Las guías de usuario están en la
[documentación del producto Oleafly](https://oleafly.com/docs/overview/). Las
referencias siguientes son para colaboradores, integradores y responsables de versiones.

| Referencia | Cubre |
| --- | --- |
| [Catálogo de producto e ingeniería](../README.md) | Inventarios de funcionalidades y contratos de ingeniería |
| [Referencia de funcionalidades](../features.md) | La superficie del producto y los flujos de trabajo admitidos |
| [Motores de documento](../document-engines.md) | Capacidades de LaTeX, Typst y Markdown |
| [Arquitectura del producto](../architecture.md) | Fronteras del sistema, propiedad de los paquetes y puntos de extensión |
| [Desarrollo](../development.md) | Configuración local, pruebas y flujo de contribución |
| [Cadena de herramientas del servidor de lenguaje](../language-server-toolchain.md) | Política de descarga, integridad y distribución |
| [Integración de MCP](../mcp.md) | Clientes externos, tokens de acceso y políticas de aprobación |
| [Publicación de versiones](../releasing.md) | Flujo de publicación y comprobación de artefactos |
| [Firma de código](../signing.md) | Requisitos de firma por plataforma |
| [Actualizaciones automáticas](../updates.md) | Manifiestos de actualización, firmas y reversión |

## Cómo contribuir

<table>
  <tr>
    <td width="38%" valign="top"><img src="../assets/oleafly-club.png" alt="El Club Oleafly: una comunidad de investigación abierta que celebra borradores, revisiones, pruebas y publicaciones aceptadas" width="100%" /></td>
    <td width="62%" valign="top"><h3>Quienes investigan merecen herramientas que puedan inspeccionar, ampliar y en las que puedan confiar.</h3><p>Oleafly se desarrolla en abierto gracias a <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> y sus colaboradores. Los informes de errores, las correcciones, las plantillas, la documentación y los comentarios cuidadosos sobre el producto son bienvenidos.</p></td>
  </tr>
</table>

1. Lee [CONTRIBUTING.md](../../CONTRIBUTING.md).
2. Abre un issue antes de un cambio grande; las correcciones pequeñas y
   acotadas pueden ir directamente en un pull request.
3. Ejecuta las comprobaciones pertinentes antes de enviar:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

Informa de los problemas de seguridad en privado tal como se describe en
[SECURITY.md](../../SECURITY.md). La participación se rige por el
[Código de conducta](../../CODE_OF_CONDUCT.md).

## Comunidad y soporte

- Haz preguntas y comparte ideas en [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- Informa de errores y solicita funciones en [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- 🔔 Sigue a [@OleaflyHQ en X](https://x.com/OleaflyHQ) para conocer las novedades del producto y de las versiones.

⭐ Si Oleafly te ayuda, considera [dar una estrella al repositorio](https://github.com/Oleafly/Oleafly).
Ese pequeño gesto ayuda a que más investigadores encuentren el proyecto y apoya su desarrollo.

## Historial de estrellas

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="Gráfico del historial de estrellas" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

## Créditos

Oleafly se apoya en
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/) y
[Hunspell](https://hunspell.github.io/).

Oleafly está licenciado bajo
[AGPL-3.0-or-later](../../LICENSE). Los avisos de terceros están listados en
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).
