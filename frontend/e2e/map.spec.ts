import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';

/** Context options for a second visitor on the same server (dev server or compose stack). */
const origin = (page: Page) => ({ baseURL: new URL(page.url()).origin });

/** True when nothing covers the middle of the element: what the player can really click. */
async function onTop(locator: Locator): Promise<void> {
  try {
    await expect
      .poll(
        () =>
          locator.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!top && el.contains(top);
          }),
        { timeout: 15_000 }, // a cold dev server can still be laying the page out
      )
      .toBe(true);
  } catch (error) {
    // keep a picture of what covers the element
    await locator
      .page()
      .screenshot({ path: `test-results/on-top-${Date.now()}.png` })
      .catch(() => undefined);
    throw error;
  }
}

/** Opens the profile menu, checks that every entry can be reached, and picks one. */
async function menu(page: Page, item: string): Promise<void> {
  await page.locator('button.who').click();
  for (const entry of await page.getByRole('menuitem').all()) await onTop(entry);
  await page.getByRole('menuitem', { name: item }).click();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  await expect(page.locator('.body')).toHaveClass(/top/);
  await expect
    .poll(async () => (await page.locator('aside').boundingBox())!.width)
    .toBe(page.viewportSize()!.width);
  await page.getByRole('button', { name: 'Menu à gauche' }).click();
  await expect(page.locator('.body')).not.toHaveClass(/top/);
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
  await onTop(page.getByLabel("Lien d'invitation")); // the panel is not hidden under the map
  // a click outside closes the floating panel
  await page.locator('app-map').click({ position: { x: 400, y: 300 } });
  await expect(page.getByLabel("Lien d'invitation")).toHaveCount(0);

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
  await plank().getByRole('button', { name: 'Voir sur la carte' }).click();
  await expect(page.locator('app-workshop')).toBeHidden();
  await expect(page.locator('img.leaflet-marker-icon[src*="unique"]').first()).toBeVisible();

  // the altar: cost and what it opens
  await open();
  await page.getByRole('tab', { name: 'Autel' }).click();
  const altar = page.locator('article', { hasText: 'Autel de test niveau 2' });
  await expect(altar).toContainText('Ouvre le niveau 2');
  await altar.getByText('1 recette(s) ouvertes').click();
  await expect(altar).toContainText('Hache de test');

  await expect(page.locator('fieldset.planner').first()).toContainText('Coût total');

  // items: made by, used in; stations; the table view
  await page.getByRole('tab', { name: 'Objets' }).click();
  await search('planche');
  await page.getByRole('button', { name: 'Planche de test' }).click();
  await expect(page.getByRole('heading', { name: 'Fabriqué par' })).toBeVisible();
  await expect(page.locator('app-entry-card', { hasText: 'Planche de test × 2' })).toBeVisible();
  await expect(page.locator('app-entry-card', { hasText: 'Hache de test' })).toBeVisible(); // used in
  await page.getByRole('button', { name: 'Retour' }).click();
  // armour sets: grouped in one card, the page lists the pieces and how to get them
  await search('tenue');
  await expect(page.locator('.item-grid li')).toHaveCount(1);
  await page.getByRole('button', { name: /Tenue de test/ }).click();
  await expect(page.getByRole('heading', { name: 'Tenue de test' })).toBeVisible();
  await expect(page.locator('app-entry-card', { hasText: 'Casque de test' })).toContainText(
    'Flamme niveau 3',
  );
  await expect(page.getByRole('button', { name: 'Voir sur la carte' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Casque de test' }).first().click(); // a piece, then back to the set
  await expect(page.getByRole('button', { name: /Set : Tenue de test/ })).toBeVisible();
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByRole('heading', { name: 'Tenue de test' })).toBeVisible();
  await page.getByRole('button', { name: 'Retour' }).click();
  await page.getByRole('button', { name: "Regrouper les sets d'armure" }).click(); // ungrouped: the pieces
  await search('casque');
  await expect(page.locator('.item-card', { hasText: 'Casque de test' })).toHaveCount(1);
  await expect(page.locator('.item-card', { hasText: 'Tenue' })).toHaveCount(0);
  await page.getByRole('button', { name: "Regrouper les sets d'armure" }).click();
  await search('');
  await page.getByLabel('Rareté').selectOption('Rare'); // the axe and the set are rare, the plank is not
  await expect(page.locator('.item-grid')).toContainText('Hache de test');
  await expect(page.locator('.item-grid')).not.toContainText('Planche');
  await page.getByLabel('Rareté').selectOption('');
  await page.getByRole('button', { name: /^Armes/ }).click();
  await expect(page.locator('.item-grid li')).toHaveCount(1);
  await page.getByRole('button', { name: /^Tous les objets/ }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('OneHandedAxe');
  await expect(page.locator('.item-grid')).toContainText('Hache de test');
  await page.getByLabel('Type', { exact: true }).selectOption('');
  await page.getByRole('tab', { name: 'Établis' }).click();
  await page.getByRole('button', { name: /Établi de test/ }).click();
  await expect(page.locator('app-entry-card', { hasText: 'Hache de test' })).toBeVisible();
  await page.getByRole('tab', { name: 'Recettes' }).click();
  await page.getByRole('button', { name: 'Tableau' }).click();
  await expect(page.getByRole('row', { name: /Hache de test/ })).toContainText('Établi de test');
  await page.getByRole('button', { name: 'Grille' }).click();

  // building pieces
  await page.getByRole('tab', { name: 'Construction' }).click();
  const cards = page.locator('app-entry-card');
  await expect(cards.filter({ hasText: 'Mur de test' })).toContainText('Planche');
  await expect(cards.filter({ hasText: 'Bloc de test' })).toContainText('Planche');
  await expect(cards.first()).toContainText('Bloc de test'); // by name
  // the groups are the category list (no separate group menu)
  await expect(page.getByLabel('Groupe')).toHaveCount(0);
  await page.getByRole('button', { name: /^Décoration/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Statue de test');
  await page.getByRole('button', { name: /^Blocs/ }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: /^Tous les objets/ }).click();
  await page.getByRole('button', { name: 'Palier', exact: true }).click();
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
  // the tree, and what is already owned stops the breakdown
  const tree = page.locator('section', { hasText: 'Arbre de fabrication' });
  await expect(tree).toContainText('Planche de test');
  await page.getByLabel('Quantité de Planche de test déjà possédée').fill('6');
  await page.getByLabel('Quantité de Planche de test déjà possédée').dispatchEvent('change');
  await expect(raw).toContainText('Bois de test× 2'); // only the category wood is left
  await expect(raw).not.toContainText('Planche de test');
  await page.getByLabel('Quantité de Planche de test déjà possédée').fill('0');
  await page.getByLabel('Quantité de Planche de test déjà possédée').dispatchEvent('change');
  await expect(raw).toContainText('Bois de test× 5');
  await page.getByLabel(/Décomposer/).uncheck();
  await expect(raw).toContainText('Planche de test× 6');
  await page.getByRole('button', { name: 'Vider le projet' }).click();
  await expect(page.getByText('Le projet est vide')).toBeVisible();
});

test('skills: take nodes, budget, save several builds, share link, AXE', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('skills.json')).text()).includes('fixture_skills'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .include('app-skills')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
  const node = (name: RegExp) => page.locator('app-skills g.skill').filter({ hasText: name });
  const side = page.locator('app-skills');
  const points = page.locator('app-skills .points');
  const popup = page.locator('app-skills .popup');
  const builds = () =>
    side.getByRole('button', { name: 'Builds enregistrés', exact: true }).click();
  const open = async () => {
    await page
      .locator('app-topbar')
      .getByRole('button', { name: 'Personnage', exact: true })
      .click();
    await page.getByRole('button', { name: 'Compétences', exact: true }).click();
  };
  await open();
  await expect(points).toContainText(/Disponible\s*6$/);
  expect(await violations(), 'tree').toEqual([]);
  await expect(page.locator('app-skills g.skill image')).toHaveCount(1); // the node the game gives a picture

  // a node is taken from a root or from a node already taken
  await node(/Tir précis/).click();
  await expect(points).toContainText(/Disponible\s*6$/); // locked: nothing next to it
  await expect(popup).toContainText('Verrouillée');
  for (let i = 0; i < 4; i++) await node(/Endurance/).click(); // 3 levels, then no more
  await expect(points).toContainText(/Disponible\s*3$/);
  await expect(node(/Endurance/)).toContainText('3/3');
  await expect(popup).toContainText('30%'); // the value of its level in the text
  await node(/Résistance/).click(); // 2 points
  await expect(points).toContainText(/Disponible\s*1$/);
  await node(/Tir précis/).click(); // 3 points: over the budget
  await expect(points).toContainText(/Disponible\s*1$/);
  await expect(popup).toContainText('Pas assez de points');
  await node(/Isolée/).click(); // linked to nothing
  await expect(points).toContainText(/Disponible\s*1$/);

  // a level comes off with the right click, but not the last one of a node others hang from
  await node(/Endurance/).click({ button: 'right' });
  await expect(points).toContainText(/Disponible\s*2$/);
  await node(/Endurance/).click({ button: 'right' });
  await node(/Endurance/).click({ button: 'right' }); // level 1, Résistance hangs from it
  await expect(points).toContainText(/Disponible\s*3$/);
  await expect(node(/Endurance/)).toContainText('1/3');

  await builds();
  // several builds: save, new, open, delete; they survive a reload
  await side.getByLabel('Nom du build').fill('Mon archer');
  await side.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(side.locator('.builds')).toContainText('Mon archer');
  await side.getByRole('button', { name: 'Nouveau' }).click();
  await expect(points).toContainText(/Disponible\s*6$/);
  await node(/Force/).click();
  await side.getByLabel('Nom du build').fill('Autre');
  await side.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(side.locator('.builds li')).toHaveCount(2);
  await page.reload();
  await open();
  await builds();
  await expect(side.locator('.builds li')).toHaveCount(2);
  await side
    .locator('.builds')
    .getByRole('button', { name: /^Mon archer/ })
    .click();
  await expect(points).toContainText(/Disponible\s*3$/);
  await expect(node(/Endurance/)).toContainText('1/3');
  await side.getByRole('button', { name: 'Supprimer Mon archer' }).click();
  await expect(side.locator('.builds li')).toHaveCount(1);
  await expect(side.locator('.builds')).not.toContainText('Mon archer');
  expect(await violations(), 'builds').toEqual([]);
  await builds();

  // attributes and summary
  await node(/Force/).click();
  await expect(page.locator('app-skills .attrs')).toContainText('Force');
  await page.getByRole('button', { name: 'Résumé', exact: true }).click();
  await expect(side.locator('.sheet')).toContainText('Compétences prises');
  expect(await violations(), 'summary').toEqual([]);

  // a shared link opens a build (index.level in base 36, in the order of skills.json)
  await page.goto('/#build=1.2-2.1');
  await expect(points).toContainText(/Disponible\s*2$/);
  await expect(node(/Endurance/)).toContainText('2/3');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
});

test('build: level, flame, equipment, protection, skills, save and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('gear.json')).text()).includes('fixture_gear'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const build = page.locator('app-build');
  const topbar = page.locator('app-topbar');
  const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
  const openBuild = () => topbar.getByRole('button', { name: 'Personnage', exact: true }).click();
  const setNumber = async (label: string, value: string) => {
    await build.getByLabel(label, { exact: true }).fill(value);
    await build.getByLabel(label, { exact: true }).dispatchEvent('change');
  };
  const wear = async (slot: RegExp, item: RegExp) => {
    await build.getByRole('button', { name: slot }).click(); // a slot of the sheet opens the picker
    const dialog = page.getByRole('dialog');
    await dialog.locator('.item').filter({ hasText: item }).click();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(dialog).toBeHidden();
  };
  await openBuild();
  const sheet = page.locator('app-character-sheet');
  await expect(sheet.locator('.total').first()).toContainText('0'); // nothing worn
  await setNumber('Niveau du personnage', '20');
  await setNumber('Niveau de flamme', '4');
  await setNumber('Niveau de flamme', '999'); // clamped to the fixture's maximum
  await expect(build.getByLabel('Niveau de flamme', { exact: true })).toHaveValue('11');
  await setNumber('Niveau de flamme', '4');
  await expect(build).toContainText('8562'); // XP for the next level at level 20
  await expect(build).toContainText('8 min'); // Shroud time 4 + Flame
  await expect(build).toContainText('augmente vos attributs primaires de 3 chacun');
  await expect(build.locator('dl').filter({ hasText: 'Santé' }).first()).toContainText('+15%'); // ranged: 0.05 x dexterity 3 (Flame)
  await expect(build.locator('dl').filter({ hasText: 'Santé' }).first()).toContainText('250'); // estimated health, nothing worn

  await wear(/Tête/, /Casque d'essai/);
  await expect(sheet.locator('.total').first()).toContainText('24'); // physical armour of the helmet
  await expect(build.locator('dl').filter({ hasText: 'Santé' }).first()).toContainText('290'); // + the helmet's Health line
  await build.getByRole('tab', { name: 'Protection' }).click();
  await expect(build.getByRole('row', { name: /Protection physique/ })).toContainText('24');
  await expect(build.getByRole('row', { name: /\+ Contondant/ })).toContainText('0%'); // base 0 %, no line
  // upgrades from the item's card: a chain, the base armour is counted one level higher per upgrade (0.14 * 188 = 26)
  const head = build.getByRole('button', { name: /^Tête/ });
  await head.hover();
  const card = build.getByRole('group', { name: "Casque d'essai" });
  await expect(card).toContainText('Équipé');
  await expect(card).toContainText('Niveau');
  await card.getByRole('button', { name: /Armure émoussée/ }).click();
  await expect(card.getByRole('button', { name: /Armure émoussée/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card).toContainText('+2 / +2'); // rank 1: base 24 -> 26 on both armours
  const violations = async (include: string) =>
    (
      await new AxeBuilder({ page })
        .include(include)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => v.id);
  expect(await violations('app-build')).toEqual([]);
  await head.focus();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(sheet.locator('.total').first()).toContainText('26');
  await head.click(); // the picker (a dialog on the same screen), also scanned
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await violations('dialog')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(head).toBeFocused();
  // the stat tooltip: total, breakdown, the game's description; reachable by keyboard and scanned
  const health = build.locator('[app-stat-row]').filter({ hasText: 'Santé' }).first();
  await health.locator('dd').focus();
  const tip = health.getByRole('tooltip');
  await expect(tip).toContainText('Équipement');
  await expect(tip).toContainText('Constitution');
  await expect(tip).toContainText('Vous mourez lorsque votre santé atteint zéro');
  expect(await violations('app-build')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(build.getByRole('row', { name: /Protection physique/ })).toContainText('26');
  await expect(build.getByRole('row', { name: /\+ Contondant/ })).toContainText('6');
  await wear(/Arme 1/, /Épée d'essai/);
  await expect(build.locator('dl.lines')).toContainText("(Épée d'essai)"); // the parry is the weapon in hand's, named like the game
  await expect(build.locator('dl.lines')).toContainText('7');
  await expect(build.getByText('estimation').first()).toBeVisible();

  // rows with a base value from the game: a value instead of a dash, a skill effect adds up (2 levels of 5 %)
  await build.getByRole('tab', { name: 'Dégâts' }).click();
  await expect(build.getByText('Dégâts de coup critique')).toBeVisible();
  await expect(
    build.locator('dl > div').filter({ hasText: 'Dégâts de coup critique' }),
  ).toContainText('+150%');
  await expect(
    build.locator('dl > div').filter({ hasText: 'Chance de coup critique' }).first(),
  ).toContainText('5%');
  await expect(build.locator('dl > div').filter({ hasText: 'À deux mains' })).toContainText('0%');
  expect(await violations('app-build')).toEqual([]);

  // the skill tree and back
  await go('Compétences');
  await expect(page.locator('app-skills g.skill').first()).toBeVisible();
  for (let i = 0; i < 2; i++)
    await page
      .locator('app-skills g.skill')
      .filter({ hasText: /Endurance/ })
      .click();
  await go('Retour au personnage');
  await expect(build.getByLabel('Niveau du personnage', { exact: true })).toHaveValue('20');
  await build.getByRole('tab', { name: 'Dégâts' }).click();
  await expect(build.locator('dl > div').filter({ hasText: 'À deux mains' })).toContainText('+10%');

  // save, reload, new (back to level 1), open the saved build
  await build.getByRole('button', { name: 'Builds enregistrés', exact: true }).click();
  await build.getByLabel('Nom du build').fill('Avec équipement');
  await build.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(build.locator('.builds')).toContainText('Avec équipement');
  await page.reload();
  await openBuild();
  await expect(sheet.locator('.total').first()).toContainText('26'); // the draft, upgrades included
  await build.getByRole('button', { name: 'Builds enregistrés', exact: true }).click();
  await build.getByRole('button', { name: 'Nouveau' }).click();
  await expect(build.getByLabel('Niveau du personnage', { exact: true })).toHaveValue('1');
  await build
    .locator('.builds')
    .getByRole('button', { name: /^Avec équipement/ })
    .click();
  await expect(build.getByLabel('Niveau du personnage', { exact: true })).toHaveValue('20');
  await expect(build.getByLabel('Niveau de flamme', { exact: true })).toHaveValue('4');
  await build.getByRole('tab', { name: 'Protection' }).click();
  await expect(build.getByRole('row', { name: /Protection physique/ })).toContainText('26');
});

test('build: a low-level piece is flagged on its slot and in the recommendations', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('gear.json')).text()).includes('fixture_gear'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const build = page.locator('app-build');
  await page.locator('app-topbar').getByRole('button', { name: 'Personnage', exact: true }).click();
  const panel = page.locator('app-recommendations');
  const setLevel = async (value: string) => {
    await build.getByLabel('Niveau du personnage', { exact: true }).fill(value);
    await build.getByLabel('Niveau du personnage', { exact: true }).dispatchEvent('change');
  };
  await setLevel('20');
  await expect(panel.getByRole('status')).toContainText('Tout est à niveau'); // nothing worn
  await build.getByRole('button', { name: /Tête/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .locator('.item')
    .filter({ hasText: /Casque d'essai/ })
    .click();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();

  // level 10 against 20: 173 / 323, -46 % armour, critical; the badge says it in words and in the label
  await expect(panel.getByRole('status')).toContainText('Niveau très bas');
  await expect(panel.getByRole('status')).toContainText('-46 %');
  await expect(panel.getByRole('status')).toContainText('Toujours trop faible même amélioré');
  await expect(panel.getByRole('status')).toContainText('niveau de base 10 : -46 %');
  await expect(build.getByRole('button', { name: /^Tête.*Niveau très bas/ })).toBeVisible();
  await expect(page.locator('app-gear-slot > .alert').first()).toContainText('-46 %');
  const axe = await new AxeBuilder({ page })
    .include('app-build')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // both upgrades: level 12, still short (-37 %), then a lower character level clears it
  await build.getByRole('button', { name: /^Tête/ }).hover();
  const card = build.getByRole('group', { name: "Casque d'essai" });
  await card.getByRole('button', { name: /Armure ignée/ }).click(); // the chain: takes both
  await expect(panel.getByRole('status')).toContainText('avec améliorations 12 : -37 %');
  await setLevel('13'); // base 10 is still low (base 173 / 218), 12 / 13 is fine
  await expect(panel.getByRole('status')).toContainText('les améliorations compensent');
  await expect(page.locator('app-gear-slot > .alert')).toHaveCount(0); // no badge: the upgraded piece is fine
  await setLevel('11'); // base 10 / 11 = 0.92 and upgraded: nothing left to flag
  await expect(panel.getByRole('status')).toContainText('Tout est à niveau');
});

test('build: a gem and its level on a weapon, shown with the weapon and saved', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(
    async () => (await (await fetch('gems.json')).json()).gems?.length === 2,
  );
  test.skip(!fixture, 'needs the fixture map');

  const build = page.locator('app-build');
  await page.locator('app-topbar').getByRole('button', { name: 'Personnage', exact: true }).click();
  await build.getByRole('button', { name: /Arme 1/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .locator('.item')
    .filter({ hasText: /Épée d'essai/ })
    .click();
  await dialog.getByLabel('Pierre précieuse', { exact: true }).selectOption({
    label: 'Pierre précieuse de saignement',
  });
  const level = dialog.getByLabel('Niveau de la pierre');
  await level.fill('15');
  await level.dispatchEvent('change');
  await expect(dialog.locator('.gempick')).toContainText('Dégâts de coupure par seconde: 14');
  await expect(dialog.locator('.gempick')).toContainText('Durée de debuff: 7.1 s');
  await level.fill('999');
  await level.dispatchEvent('change');
  await expect(level).toHaveValue('105'); // clamped to the gem's range
  await level.fill('15');
  await level.dispatchEvent('change');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();
  await expect(build.getByRole('button', { name: /Arme 1/ })).toHaveAccessibleName(/saignement 15/);

  // the Damage tab: the gem under its weapon, its lines tagged as estimations
  await build.getByRole('tab', { name: 'Dégâts' }).click();
  await expect(build.locator('.gem-row')).toContainText('Pierre précieuse de saignement');
  await expect(
    build.locator('dl > div').filter({ hasText: 'Dégâts de coupure par seconde' }),
  ).toContainText('14');
  await expect(build.locator('dl > div').filter({ hasText: 'Durée de debuff' })).toContainText(
    '7.1 s',
  );

  // saved with the build and back after a reload
  await build.getByRole('button', { name: 'Builds enregistrés', exact: true }).click();
  await build.getByLabel('Nom du build').fill('Avec pierre');
  await build.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(build.locator('.builds')).toContainText('Avec pierre');
  await build.getByRole('button', { name: 'Nouveau' }).click();
  await expect(build.locator('.gem-row')).toHaveCount(0);
  await build
    .locator('.builds')
    .getByRole('button', { name: /^Avec pierre/ })
    .click();
  await build.getByRole('tab', { name: 'Dégâts' }).click();
  await expect(build.locator('.gem-row')).toContainText('15');
});

test('a marker done on the map shows everywhere, and the other way round', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('craft.json')).text()).includes('Recette liée'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const who = page.locator('.who');
  const linked = page.locator('app-entry-card').filter({
    has: page.getByRole('heading', { name: 'Recette liée' }),
  });
  const search = async (text: string) => {
    const box = page.locator('app-workshop').getByRole('searchbox');
    await box.click();
    await box.fill(text);
  };
  const bosses = page.locator('app-enemies .entry').filter({ hasText: 'Cyclope de test' });

  const count = async () => Number(/(\d+) faits/.exec((await who.textContent()) ?? '')![1]);

  // marking the item on the map ... (an earlier test may have marked it: clear it first)
  await page.locator('img.leaflet-marker-icon[src*="unique"]').first().click();
  const action = page.locator('.leaflet-popup .popup-actions button');
  if (!(await action.innerText()).includes('Marquer')) await action.click();
  await expect(action).toContainText('Marquer');
  const base = await count();
  await action.click();
  await expect(who).toContainText(`${base + 1} faits`);

  // ... unlocks the recipe it opens in the workshop, shows on its item page and on the boss
  await page.getByRole('button', { name: 'Atelier', exact: true }).click();
  await search('liée');
  await expect(linked.getByLabel('Débloquée')).toBeChecked();
  await page.getByRole('tab', { name: 'Objets' }).click();
  await search('trésor');
  await page.getByRole('button', { name: 'Carte au trésor' }).click();
  await expect(page.locator('app-workshop')).toContainText('Sur la carte : 1/1 trouvé(s)');
  await page.getByRole('button', { name: 'Ennemis', exact: true }).click();
  await expect(bosses).toContainText('1/1 faits');

  // unticking the recipe unmarks the item on the map; ticking marks it again
  await page.getByRole('button', { name: 'Atelier', exact: true }).click();
  await page.getByRole('tab', { name: 'Recettes' }).click();
  await search('liée');
  await linked.getByLabel('Débloquée').uncheck();
  await expect(who).toContainText(`${base} faits`);
  await expect(linked.getByLabel('Débloquée')).not.toBeChecked();
  await page.getByRole('button', { name: 'Ennemis', exact: true }).click();
  await expect(bosses).toContainText('0/1 faits');
  await page.getByRole('button', { name: 'Atelier', exact: true }).click();
  await linked.getByLabel('Débloquée').check();
  await expect(who).toContainText(`${base + 1} faits`);

  // it is saved: still so after a reload
  await expect(async () => {
    await page.reload();
    await expect(who).toContainText(`${base + 1} faits`, { timeout: 1000 });
  }).toPass();
});

test('enemies: filters, facts, show on the map, AXE', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('enemies.json')).text()).includes('fixture_enemies'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .include('app-enemies')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
  const cards = page.locator('app-enemies .entry');
  await page.getByRole('button', { name: 'Ennemis', exact: true }).click();
  await expect(cards).toHaveCount(2);
  expect(await violations(), 'list').toEqual([]);

  // kind, faction and region filters
  await page.getByRole('button', { name: 'Boss', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Tous', exact: true }).click();
  await page.getByRole('button', { name: /^Creux/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Squelette de test');
  await page.getByRole('button', { name: /^Toutes/ }).click();
  await page.getByRole('button', { name: /^Hautes pâtures/ }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: /^Hautes pâtures/ }).click(); // again: no region filter
  await expect(cards).toHaveCount(2);

  // the facts of one enemy
  await page.getByRole('button', { name: 'Cyclope de test' }).click();
  const facts = page.locator('app-enemies .facts');
  await expect(facts).toContainText('× 8');
  await expect(facts).toContainText('+ 60 %');
  await expect(facts).toContainText('Hautes pâtures');
  await expect(page.locator('app-enemies .portrait')).toBeVisible(); // its picture
  await expect(facts).toContainText('Pic Hurlant'); // the named area near it
  await expect(facts).toContainText('Tête de cyclope de test');
  // the address names it: a reload comes back to its page
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#enemy=test-cyclops');
  await page.reload();
  await expect(page.locator('app-enemies h2')).toHaveText('Cyclope de test');
  expect(await violations(), 'enemy').toEqual([]);

  // show it on the map
  await page.getByRole('button', { name: 'Voir sur la carte' }).click();
  await expect(page.locator('app-enemies')).toBeHidden();
  await expect(page.locator('img.leaflet-marker-icon[src*="unique"]').first()).toBeVisible();
  // its popup shows the picture of its head
  await page.locator('img.leaflet-marker-icon[src*="unique"]').first().click();
  await expect(page.locator('.leaflet-popup img.popup-portrait')).toBeVisible();
});

test('lore: notes found per player, quests, AXE', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('lore.json')).text()).includes('fixture_lore'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .include('app-lore')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
  const who = await page.locator('.who').textContent();
  const search = page.locator('app-lore').getByRole('searchbox');
  const open = () => page.getByRole('button', { name: 'Lore', exact: true }).click();
  await open();
  await expect(page.locator('app-lore .entry')).toHaveCount(2);
  expect(await violations(), 'notes').toEqual([]);

  // search and categories
  await search.click();
  await search.fill('sans région');
  await expect(page.locator('app-lore .entry')).toHaveCount(1);
  await search.fill('');
  await page.getByRole('button', { name: /^Région de test/ }).click();
  await expect(page.locator('app-lore .entry')).toHaveCount(1);
  await page
    .getByRole('button', { name: /^Toutes/ })
    .first()
    .click();

  // a note's pages keep their paragraphs; it is marked found, and remembered
  await page.getByRole('button', { name: 'Note de test' }).click();
  await expect(page.locator('app-lore .note-page p')).toHaveCount(3);
  expect(await violations(), 'note').toEqual([]);
  const side = page.locator('app-lore .side');
  const pages = page.locator('app-lore .note-page');
  await pages.first().getByLabel('Page récupérée').check(); // one page only
  await expect(side).toContainText('1 page(s) récupérée(s) sur 3');
  await expect(side).toContainText('0 trouvée(s) sur 2');
  await page.locator('app-lore header').getByLabel('Trouvée').check(); // the whole note
  await expect(side).toContainText('2 page(s) récupérée(s) sur 3');
  await pages.nth(1).getByLabel('Page récupérée').uncheck(); // the whole mark is split
  await expect(side).toContainText('1 page(s) récupérée(s) sur 3');
  await expect(side).toContainText('0 trouvée(s) sur 2');
  await page.locator('app-lore header').getByLabel('Trouvée').check();
  await expect(page.locator('.who')).toHaveText(who!); // found pages are not marked map elements
  await expect(async () => {
    await page.reload();
    await open();
    await expect(page.locator('app-lore')).toContainText('1 trouvée(s) sur 2', { timeout: 1000 });
  }).toPass();
  await page.getByRole('button', { name: 'À trouver' }).click();
  await expect(page.locator('app-lore .entry')).toHaveCount(1);
  await expect(page.locator('app-lore .entry')).toContainText('Lettre sans région');
  await page.getByRole('button', { name: 'Trouvées' }).click();
  await expect(page.locator('app-lore .entry')).toContainText('Note de test');

  // quests: by giver, steps and rewards
  await page.getByRole('tab', { name: 'Quêtes' }).click();
  await expect(page.locator('app-lore .entry')).toHaveCount(2);
  expect(await violations(), 'quests').toEqual([]);
  const quests = page.locator('app-lore .entry');
  await expect(side).toContainText('0 terminée(s) sur 2');
  await quests.filter({ hasText: 'Quête de test' }).getByLabel('Terminée').check();
  await expect(side).toContainText('1 terminée(s) sur 2');
  await expect(page.locator('.who')).toHaveText(who!); // a finished quest is not a marked map element
  await expect(async () => {
    await page.reload();
    await open();
    await page.getByRole('tab', { name: 'Quêtes' }).click();
    await expect(side).toContainText('1 terminée(s) sur 2', { timeout: 1000 });
  }).toPass();
  const status = page.locator('app-lore .side-pills').first();
  await status.getByRole('button', { name: 'À faire' }).click();
  await expect(quests).toHaveCount(1);
  await expect(quests).toContainText('Quête de région');
  await status.getByRole('button', { name: 'Terminées' }).click();
  await expect(quests).toHaveCount(1);
  await expect(quests).toContainText('Quête de test');
  await status.getByRole('button', { name: 'Toutes' }).click();
  await expect(quests).toHaveCount(2);
  await page.getByRole('button', { name: /^Alchimiste/ }).click();
  await expect(page.locator('app-lore .entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Quête de test' }).click();
  await expect(page.locator('app-lore .note-page')).toHaveCount(2);
  await expect(page.locator('app-lore')).toContainText('Bois de test'); // the reward
  expect(await violations(), 'quest').toEqual([]);
});

test('workshop: every tab passes the AXE checks (WCAG A and AA)', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  await page.getByRole('button', { name: 'Atelier', exact: true }).click();

  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .include('app-workshop')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`);

  for (const tab of ['Recettes', 'Objets', 'Construction', 'Établis', 'Autel', 'Calculateur']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('#ws-panel').locator('h2, article, input, button').first(),
    ).toBeVisible();
    expect(await violations(), tab).toEqual([]);
  }

  // the build screen, its equipment and the skill tree (when the server has gear.json / skills.json)
  const buildButton = page
    .locator('app-topbar')
    .getByRole('button', { name: 'Personnage', exact: true });
  if (await buildButton.count()) {
    const scan = async (include: string, label: string) =>
      (
        await new AxeBuilder({ page })
          .include(include)
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((v) => `${label} ${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
    await buildButton.click();
    const slot = page.locator('app-character-sheet app-gear-slot button').first();
    if (await slot.count()) {
      expect(await scan('app-character-sheet', 'sheet')).toEqual([]);
      for (const tab of ['Bases', 'Dégâts', 'Protection']) {
        await page.getByRole('tab', { name: tab }).click();
        expect(await scan('app-build', `build ${tab}`)).toEqual([]);
      }
      await slot.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await scan('dialog', 'picker')).toEqual([]);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Compétences', exact: true }).click();
    await expect(page.locator('app-skills g.skill').first()).toBeVisible();
    expect(await scan('app-skills', 'skills')).toEqual([]);
  }

  // the enemies (when the server has enemies.json): the list and one enemy
  if (await page.getByRole('button', { name: 'Ennemis', exact: true }).count()) {
    await page.getByRole('button', { name: 'Ennemis', exact: true }).click();
    const enemies = async (name: string) =>
      (
        await new AxeBuilder({ page })
          .include('app-enemies')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((v) => `${name} ${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
    await expect(page.locator('app-enemies .entry').first()).toBeVisible();
    expect(await enemies('enemies')).toEqual([]);
    await page.locator('app-enemies .entry .chip-link').first().click();
    await expect(page.locator('app-enemies .facts')).toBeVisible();
    expect(await enemies('enemy')).toEqual([]);
  }

  // the lore (when the server has lore.json): both tabs, and a note opened
  if (await page.getByRole('button', { name: 'Lore', exact: true }).count()) {
    await page.getByRole('button', { name: 'Lore', exact: true }).click();
    const lore = async (name: string) =>
      (
        await new AxeBuilder({ page })
          .include('app-lore')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((v) => `${name} ${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
    await expect(page.locator('app-lore .entry').first()).toBeVisible();
    expect(await lore('notes')).toEqual([]);
    await page.locator('app-lore .entry .chip-link').first().click();
    await expect(page.locator('app-lore .note-page').first()).toBeVisible();
    expect(await lore('note')).toEqual([]);
    await page.getByRole('tab', { name: 'Quêtes' }).click();
    await expect(page.locator('app-lore .entry').first()).toBeVisible();
    expect(await lore('quests')).toEqual([]);
  }
});

test('browser Back and Forward walk through the views', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const current = page.locator('app-topbar [aria-current="page"]').first();
  await page.getByRole('button', { name: 'Lore', exact: true }).click();
  await expect(current).toHaveText('Lore');
  await page.goBack();
  await expect(current).not.toHaveText('Lore');
  await page.goForward();
  await expect(current).toHaveText('Lore');
});

test('comfort points are kept in the draft and Rested stays unknown', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);

  // comfort: kept in the draft, Rested stays unknown ("—")
  await page.getByRole('button', { name: 'Personnage', exact: true }).click();
  const comfort = page.getByLabel('Points de confort');
  await comfort.fill('120');
  await comfort.blur();
  await page.reload();
  await page.getByRole('button', { name: 'Personnage', exact: true }).click();
  await expect(page.getByLabel('Points de confort')).toHaveValue('120');
  await expect(
    page.locator('app-build div[app-stat-row]').filter({ hasText: 'Durée de Reposé' }),
  ).toContainText('—');
});

test('game: edit, export, import, reload, AXE', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .include('app-game')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`);
  await page.getByRole('button', { name: 'Partie', exact: true }).click();
  const preview = page.getByLabel('Aperçu du fichier enshrouded_server.json');
  await expect(preview).toHaveValue(new RegExp(escapeRe('"name": "Enshrouded Server"')));
  await expect(page.getByLabel('Santé des joueurs', { exact: true })).toBeEnabled();
  expect(await violations(), 'default').toEqual([]);

  await page.getByLabel('Préréglage', { exact: true }).selectOption('Custom');
  const health = page.getByLabel('Santé des joueurs', { exact: true });
  await health.fill('9'); // clamped to 4 like the server
  await health.blur();
  await expect(health).toHaveValue('4');
  await expect(preview).toHaveValue(new RegExp(escapeRe('"playerHealthFactor": 4')));
  await page.getByRole('button', { name: 'Rétablir Santé des joueurs' }).click();
  await expect(preview).toHaveValue(new RegExp(escapeRe('"playerHealthFactor": 1')));
  expect(await violations(), 'custom').toEqual([]);

  await page.getByLabel('Ou collez son contenu').fill(
    JSON.stringify({
      name: 'Imported',
      queryPort: 20000,
      mystery: 1,
      gameSettingsPreset: 'Custom',
      gameSettings: { bossDamageFactor: 3, nope: 1 },
    }),
  );
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page.locator('.gs-report')).toContainText('mystery');
  await expect(page.locator('.gs-report')).toContainText('Dégâts des boss');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(preview).toHaveValue(new RegExp(escapeRe('"queryPort": 20000')));
  await expect(preview).toHaveValue(new RegExp(escapeRe('"bossDamageFactor": 3')));
  await expect(preview).toHaveValue(new RegExp(escapeRe('"name": "Imported"')));
  expect(await violations(), 'imported').toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Partie', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Partie' })
    .getByRole('button', { name: 'Boss' })
    .click();
  await expect(page.getByLabel('Dégâts des boss', { exact: true })).toHaveValue('3');
  await expect(preview).toHaveValue(new RegExp(escapeRe('"name": "Imported"')));
});

test('game: a preset can be changed, a field edit turns it into Custom, reset all goes back to Default', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  await page.getByRole('button', { name: 'Partie', exact: true }).click();
  const preset = page.getByLabel('Préréglage', { exact: true });
  const health = page.getByLabel('Santé des joueurs', { exact: true });
  await preset.selectOption('Hard');
  await expect(preset).toHaveValue('Hard');
  await health.fill('3');
  await health.blur();
  await expect(preset).toHaveValue('Custom');
  await expect(health).toHaveValue('3');
  await page.getByRole('button', { name: 'Rétablir Santé des joueurs' }).click();
  await expect(health).not.toHaveValue('3');
  await health.fill('2');
  await health.blur();
  await page.getByRole('button', { name: 'Tout rétablir' }).click();
  await expect(preset).toHaveValue('Default');
  await expect(health).toHaveValue('1');
});

test('game settings feed the Personnage values and their tooltips', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  const fixture = await page.evaluate(async () =>
    (await (await fetch('gear.json')).text()).includes('fixture_gear'),
  );
  test.skip(!fixture, 'needs the fixture map');

  const build = page.locator('app-build');
  const openBuild = () =>
    page.locator('app-topbar').getByRole('button', { name: 'Personnage', exact: true }).click();
  await openBuild();
  await build.getByLabel('Niveau de flamme', { exact: true }).fill('4');
  await build.getByLabel('Niveau de flamme', { exact: true }).dispatchEvent('change');
  const health = build.locator('[app-stat-row]').filter({ hasText: 'Santé' }).first();
  const shroud = build.locator('[app-stat-row]').filter({ hasText: /Temps dans l[ae] Brume/ });
  await expect(health).toContainText('250'); // 100 + 50 x constitution 3, default world
  await expect(shroud).toContainText('8 min');

  await page.getByRole('button', { name: 'Partie', exact: true }).click();
  const game = page.locator('app-game');
  await game.getByLabel('Préréglage', { exact: true }).selectOption('Custom');
  for (const [label, value] of [
    ['Santé des joueurs', '2'],
    ['Temps dans la Brume', '2'],
  ]) {
    await game.getByLabel(label, { exact: true }).fill(value);
    await game.getByLabel(label, { exact: true }).blur();
  }

  await openBuild();
  await expect(health).toContainText('500'); // round((100 + 150) x 2)
  await expect(shroud).toContainText('16 min'); // (4 + Flame 4) x 2
  await health.locator('dd').hover();
  await expect(health.getByRole('tooltip')).toContainText('Réglage de la partie');
  await expect(health.getByRole('tooltip')).toContainText('×2');
  await shroud.locator('dd').hover();
  await expect(shroud.getByRole('tooltip')).toContainText('Réglage de la partie');
});
