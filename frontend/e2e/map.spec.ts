import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' }); // the second test needs the account of the first

const user = `e2e${Date.now()}`;
const password = 'correct horse battery';

test('register, mark an element, and find everything again after a reload', async ({ page }) => {
  const violations: string[] = [];
  page.on(
    'console',
    (m) => m.text().includes('Content Security Policy') && violations.push(m.text()),
  );
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Carte Enshrouded');
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();

  // empty database: the first account must be created, the dialog cannot be dismissed
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Créer le premier compte');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toHaveCount(0);
  await dialog.getByLabel("Nom d'utilisateur").fill(user);
  await dialog.getByLabel('Mot de passe').fill(password);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.locator('.who')).toContainText(user);

  // language switch
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Enshrouded map');

  // only bosses on the map (saved in the profile)
  await page.getByRole('button', { name: 'None', exact: true }).click();
  const boss = page.locator('app-category-card', { hasText: 'Boss' }).first();
  await boss.locator('.toggle').click();
  await expect(boss.locator('.toggle')).toHaveAttribute('aria-pressed', 'true');

  // mark the first visible boss from its popup
  await page.locator('.leaflet-marker-icon').first().click({ force: true });
  await page.getByRole('button', { name: /Mark as done/ }).click();
  await expect(page.getByRole('button', { name: 'Unmark' })).toBeVisible();
  await expect(boss.locator('.count').first()).toHaveText(/^1\//);

  // let the debounced filter save go out, then reload
  await page.waitForResponse(
    (r) => r.url().includes('/api/v1/settings') && r.request().method() === 'PUT',
  );
  await page.reload();
  await expect(page.locator('.who')).toContainText(`${user} · 1`);
  await expect(
    page.locator('app-category-card', { hasText: 'Boss' }).first().locator('.toggle'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('app-category-card', { hasText: 'Chest' }).first().locator('.toggle'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('h1')).toHaveText('Enshrouded map'); // language remembered

  // log out: back to the defaults
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('an account can only be created from a single-use invitation link', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  await page.getByRole('button', { name: 'Inviter' }).click();
  const link = await page.getByLabel("Lien d'invitation").inputValue();
  await expect(page.getByText(/Lien à usage unique, valable jusqu'à/)).toBeVisible();

  // someone else opens the link
  const guest = await browser.newPage({ baseURL: 'http://127.0.0.1:4200' });
  await guest.goto(link);
  const dialog = guest.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Créer votre compte');
  expect(guest.url()).not.toContain('invite'); // the token is removed from the address bar
  await dialog.getByLabel("Nom d'utilisateur").fill('guest');
  await dialog.getByLabel('Mot de passe').fill(password);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(guest.locator('.who')).toContainText('guest');

  // the link is spent
  const late = await browser.newPage({ baseURL: 'http://127.0.0.1:4200' });
  await late.goto(link);
  await expect(late.getByRole('alert')).toContainText('invalide, expiré ou déjà utilisé');
  await expect(late.getByRole('dialog')).toHaveCount(0);
});
