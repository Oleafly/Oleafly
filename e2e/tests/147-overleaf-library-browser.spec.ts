import { expect, test, type Page } from "@playwright/test";
import { harnessCalls, openHarnessPage } from "../harness-page";

const THESIS = "6af963ebc9037022065bb53f";
const INVITED = "6af963ebc9037022065bb5aa";
const SHARED = "6af963ebc9037022065bb5bb";
const INVITE = "6b04e5f6c0ffee0000000001";
const ALICE = "64f1c2a3b4c5d6e7f8091a2b";
const BOB = "64f1c2a3b4c5d6e7f8091a2c";

async function openHarness(page: Page, query: string) {
  await openHarnessPage(page, "overleaf-library-harness", query, { width: 900, height: 760 });
}

async function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __opened: string[] }).__opened]);
}

test("Open live opens an Overleaf project without importing it first", async ({ page }) => {
  await openHarness(page, "view=import");
  await page.getByTestId(`overleaf-open-live-${THESIS}`).click();
  await expect.poll(() => opened(page)).toEqual([`local-${THESIS}`]);
  expect(await harnessCalls(page, "overleaf_open_live")).toEqual([
    { server: "https://www.overleaf.com", account: ALICE, remoteId: THESIS },
  ]);
  expect(await harnessCalls(page, "overleaf_import_projects")).toEqual([]);
  await expect(page.getByTestId(`overleaf-status-${THESIS}`)).toContainText("Imported");
});

test("a project that can't be opened live says why and offers to try again", async ({ page }) => {
  await openHarness(page, "view=import&open=refused");
  await page.getByTestId(`overleaf-open-live-${THESIS}`).click();
  const row = page.getByTestId(`overleaf-status-${THESIS}`);
  await expect(row).toContainText("This project could not be downloaded. You may no longer have access to it.");
  await expect(row.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(await opened(page)).toEqual([]);
  await row.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => harnessCalls(page, "overleaf_open_live")).toHaveLength(2);
});

test("an invitation is joined from the list and then opened live", async ({ page }) => {
  await openHarness(page, "view=import");
  const invites = page.getByTestId("overleaf-invitations");
  await expect(invites.getByTestId(`overleaf-invite-${INVITE}`)).toContainText("Grant proposal");
  await expect(invites).toContainText("From Olivia Park");
  await invites.getByTestId(`overleaf-invite-join-${INVITE}`).click();
  const joined = page.getByTestId(`overleaf-joined-${INVITED}`);
  await expect(joined).toContainText("You joined this project");
  expect(await harnessCalls(page, "overleaf_invite_accept")).toEqual([
    { server: "https://www.overleaf.com", account: ALICE, invite: INVITE },
  ]);
  await expect(page.getByTestId(`overleaf-invite-${INVITE}`)).toHaveCount(0);
  await page.getByTestId(`overleaf-joined-open-live-${INVITED}`).click();
  await expect.poll(() => opened(page)).toEqual([`local-${INVITED}`]);
});

test("a pasted share link says what joining grants before anything is joined", async ({ page }) => {
  await openHarness(page, "view=import");
  const search = page.getByTestId("overleaf-search");
  await search.fill("https://www.overleaf.com/read/qwertyuiopas");
  const card = page.getByTestId("overleaf-link-preview");
  await expect(card.getByTestId("overleaf-link-grants")).toHaveText(
    "Joining lets you view it only. Link viewers get no comments or chat.",
  );
  await expect(card).toContainText("Reading group");
  expect(await harnessCalls(page, "overleaf_link_join")).toEqual([]);

  await search.fill("https://www.overleaf.com/4815162342asdfghjklzxc#a1b2c3");
  await expect(card.getByTestId("overleaf-link-grants")).toHaveText("Joining lets you edit it as a collaborator.");
  await card.getByTestId("overleaf-link-join").click();
  await expect(card.getByTestId("overleaf-link-grants")).toHaveText("You joined this project");
  expect(await harnessCalls(page, "overleaf_link_join")).toEqual([
    {
      server: "https://www.overleaf.com",
      account: ALICE,
      link: "https://www.overleaf.com/4815162342asdfghjklzxc#a1b2c3",
    },
  ]);
  await page.getByTestId(`overleaf-joined-open-live-${SHARED}`).click();
  await expect.poll(() => opened(page)).toEqual([`local-${SHARED}`]);

  await search.fill("https://www.overleaf.com/read/goneprojectx");
  await expect(card.getByRole("alert")).toContainText("This link doesn't open a project anymore.");
});

test("Put on Overleaf uploads a local project under the chosen name and account", async ({ page }) => {
  await openHarness(page, "view=put&accounts=2");
  const dialog = page.getByTestId("put-on-overleaf-dialog");
  await expect(dialog).toContainText("Put on Overleaf");
  const name = dialog.getByTestId("put-on-overleaf-name");
  await expect(name).toHaveValue("Conference paper");
  await name.fill("Camera ready");
  await dialog.getByTestId("put-on-overleaf-account").click();
  await page.getByRole("option", { name: "bob@lab.org" }).click();
  await dialog.getByTestId("put-on-overleaf-submit").click();
  await expect.poll(() => opened(page)).toEqual(["local-paper"]);
  expect(await harnessCalls(page, "overleaf_create_from_local")).toEqual([
    { projectId: "local-paper", server: "https://www.overleaf.com", account: BOB, name: "Camera ready" },
  ]);
});

test("Put on Overleaf shows Overleaf's refusal and keeps the dialog open", async ({ page }) => {
  await openHarness(page, "view=put&create=refused");
  const dialog = page.getByTestId("put-on-overleaf-dialog");
  await dialog.getByTestId("put-on-overleaf-submit").click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Every file in this project is inside one folder, and Overleaf would drop that folder. Move the files up a level first.",
  );
  expect(await opened(page)).toEqual([]);
  await expect(dialog.getByTestId("put-on-overleaf-submit")).toBeEnabled();
});

test("two Overleaf accounts on one server each get a row, a picker and their own sign out", async ({ page }) => {
  await openHarness(page, "view=accounts&accounts=2");
  const rows = page.getByTestId("overleaf-account");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Signed in as alice@uni.edu on www.overleaf.com");
  await expect(rows.nth(1)).toContainText("Signed in as bob@lab.org on www.overleaf.com");
  const picker = page.getByTestId("overleaf-account-picker-trigger");
  await expect(picker).toHaveText("alice@uni.edu");
  await picker.click();
  await page.getByRole("option", { name: "bob@lab.org" }).click();
  await expect.poll(() => harnessCalls(page, "overleaf_use_account")).toEqual([
    { server: "https://www.overleaf.com", account: BOB },
  ]);
  await expect(picker).toHaveText("bob@lab.org");
  await rows.nth(0).getByTestId("overleaf-settings-sign-out").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("bob@lab.org");
  expect(await harnessCalls(page, "overleaf_sign_out")).toEqual([
    { server: "https://www.overleaf.com", account: ALICE, keepLocalCopy: false },
  ]);
  await expect(page.getByTestId("overleaf-account-picker-trigger")).toHaveCount(0);
});
