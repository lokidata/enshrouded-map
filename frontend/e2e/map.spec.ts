import { type Page, expect, test } from '@playwright/test';

/** Context options for a second visitor on the same server (dev server or compose stack). */
const origin = (page: Page) => ({ baseURL: new URL(page.url()).origin });

/** Opens the profile menu and picks an entry. */
async function menu(page: Page, item: string): Promise<void> {
  await page.locator('button.who').click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe.configure({ mode: 'serial' }); // the second test needs the account of the first

const user = `e2e${Date.now()}`;
const password = 'correct horse battery';
const setupToken = process.env['SETUP_TOKEN']!; // set by the Playwright config or by `make e2e-stack`

test('register, mark an element, and find everything again after a reload', async ({ page }) => {
  const violations: string[] = [];
  page.on(
    'console',
    (m) => m.text().includes('Content Security Policy') && violations.push(m.text()),
  );
  await page.goto('/');
  await expect(page.locator('app-map')).toHaveCount(0); // nothing but the dialog without an account

  // empty database: the first account must be created, the dialog cannot be dismissed
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Créer le premier compte');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toHaveCount(0);
  await dialog.getByLabel("Nom d'utilisateur").fill(user);
  await dialog.getByLabel('Mot de passe', { exact: true }).fill(password);
  await dialog.getByLabel('Confirmation').fill(password);
  // a wrong code is refused, the right one is accepted
  await dialog.getByLabel("Code d'installation").fill('wrong');
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(dialog.getByRole('alert')).toContainText("Code d'installation incorrect");
  await dialog.getByLabel("Code d'installation").fill(setupToken);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.locator('.who')).toContainText(user);
  await expect(page.locator('h1')).toHaveText('Carte Enshrouded');
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();

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
  await menu(page, 'Log out');
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Log in');
});

test('an account can only be created from a single-use invitation link', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // the menu goes on top of the map, or back to the left
  await page.getByRole('button', { name: 'Menu en haut' }).click();
  await expect(page.locator('app-root')).toHaveClass(/top/);
  await expect
    .poll(async () => (await page.locator('aside').boundingBox())!.width)
    .toBe(page.viewportSize()!.width);
  await page.getByRole('button', { name: 'Menu à gauche' }).click();
  await expect(page.locator('app-root')).not.toHaveClass(/top/);
  // the left menu can be hidden (the map takes its room) and shown again
  await page.getByRole('button', { name: 'Masquer le menu' }).click();
  await expect(page.locator('aside')).toBeHidden();
  const width = page.viewportSize()!.width;
  await expect.poll(async () => (await page.locator('app-map').boundingBox())!.width).toBe(width);
  await page.getByRole('button', { name: 'Afficher le menu' }).click();
  await expect(page.locator('aside')).toBeVisible();
  await menu(page, 'Inviter');
  const link = await page.getByLabel("Lien d'invitation").inputValue();
  await expect(page.getByText(/Lien à usage unique, valable jusqu'à/)).toBeVisible();

  // someone else opens the link
  const guest = await browser.newPage(origin(page));
  await guest.goto(link);
  const dialog = guest.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Créer votre compte');
  expect(guest.url()).not.toContain('invite'); // the token is removed from the address bar
  await dialog.getByLabel("Nom d'utilisateur").fill('guest');
  await dialog.getByLabel('Mot de passe', { exact: true }).fill(password);
  await dialog.getByLabel('Confirmation').fill(password);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(guest.locator('.who')).toContainText('guest');

  // the link is spent
  const late = await browser.newPage(origin(page));
  await late.goto(link);
  await expect(late.locator('.toast')).toContainText('invalide, expiré ou déjà utilisé');
  await expect(late.getByRole('dialog').getByRole('heading')).toHaveText('Se connecter');
});

test('change my password, show it while typing, and reset someone else’s with a link', async ({
  page,
  browser,
}) => {
  const newPassword = 'a brand new passphrase';
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  const field = page.getByRole('dialog').getByLabel('Mot de passe', { exact: true });
  await field.fill(password);
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);

  // change my own password: the current one is checked
  await menu(page, 'Mot de passe');
  const account = page.getByRole('dialog');
  await account.getByLabel('Mot de passe actuel').fill('not my password');
  await account.getByLabel('Nouveau mot de passe').fill(newPassword);
  await account.getByLabel('Confirmation').fill('something else');
  await account.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(account.getByRole('alert').first()).toContainText('sont différents');
  await account.getByLabel('Confirmation').fill(newPassword);
  await account.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(account.getByRole('alert').first()).toContainText('Mot de passe actuel incorrect');
  await account.getByLabel('Mot de passe actuel').fill(password);
  await account.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(account.getByRole('status')).toContainText('Mot de passe modifié');

  // the first account generates a reset link for "guest" (created by the previous test)
  await account.getByRole('button', { name: 'Générer le lien' }).click();
  const link = await account.getByLabel('Lien de réinitialisation').inputValue();
  expect(link).toContain('#reset=');

  const guest = await browser.newPage(origin(page));
  await guest.goto(link);
  const dialog = guest.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Nouveau mot de passe');
  await expect(dialog).toContainText('Compte : guest');
  expect(guest.url()).not.toContain('reset');
  await dialog.getByLabel('Nouveau mot de passe').fill('guest new passphrase');
  await dialog.getByLabel('Confirmation').fill('guest new passphrase');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(guest.locator('.who')).toContainText('guest');

  // the link is spent
  const late = await browser.newPage(origin(page));
  await late.goto(link);
  await expect(late.locator('.toast')).toContainText('invalide, expiré ou déjà utilisé');
});

test('team: create, add a player, invite a new one, see who marked what', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);

  await menu(page, 'Équipe');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel("Nom de l'équipe").fill('Les Braves');
  await dialog.getByRole('button', { name: "Créer l'équipe" }).click();

  // an existing player is added directly
  await dialog.getByLabel('Ajouter un joueur existant').selectOption({ label: 'guest' });
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(2);

  // the team link creates a new account that lands in the team
  await dialog.getByRole('button', { name: "Créer un lien d'invitation" }).click();
  const link = await dialog.getByRole('textbox', { name: /Lien d'invitation/ }).inputValue();
  const carl = await browser.newPage(origin(page));
  await carl.goto(link);
  await carl.getByLabel("Nom d'utilisateur").fill('carl');
  await carl.getByLabel('Mot de passe', { exact: true }).fill(password);
  await carl.getByRole('dialog').getByLabel('Confirmation').fill(password);
  await carl.getByRole('dialog').getByRole('button', { name: 'Créer le compte' }).click();
  await expect(carl.locator('.who')).toContainText('carl');
  await menu(carl, 'Équipe');
  await expect(carl.getByRole('dialog').getByRole('listitem')).toHaveCount(3);
  await expect(carl.getByRole('button', { name: "Quitter l'équipe" })).toHaveCSS(
    'background-color',
    'rgb(192, 57, 43)',
  );
  // leaving asks for a confirmation: refusing changes nothing
  carl.once('dialog', (d) => void d.dismiss());
  await carl.getByRole('button', { name: "Quitter l'équipe" }).click();
  await expect(carl.getByRole('dialog').getByRole('listitem')).toHaveCount(3);
  carl.once('dialog', (d) => void d.accept());
  await carl.getByRole('button', { name: "Quitter l'équipe" }).click();
  await expect(carl.getByRole('dialog').getByLabel("Nom de l'équipe")).toHaveValue('');

  // carl erases his own account: the warning is shown, the password is asked, the login is gone
  await carl.getByRole('button', { name: 'Fermer' }).first().click(); // the ✕ in the corner
  await menu(carl, 'Supprimer mon compte');
  const del = carl.getByRole('dialog');
  await expect(del).toContainText('toute votre progression');
  await del.getByLabel('Mot de passe actuel').fill('wrong password');
  await del.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(del.getByRole('alert')).toContainText('Mot de passe actuel incorrect');
  await del.getByLabel('Mot de passe actuel').fill(password);
  await del.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(carl.getByRole('dialog').getByRole('heading')).toHaveText('Se connecter');
  await carl.getByLabel("Nom d'utilisateur").fill('carl');
  await carl.getByLabel('Mot de passe', { exact: true }).fill(password);
  await carl.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(carl.getByRole('dialog').getByRole('alert')).toContainText('incorrect');

  // the owner already marked a boss in the first test: guest sees an orange halo and the owner's name
  const guest = await browser.newPage(origin(page));
  await guest.goto('/');
  await guest.getByLabel("Nom d'utilisateur").fill('guest');
  await guest.getByLabel('Mot de passe', { exact: true }).fill('guest new passphrase');
  await guest.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(guest.locator('.who')).toContainText('guest');
  await guest.getByRole('button', { name: 'Rien', exact: true }).click();
  await guest.locator('app-category-card', { hasText: /Boss/ }).first().locator('.toggle').click();
  const orange = guest.locator('.leaflet-marker-icon.halo-some').first();
  await expect(orange).toBeVisible();
  await orange.click({ force: true });
  await expect(guest.locator('.popup-team')).toContainText(user);

  // once the guest marks it too, everyone has: green for both
  await guest.getByRole('button', { name: /Marquer comme fait/ }).click();
  await expect(guest.locator('.leaflet-marker-icon.halo-all').first()).toBeVisible();
  await expect(guest.locator('.popup-team')).toContainText(`guest, ${user}`);
  await page.reload();
  await expect(page.locator('.leaflet-marker-icon.halo-all').first()).toBeVisible();
});

test('loot items in one chest are listed in a single popup', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // only the CI fixture map has this pair (see e2e/fixtures/map); the real map is not predictable
  const fixture = await page.evaluate(async () =>
    (await (await fetch('map-data.json')).text()).includes('Weapon_fixture'),
  );
  test.skip(!fixture, 'needs the fixture map');

  await page.getByRole('button', { name: 'Rien', exact: true }).click();
  await page.locator('app-category-card', { hasText: 'Objet unique' }).locator('.toggle').click();
  await page.locator('app-category-card', { hasText: 'Cosmétique' }).locator('.toggle').click();
  // one icon for the pair, not two
  await expect(page.locator('img.leaflet-marker-icon[src*="cosmetic"]')).toHaveCount(0);
  await expect(page.locator('img.leaflet-marker-icon[src*="unique"]')).toHaveCount(1);
  // the tooltip says "+1" once the filters have been applied to both items
  const icon = page.locator('img.leaflet-marker-icon[src*="unique"]');
  await expect(async () => {
    await page.mouse.move(0, 0);
    await icon.hover({ force: true });
    await expect(page.locator('.leaflet-tooltip', { hasText: '+1' })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.locator('img.leaflet-marker-icon[src*="unique"]').click({ force: true });
  await expect(page.locator('.popup-name')).toHaveText('2 objets ici');
  await expect(page.locator('.popup-row')).toHaveCount(2);
  await expect(page.locator('.popup-row').filter({ hasText: 'Chapeau de test' })).toContainText(
    'Cosmétique',
  );
  await page.locator('.popup-row').first().getByRole('button').click();
  await expect(page.locator('.popup-row').first().getByRole('button')).toHaveText(
    'Retirer la marque',
  );
});
