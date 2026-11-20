<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-app-icon-pastel-256.png" alt="Logotipo de Oleafly" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | [English](../../README.md) | **Español** | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md) | [العربية](README.ar.md)

[![Descargar para macOS (Apple Silicon)](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Descargar para Windows](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Descargar para Linux](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest)

[![Incidencias abiertas](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Descargas](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml) [![Quality Gate de SonarQube](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Oleafly_Oleafly) [![Cobertura de código](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=coverage)](https://sonarcloud.io/component_measures?id=Oleafly_Oleafly&metric=coverage) [![Estado del desarrollo: extremadamente activo](https://img.shields.io/badge/status-ultra_active-22c55e)](https://github.com/Oleafly/Oleafly/pulse) [![Último commit](https://img.shields.io/github/last-commit/Oleafly/Oleafly?label=last%20commit&color=22c55e)](https://github.com/Oleafly/Oleafly/commits/main) [![Licencia: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](../../LICENSE) [![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2Fkt9bcCjgkP%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=&color=5865F2&logo=discord&logoColor=white&cacheSeconds=600)](https://oleafly.com/discord) [![Estrellas](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

<a href="https://trendshift.io/repositories/99082"><img src="https://trendshift.io/api/badge/trendshift/repositories/99082/daily?language=TypeScript" alt="Oleafly on Trendshift" width="250" height="55" /></a>

**Un editor colaborativo en directo de LaTeX, Typst y Markdown para la investigación.**

Oleafly es un espacio de trabajo gratuito y de código abierto para escribir investigación científica. Incluye un entorno de desarrollo con agentes para macOS, Windows y Linux, un servidor que aloja tu laboratorio para la colaboración en directo, una herramienta de línea de comandos para compilaciones locales y CI, y una vista web para que los coautores trabajen en el navegador. Compila LaTeX, Typst y Markdown sin configuración y guarda cada proyecto como un repositorio de Git con puntos de control automáticos. El kit de herramientas de investigación tiene más de 1700 plantillas, Zotero, BibTeX, calculadoras estadísticas, búsqueda en arXiv, Semantic Scholar, Crossref, PubMed y OpenAlex, y comprobaciones de Preflight para referencias rotas, figuras ausentes, filtraciones en la revisión anónima y PDF/UA. Colabora en tiempo real en el servidor, que se instala con un solo comando, con cursores compartidos, comentarios, chat, cambios con seguimiento, roles y fusión sin conexión. Claude Code, Codex y 13 agentes de IA más trabajan en tu proyecto, con cada edición como una diferencia que revisas, y las tareas de investigación experimentales hacen una revisión bibliográfica o una pasada de revisión en segundo plano en worktrees aislados, dentro de un presupuesto que fijas tú. La CLI (`check`, `lint`, `mcp`, `ask`, `agent run`, `daemon`) abre todo esto a los terminales y a CI.

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>Descarga gratis</strong></a>
· <a href="https://oleafly.com/docs/">Consulta las guías</a> · <a href="https://github.com/Oleafly/oleafly-server">Aloja un servidor</a> · <a href="../development.md">Compila desde el código fuente</a>
</p>


Gratis para siempre · Código abierto · Sin cuenta de Oleafly · Sin seguimiento

</div>

<div align="center">
  <img src="../assets/readme/oleafly-overview.png" alt="Cómo encaja Oleafly: Oleafly Desktop y Oleafly CLI en tu ordenador, Oleafly Server en la máquina de tu laboratorio con Oleafly Web en el navegador, y los agentes de IA, las herramientas de referencias, Overleaf, la sincronización en la nube y los hosts de Git a los que se conecta Desktop" width="100%" />
</div>

## Por qué Oleafly

Durante años, escribir investigación ha sido algo que se alquila. Tu trabajo de investigación está en el servidor de otra persona, y lo que más necesita un investigador está bloqueado tras un plan de pago. Con Oleafly, todo eso es gratis. Es decir, colaboración en tiempo real con tantos coautores como invites, historial de versiones completo, sincronización con cualquier host de Git, Zotero, corrección gramatical y agentes de IA con tu propio inicio de sesión o clave, en un servidor que gestiona tu laboratorio. No necesita cuenta, no envía telemetría y funciona sin conexión.

<p align="center">
  <img src="../assets/readme/hero-collab.png" alt="Oleafly con un artículo de investigación en LaTeX abierto: el árbol de archivos, el esquema y la estructura a la izquierda, el código fuente con los cursores de siete coautores y comentarios resaltados, y el PDF compilado" width="100%" />
</p>

- Escribe con tus coautores en tiempo real, con cursores y comentarios compartidos, en un servidor que tu laboratorio instala con un solo comando.
- Un editor pensado para documentos largos: completado de etiquetas, citas y comandos, comprobación de errores en directo, un esquema de todo el proyecto, combinaciones de teclas de Vim y Emacs, un modo visual y una paleta de 236 símbolos LaTeX en la que puedes buscar.
- Compila en tu propio ordenador. Tectonic, Typst y Pandoc vienen integrados, y TeX Live, MacTeX, MiKTeX o TinyTeX toman el relevo cuando un proyecto necesita una distribución completa.
- Haz clic en el PDF para saltar al código fuente y volver, y el último PDF correcto sigue en pantalla mientras corriges un error.
- Cada proyecto es un repositorio de Git que puedes subir a GitHub, GitLab, Gitea, Forgejo, Codeberg o tu propio servidor Git, y Checkpoints guarda una instantánea después de cada compilación correcta.
- Cita desde tu biblioteca de Zotero mientras escribes y busca en arXiv, Semantic Scholar, Crossref, PubMed y OpenAlex sin salir del editor.
- La corrección ortográfica y gramatical, adaptada a la escritura académica, se ejecuta en tu ordenador.
- Preflight detecta referencias rotas, figuras ausentes, fuentes que no se incrustaron, carencias de accesibilidad y cualquier cosa que rompa el anonimato de una revisión, antes de que hagas el envío.
- Dibuja figuras que se conservan como código TikZ, Typst o Mermaid, y empieza con más de 1700 plantillas para artículos, tesis, diapositivas, pósteres y currículums.
- Los PDF, las imágenes, las hojas de cálculo, los archivos `.bib`, las páginas HTML, las presentaciones y las pizarras se abren dentro del proyecto, cada uno en su propio visor.
- Importa desde Word, un PDF, un código fuente de arXiv, un repositorio de Git o una cuenta de Overleaf.
- ¿Coautores que siguen en un servicio de LaTeX en línea como Overleaf? Edita el mismo proyecto en directo con ellos desde Oleafly mientras ellos siguen en su editor web. La edición en directo es experimental y viene desactivada de forma predeterminada. Actívala en Ajustes > Experimentación.
- El comando `oleafly` compila, comprueba y sincroniza tus proyectos desde cualquier terminal o trabajo de CI, con los mismos compiladores y ajustes que la aplicación.
- La sincronización en la nube mantiene tus proyectos en cada ordenador que usas, y puedes seguir escribiendo sin conexión.
- Claude Code, Codex y 13 agentes más trabajan dentro de tu proyecto, o puedes conectar cualquier modelo, incluidos los locales. La IA es opcional, y cada cambio que hace es una diferencia que puedes revisar y deshacer.
- Las tareas de investigación hacen una revisión bibliográfica, una auditoría de evidencias o una pasada de revisión en una copia separada del proyecto mientras sigues escribiendo, y tú eliges qué archivos modificados conservar. Son experimentales y vienen desactivadas de forma predeterminada. Actívalas en Ajustes > Experimentación.
- Notes guarda tus notas de investigación como archivos Markdown junto a tus proyectos, con enlaces, etiquetas, tareas y un calendario. También es experimental y viene desactivado de forma predeterminada.

## Escribe en equipo, en directo

Comparte un proyecto en el Oleafly Server de tu laboratorio y todos editan los mismos archivos a la vez. Ves el cursor y la selección de cada persona, quién está conectado y qué cambió mientras no estabas. Haz clic en el avatar de alguien para saltar a la línea en la que está trabajando.

<p align="center">
  <img src="../assets/readme/live-comments.png" alt="Hilos de comentarios junto al código fuente LaTeX en Oleafly, con respuestas, menciones y los cursores de los coautores en el archivo" width="100%" />
</p>

- Comenta cualquier selección en LaTeX, Typst o Markdown, y después responde, menciona a alguien, resuelve o vuelve a abrir. Un coautor mencionado recibe un solo correo electrónico, y puede desactivar esos avisos.
- Las ediciones que haces sin conexión se fusionan cuando vuelves a conectarte. Si se solapan con las de otra persona, Oleafly te muestra ambas y pregunta antes de aplicar nada.
- Las ediciones de la IA, las citas de Zotero, los cambios de nombre, los borrados y las figuras también se sincronizan. Si dos personas reemplazan la misma figura a la vez, se conservan ambas versiones.
- El archivo principal, el compilador, el idioma de la ortografía y las opciones de Typst se comparten, así que todo el equipo compila el proyecto de la misma manera.
- Cada proyecto tiene un propietario, editores, revisores, comentadores y lectores. Las ediciones de los revisores se convierten en sugerencias, y los propietarios y editores también pueden cambiar al modo Sugiriendo. Los invitados por correo electrónico solo ven los proyectos a los que se les invitó.
- Cada proyecto compartido tiene un chat y un historial donde puedes comparar versiones, restaurar una o ponerle un nombre.
- Los coautores pueden abrir un proyecto compartido en su navegador cuando el servidor tiene activado el acceso desde el navegador, y leer el PDF de la última compilación.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/live-chat.png" alt="Chat del proyecto en Oleafly junto al código fuente LaTeX compartido, con menciones y reacciones" width="100%" />
      <h3>Habla de ello en el chat del proyecto</h3>
      Cada proyecto compartido tiene su propio chat con menciones y reacciones, así que la conversación queda junto al archivo del que trata.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/live-people.png" alt="Panel Live collaboration de Oleafly con las personas de un proyecto, sus roles y el archivo que cada una tiene abierto" width="100%" />
      <h3>Mira quién está aquí</h3>
      El panel Live collaboration lista a todas las personas del proyecto, su rol y el archivo que cada una tiene abierto. Debajo de la lista hay un registro de actividad reciente.
    </td>
  </tr>
</table>

### Aloja el servidor por tu cuenta

Oleafly Server se instala con un solo comando en una máquina Linux, ya sea una estación de trabajo del laboratorio, una máquina virtual de la universidad o un pequeño servidor en la nube:

```bash
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

Es un único binario de Rust que usa SQLite, guarda los archivos en el disco o en cualquier almacenamiento compatible con S3 y envía correo electrónico por SMTP si lo configuras. Las personas inician sesión con GitHub o con cualquier proveedor de OpenID Connect, así que funciona el inicio de sesión único de tu universidad. Hay configuraciones listas para Docker Compose, Coolify, Render y systemd, y guías para Railway, Cloudflare Tunnel y los certificados universitarios.

Los administradores tienen una consola en Oleafly para las personas, las reglas de acceso, los proyectos, el correo electrónico y el registro de seguridad. Cada dispositivo firma sus cambios, y el servidor construye cada instantánea a partir de ese historial firmado en lugar de fiarse de lo que se sube.

<p align="center">
  <img src="../assets/readme/server-admin.png" alt="Consola de administración de Oleafly Server con las personas del servidor y sus roles" width="100%" />
</p>

Lee la [guía del servidor](https://github.com/Oleafly/oleafly-server) para la configuración, las copias de seguridad y la lista completa de quién puede hacer qué.

## Sincronización en la nube entre tus ordenadores

Activa la sincronización en la nube y los proyectos de tu biblioteca y los ajustes de la aplicación te siguen de un ordenador a otro. Cada descarga se comprueba con su registro antes de reemplazar un archivo, y un archivo que tienes abierto con cambios sin guardar nunca se sobrescribe.

Puedes sincronizar con Dropbox, con Google Drive o con un bucket propio en Amazon S3, Google Cloud Storage, MinIO u otro servicio compatible con S3. Elige una en Ajustes > Almacenamiento de datos > Sincronización en la nube. La misma página tiene una barra que muestra qué contiene la carpeta de datos de Oleafly y qué ocupa el espacio.

<p align="center">
  <img src="../assets/readme/cloud-sync-dropbox.png" alt="Ajustes de sincronización en la nube de Oleafly con Dropbox, Google Drive y almacenamiento compatible con S3, y una lista de lo que se sincroniza" width="100%" />
</p>

- Cuando dos ordenadores editan el mismo archivo, se conservan ambas versiones, cada una con el nombre del ordenador que la escribió.
- Borrar la mayor parte de un proyecto de una vez deja el borrado en espera hasta que lo confirmes, así que un descuido no puede vaciarlo en todas partes.
- Los archivos borrados en otro ordenador van a la Papelera de este en lugar de desaparecer.
- En un ordenador nuevo, Oleafly pregunta una sola vez si quieres conservar los ajustes de este ordenador o los sincronizados.

## Trae tus proyectos contigo

¿Vienes de un editor de LaTeX en línea? Inicia sesión en tu cuenta una vez desde Oleafly, elige los proyectos que quieras y llegan con sus archivos, su compilador y su archivo principal, listos para compilar. También funciona con el servidor propio de una universidad.

Con un token de Git de esa cuenta, Oleafly puede mantener sincronizado un proyecto importado en ambas direcciones, así que los coautores que siguen en línea trabajan como hasta ahora. La sincronización bidireccional usa la integración de Git del propio servicio, que requiere un plan de pago o universitario en la cuenta del propietario del proyecto.

La edición en directo va más allá y no necesita un token de Git. Actívala y tú y los coautores que siguen en línea trabajan en el mismo proyecto a la vez: lo que escribes, los archivos nuevos y los cambios de nombre llegan a ambos lados en cosa de un segundo, y ves dónde trabaja cada persona. Si se corta tu conexión, sigue escribiendo y se pone al día cuando vuelvas. Si tu cuenta inicia sesión con Google, con tu institución o con una passkey, usa Iniciar sesión con el navegador. La edición en directo es experimental. Actívala en Ajustes > Experimentación.

<p align="center">
  <img src="../assets/readme/import-dialog.png" alt="Diálogo Importar un proyecto de Oleafly con opciones para archivos locales, arXiv, un repositorio de Git y Overleaf" width="100%" />
</p>

También puedes empezar con un ZIP de proyecto, un repositorio de GitHub, un documento de Word, un paquete de código fuente de arXiv o un PDF que Oleafly reconstruye como LaTeX editable. O abre una carpeta allí donde ya está.

## Agentes de IA que trabajan dentro de tu proyecto

Elige un agente del catálogo y trabajará en tu proyecto con el código fuente, el PDF y el registro de compilación a su alcance. Cada agente inicia sesión con su propia cuenta y usa su propio modelo. Oleafly le da el proyecto y las herramientas que lo rodean.

<p align="center">
  <img src="../assets/readme/ai-agents.png" alt="Claude Code en Oleafly revisando un párrafo de un artículo en LaTeX, con el cambio mostrado como una diferencia" width="100%" />
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/oleafly-assistant.png" alt="Oleafly Assistant abierto junto al código fuente LaTeX, con skills de investigación para empezar" width="100%" />
      <h3>Oleafly Assistant</h3>
      El asistente integrado funciona con un proveedor que conectas o con un modelo local. Se abre con skills de investigación agrupadas por tarea: investigación, redacción, figuras, revisión y envío.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/cli-agents.png" alt="Pestaña CLI Agent en Oleafly con Claude Code seleccionado, junto al código fuente y el PDF" width="100%" />
      <h3>Agentes CLI</h3>
      Elige Claude Code, Codex, Gemini CLI u otro agente en la fila sobre el cuadro de mensaje. Trabaja junto a tu código fuente y el PDF compilado.
    </td>
  </tr>
</table>

<div align="center">
<table>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/claude-code.svg" alt="" width="40" height="40" /><br />Claude&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codex.svg" alt="" width="40" height="40" /><br />Codex&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/gemini-cli.svg" alt="" width="40" height="40" /><br />Gemini&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/pi.svg" alt="" width="40" height="40" /><br />Pi</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/opencode.svg" alt="" width="40" height="40" /><br />OpenCode</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/openclaw.svg" alt="" width="40" height="40" /><br />OpenClaw</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cline.svg" alt="" width="40" height="40" /><br />Cline</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/hermes-agent.svg" alt="" width="40" height="40" /><br />Hermes&nbsp;Agent</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/codebuddy.svg" alt="" width="40" height="40" /><br />CodeBuddy</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/kimi-code.svg" alt="" width="40" height="40" /><br />Kimi&nbsp;Code</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/grok.svg" alt="" width="40" height="40" /><br />Grok&nbsp;Build</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/cursor.svg" alt="" width="40" height="40" /><br />Cursor</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/deepseek-harness.png" alt="" width="40" height="40" /><br />DeepSeek Harness</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/qoder.svg" alt="" width="40" height="40" /><br />Qoder</td>
    <td align="center" valign="top" width="135"><img src="../assets/readme/agents/antigravity.svg" alt="" width="40" height="40" /><br />Antigravity&nbsp;CLI</td>
  </tr>
</table>
</div>

<p align="center"><sub>Estas marcas identifican herramientas compatibles y siguen siendo propiedad de sus respectivos titulares. No implican respaldo.</sub></p>

¿Prefieres un asistente de chat? Conecta un proveedor alojado, cualquier endpoint compatible con OpenAI o un modelo local en Ollama, llama.cpp o Lemonade.

- Cada cambio en un archivo es una diferencia. Aprueba cada uno, deja que el asistente trabaje por su cuenta o define reglas por herramienta, y deshaz un solo archivo o un turno completo.
- El modo de planificación traza el proyecto antes de que se escriba nada.
- ¿Sin clave de API? Paper Review, las ediciones en el texto, Fix with AI y las herramientas de imágenes y ecuaciones pueden funcionar con un agente CLI en el que ya has iniciado sesión.
- Los agentes pueden usar las aplicaciones de escritorio y los sitios web que permitas, como el formulario de envío de una revista o un paquete de estadística. Funciona con Cua Driver, que instalas tú.
- Una revisión bibliográfica o una pasada de revisión puede ejecutarse en su propio worktree de Git mientras sigues escribiendo. Tú eliges qué archivos modificados conservar.
- La aplicación incluye 39 skills de investigación, entre ellas rastreos bibliográficos, trabajo relacionado, verificación de afirmaciones y cartas de respuesta a revisores. `npx skills add Oleafly/Oleafly` también las instala en Claude Code, Codex y otros agentes.
- Un servidor MCP local permite que un cliente de IA externo use las mismas herramientas del proyecto. Solo escucha en 127.0.0.1.
- `oleafly mcp` ofrece las herramientas del proyecto a Claude Code, Codex, Cursor y Gemini CLI por stdio, con la aplicación abierta o cerrada.
- Cada versión incluye `oleafly.mcpb`. Ábrelo y Claude Desktop instala Oleafly como extensión. El MCP Registry lo lista como `io.github.Oleafly/oleafly`.

La IA es opcional. El editor, el compilador, el PDF, las citas, la corrección y las comprobaciones funcionan con ella desactivada.

## LaTeX, Typst y Markdown, compilados en tu ordenador

Tectonic, Typst y Pandoc vienen con la aplicación, así que un proyecto nuevo compila sin instalar nada. Cuando un proyecto necesita una distribución TeX completa, cámbialo a latexmk con TeX Live, MacTeX, MiKTeX o un TinyTeX que Oleafly instala por ti.

<p align="center">
  <img src="../assets/readme/editor-and-pdf.png" alt="Editor de código fuente de Oleafly y PDF compilado uno al lado del otro, con el árbol de archivos y el esquema del documento" width="100%" />
</p>

- Haz clic en el PDF para saltar al código fuente, y viceversa. LaTeX usa SyncTeX, y Typst 0.13 o posterior usa Tinymist.
- Los errores de compilación enlazan con la línea que los causó, y el último PDF correcto sigue en pantalla mientras los corriges.
- El modo visual te permite editar en una vista parecida a la página, con el código fuente a un clic.
- Completado y diagnósticos en directo para etiquetas, citas, comandos, entornos y rutas de archivos en todo el proyecto.
- La corrección ortográfica y gramatical se ejecuta en local y está adaptada a la escritura académica.
- XeLaTeX, LuaLaTeX, y upLaTeX o pLaTeX para documentos en japonés.
- Los documentos de Quarto y Calepin ejecutan su código de R, Python o Julia en cuanto permites el código en el proyecto. Oleafly puede descargar cualquiera de las dos herramientas por ti.
- Un documento Markdown puede compilarse como artículo, informe, libro, diapositivas, póster, carta o currículum. Define `type:` en su front matter.

<p align="center">
  <img src="../assets/readme/pdf-viewer.png" alt="Visor de PDF de Oleafly con dos páginas una al lado de la otra y un término de búsqueda resaltado en la página" width="100%" />
</p>

El visor de PDF tiene búsqueda, un esquema del documento, vistas de una y dos páginas, y ajuste al ancho o al alto.

## Citas, figuras, comprobaciones y plantillas

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/citations.png" alt="Citando una referencia al escribir @ en el editor de Oleafly" width="100%" />
      <h3>Cita desde Zotero mientras escribes</h3>
      Escribe <code>@</code> y parte de un autor, un título o un año para citar desde tu biblioteca de Zotero. Oleafly añade solo esa entrada al <code>.bib</code> del proyecto. Citation Search abarca arXiv, Semantic Scholar, Crossref, PubMed y OpenAlex.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/diagrams.png" alt="Diagram Composer de Oleafly con un diagrama TikZ en el lienzo" width="100%" />
      <h3>Dibuja figuras que se conservan como código</h3>
      Diagram Composer dibuja en un lienzo y escribe TikZ, fletcher para Typst o Mermaid. Cambia el dibujo o el código y el otro se actualiza.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/preflight.png" alt="Preflight de Oleafly con una puntuación de envío y una lista de hallazgos de accesibilidad" width="100%" />
      <h3>Comprueba antes de enviar</h3>
      Preflight encuentra referencias rotas, figuras ausentes, fuentes que no se incrustaron, carencias de accesibilidad y cualquier cosa que revele a los autores en una revisión anónima. Tiene perfiles para arXiv, IEEE, ACM, revistas y tesis.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/templates.png" alt="Galería de plantillas de Oleafly con vistas previas renderizadas de plantillas de artículos de revista" width="100%" />
      <h3>Empieza con más de 1700 plantillas</h3>
      Artículos, tesis, charlas de Beamer, pósteres, currículums y artículos con el estilo de congresos y revistas, cada uno con una vista previa renderizada antes de crear el proyecto.
    </td>
  </tr>
</table>

## Git, historial y un terminal

Cada proyecto es una carpeta normal con un repositorio de Git normal. Prepara archivos, compara diferencias, haz commit, push y pull, y publica en GitHub, GitLab, Gitea, Forgejo, Codeberg o tu propio servidor desde el panel Source Control, o usa tu propio terminal, ya que no se le oculta nada. Checkpoints guarda una instantánea local después de cada compilación correcta, así que puedes volver atrás sin hacer un commit.

<p align="center">
  <img src="../assets/readme/git-history.png" alt="Panel Source Control de Oleafly con una diferencia, el grafo de commits y controles de commit" width="100%" />
</p>

Bajo el editor hay un terminal acoplado con hasta diez pestañas por proyecto. Haz Cmd-clic (Ctrl-clic) en una ruta de archivo de su salida para abrirlo en esa línea.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/terminal.png" alt="Terminal acoplado bajo el editor de Oleafly con el estado de Git y el grafo de commits" width="100%" />
      <h3>Un terminal bajo el editor</h3>
      Ejecuta Git, un script de compilación o el comando <code>oleafly</code> en la carpeta del proyecto sin salir de la ventana.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/versioning.png" alt="Diálogo Versioning de Oleafly con una versión guardada por cada compilación, cada una con un botón Restore" width="100%" />
      <h3>Una versión después de cada compilación</h3>
      Versioning guarda una instantánea del código fuente después de cada compilación correcta. Restaura cualquiera con un clic, sin hacer un commit.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/git-hosting.png" alt="Ajustes de Git hosting de Oleafly con GitHub, GitLab, Codeberg y otro servidor para elegir" width="100%" />
      <h3>Tu host de Git, o tu propio servidor</h3>
      Inicia sesión en GitHub, GitLab o Codeberg, o añade la dirección de un servidor Gitea o Forgejo que gestionas tú. Después haz push, pull y publica desde el panel Source Control.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/local-storage.png" alt="Ajustes de almacenamiento de datos de Oleafly con el espacio que ocupan los proyectos, los PDF, el historial de Git y los datos de la aplicación" width="100%" />
      <h3>Mira adónde va el espacio</h3>
      Los ajustes muestran cuánto ocupan en el disco tus proyectos, los PDF, el historial de Git y los datos propios de la aplicación. Los proyectos borrados esperan en una Papelera.
    </td>
  </tr>
</table>

El comando `oleafly` trabaja con los mismos proyectos desde cualquier terminal: compila, vuelve a compilar con cada cambio, comprueba antes de enviar, sincroniza con un servicio de LaTeX en línea o ejecuta el agente de Oleafly sin abrir la aplicación. Cada comando puede imprimir JSON con códigos de salida estables para scripts y CI. Consulta la [guía de la línea de comandos](../cli.md).

## Notes para tu investigación

Notes es una base de conocimiento que está junto a tus proyectos. Cada nota es un archivo Markdown tuyo, que se edita en un editor enriquecido con bloques destacados, tablas, gráficos, diagramas, matemáticas, enlaces y retroenlaces, etiquetas, y tareas con fechas de vencimiento. Notes es experimental y viene desactivado de forma predeterminada. Actívalo en Ajustes > Experimentación.

<p align="center">
  <img src="../assets/readme/notes.png" alt="Oleafly Notes con dos notas una al lado de la otra, un gráfico y una tabla en una y una lista de tareas en la otra, y un calendario y etiquetas en la barra lateral" width="100%" />
</p>

- Las notas se abren como pestañas que puedes dividir y acoplar. Notes Home las lista con búsqueda, etiquetas, una lista de tareas y un calendario.
- Una nota puede partir de una plantilla y vivir dentro de un proyecto como `notes/<Title>.md`.
- Comparte una nota a través del servidor de tu laboratorio para editarla en equipo, y comenta una selección como lo haces en un archivo del proyecto.
- El asistente o un agente CLI puede sugerir cambios en una nota. Aceptas o rechazas cada uno en el sitio.
- Quick capture es una pequeña ventana flotante para una idea que quieres guardar.
- Pega un enlace a una publicación de X y la nota conserva el autor, la fecha y el texto de la publicación.

## Haz Oleafly a tu manera

Oleafly sigue el ajuste claro u oscuro de tu sistema, o tú eliges uno. Elige un color de acento, dónde va el dock de Home y qué se dibuja detrás de tus proyectos. El editor tiene su propia fuente, tema, colores y combinaciones de teclas, y Notes muestra una vista previa en directo mientras cambias su tipografía y su espaciado.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/appearance-app.png" alt="Ajustes de apariencia de Oleafly con la posición del dock, el patrón de fondo, el color de acento y claro u oscuro" width="100%" />
      <h3>Acento, dock y fondo</h3>
      Seis colores de acento, un dock a la izquierda, abajo o a la derecha, y puntos, una cuadrícula o nada detrás de tus proyectos.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/appearance-notes.png" alt="Ajustes de apariencia de las notas de Oleafly con tipografías para elegir y una vista previa en directo de una nota" width="100%" />
      <h3>Una tipografía a tu medida</h3>
      Elige una tipografía, un tamaño y un espaciado para tus notas y mira cómo cambia la vista previa mientras lo haces.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../assets/readme/dark-theme.png" alt="Oleafly en el tema oscuro con código fuente LaTeX junto al PDF compilado" width="100%" />
      <h3>Claro u oscuro</h3>
      Cambia desde la barra de herramientas, o deja que Oleafly siga tu sistema.
    </td>
    <td width="50%" valign="top">
      <img src="../assets/readme/notes-dark.png" alt="Oleafly Notes en el tema oscuro con un gráfico, una tabla y una lista de tareas" width="100%" />
      <h3>Oscuro también en Notes</h3>
      Los gráficos, las tablas y los bloques destacados de una nota se dibujan para oscuro igual que para claro.
    </td>
  </tr>
</table>

## Y mucho más

<details>
<summary>Más de 40 herramientas de conversión, citas y matemáticas</summary>

La galería de herramientas está en beta y viene desactivada de forma predeterminada. Actívala en Ajustes > Experimentación > Herramientas de LaTeX.

#### Importación y conversión de formatos

| Herramienta | Úsala para |
| --- | --- |
| PDF to LaTeX | Reconstruir LaTeX editable desde un PDF, conservando las matemáticas, figuras y estructura cuando el origen lo permite |
| arXiv to LaTeX | Descargar un paquete de código fuente de arXiv por ID o desempaquetar un archivo guardado en el disco |
| Image to LaTeX | Convertir una imagen de notas, ecuaciones o una tabla en LaTeX editable |
| Equation to LaTeX | Convertir matemáticas escritas o una imagen de una ecuación en LaTeX |
| Excel to LaTeX | Convertir una hoja de Excel, CSV o TSV en una tabla LaTeX con caracteres escapados |
| HTML to LaTeX | Convertir HTML pegado en un documento LaTeX independiente |
| Image to Typst | Convertir una imagen de notas, ecuaciones o una tabla en Typst editable |
| LaTeX to HTML | Convertir LaTeX en HTML independiente con ecuaciones MathML |
| LaTeX to Image | Renderizar una ecuación y exportar un PNG o SVG |
| LaTeX to Markdown | Convertir un documento LaTeX en Markdown portable |
| LaTeX to Typst | Convertir LaTeX en código fuente Typst que puedes copiar, guardar o abrir como proyecto |
| LaTeX to Word | Crear un documento Word con ecuaciones guardadas como matemáticas nativas de Word |
| Markdown to LaTeX | Convertir notas Markdown en un documento LaTeX independiente |
| Markdown to Typst | Convertir notas Markdown en código fuente Typst |
| Mermaid to LaTeX | Convertir un diagrama de flujo Mermaid en código TikZ editable |
| PDF to Markdown | Extraer la capa de texto, las ecuaciones y las figuras de un PDF a Markdown |
| PDF to Typst | Extraer la capa de texto, las ecuaciones y las figuras de un PDF a Typst |
| Table to LaTeX | Crear una tabla LaTeX en un editor visual de filas y columnas |
| Typst Editor | Iniciar un proyecto Typst con edición del código fuente, vista previa en directo y exportación PDF |
| Visual Typst Editor | Iniciar un documento Typst en el editor del proyecto con vista previa en directo |
| Typst to LaTeX | Convertir el marcado Typst en LaTeX para revistas y envíos |
| arXiv to Typst | Convertir un paquete de código fuente de arXiv a Typst, con una comprobación de compilación que indica lo que no se convirtió |
| CSV to Typst | Pegar filas CSV o TSV y obtener una tabla Typst con caracteres escapados |
| Equation to Typst | Convertir matemáticas LaTeX escritas o una imagen de una ecuación en matemáticas de Typst |
| Excel to Typst | Convertir una hoja de Excel, CSV o TSV en una tabla Typst con caracteres escapados |
| HTML to Typst | Convertir HTML pegado en un documento Typst independiente |
| Mermaid to Typst | Convertir un diagrama de flujo Mermaid en código fletcher editable |
| Typst to HTML | Convertir el marcado Typst en HTML independiente con ecuaciones MathML |
| Typst to Markdown | Convertir el marcado Typst en Markdown portable |
| Typst to Word | Crear un documento Word con ecuaciones guardadas como matemáticas nativas de Word |
| Word to Typst | Convertir un documento Word en Typst y mantener juntos los recursos multimedia extraídos |
| Word to LaTeX | Convertir un documento Word en LaTeX y mantener juntos los recursos multimedia extraídos |

#### Matemáticas, tablas, escritura y validación

| Herramienta | Úsala para |
| --- | --- |
| BibTeX Validator | Comprobar archivos `.bib` en busca de errores de sintaxis, campos obligatorios ausentes y claves duplicadas |
| Statistics Calculators | Calcular valores p, tamaños de muestra e intervalos de confianza en local |
| Writing Generators | Preparar un resumen, una síntesis, una paráfrasis o un esquema de tesis a partir del documento abierto con el asistente |
| Symbol Reference | Consultar símbolos LaTeX e insertar uno en el cursor, o su nombre Typst en un archivo Typst |

#### Literatura, referencias e investigación

| Herramienta | Úsala para |
| --- | --- |
| Find Citations | Buscar en índices académicos, analizar un borrador para detectar soporte ausente y exportar BibTeX |
| arXiv Citation Generator | Buscar un artículo de arXiv y dar formato a su cita en ocho estilos |
| Bibliography Generator | Crear, validar, ordenar y exportar una bibliografía a partir de datos estructurados o BibTeX |
| Citation Generator | Convertir los datos de un artículo o un identificador académico en una cita formateada y BibTeX |
| Citation Generators by Style | Comparar una referencia en APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA y ACS |
| DOI to BibTeX | Recuperar el registro de un DOI, revisar sus campos y exportar BibTeX |
| ISBN to BibTeX | Recuperar metadatos de un libro a partir de un ISBN, corregirlos y exportar BibTeX |
| PubMed to BibTeX | Recuperar un registro de PubMed desde su PMID, revisarlo y exportar BibTeX |
| URL to BibTeX | Reconocer enlaces DOI, arXiv y PubMed o crear una cita editable de una página web |
| Lab Search | Encontrar instituciones de investigación mediante el directorio de OpenAlex |
| Conference Deadlines | Filtrar fechas límite de conferencias, la mayoría de informática, y ver cuentas atrás |

</details>

<details>
<summary>Las 39 skills de investigación incluidas con Oleafly</summary>

Las skills son carpetas `SKILL.md` normales que siguen la estructura de Agent Skills. Ejecuta una con un comando de barra, añade las tuyas o compártelas con agentes CLI compatibles en el mismo ordenador.

El paquete `research-core` incluido contiene 39 skills. Los nombres siguientes son los identificadores que usan el catálogo y los ajustes del proyecto.

| Categoría | Skills |
| --- | --- |
| Investigación y literatura | `citation-management`, `exploratory-data-analysis`, `hypothesis-generation`, `literature-review`, `oleafly-experiment-loop`, `oleafly-literature-sweep`, `oleafly-research-loop`, `openresearch`, `paper-lookup`, `research-lookup`, `scientific-brainstorming`, `scientific-critical-thinking` |
| Autoría y análisis de manuscritos | `experimental-design`, `oleafly-data-analysis`, `oleafly-manuscript-scaffold`, `oleafly-related-work`, `scientific-writing`, `statistical-analysis`, `statistical-power`, `venue-templates` |
| Figuras y visualización | `oleafly-figure-prep`, `scientific-schematics`, `scientific-visualization` |
| Revisión y evidencias | `oleafly-response-letter`, `oleafly-review-manuscript`, `oleafly-verify-claims`, `peer-review`, `scholar-evaluation` |
| Envío | `oleafly-pre-submission` |
| Comunicación | `oleafly-slides-and-posters`, `pptx-posters`, `research-grants`, `scientific-slides` |
| Herramientas y automatización | `desktop-apps`, `import-refine`, `oleafly-cli`, `oleafly-latex-build`, `pdf-to-latex`, `template-generate` |

</details>

<details>
<summary>Detalles del editor</summary>

- Una paleta de 236 símbolos LaTeX en la que puedes buscar, que inserta los nombres de Typst en los archivos Typst.
- Un carril de esquema en el borde derecho del editor marca cada título y la sección que estás leyendo. Ábrelo para ver los números de sección y la página del PDF de cada título según la última compilación.
- Visores para los demás archivos de un proyecto: un PDF con la barra de vista previa completa, imágenes con zoom, hojas de CSV y Excel como una tabla ordenable, una lista con búsqueda para los archivos `.bib` y una vista previa en directo para HTML.
- Las presentaciones escritas en TSX se previsualizan mientras escribes y se presentan como un PDF. Un archivo llamado `something.excalidraw` se abre como una pizarra en la que puedes dibujar.
- Haz doble clic en un archivo `.tex`, `.typ` o `.md` en tu gestor de archivos y se abre en Oleafly.
- Combinaciones de teclas de Vim y Emacs, pestañas para varios archivos, plegado de código, buscar y reemplazar en todo el proyecto, y recuento de palabras.
- Cambia el nombre de un archivo o muévelo, y Oleafly actualiza las rutas que apuntan a él.
- Temas para el modo claro y el oscuro, cualquier fuente instalada, colores de sintaxis editables y modo Zen.
- Los iconos de archivo se colorean según el tipo de archivo. Cambia a insignias de tipo cortas como TEX o PDF en Ajustes > Apariencia > Proyecto.
- La interfaz está disponible en 22 idiomas.
- Paleta de comandos con Cmd+K (Ctrl+K), y un único cuadro de búsqueda para proyectos, documentos, ajustes y herramientas con Cmd+Shift+F (Ctrl+Shift+F).

</details>

## Primeros pasos

1. [Descarga Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) para tu ordenador.
2. Crea un proyecto a partir de una plantilla, importa uno o abre una carpeta que ya tengas.
3. Pulsa Cmd+Enter (Ctrl+Enter en Windows y Linux) para compilar.
4. Para escribir con otras personas, haz clic en **Compartir** y envía el proyecto al Oleafly Server de tu laboratorio.

| Plataforma | Paquete | Descarga |
| --- | --- | --- |
| macOS · Apple Silicon | DMG | [![Descargar para macOS (Apple Silicon)](../assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| macOS · Intel | DMG (`x64`) | [![Descargar para macOS (Intel)](../assets/readme/download-glass-macos-intel.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | MSI o EXE | [![Descargar para Windows](../assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 | AppImage, DEB o RPM | [![Descargar para Linux (x86_64)](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · ARM64 | AppImage, DEB o RPM | [![Descargar para Linux (ARM64)](../assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |

Los paquetes de Linux necesitan glibc 2.35 o una versión posterior (Ubuntu 22.04, Debian 12 o posterior). Las versiones incluyen artefactos de actualización firmados, y el actualizador integrado comprueba la firma antes de instalar nada.

## Preguntas frecuentes

<details>
<summary>¿Necesito una cuenta?</summary>

No necesitas una cuenta de Oleafly. Puedes escribir, compilar y usar Git sin iniciar sesión en nada. Para la colaboración en directo inicias sesión en el servidor de tu laboratorio con GitHub o con el inicio de sesión de tu universidad, y la sincronización en la nube inicia sesión en tu almacenamiento en la nube.

</details>

<details>
<summary>¿Funciona sin conexión?</summary>

Sí. La escritura, la compilación, el PDF, la corrección, Preflight, Git y Checkpoints funcionan en tu ordenador. LaTeX compila sin conexión cuando el motor incluido ya tiene los paquetes que necesita, y Typst cuando sus paquetes están en caché. Los proyectos compartidos conservan tus ediciones y las fusionan cuando vuelves a conectarte.

</details>

<details>
<summary>¿Qué pasa por la red?</summary>

Solo lo que pides: compartir con tu servidor, la sincronización en la nube, un servicio de LaTeX en línea desde el que importas o editas en directo, las búsquedas de literatura y DOI, tu host de Git, los proveedores de IA alojados, los servidores MCP que conectes y las descargas opcionales de motores, paquetes y plantillas. Las versiones publicadas también comprueban si hay una actualización cuando se inicia la aplicación. Un modelo local mantiene el tráfico de la IA en tu ordenador.

</details>

<details>
<summary>¿Puede mi universidad o empresa alojar el servidor?</summary>

Sí, esa es la idea. Oleafly Server se ejecuta en tu propia máquina o cuenta en la nube, permite iniciar sesión mediante GitHub o cualquier proveedor de OpenID Connect y guarda los archivos en el disco o en un almacenamiento compatible con S3. La [guía del servidor](https://github.com/Oleafly/oleafly-server) cubre la instalación, las copias de seguridad y los roles.

</details>

## Más información

- [Guías del producto](https://oleafly.com/docs/)
- [Oleafly Server](https://github.com/Oleafly/oleafly-server)
- [Mapa de funciones](../features.md)
- [Guía del editor](../Editor.md)
- [Vista previa del PDF](../PDFPreview.md)
- [Citas y literatura](../Citations.md)
- [Galería de herramientas](../Tools.md)
- [Preflight y comprobaciones de accesibilidad](../Preflight.md)
- [Plantillas](../Templates.md)
- [Diagram Composer](../DiagramComposer.md)
- [Git y control del código fuente](../SourceControl.md)
- [Checkpoints](../Checkpoints.md)
- [AI Copilot](../AICopilot.md)
- [Skills](../Skills.md)
- [Integración con MCP](../mcp.md)
- [Herramienta de línea de comandos](../cli.md)
- [Configuración de desarrollo](../development.md)
- [Registro de cambios](../../CHANGELOG.md)

## Comunidad y asistencia

Gracias a todos los que enviaron un pull request, y a las personas cuyas incidencias dieron forma a más versiones.

<p>
<a href="https://github.com/palmtenor" title="Teng Qin (palmtenor)"><img src="../assets/readme/contributors/palmtenor.svg" width="44" height="44" alt="palmtenor" /></a>
<a href="https://github.com/wahidmounir" title="wahidmounir"><img src="../assets/readme/contributors/wahidmounir.svg" width="44" height="44" alt="wahidmounir" /></a>
<a href="https://github.com/Jianxinnn" title="Jianx (Jianxinnn)"><img src="../assets/readme/contributors/Jianxinnn.svg" width="44" height="44" alt="Jianxinnn" /></a>
<a href="https://github.com/multics" title="Not AI (multics)"><img src="../assets/readme/contributors/multics.svg" width="44" height="44" alt="multics" /></a>
<a href="https://github.com/um1chc5" title="Vũ Vương An (um1chc5)"><img src="../assets/readme/contributors/um1chc5.svg" width="44" height="44" alt="um1chc5" /></a>
<a href="https://github.com/a-green-hand-jack" title="Jack Wu (a-green-hand-jack)"><img src="../assets/readme/contributors/a-green-hand-jack.svg" width="44" height="44" alt="a-green-hand-jack" /></a>
<a href="https://github.com/DEENUU1" title="Kacper Włodarczyk (DEENUU1)"><img src="../assets/readme/contributors/DEENUU1.svg" width="44" height="44" alt="DEENUU1" /></a>
<a href="https://github.com/mvanhorn" title="Matt Van Horn (mvanhorn)"><img src="../assets/readme/contributors/mvanhorn.svg" width="44" height="44" alt="mvanhorn" /></a>
<a href="https://github.com/vincencwolff" title="Alexander Wolff (vincencwolff)"><img src="../assets/readme/contributors/vincencwolff.svg" width="44" height="44" alt="vincencwolff" /></a>
<a href="https://github.com/ssbodda-powern" title="ssbodda-powern"><img src="../assets/readme/contributors/ssbodda-powern.svg" width="44" height="44" alt="ssbodda-powern" /></a>
<a href="https://github.com/Fravoj3" title="Fravoj3"><img src="../assets/readme/contributors/Fravoj3.svg" width="44" height="44" alt="Fravoj3" /></a>
<a href="https://github.com/Entrery901" title="Pavel Entrery (Entrery901)"><img src="../assets/readme/contributors/Entrery901.svg" width="44" height="44" alt="Entrery901" /></a>
<a href="https://github.com/CherryYang05" title="Minyang Bao (CherryYang05)"><img src="../assets/readme/contributors/CherryYang05.svg" width="44" height="44" alt="CherryYang05" /></a>
<a href="https://github.com/MaverickJohn026" title="MaverickJohn026"><img src="../assets/readme/contributors/MaverickJohn026.svg" width="44" height="44" alt="MaverickJohn026" /></a>
<a href="https://github.com/marlondecol" title="Marlon Luís de Col (marlondecol)"><img src="../assets/readme/contributors/marlondecol.svg" width="44" height="44" alt="marlondecol" /></a>
</p>

Únete a la [comunidad de Oleafly en Discord](https://oleafly.com/discord) para hacer preguntas, pedir ayuda con una compilación rebelde, enseñar lo que estás escribiendo y votar qué se construye después. Es gratis y está abierta a todo el mundo. ¿Prefieres GitHub? Informa de errores o solicita funciones en las [incidencias de GitHub](https://github.com/Oleafly/Oleafly/issues).

Oleafly no recopila telemetría, así que nadie sabe quién lo usa hasta que lo dices. ¿Escribes tu tesis o los artículos de tu laboratorio con él? Saluda en [¿Quién usa Oleafly?](https://github.com/Oleafly/Oleafly/discussions/502).

Oleafly está creado por [Prajwal Murthy](https://github.com/prajwal-svm) y sus colaboradores. Las contribuciones al código, las plantillas, la documentación y los comentarios son bienvenidos. Lee la [guía de contribución](../../CONTRIBUTING.md) para participar.

Si usas Oleafly, una [estrella en GitHub](https://github.com/Oleafly/Oleafly) ayuda a que otros investigadores lo encuentren.

## Cita Oleafly

<details>
<summary>Copia la entrada BibTeX</summary>

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S. and {The Oleafly contributors}},
  title   = {Oleafly: a local-first workspace for research writing},
  year    = {2026},
  version = {0.4.13},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

</details>

[Seguridad](../../SECURITY.md) · [Código de conducta](../../CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](../../LICENSE)

## Historial de estrellas

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Gráfico del historial de estrellas" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
