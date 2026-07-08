// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Project site served from https://prajwal-svm.github.io/OpenLeaf/.
export default defineConfig({
  site: "https://prajwal-svm.github.io",
  base: "/OpenLeaf",
  integrations: [
    starlight({
      title: "OpenLeaf",
      description:
        "Free, local-first LaTeX and resume editor for macOS, Windows, and Linux. An offline Overleaf alternative with Git, GitHub sync, SyncTeX, and bring-your-own-key AI.",
      logo: { src: "./src/assets/leaf.svg", alt: "OpenLeaf" },
      favicon: "/favicon.png",
      customCss: ["./src/styles/theme.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/prajwal-svm/OpenLeaf" },
      ],
      // Product docs: no "Edit this page" link (that's a contributor affordance).
      sidebar: [
        {
          label: "Get started",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Download & install", slug: "install" },
          ],
        },
        {
          label: "Using OpenLeaf",
          items: [
            { label: "Features", slug: "features" },
            { label: "AI assistant", slug: "ai-assistant" },
            { label: "GitHub sync", slug: "github-sync" },
            { label: "Keyboard shortcuts", slug: "keyboard-shortcuts" },
          ],
        },
        {
          label: "Help",
          items: [{ label: "FAQ", slug: "faq" }],
        },
      ],
    }),
  ],
});
