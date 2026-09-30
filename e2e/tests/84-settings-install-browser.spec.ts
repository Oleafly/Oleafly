import { existsSync } from "node:fs";
import { chromium, webkit, expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    const state = {
      installs: 0,
      fail: true,
      packages: ["pgf", "graphics", "tools"],
      calls: [] as { command: string; args: unknown }[],
    };
    const agent = {
      definition: {
        id: "fixture",
        name: "Research CLI",
        version: "1.2.3",
        description: "Test bridge",
        builtin: true,
        distribution: { npx: { package: "research-fixture@1.2.3", args: [] } },
      },
      installed: false,
      managed: false,
      executable: null,
      installedVersion: null,
      platform: "windows-x86_64",
      canInstall: true,
      reason: null,
      authentication: null,
      taskSupported: true,
      taskUnavailableReason: null,
      cli: null,
    };
    // Pi on Windows: the bridge is installed, but the only `pi` on the search
    // path is an npm PowerShell script, so the CLI counts as missing.
    const pi = {
      definition: {
        id: "pi",
        name: "Pi",
        version: "0.0.34",
        description: "Test bridge",
        builtin: true,
        distribution: { npx: { package: "pi-acp@0.0.34", args: [] } },
      },
      installed: true,
      managed: true,
      executable: "C:\\Users\\Ada\\AppData\\Roaming\\Oleafly\\acp\\pi\\pi-acp.cmd",
      installedVersion: "0.0.34",
      platform: "windows-x86_64",
      canInstall: true,
      reason: null,
      signInHint: "Run pi in your terminal and sign in with /login, then reconnect.",
      taskUnavailableReason:
        "Isolated CLI agent tasks are not available on Windows yet. Use the agent in the assistant instead.",
      bridgeSharedWithCli: false,
      programOverride: null as string | null,
      cliRequired: true,
      cli: {
        command: "pi",
        displayName: "Pi",
        path: null as string | null,
        version: null as string | null,
        signInCommand: "pi",
        source: null as string | null,
        rejected: [{ path: "C:\\Users\\Ada\\AppData\\Roaming\\npm\\pi.ps1", reason: "unsupported_script" }],
      },
    };
    Object.assign(window, {
      __settingsInstallTest: state,
      isTauri: true,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          state.calls.push({ command, args });
          if (command === "acp_catalog") return [agent, pi];
          if (command === "acp_pick_agent_program") return "D:\\Tools\\Agents\\Pi\\pi.exe";
          if (command === "acp_check_agent")
            return { ok: true, code: "ready", detail: null, program: args.path, version: "0.81.2", agentName: "pi-acp" };
          if (command === "acp_set_agent_program") {
            const path = args.path as string | null;
            pi.programOverride = path;
            pi.cli = { ...pi.cli, path, version: path ? "0.81.2" : null, source: path ? "override" : null, rejected: [] };
            return pi;
          }
          if (command === "acp_install") {
            state.installs += 1;
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (state.fail) throw "The bridge download was interrupted. Try again.";
            agent.installed = true;
            agent.managed = true;
            return agent;
          }
          if (command === "latex_engine_info")
            return {
              kind: "system",
              lualatex: "/test/lualatex",
              tlmgr: "/test/tlmgr",
              latexmk: "/test/latexmk",
              version: "test",
            };
          if (command === "tlmgr_installed") return state.packages;
          if (command === "tlmgr_search") return [{ name: "classicthesis", description: "A thesis package" }];
          if (command === "tlmgr_install") {
            if (state.fail) throw "TeX Live repository is unreachable. Check your connection.";
            state.packages.push(...(args.packages as string[]));
            return "installed";
          }
          if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
          if (command === "get_ai_config") return { providers: [] };
          if (command === "system_integration_status") return { platform: "other", items: [] };
          if (command === "shell_command_status") return { state: "unsupported" };
          if (command === "tex_distributions") return [];
          if (command.startsWith("plugin:")) return 1;
          return [];
        },
      },
    });
  });
  await page.goto(
    `${process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420"}/e2e/settings-install-harness.html`,
  );
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
}

for (const browserType of [chromium, webkit]) {
  test(`${browserType.name()}: bridge confirmation is clickable above Settings and can retry`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByTestId("settings-section-ai").click();
      await page.getByTestId("ai-settings-tab-agents").click();
      await page.getByTestId("acp-agent-card-fixture").getByRole("button", { expanded: false }).click();
      await page.getByTestId("acp-agent-install-fixture").click();
      const review = page.getByRole("dialog", { name: "Install Research CLI bridge 1.2.3" });
      await expect(review).toBeVisible();
      const install = review.getByRole("button", { name: "Install", exact: true });
      await expect(install).toBeEnabled();

      await expect
        .poll(() =>
          install.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const settings = document.querySelector<HTMLElement>('[aria-label="Settings"][role="dialog"]')!
              .parentElement!;
            const previous = settings.style.pointerEvents;
            settings.style.pointerEvents = "auto";
            const visible = button.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
            );
            settings.style.pointerEvents = previous;
            return visible;
          }),
        )
        .toBe(true);
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        expect(await review.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(review).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByTestId("acp-agent-install-fixture")).toBeFocused();
      await page.getByTestId("acp-agent-install-fixture").click();
      await install.click();
      await expect(review.getByRole("button", { name: "Installing", exact: true })).toBeDisabled();
      await expect(review.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(review).toBeVisible();
      await expect(review.getByRole("alert")).toContainText("download was interrupted");
      await page.evaluate(() => {
        (window as any).__settingsInstallTest.fail = false;
      });
      await install.click();
      await expect(review).toBeHidden();
      await expect(page.getByRole("status")).toContainText("Research CLI is installed");
      expect(await page.evaluate(() => (window as any).__settingsInstallTest.installs)).toBe(2);
    } finally {
      await browser.close();
    }
  });
  test(`${browserType.name()}: a chosen Pi program is tested before it is saved`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByTestId("settings-section-ai").click();
      await page.getByTestId("ai-settings-tab-agents").click();
      const card = page.getByTestId("acp-agent-card-pi");
      await expect(card).toContainText(
        "Found pi.ps1, but PowerShell scripts can't be started. Choose pi.cmd or pi.exe.",
      );
      await expect(card).toContainText("CLI not found");
      await card.getByRole("button", { expanded: false }).click();
      const nextStep = card.getByRole("region", { name: "Next step" });
      await expect(nextStep.locator("p").first()).toHaveText("Install Pi, or choose where it's installed.");
      await expect(nextStep).toContainText("Background tasks: Isolated CLI agent tasks are not available on Windows yet.");
      await expect(card).not.toContainText("PATH");

      await card.getByRole("button", { name: "Choose…" }).click();

      await expect(card.getByRole("status")).toContainText("Pi 0.81.2 started and answered.");
      await expect(card).toContainText("Chosen by you");
      await expect(card).toContainText("D:\\Tools\\Agents\\Pi\\pi.exe");
      await expect(card).toContainText("Ready");
      expect(
        await page.evaluate(() =>
          (window as any).__settingsInstallTest.calls
            .map((call: any) => call.command)
            .filter((command: string) => command.startsWith("acp_") && command !== "acp_catalog"),
        ),
      ).toEqual(["acp_pick_agent_program", "acp_check_agent", "acp_set_agent_program"]);
    } finally {
      await browser.close();
    }
  });
  test(`${browserType.name()}: TeX Live search, installed aliases, failure details and retry`, async () => {
    // Ignored on purpose when that Playwright browser was never downloaded on this runner.
    test.skip(!existsSync(browserType.executablePath()), "Browser executable is not installed");
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
      await setup(page);
      await page.getByTestId("settings-section-engine").click();
      const packages = page.getByRole("region", { name: "LaTeX packages" });
      const query = packages.getByRole("textbox", { name: "Find LaTeX packages" });
      await query.fill("tikz");
      await expect(packages.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(packages).toContainText("Included in pgf");
      await query.fill("classicthesis");
      await packages.getByRole("button", { name: "Search TeX Live" }).click();
      await expect(packages.getByText("classicthesis", { exact: true })).toBeVisible();
      await packages.getByRole("button", { name: "Add", exact: true }).click();
      await expect(packages.getByRole("alert")).toContainText("repository is unreachable");
      await page.evaluate(() => {
        (window as any).__settingsInstallTest.fail = false;
      });
      await packages.getByRole("button", { name: "Add", exact: true }).click();
      await expect(packages.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(packages.getByRole("alert")).toBeHidden();
      expect(
        await page.evaluate(() =>
          (window as any).__settingsInstallTest.calls
            .filter((call: any) => call.command === "tlmgr_install")
            .map((call: any) => call.args.packages),
        ),
      ).toEqual([["classicthesis"], ["classicthesis"]]);
    } finally {
      await browser.close();
    }
  });
}
