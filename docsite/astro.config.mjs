// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Project site served from https://prajwal-svm.github.io/OpenLeaf/.
export default defineConfig({
  site: "https://prajwal-svm.github.io",
  base: "/Oleafly",
  integrations: [
    starlight({
      title: "Oleafly",
      description:
        "Free, local-first LaTeX and resume editor for macOS, Windows, and Linux. An offline Overleaf alternative with Git, GitHub sync, SyncTeX, and bring-your-own-key AI.",
      logo: { src: "./src/assets/icon.png", alt: "Oleafly" },
      favicon: "/favicon.png",
      customCss: ["./src/styles/theme.css", "./src/styles/landing.css"],
      // Swap Starlight's light/dark/auto <select> for a light/dark toggle button.
      components: { ThemeSelect: "./src/components/ThemeToggle.astro" },
      // Inter (body/UI) + Fira Code (code), the Mintlify pairing.
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap",
          },
        },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/prajwal-svm/OpenLeaf" },
      ],
      // Product docs: no "Edit this page" link (that's a contributor affordance).
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "overview" },
            { label: "Philosophy", slug: "philosophy" },
            { label: "Why Oleafly", slug: "why-oleafly" },
            { label: "Download & install", slug: "install" },
            { label: "Getting started", slug: "getting-started" },
          ],
        },
        {
          label: "Projects & library",
          items: [
            { label: "The library", slug: "library" },
            { label: "Templates", slug: "templates" },
            { label: "Files & folders", slug: "files" },
            { label: "Where your data lives", slug: "where-your-data-lives" },
          ],
        },
        {
          label: "Writing",
          items: [
            { label: "The editor", slug: "editor" },
            { label: "Autocomplete & slash commands", slug: "autocomplete" },
            { label: "Code intelligence", slug: "code-intelligence" },
            { label: "Spelling & grammar", slug: "spellcheck-grammar" },
            { label: "Citations & bibliography", slug: "citations" },
            { label: "Figures & diagrams", slug: "figures-diagrams" },
            { label: "Keyboard shortcuts", slug: "keyboard-shortcuts" },
          ],
        },
        {
          label: "Compile & preview",
          items: [
            { label: "Compiling", slug: "compiling" },
            { label: "PDF preview", slug: "pdf-preview" },
            { label: "SyncTeX", slug: "synctex" },
            { label: "LaTeX engines & packages", slug: "latex-engines" },
          ],
        },
        {
          label: "Check & export",
          items: [
            { label: "Preflight: ATS & accessibility", slug: "preflight" },
            { label: "Export formats", slug: "export" },
          ],
        },
        {
          label: "AI assistant",
          items: [
            { label: "Set up AI", slug: "ai-setup" },
            { label: "Chat & tools", slug: "ai-chat" },
            { label: "Inline AI edits", slug: "ai-inline-edit" },
            { label: "Draw figures with AI", slug: "ai-figures" },
            { label: "Connect via MCP", slug: "mcp" },
          ],
        },
        {
          label: "History & sync",
          items: [
            { label: "Git history & source control", slug: "git-history" },
            { label: "GitHub sync", slug: "github-sync" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Settings reference", slug: "settings" },
            { label: "Updates", slug: "updates" },
          ],
        },
        {
          label: "Help",
          items: [{ label: "FAQ", slug: "faq" }],
        },
        {
          label: "Engineering",
          collapsed: true,
          items: [
            { label: "Contributing", slug: "engineering/contributing" },
            { label: "Architecture", slug: "engineering/architecture" },
            { label: "Development", slug: "engineering/development" },
            { label: "Releasing", slug: "engineering/releasing" },
            { label: "Auto-update internals", slug: "engineering/updates" },
          ],
        },
      ],
    }),
  ],
});
