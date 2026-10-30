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

  // the colour legend can be folded, and stays folded after a reload
  const legend = page.getByRole('button', { name: /Légende|Legend/ });
  await expect(legend).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('app-progress-legend li')).toHaveCount(1); // no team: green only
  await legend.click();
  await expect(legend).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: /Légende|Legend/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: /Légende|Legend/ }).click();
  await expect(page.getByRole('button', { name: /Légende|Legend/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

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
  await account.getByRole('button', { name: 'Fermer' }).last().click();
  await menu(page, 'Administration');
  const tools = page.getByRole('dialog');
  await tools.getByRole('button', { name: 'Générer le lien' }).click();
  const link = await tools.getByLabel('Lien de réinitialisation').inputValue();
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

  // the owner already marked a boss in the first test: guest sees an orange halo (others only) and the owner's name
  const guest = await browser.newPage(origin(page));
  await guest.goto('/');
  await guest.getByLabel("Nom d'utilisateur").fill('guest');
  await guest.getByLabel('Mot de passe', { exact: true }).fill('guest new passphrase');
  await guest.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(guest.locator('.who')).toContainText('guest');
  await guest.getByRole('button', { name: 'Rien', exact: true }).click();
  await guest.locator('app-category-card', { hasText: /Boss/ }).first().locator('.toggle').click();
  const orange = guest.locator('.leaflet-marker-icon.halo-others').first();
  await expect(orange).toBeVisible();
  await orange.click({ force: true });
  await expect(guest.locator('.popup-team')).toContainText(user);

  // the owner, who marked it alone, sees it blue
  await page.reload();
  await expect(page.locator('.leaflet-marker-icon.halo-alone').first()).toBeVisible();

  // once the guest marks it too, everyone has: green for both
  await guest.getByRole('button', { name: /Marquer comme fait/ }).click();
  await expect(guest.locator('.leaflet-marker-icon.halo-all').first()).toBeVisible();
  await expect(guest.locator('.popup-team')).toContainText(`guest, ${user}`);
  await page.reload();
  await expect(page.locator('.leaflet-marker-icon.halo-all').first()).toBeVisible();

  // the owner hands the team to guest (after a confirmation), who can now rename it; guest hands it back
  await menu(page, 'Équipe');
  const mine = page.getByRole('dialog');
  page.once('dialog', (d) => void d.dismiss());
  await mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }).click();
  await expect(mine.getByRole('button', { name: 'Renommer' })).toBeVisible(); // refused: still owner
  page.once('dialog', (d) => void d.accept());
  await mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }).click();
  await expect(mine.getByRole('button', { name: 'Renommer' })).toHaveCount(0);
  await expect(mine.getByRole('button', { name: "Dissoudre l'équipe" })).toHaveCount(0);

  await guest.reload();
  await menu(guest, 'Équipe');
  const theirs = guest.getByRole('dialog');
  await expect(theirs.getByRole('button', { name: 'Renommer' })).toBeVisible();
  guest.once('dialog', (d) => void d.accept());
  await theirs.getByRole('button', { name: `Transférer le rôle de créateur à ${user}` }).click();
  await expect(theirs.getByRole('button', { name: 'Renommer' })).toHaveCount(0);
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
  // one button for the whole stack, at the bottom of the popup
  await expect(page.locator('.popup-row').getByRole('button')).toHaveCount(0);
  await page
    .locator('.popup-actions')
    .getByRole('button', { name: 'Tout marquer comme fait' })
    .click();
  await expect(page.locator('.popup-actions').getByRole('button')).toHaveText(
    'Retirer toutes les marques',
  );
  await expect(page.locator('.popup-state', { hasText: '✓' })).toHaveCount(2);
});

test('passkeys: add one from the profile menu, sign in with it, delete it', async ({ page }) => {
  // a software authenticator that remembers the passkey and always passes the user check
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const me = await page.evaluate(async () => (await fetch('api/v1/auth/me')).json());
  test.skip(!me.passkeys_enabled, 'the server has no WEBAUTHN_RP_ID');

  await menu(page, 'Passkeys');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Aucune passkey enregistrée.');
  await dialog.getByLabel('Nom de la passkey').fill('Mon test');
  await dialog.getByRole('button', { name: 'Ajouter une passkey' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Passkey ajoutée.');
  await expect(dialog.getByRole('listitem')).toContainText('Mon test');
  await dialog.getByRole('button', { name: 'Fermer' }).first().click();

  // signed out, the login screen offers the passkey: no user name or password to type
  await menu(page, 'Déconnexion');
  await page.getByRole('button', { name: /Utiliser une passkey/ }).click();
  await expect(page.locator('.who')).toContainText(user);

  // delete it (the browser asks first), the password still works
  await menu(page, 'Passkeys');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('dialog')).toContainText('Aucune passkey enregistrée.');
});

test('landmarks (fast travel, start) are bigger and stay bright when marked', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('map-data.json')).text()).includes('fixture_tower'),
  );
  test.skip(!fixture, 'needs the fixture map');

  await page.getByRole('button', { name: 'Tout', exact: true }).click(); // this profile shows only bosses
  const tower = page.locator('img.leaflet-marker-icon[src*="tower"]');
  const boss = page.locator('img.leaflet-marker-icon[src*="boss"]').first();
  await expect(tower).toBeVisible();
  const size = async (icon: typeof tower) => (await icon.boundingBox())!.width;
  expect(await size(tower)).toBeGreaterThan(await size(boss));

  await tower.click({ force: true });
  await page.getByRole('button', { name: /Marquer comme fait/ }).click();
  await expect(page.getByRole('button', { name: 'Retirer la marque' })).toBeVisible();
  await expect(tower).not.toHaveClass(/done/); // a marked ordinary icon fades, this one does not
  await expect(tower).toHaveClass(/halo-alone/); // its halo still says it is marked (only me in the team)
});

test('the administrator can delete another account', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);

  // a throwaway player joins through an invitation
  await menu(page, 'Inviter');
  const link = await page.getByLabel("Lien d'invitation").inputValue();
  const temp = await browser.newPage(origin(page));
  await temp.goto(link);
  const dialog = temp.getByRole('dialog');
  await dialog.getByLabel("Nom d'utilisateur").fill('temp');
  await dialog.getByLabel('Mot de passe', { exact: true }).fill(password);
  await dialog.getByLabel('Confirmation').fill(password);
  await dialog.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(temp.locator('.who')).toContainText('temp');

  // the administrator deletes it, after a confirmation
  await menu(page, 'Administration');
  const admin = page.getByRole('dialog');
  const section = admin.locator('section', { hasText: "Supprimer le compte d'un utilisateur" });
  await section.getByLabel('Utilisateur').selectOption({ label: 'temp' });
  page.once('dialog', (d) => void d.dismiss());
  await section.getByRole('button', { name: 'Supprimer ce compte' }).click();
  await expect(section.locator('option', { hasText: 'temp' })).toHaveCount(1); // refused: still there
  page.once('dialog', (d) => void d.accept());
  await section.getByRole('button', { name: 'Supprimer ce compte' }).click();
  await expect(section.locator('option', { hasText: 'temp' })).toHaveCount(0);

  // its session is gone and it can no longer sign in
  await temp.reload();
  await temp.getByLabel("Nom d'utilisateur").fill('temp');
  await temp.getByRole('dialog').getByLabel('Mot de passe', { exact: true }).fill(password);
  await temp.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(temp.getByRole('dialog').getByRole('alert')).toContainText('incorrect');
});

test('workshop: recipes, unlock tick, show on the map, altar, calculator', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // only the CI fixture has this craft.json (see e2e/fixtures/map); the real one is not predictable
  const fixture = await page.evaluate(async () =>
    (await (await fetch('craft.json')).text()).includes('fixture_workshop'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const search = async (text: string) => {
    const box = page.locator('app-workshop').getByRole('searchbox');
    await box.click(); // focus first: a fill on a field that was just drawn can be lost
    await box.fill(text);
  };
  const plank = () =>
    page
      .locator('app-entry-card')
      .filter({ has: page.getByRole('heading', { name: 'Planche de test × 2' }) });
  const open = () => page.getByRole('button', { name: 'Atelier', exact: true }).click();
  await open();
  await search('planche');
  const card = plank();
  await expect(card).toContainText('Établi de test');
  await expect(card).toContainText('Bois de test');
  const who = await page.locator('.who').textContent();
  await card.getByLabel('Débloquée').check();
  await expect(page.locator('.who')).toHaveText(who!); // a known recipe is not a marked map element

  // the tick is saved: still there after a reload
  await expect(async () => {
    await page.reload();
    await open();
    await search('planche');
    await expect(plank().getByLabel('Débloquée')).toBeChecked({ timeout: 1000 });
  }).toPass();

  // "show on the map" goes back to the map and frames the places
  await page
    .locator('app-entry-card', { hasText: 'Planche de test' })
    .getByRole('button', { name: 'Voir sur la carte' })
    .click();
  await expect(page.locator('app-workshop')).toBeHidden();
  await expect(page.locator('img.leaflet-marker-icon[src*="unique"]').first()).toBeVisible();

  // the altar: cost and what it opens
  await open();
  await page.getByRole('tab', { name: 'Autel' }).click();
  const altar = page.locator('article', { hasText: 'Autel de test niveau 2' });
  await expect(altar).toContainText('Ouvre le niveau 2');
  await altar.getByText('1 recette(s) ouvertes').click();
  await expect(altar).toContainText('Hache de test');

  // building pieces
  await page.getByRole('tab', { name: 'Construction' }).click();
  const cards = page.locator('app-entry-card');
  await expect(cards.filter({ hasText: 'Mur de test' })).toContainText('Planche');
  await expect(cards.filter({ hasText: 'Bloc de test' })).toContainText('Planche');
  await expect(cards.first()).toContainText('Bloc de test'); // by name
  await page.getByLabel('Tri', { exact: true }).selectOption('tier');
  await expect(cards.first()).toContainText('Mur de test'); // T1 before T2
  await page.getByLabel('Palier').selectOption('T2');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Bloc de test');

  // the calculator: the axe needs 3 planks (2 crafts of 2 = 2 wood) and 1 wood of the category
  await page.getByRole('tab', { name: 'Calculateur' }).click();
  await search('hache');
  await page.getByRole('button', { name: /Hache de test/ }).click();
  const raw = page.locator('section', { hasText: 'Ressources totales' });
  await expect(raw).toContainText('Bois de test× 3');
  await page.getByLabel('Quantité de Hache de test').fill('2');
  await page.getByLabel('Quantité de Hache de test').dispatchEvent('change');
  await expect(raw).toContainText('Bois de test× 5'); // 6 planks = 3 crafts, plus 2 from the category
  await page.getByLabel(/Décomposer/).uncheck();
  await expect(raw).toContainText('Planche de test× 6');
  await page.getByRole('button', { name: 'Vider le projet' }).click();
  await expect(page.getByText('Le projet est vide')).toBeVisible();
});
