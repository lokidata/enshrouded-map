import { type Page, expect, test } from '@playwright/test';

// Real add-on flow against the nginx stack with the example add-on mounted (`make e2e-stack` runs it as a second,
// separate step: it signs in as the first account, which map.spec.ts created with the name in E2E_USER).
test.skip(!process.env['ADDON_STACK'], 'needs the nginx stack, after map.spec.ts');
test.describe.configure({ mode: 'serial' });

const admin = { name: process.env['E2E_USER'] ?? '', password: 'a brand new passphrase' };
const bob = { name: 'bob', password: 'bob very long passphrase' };

async function signIn(page: Page, who: { name: string; password: string }): Promise<void> {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(who.name);
  await page.getByRole('dialog').getByLabel('Mot de passe', { exact: true }).fill(who.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(who.name);
}

const tab = (page: Page) => page.locator('app-topbar').getByRole('button', { name: 'Bonjour' });
const listed = async (page: Page) =>
  (await (await page.request.get('/api/v1/addons')).json()) as unknown[];

test('the add-on files need a session', async ({ page, request }) => {
  expect((await request.get('/addon/hello/main.js')).status()).toBe(401);
  await signIn(page, admin);
  const res = await page.request.get('/addon/hello/main.js');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("customElements.define('addon-hello'");
});

test('the example add-on is listed disabled', async ({ page }) => {
  await signIn(page, admin);
  const res = await page.request.get('/api/v1/addons/admin');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([expect.objectContaining({ id: 'hello', enabled: false })]);
  expect(await listed(page)).toEqual([]);
});

test('enabled, then granted: the player sees the tab only after the grant', async ({
  page,
  browser,
}) => {
  await signIn(page, admin);
  // a new player, from an invitation link (as map.spec.ts does)
  await page.locator('button.who').click();
  await page.getByRole('menuitem', { name: 'Inviter' }).click();
  const link = await page.getByLabel("Lien d'invitation").inputValue();
  await page.keyboard.press('Escape');
  const player = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await player.goto(link);
    const sign = player.getByRole('dialog');
    await sign.getByLabel("Nom d'utilisateur").fill(bob.name);
    await sign.getByLabel('Mot de passe', { exact: true }).fill(bob.password);
    await sign.getByLabel('Confirmation').fill(bob.password);
    await sign.getByRole('button', { name: 'Créer le compte' }).click();
    await expect(player.locator('.who')).toContainText(bob.name);

    await page.locator('button.who').click();
    await page.getByRole('menuitem', { name: 'Administration' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Bonjour' }).click();
    await dialog.getByLabel('Activer cet add-on').check();
    await expect(tab(page)).toBeVisible(); // the administrator is implicit "action"

    // enabled but not granted: nothing for the player
    await player.reload();
    await expect(player.locator('.who')).toContainText(bob.name);
    await expect(tab(player)).toHaveCount(0);
    expect(await listed(player)).toEqual([]);

    await dialog.getByLabel(bob.name).selectOption('read'); // access table: label = username, option value = level
    await expect.poll(async () => (await listed(player)).length).toBe(1);

    await player.reload();
    await tab(player).click();
    await expect(player.locator('[data-addon] addon-hello #state')).toContainText(
      'base=/addon/hello/',
    );
  } finally {
    await player.close();
  }
});
