import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  // no ADDON_URL in the test stack: the optional add-on entry must not exist
  await expect(page.getByRole('menuitem', { name: /Serveur de jeu|Game server/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: item }).click();
}

/** Menu layout, chosen in Profile > Personnalisation. */
async function layoutChoice(page: Page, label: string): Promise<void> {
  await menu(page, 'Profil');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Personnalisation' }).click();
  await dialog.getByLabel('Disposition du menu').selectOption({ label });
  await page.keyboard.press('Escape');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The server keeps the sheet of every earlier test: start a Character test from an empty one (logged in). */
async function blankSheet(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
    const list = (await (await fetch('api/v1/characters')).json()) as {
      id: number;
      active: boolean;
    }[];
    const id = (list.find((c) => c.active) ?? list[0]).id;
    const url = `api/v1/characters/${id}/sheet`;
    const { updated_at } = (await (await fetch(url)).json()) as { updated_at: string | null };
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token) },
      body: JSON.stringify({ settings: {}, base: updated_at }),
    });
  });
  await page.reload();
  await expect(page.locator('.who')).toBeVisible();
}

test.describe.configure({ mode: 'serial' }); // the second test needs the account of the first

// The account keeps its language: whatever a test did (even failing half way), the next ones find French.
test.afterEach(async ({ page }) => {
  try {
    if (
      !(await page.locator('.who').count()) ||
      (await page.locator('html').getAttribute('lang')) === 'fr'
    )
      return;
    await page.keyboard.press('Escape');
    await menu(page, 'Profil'); // also matches "Profile"
    await page
      .getByRole('dialog')
      .getByLabel(/Langue|Language|Sprache/)
      .selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    // wait for the debounced save: the next test signs in again and reads the account's language
    await expect
      .poll(() =>
        page.evaluate(async () => (await (await fetch('api/v1/settings')).json()).settings?.lang),
      )
      .toBe('fr');
  } catch {
    // the page is gone or logged out: nothing to restore from here
  }
});

const user = `e2e${Date.now()}`;
const password = 'correct horse battery';
const setupToken = process.env['SETUP_TOKEN']!; // set by the Playwright config or by `make e2e-stack`

test('register, mark an element, and find everything again after a reload @cross', async ({
  page,
}) => {
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
  // the language is chosen while creating the account
  await dialog.getByLabel('Langue').selectOption('en');
  await expect(dialog.getByRole('heading')).toHaveText('Create the first account');
  await dialog.getByLabel('Language').selectOption('fr');
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
  await menu(page, 'Profil');
  await page.getByRole('dialog').getByLabel('Langue').selectOption('en');
  await page.keyboard.press('Escape');
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

  // let the debounced filter save go out (waiting for its response is a race: in a fast browser it is
  // already sent), then reload
  await expect
    .poll(() =>
      page.evaluate(async () =>
        JSON.stringify(
          ((await (await fetch('api/v1/settings')).json()) as { settings?: unknown }).settings,
        ),
      ),
    )
    // only the fast-travel markers differ from the defaults: the bosses are shown by default, so showing them
    // again drops their override; the language chosen above is kept with them
    .toBe('{"filters":{"fastTravel|*":false},"lang":"en"}');
  await page.reload();
  await expect(page.locator('.who')).toContainText(`${user} · 1`);
  await expect(
    page.locator('app-category-card', { hasText: 'Boss' }).first().locator('.toggle'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('app-category-card', { hasText: 'Chest' }).first().locator('.toggle'),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('h1')).toHaveText('Enshrouded map'); // language remembered
  // the account keeps it: back to French so the next tests (same account) find their texts
  await menu(page, 'Profile');
  await page.getByRole('dialog').getByLabel('Language').selectOption('fr');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (await fetch('api/v1/settings')).json()).settings?.lang),
    )
    .toBe('fr');

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
  await menu(page, 'Déconnexion');
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Se connecter');
});

test('an account can only be created from a single-use invitation link @cross', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // the menu goes on top of the map, or back to the left
  await layoutChoice(page, 'Menu en haut');
  await expect(page.locator('.body')).toHaveClass(/top/);
  await expect
    .poll(async () => (await page.locator('aside').boundingBox())!.width)
    .toBe(page.viewportSize()!.width);
  await layoutChoice(page, 'Menu à gauche');
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

test('change my password, show it while typing, and reset someone else’s with a link @cross', async ({
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
  await menu(page, 'Profil');
  const account = page.locator('app-profile');
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

  await page.keyboard.press('Escape');
  // the first account generates a reset link for "guest" (created by the previous test)
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
  await dialog.getByRole('tab', { name: 'Membres' }).click();
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
  await carl.getByRole('dialog').getByRole('tab', { name: 'Membres' }).click();
  await expect(carl.getByRole('dialog').getByRole('listitem')).toHaveCount(3);
  await carl.getByRole('dialog').getByRole('tab', { name: 'Zone dangereuse' }).click();
  await expect(carl.getByRole('button', { name: "Quitter l'équipe" })).toHaveCSS(
    'background-color',
    'rgb(184, 69, 59)',
  );
  // leaving asks for a confirmation: refusing changes nothing
  carl.once('dialog', (d) => void d.dismiss());
  await carl.getByRole('button', { name: "Quitter l'équipe" }).click();
  await expect(carl.getByRole('button', { name: "Quitter l'équipe" })).toBeVisible();
  carl.once('dialog', (d) => void d.accept());
  await carl.getByRole('button', { name: "Quitter l'équipe" }).click();
  await expect(carl.getByRole('dialog').getByLabel("Nom de l'équipe")).toHaveValue('');

  // carl erases his own account: the warning is shown, the password is asked, the login is gone
  await carl.getByRole('button', { name: 'Fermer' }).first().click(); // the ✕ in the corner
  await menu(carl, 'Profil');
  const profile = carl.locator('app-profile');
  await profile.getByRole('tab', { name: 'Zone dangereuse' }).click();
  await expect(profile).toContainText('toute votre progression');
  await profile.getByLabel('Mot de passe actuel').fill('wrong password');
  await profile.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(profile.getByRole('alert')).toContainText('Mot de passe actuel incorrect');
  await profile.getByLabel('Mot de passe actuel').fill(password);
  await profile.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(carl.getByRole('dialog', { name: 'Se connecter' })).toBeVisible();
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
  await mine.getByRole('tab', { name: 'Membres' }).click();
  page.once('dialog', (d) => void d.dismiss());
  await mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }).click();
  await expect(
    mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }),
  ).toBeVisible(); // refused: still owner
  page.once('dialog', (d) => void d.accept());
  await mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }).click();
  await expect(
    mine.getByRole('button', { name: 'Transférer le rôle de créateur à guest' }),
  ).toHaveCount(0);
  await mine.getByRole('tab', { name: 'Équipe', exact: true }).click();
  await expect(mine.getByRole('button', { name: 'Renommer' })).toHaveCount(0);
  await mine.getByRole('tab', { name: 'Zone dangereuse' }).click();
  await expect(mine.getByRole('button', { name: "Dissoudre l'équipe" })).toHaveCount(0);

  await guest.reload();
  await menu(guest, 'Équipe');
  const theirs = guest.getByRole('dialog');
  await expect(theirs.getByRole('button', { name: 'Renommer' })).toBeVisible();
  await theirs.getByRole('tab', { name: 'Membres' }).click();
  guest.once('dialog', (d) => void d.accept());
  await theirs.getByRole('button', { name: `Transférer le rôle de créateur à ${user}` }).click();
  await theirs.getByRole('tab', { name: 'Équipe', exact: true }).click();
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
  // each row shows its item's picture or, failing that, its category icon
  await expect(page.locator('.popup-row img.popup-icon')).toHaveCount(2);
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

  await menu(page, 'Profil');
  await page.getByRole('tab', { name: 'Passkeys' }).click();
  const dialog = page.locator('app-profile');
  await expect(dialog).toContainText('Aucune passkey enregistrée.');
  await dialog.getByLabel('Nom de la passkey').fill('Mon test');
  await dialog.getByRole('button', { name: 'Ajouter une passkey' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Passkey ajoutée.');
  await expect(dialog.getByRole('listitem')).toContainText('Mon test');

  await page.keyboard.press('Escape');
  // signed out, the login screen offers the passkey: no user name or password to type
  await menu(page, 'Déconnexion');
  await page.getByRole('button', { name: /Utiliser une passkey/ }).click();
  await expect(page.locator('.who')).toContainText(user);

  // delete it (the browser asks first), the password still works
  await menu(page, 'Profil');
  await page.getByRole('tab', { name: 'Passkeys' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.locator('app-profile').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.locator('app-profile')).toContainText('Aucune passkey enregistrée.');
});

test('profile: the language is kept by the account, passkeys tab only when available', async ({
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
  const me = await page.evaluate(async () => (await fetch('api/v1/auth/me')).json());

  await menu(page, 'Profil');
  const profile = page.locator('app-profile');
  const passkeys = profile.getByRole('tab', { name: 'Passkeys' });
  if (me.passkeys_enabled) await expect(passkeys).toBeVisible();
  else await expect(passkeys).toHaveCount(0);

  await profile.getByLabel('Langue').selectOption('en');
  await expect(profile.getByRole('tab', { name: 'Danger zone' })).toBeVisible();
  // the tabs follow the WAI-ARIA pattern: an arrow key moves to the next one
  await profile.getByRole('tab', { name: 'Account' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(profile.getByRole('tab', { name: 'Account' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await expect(profile.getByRole('tabpanel')).toBeVisible();
  // the account got it (sent a moment later), not only this browser
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (await fetch('api/v1/settings')).json()).settings?.lang),
    )
    .toBe('en');
  // another browser (no saved language) signs in: the account's language wins
  await page.evaluate(() => localStorage.removeItem('lang'));
  await page.reload();
  await expect(page.locator('.who')).toContainText(user);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // back to French (the next tests use the same account)
  await menu(page, 'Profile');
  await page.locator('app-profile').getByLabel('Language').selectOption('fr');
  await expect(
    page.locator('app-profile').getByRole('tab', { name: 'Zone dangereuse' }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (await fetch('api/v1/settings')).json()).settings?.lang),
    )
    .toBe('fr');
});

test('german: the interface switches to German, the data falls back to the English names', async ({
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

  await menu(page, 'Profil');
  const profile = page.locator('app-profile');
  await profile.getByLabel('Langue').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(profile.getByLabel('Sprache')).toHaveValue('de');
  await expect(profile.getByRole('tab', { name: 'Gefahrenzone' })).toBeVisible();
  // back to French (the next tests use the same account)
  await profile.getByLabel('Sprache').selectOption('fr');
  await expect(profile.getByRole('tab', { name: 'Zone dangereuse' })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (await fetch('api/v1/settings')).json()).settings?.lang),
    )
    .toBe('fr');
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

test('workshop: recipes, unlock tick, show on the map, altar, calculator @cross', async ({
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

  // discovered or not: the recipe ticked above is "discovered", the axe is not
  await page.getByRole('button', { name: 'Non découvertes' }).click();
  await expect(plank()).toHaveCount(0);
  await page.getByRole('button', { name: 'Découvertes', exact: true }).click();
  await expect(plank()).toHaveCount(1);
  await page.getByRole('button', { name: 'Tout', exact: true }).click();
  // the three buttons share one line, right under the search field
  const filter = page.locator('app-status-filter button');
  const tops = await filter.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size, 'one line').toBe(1);
  const searchBottom = await page
    .locator('app-workshop')
    .getByRole('searchbox')
    .evaluate((e) => e.getBoundingClientRect().bottom);
  expect(tops[0]).toBeGreaterThanOrEqual(searchBottom);
  expect(tops[0]).toBeLessThan(searchBottom + 40);

  // the recipes of two levels of one item are one card, with a badge and a choice by level
  await search('bâton');
  const staff = page
    .locator('app-entry-card')
    .filter({ has: page.getByRole('heading', { name: 'Bâton de test', exact: true }) });
  await expect(staff).toHaveCount(1);
  await expect(staff).toContainText('2 variantes');
  const staffLevels = staff
    .getByRole('group', { name: 'Variantes de la recette' })
    .getByRole('button');
  await expect(staffLevels).toHaveCount(2);
  await expect(staffLevels.first()).toContainText('Niveau 12');
  await expect(staff).toContainText('× 1'); // first variant: 1 wood
  await staffLevels.nth(1).click();
  await expect(staff).toContainText('× 2');
  await search('planche');

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
  await expect(altar).toContainText('Zone de construction : 80 × 80 m'); // the build area follows the altar level
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
  // building items have their own page: they are not listed in Objets
  await search('bloc de test');
  await expect(page.locator('.item-grid')).toContainText('Aucun résultat');
  await expect(page.locator('.item-grid')).not.toContainText('Bloc de test');
  // discovered items: the plank is made by the recipe ticked above, the axe is not made by any known recipe
  await search('');
  await page.getByRole('button', { name: 'Non découvertes' }).click();
  await expect(page.locator('.item-grid')).not.toContainText('Planche de test');
  await expect(page.locator('.item-grid')).toContainText('Hache de test');
  await page.getByRole('button', { name: 'Découvertes', exact: true }).click();
  await expect(page.locator('.item-grid')).toContainText('Planche de test');
  await expect(page.locator('.item-grid')).not.toContainText('Hache de test');
  await page.getByRole('button', { name: 'Tout', exact: true }).click();
  // discovered items have the green frame on their tile, not only inside the card
  await expect(page.locator('.item-card', { hasText: 'Planche de test' })).toHaveClass(/known/);
  await expect(page.locator('.item-card', { hasText: 'Mur de test' })).not.toHaveClass(/known/);
  // two levels of the same item: one tile with a badge, the variants are on its page
  await search('bâton');
  const axes = page.locator('.item-card', { hasText: 'Bâton de test' });
  await expect(axes).toHaveCount(1);
  await expect(axes).toContainText('2 variantes');
  await axes.click();
  const levels = page.getByRole('group', { name: "Variantes de l'objet" }).getByRole('button');
  await expect(levels).toHaveCount(2);
  await expect(levels.first()).toHaveAttribute('aria-pressed', 'true');
  await levels.nth(1).click();
  await expect(levels.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Retour' }).click();
  await search('');
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
  await expect(
    page
      .locator('app-entry-card')
      .filter({ has: page.getByRole('heading', { name: 'Hache de test', exact: true }) }),
  ).toBeVisible();
  // the discovery filter works on the stations too: the axe recipe is not discovered
  await page.getByRole('button', { name: 'Découvertes', exact: true }).click();
  await expect(
    page
      .locator('app-entry-card')
      .filter({ has: page.getByRole('heading', { name: 'Hache de test', exact: true }) }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Non découvertes' }).click();
  await expect(
    page
      .locator('app-entry-card')
      .filter({ has: page.getByRole('heading', { name: 'Hache de test', exact: true }) }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tout', exact: true }).click();
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
  // two recipes for the same piece are one card with a choice, each variant says what tells it apart
  const wall = cards.filter({ hasText: 'Mur de test' });
  await expect(wall).toHaveCount(1);
  const variants = wall.getByRole('group', { name: 'Variantes de la recette' }).getByRole('button');
  await expect(variants).toHaveCount(2);
  await expect(variants.first()).toContainText('matériaux');
  await expect(wall).toContainText('Planche'); // the first variant
  await variants.nth(1).click();
  await expect(wall).toContainText('Bois de test');
  await expect(wall).not.toContainText('Planche');
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
  await blankSheet(page);

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

  // the sheet belongs to the profile, not to a saved build: still there after a reload
  await page.reload();
  await openBuild();
  await expect(sheet.locator('.total').first()).toContainText('26'); // the draft, upgrades included
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
  await blankSheet(page);

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
  // the sheet may still be loading and overwrite the level: set it again until the badge shows
  await expect(async () => {
    await setLevel('20');
    await expect(panel.getByRole('status')).toContainText('Niveau très bas', { timeout: 1500 });
  }).toPass();
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
  await blankSheet(page);

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
  // the values of the level are written in the description, where the game puts its %k, and not listed again
  await expect(dialog.locator('.gempick .gem-text')).toContainText(
    'infligeant 14 dégât par seconde pendant 7.1 s',
  );
  await expect(dialog.locator('.gempick .lines')).toHaveCount(0);
  await level.fill('999');
  await level.dispatchEvent('change');
  await expect(level).toHaveValue('105'); // clamped to the gem's range
  await level.fill('15');
  await level.dispatchEvent('change');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();
  await expect(build.getByRole('button', { name: /Arme 1/ })).toHaveAccessibleName(/saignement 15/);

  // the Damage tab: the gem under its weapon; its values are in its text, not in rows of their own
  await build.getByRole('tab', { name: 'Dégâts' }).click();
  await expect(build.locator('.gem-row')).toContainText('Pierre précieuse de saignement');
  await expect(
    build.locator('dl > div').filter({ hasText: 'Dégâts de coupure par seconde' }),
  ).toHaveCount(0);

  // the gem belongs to the profile's sheet: still there after a reload
  await page.reload();
  await page.locator('app-topbar').getByRole('button', { name: 'Personnage', exact: true }).click();
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

  // it is saved: wait until the server holds it (a reload before that drops the queued save, and no
  // retry can bring the mark back), then still so after a reload
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { marks } = (await (await fetch('api/v1/progress')).json()) as { marks: string[] };
        return marks.filter((m) => !/^(recipe|lore|quest):/.test(m)).length; // as the counter
      }),
    )
    .toBe(base + 1);
  await page.reload();
  await expect(who).toContainText(`${base + 1} faits`);
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
  // the progress may still be loading and overwrite the mark: check again until it holds
  await expect(async () => {
    await pages.first().getByLabel('Page récupérée').check(); // one page only
    await expect(side).toContainText('1 page(s) récupérée(s) sur 3', { timeout: 1500 });
  }).toPass();
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

test('comfort points are kept in the draft and give the Rested duration', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);

  // comfort: kept in the draft; 34 x ln(1 + 0.04 x 120) + 5 = 64.8 min
  await page.getByRole('button', { name: 'Personnage', exact: true }).click();
  const comfort = page.getByLabel('Points de confort');
  await comfort.fill('120');
  await comfort.blur();
  await page.reload();
  await page.getByRole('button', { name: 'Personnage', exact: true }).click();
  await expect(page.getByLabel('Points de confort')).toHaveValue('120');
  await expect(
    page.locator('app-build div[app-stat-row]').filter({ hasText: 'Durée de Reposé' }),
  ).toContainText('64 min');
});

test('game: edit, export, import, reload, AXE @cross', async ({ page }) => {
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

test('game: the configuration is saved on the server and survives a cleared browser', async ({
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
  const health = page.getByLabel('Santé des joueurs', { exact: true });
  await page.getByLabel('Préréglage', { exact: true }).selectOption('Custom');
  await health.fill('3');
  await health.blur();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await page.evaluate(() => localStorage.removeItem('gameSettings'));
  await page.reload();
  await page.getByRole('button', { name: 'Partie', exact: true }).click();
  await expect(health).toHaveValue('3');
  // the account is shared with the next tests: put the saved configuration back to the default
  await page.getByRole('button', { name: 'Tout rétablir' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
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

const fnv = (guid: string): number => {
  const hex = guid.replaceAll('-', '');
  const b = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  const le = [
    ...b.slice(0, 4).reverse(),
    ...b.slice(4, 6).reverse(),
    ...b.slice(6, 8).reverse(),
    ...b.slice(8),
  ];
  let h = 0x811c9dc5;
  for (const x of le) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return h;
};

/** A save with stored (not compressed) sections, built from the format notes: SV2C header, table, names, S2BH blocks. */
function fakeKsd(sections: Record<string, Buffer>): Buffer {
  const names = Object.keys(sections);
  const table = 0x30;
  const namesAt = table + 20 * names.length;
  const nameBytes = names.map((n) => Buffer.from(n));
  const blocks = names.map((n) =>
    Buffer.concat([Buffer.from('S2BH'), Buffer.alloc(10), sections[n]]),
  );
  const head = Buffer.alloc(namesAt);
  head.write('SV2C', 0);
  head.writeUInt32LE(table - 0x28, 0x28);
  head.writeUInt32LE(names.length, 0x2c);
  let nameOff = namesAt;
  let blockOff = namesAt + nameBytes.reduce((n, b) => n + b.length, 0);
  names.forEach((_, i) => {
    const at = table + 20 * i;
    head.writeUInt32LE(nameOff - at, at);
    head.writeUInt32LE(nameBytes[i].length, at + 4);
    head.writeUInt32LE(blockOff, at + 8);
    head.writeUInt32LE(blocks[i].length, at + 12);
    nameOff += nameBytes[i].length;
    blockOff += blocks[i].length;
  });
  return Buffer.concat([head, ...nameBytes, ...blocks]);
}

/** player_knowledge: [u32 1][u32 n][n ids][n flags]. */
function knowledge(entries: [number, number][]): Buffer {
  const k = Buffer.alloc(8 + 8 * entries.length);
  k.writeUInt32LE(1, 0);
  k.writeUInt32LE(entries.length, 4);
  entries.forEach(([id, flags], i) => {
    k.writeUInt32LE(id, 8 + 4 * i);
    k.writeUInt32LE(flags, 8 + 4 * (entries.length + i));
  });
  return k;
}

/** player_character: level, experience, skills (node id, level) then the slots of the inventory. */
function character(
  level: number,
  skills: [number, number][],
  slots: { id: number; level: number; upgrades: number }[],
): Buffer {
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const entry = (i: number, p: { id: number; level: number; upgrades: number }): Buffer =>
    Buffer.concat([
      Buffer.from([i]),
      u32(p.id),
      Buffer.from([1, 0, 0x13, p.level, 100, 0, 0, 0, 100, 0, 0, 0, p.upgrades, p.upgrades]),
    ]);
  return Buffer.concat([
    Buffer.alloc(40),
    u32(level),
    u32(1234),
    u32(skills.length),
    ...skills.map(([id, l]) => Buffer.concat([u32(id), Buffer.from([l])])),
    Buffer.alloc(30),
    ...slots.map((p, i) => entry(5 + i, p)), // slots 0-4 are the outfit in a current save
  ]);
}

/** fogofwar: a 13-byte header (`FGOW` at byte 8), then 1280 x 1280 cells; the first quarter explored. */
function fog(): Buffer {
  const b = Buffer.alloc(13 + 1280 * 1280);
  b.write('FGOW', 8);
  b.fill(255, 13, 13 + (1280 * 1280) / 4);
  return b;
}

test('save import: a character save ticks its recipes and quests @cross', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // earlier tests may have ticked them: start from unticked
  await page.evaluate(async () => {
    const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
    await fetch('api/v1/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token) },
      body: JSON.stringify({
        ids: [
          'recipe:11111111-1111-4111-8111-111111111111',
          'quest:333',
          'lore:222:0',
          'lore:222',
          'fastTravel:200:700',
          'unique:500:800',
        ],
        done: false,
      }),
    });
  });
  await page.reload();
  await menu(page, 'Importer une sauvegarde');
  const dialog = page.getByRole('dialog', { name: 'Importer une sauvegarde' });
  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'character0.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({
      player_knowledge: knowledge([
        [fnv('11111111-1111-4111-8111-111111111111'), 1], // a recipe
        [333, 1], // a quest
        [555, 1], // a lore page
        [777, 1], // a discovered place
        [fnv('a0000000-0000-4000-8000-00000000000a'), 5], // a unique item, picked up and inspected
      ]),
      fogofwar: fog(),
    }),
  });
  await expect(dialog).toContainText('Recettes et constructions connues');
  await expect(dialog).toContainText('1 à cocher sur 1');
  await expect(dialog).toContainText('Pages de lore récupérées');
  await expect(dialog).toContainText('1 à cocher sur 1');
  await expect(dialog).toContainText('Lieux découverts');
  await expect(dialog).toContainText('Zone explorée de la carte (25 % du monde)');
  await dialog.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(dialog).toContainText('6 éléments cochés'); // recipe, quest, page, place, item and the fog
  await expect(dialog.getByRole('button', { name: 'Importer', exact: true })).toHaveCount(0);
  // another character's save goes to a new profile (this one already has marks)
  expect(
    await page.evaluate(
      () => Object.entries(localStorage).find(([k]) => k.startsWith('fog:'))?.[1] ?? '',
    ),
  ).toMatch(/^data:image\/png/);
  await expect(page.getByLabel('Personnage actif')).toHaveCount(1);
  await page.reload();
  const marks = await page.evaluate(
    async () => (await (await fetch('api/v1/progress')).json()).marks,
  );
  expect(marks).toEqual(
    expect.arrayContaining([
      'recipe:11111111-1111-4111-8111-111111111111',
      'quest:333',
      'lore:222:0',
      'fastTravel:200:700',
      'unique:500:800',
    ]),
  );
  await expect(page.locator('.leaflet-control-layers')).toContainText('Ma zone explorée');

  // the progress summary
  await menu(page, 'Ma progression');
  const summary = page.getByRole('dialog', { name: 'Ma progression' });
  await expect(summary).toContainText('1 / 2'); // quests
  await expect(summary).toContainText('25 %'); // explored
  await expect(summary.locator('progress')).not.toHaveCount(0);
  await summary.getByRole('button', { name: 'Fermer', exact: true }).last().click();

  // the last import is remembered
  await menu(page, 'Importer une sauvegarde');
  await expect(page.getByRole('dialog', { name: 'Importer une sauvegarde' })).toContainText(
    'Dernier import : character0.ksd',
  );
  await page
    .getByRole('dialog', { name: 'Importer une sauvegarde' })
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();

  // only the explored area: the markers outside the northern quarter (z > 768 of 1024) go
  const icons = page.locator('.leaflet-marker-icon');
  const before = await icons.count();
  await page.getByLabel('Seulement la zone explorée (sauvegarde importée)').check();
  await expect(async () => expect(await icons.count()).toBeLessThan(before)).toPass();
  await expect(page.locator('img.leaflet-marker-icon[src*="unique"]')).toHaveCount(1); // z = 800: explored
  await page.getByLabel('Seulement la zone explorée (sauvegarde importée)').uncheck();
  await expect(async () => expect(await icons.count()).toBe(before)).toPass();
});

test('opening the workshop or the lore does not move their content @cross', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  // every layout shift with the element that moved, to tell what moves when a test fails
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __why: string[] };
    w.__cls = 0;
    w.__why = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const shift = e as unknown as {
          value: number;
          sources?: { node?: Element; previousRect: DOMRect; currentRect: DOMRect }[];
        };
        w.__cls += shift.value;
        w.__why.push(
          `${shift.value.toFixed(4)} ` +
            (shift.sources ?? [])
              .map(
                (s) =>
                  `${s.node?.nodeName}.${(s.node as HTMLElement | undefined)?.className} ` +
                  `${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`,
              )
              .join(' | '),
        );
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
  // what loads after the login (profiles, the explored area) settles first: only the opening is measured
  await page.waitForLoadState('networkidle');
  const shift = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  const why = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { __why: string[] }).__why);
  for (const [entry, tabs] of [
    ['Atelier', 'workshop'],
    ['Lore', 'lore'],
  ] as const) {
    const before = await shift();
    await page.getByRole('button', { name: entry, exact: true }).click();
    await expect(page.locator(`app-${tabs} [role="tablist"]`)).toBeVisible();
    await page.waitForTimeout(800); // late fonts and images would shift it now
    expect(await shift(), `${entry}: ${(await why()).join(' ; ')}`).toBeLessThan(before + 0.001);
  }
});

test('character profiles: each has its own progress, switched from the top bar', async ({
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
  const marks = (): Promise<string[]> =>
    page.evaluate(async () => (await (await fetch('api/v1/progress')).json()).marks);
  const before = await marks();
  const switcher = page.getByLabel('Personnage actif');
  // the profiles an earlier test left (read from the API: the top bar fills in after the login)
  const chars = await page.evaluate(
    async () =>
      (await (await fetch('api/v1/characters')).json()) as { id: number; active: boolean }[],
  );
  const profiles = chars.length;
  const first = String(chars.find((c) => c.active)!.id);
  await expect(switcher).toHaveCount(profiles > 1 ? 1 : 0);

  // add a character: it starts empty and is the one followed
  await menu(page, 'Mes personnages');
  const dialog = page.getByRole('dialog', { name: 'Mes personnages' });
  await dialog.getByLabel('Nouveau personnage').fill('Frère');
  await dialog.getByRole('button', { name: 'Ajouter' }).click();
  await expect(switcher.locator('option')).toHaveCount(profiles + 1);
  await expect(switcher.locator('option:checked')).toHaveText('Frère');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  expect(await marks()).toEqual([]);

  // the character sheet (level, equipment...) belongs to the profile too
  const hasSheet = await page.evaluate(async () =>
    (await (await fetch('gear.json')).text()).includes('fixture_gear'),
  );
  const level = page.locator('app-build').getByLabel('Niveau du personnage', { exact: true });
  if (hasSheet) {
    await page
      .locator('app-topbar')
      .getByRole('button', { name: 'Personnage', exact: true })
      .click();
    await level.fill('33');
    await level.dispatchEvent('change');
    await expect(level).toHaveValue('33');
    await page.locator('app-topbar').getByRole('button', { name: 'Carte', exact: true }).click();
  }

  // a save imported while the empty profile is followed goes into it
  await menu(page, 'Importer une sauvegarde');
  const imp = page.getByRole('dialog', { name: 'Importer une sauvegarde' });
  await imp.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'character1.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({ player_knowledge: knowledge([[444, 1]]) }),
  });
  await expect(imp.getByRole('radio').first()).toBeChecked(); // into "Frère"
  await imp.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(imp).toContainText('1 éléments cochés');
  await imp.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  expect(await marks()).toEqual(['quest:444']);

  // switching to the first profile brings its own marks back
  await switcher.selectOption(first ?? { index: 0 });
  await expect.poll(marks).toEqual(before);

  if (hasSheet) {
    await expect(level).not.toHaveValue('33'); // the first profile keeps its own sheet
    await switcher.selectOption({ label: 'Frère' });
    await expect(level).toHaveValue('33');
    await switcher.selectOption(first ?? { index: 0 });
    await expect.poll(marks).toEqual(before);
  }

  // delete the second profile: one left, no switch in the top bar
  await menu(page, 'Mes personnages');
  page.once('dialog', (d) => void d.accept());
  await page
    .getByRole('dialog', { name: 'Mes personnages' })
    .getByRole('button', { name: 'Supprimer' })
    .last()
    .click();
  if (profiles > 1) await expect(switcher.locator('option')).toHaveCount(profiles);
  else await expect(switcher).toHaveCount(0);
  expect(await marks()).toEqual(before);
});

test('team: the explored area is shared at any time, and each player chooses what the map shows', async ({
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

  // guest, in the same team, sees nothing before anyone shares
  const guest = await browser.newPage(origin(page));
  await guest.goto('/');
  await guest.getByLabel("Nom d'utilisateur").fill('guest');
  await guest.getByLabel('Mot de passe', { exact: true }).fill('guest new passphrase');
  await guest.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(guest.locator('.who')).toContainText('guest');
  const sharing = (p: Page): Promise<string[]> =>
    p.evaluate(async () =>
      (
        (await (await fetch('api/v1/team/fog')).json()) as { members: { username: string }[] }
      ).members.map((m) => m.username),
    );
  expect(await sharing(guest)).toEqual([]);

  // the owner imports a save into the profile followed: the area is kept, not shared yet
  await menu(page, 'Importer une sauvegarde');
  const imp = page.getByRole('dialog', { name: 'Importer une sauvegarde' });
  await imp.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'character0.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({ player_knowledge: knowledge([]), fogofwar: fog() }),
  });
  await imp.getByRole('radio').first().check(); // into the profile followed
  await expect(imp.getByLabel('Partager cette zone avec mon équipe')).not.toBeChecked();
  await imp.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(imp).toContainText('1 éléments cochés');
  await imp.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  expect(await sharing(guest)).toEqual([]);

  // it can be shared at any time, from the map's side menu
  const shareMine = page.getByLabel("Partager ma zone avec l'équipe");
  await expect(shareMine).not.toBeChecked();
  await shareMine.check();
  await expect.poll(() => sharing(guest)).toEqual([user]);

  // each area is a layer of the map's control: guest ticks the ones to show (one veil, the union of them)
  await guest.reload();
  const layers = guest.locator('.leaflet-control-layers');
  const veil = guest.locator('img.leaflet-image-layer[src^="data:image"]');
  await layers.hover();
  const theirs = layers.getByLabel(`Zone explorée de ${user}`);
  await expect(theirs).toBeChecked();
  await expect(veil).toHaveCount(1);
  await theirs.uncheck();
  await expect(veil).toHaveCount(0); // nothing ticked, nothing veiled
  await theirs.check();
  await expect(veil).toHaveCount(1);

  // the owner stops sharing from the same place: its layer is gone for guest
  await shareMine.uncheck();
  await expect.poll(() => sharing(guest)).toEqual([]);
  await guest.reload();
  await expect(guest.locator('.leaflet-control-layers')).not.toContainText(
    `Zone explorée de ${user}`,
  );

  // ... and from "My progress" too
  await shareMine.check();
  await expect.poll(() => sharing(guest)).toEqual([user]);
  await menu(page, 'Ma progression');
  const summary = page.getByRole('dialog', { name: 'Ma progression' });
  const mine = summary.getByLabel('Partager ma zone explorée avec mon équipe');
  await expect(mine).toBeChecked();
  await mine.uncheck();
  await expect.poll(() => sharing(guest)).toEqual([]);
  await summary.getByRole('button', { name: 'Fermer', exact: true }).last().click();

  // withdrawn from the team, the area is still the owner's: the server keeps it for the profile, so a
  // browser with nothing cached (a new one, after a logout) gets it back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.leaflet-control-layers')).toContainText('Ma zone explorée');
  await expect(page.locator('img.leaflet-image-layer[src^="data:image"]')).toHaveCount(1);
  expect(await sharing(guest)).toEqual([]); // and the team still sees nothing
});

test('custom markers: a pin and an altar zone, shared with the team, read-only for the others', async ({
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
  const host = page.locator('.map-host');
  const icons = page.locator('.cm-icon');
  await expect(icons).toHaveCount(0);

  // zoom in so that a 80 m square is wide enough to measure
  for (let i = 0; i < 6; i++) {
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    if ((await zoomIn.getAttribute('aria-disabled')) === 'true') break; // the closest zoom is reached
    await zoomIn.click();
  }
  const coords = page.locator('.coords');
  const at = async (x: number, y: number): Promise<number> => {
    await host.hover({ position: { x, y } });
    return Number((await coords.textContent())!.match(/X (\d+)/)![1]);
  };
  const metresPerPixel = ((await at(500, 300)) - (await at(300, 300))) / 200;

  const place = async (x: number, y: number, name: string, altarLevel?: string): Promise<void> => {
    await page.getByRole('button', { name: 'Ajouter un repère' }).click();
    await host.click({ position: { x, y } });
    const form = page.locator('.cm-form');
    await expect(form.getByLabel('Nom')).toBeFocused();
    await form.getByLabel('Nom').fill(name);
    await form.getByLabel('Note').fill('<b>texte</b>');
    if (altarLevel) {
      await form.getByLabel('Autel de flamme').check();
      await form.getByLabel(altarLevel, { exact: true }).check();
    }
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(form).toHaveCount(0);
  };
  await place(300, 200, 'Mon repère');
  await place(700, 400, 'Mon autel', '2');
  await expect(icons).toHaveCount(2);

  // the altar zone is a square of 80 m (level 2) at the map's scale; the note is text, not markup
  const square = await page.locator('.leaflet-overlay-pane path').first().boundingBox();
  expect(square!.width * metresPerPixel).toBeGreaterThan(76);
  expect(square!.width * metresPerPixel).toBeLessThan(84);
  expect(Math.abs(square!.width - square!.height)).toBeLessThan(1.5);
  await icons.nth(0).click();
  await expect(page.locator('.cm-form textarea')).toHaveValue('<b>texte</b>');
  await expect(page.locator('.cm-form b')).toHaveCount(0);
  // nothing of the form is cut: it is no wider than the popup's content, and the content does not scroll sideways
  const fits = (form: Locator) =>
    form.evaluate((f) => {
      const box = f.closest('.leaflet-popup-content') as HTMLElement;
      return box.scrollWidth <= box.clientWidth && f.scrollWidth <= box.clientWidth;
    });
  expect(await fits(page.locator('.cm-form').last())).toBe(true);
  const axe = await new AxeBuilder({ page })
    .include('.leaflet-popup')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');

  // the list in the menu: count out of the limit, search, a click shows the marker and opens its popup
  const list = page.locator('app-marker-list');
  const altarForm = () => page.locator('.cm-form').last(); // the newest popup: the one before it is still fading out
  await list.locator('summary').click();
  await expect(list.locator('summary')).toContainText('2 / 100');
  const find = list.getByLabel('Chercher dans mes repères');
  await find.fill('autel');
  await expect(list.locator('.list button')).toHaveCount(1);
  await list.locator('.list button').click();
  await expect(altarForm().locator('input[name=name]')).toHaveValue('Mon autel');
  await find.fill('');
  await expect(list.locator('.list button')).toHaveCount(2);

  // moving: the hint says what the next click does, Escape cancels, a click moves (the square follows)
  const stored = (): Promise<{ name: string; x: number; z: number }[]> =>
    page.evaluate(async () => (await fetch('api/v1/markers')).json());
  const altarAt = async () => (await stored()).find((m) => m.name === 'Mon autel')!;
  const hint = page.locator('.cm-hint');
  const startMove = async (): Promise<void> => {
    await list.locator('.list button', { hasText: 'Mon autel' }).click();
    await expect(altarForm().locator('input[name=name]')).toHaveValue('Mon autel');
    await altarForm().getByRole('button', { name: 'Déplacer' }).click();
  };
  const first = await altarAt();
  await startMove();
  await expect(hint).toContainText('Cliquez sur la carte pour déplacer « Mon autel »');
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  await host.click({ position: { x: 200, y: 150 } }); // nothing is moving now: a plain click
  expect(await altarAt()).toEqual(first);
  await startMove();
  await host.click({ position: { x: 200, y: 150 } });
  await expect.poll(async () => (await altarAt()).x).not.toBe(first.x);
  // the square follows: it is centred on the altar's icon
  const zone = await page.locator('.leaflet-overlay-pane path').first().boundingBox();
  const pin = await icons.nth(1).boundingBox();
  expect(Math.abs(zone!.x + zone!.width / 2 - (pin!.x + pin!.width / 2))).toBeLessThan(8);
  expect(Math.abs(zone!.y + zone!.height / 2 - (pin!.y + pin!.height / 2))).toBeLessThan(8);
  const second = await altarAt();
  // from the keyboard (no pointer): the marker goes to the centre of the view
  await icons.nth(1).click(); // not from the list, which centres the map on the marker: the view's centre is elsewhere
  await expect(altarForm().locator('input[name=name]')).toHaveValue('Mon autel');
  await altarForm().getByRole('button', { name: 'Déplacer' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await altarAt()).x).not.toBe(second.x);
  expect((await stored()).map((m) => m.name).sort()).toEqual(['Mon autel', 'Mon repère']);
  await page.keyboard.press('Escape');

  // private until ticked: guest sees nothing, then only the shared altar, read-only
  const guest = await browser.newPage(origin(page));
  await guest.goto('/');
  await guest.getByLabel("Nom d'utilisateur").fill('guest');
  await guest.getByLabel('Mot de passe', { exact: true }).fill('guest new passphrase');
  await guest.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(guest.locator('.who')).toContainText('guest');
  await expect(guest.locator('.cm-icon')).toHaveCount(0);
  await icons.nth(1).click();
  await expect(page.locator('.cm-form')).toHaveCount(1); // the first popup is gone (it fades out)
  // an altar being edited shows its level, not the colours and icons of a simple marker, and fits its popup
  await expect(page.locator('.cm-form').getByRole('group', { name: /Niveau/ })).toBeVisible();
  await expect(page.locator('.cm-form .cm-colors')).toBeHidden();
  await expect(page.locator('.cm-form .cm-icons')).toBeHidden();
  expect(await fits(page.locator('.cm-form'))).toBe(true);
  await page.locator('.cm-form').getByLabel('Partager avec mon équipe').check();
  await page.locator('.cm-form').getByRole('button', { name: 'Enregistrer' }).click();
  await guest.reload();
  await expect(guest.locator('.cm-icon')).toHaveCount(1);
  await guest.locator('.leaflet-control-layers').hover();
  await expect(guest.locator('.leaflet-control-layers')).toContainText(`Repères de ${user}`);
  await guest.locator('.cm-icon').click();
  await expect(guest.locator('.leaflet-popup')).toContainText('Mon autel');
  await expect(guest.locator('.leaflet-popup')).toContainText('80 m');
  await expect(guest.locator('.cm-form')).toHaveCount(0); // read-only

  // the list shows the shared one under its owner, and a click opens it
  await guest.locator('app-marker-list summary').click();
  await expect(guest.locator('app-marker-list h3')).toContainText(`Partagés par ${user}`);
  await guest.locator('app-marker-list .list button', { hasText: 'Mon autel' }).click();
  await expect(guest.locator('.leaflet-popup')).toContainText('Mon autel');

  // the ticked layers are kept by the browser: unticked, it stays so after a reload
  await guest.locator('.leaflet-control-layers').hover();
  const theirs = guest.locator('.leaflet-control-layers').getByLabel(`Repères de ${user}`);
  await theirs.uncheck();
  await expect(guest.locator('.cm-icon')).toHaveCount(0);
  await guest.reload();
  await guest.locator('.leaflet-control-layers').hover();
  await expect(theirs).not.toBeChecked();
  await expect(guest.locator('.cm-icon')).toHaveCount(0);
  await theirs.check();
  await expect(guest.locator('.cm-icon')).toHaveCount(1);

  // leaving the team switches the sharing off: it is gone for guest, and the tick is off again
  await page.evaluate(async () => {
    const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
    await fetch('api/v1/team/leave', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': decodeURIComponent(token) },
    });
  });
  await guest.reload();
  await expect(guest.locator('.cm-icon')).toHaveCount(0);
  const shared = await page.evaluate(async () =>
    ((await (await fetch('api/v1/markers')).json()) as { shared: boolean }[]).map((m) => m.shared),
  );
  expect(shared).toEqual([false, false]);
});

/** A `base` section of a world save: GUID, then the corners of the build box in half metres, then some voxel bytes. */
function baseBox(cx: number, cz: number, level: number): Buffer {
  const half = level * 40;
  const b = Buffer.alloc(16 + 24 + 10);
  [2 * cx - half, 1700, 2 * cz - half, 2 * cx + half, 1760, 2 * cz + half].forEach((n, i) =>
    b.writeUInt32LE(n, 16 + 4 * i),
  );
  return b;
}

test('custom markers: the altars of a world save are added once, privately, with what lies in their zone', async ({
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

  const world = {
    name: 'world0.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({
      world_metadata: Buffer.alloc(8),
      base00: baseBox(500, 800, 1), // 40 m: holds the unique item and the cosmetic of the fixture map
      base01: baseBox(700, 600, 2), // 80 m: holds a boss
      base02: Buffer.alloc(20), // not a clean altar: ignored and counted
    }),
  };
  await menu(page, 'Importer une sauvegarde');
  const dialog = page.getByRole('dialog', { name: 'Importer une sauvegarde' });
  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles(world);
  await expect(dialog).toContainText('2 autel(s) de flamme trouvé(s)');
  await expect(dialog).toContainText('1 section(s) du fichier ne sont pas un autel exploitable');
  await expect(dialog).toContainText('Autel 1 : niveau 1, X 500 · Z 800');
  await expect(dialog).toContainText('Autel 2 : niveau 2, X 700 · Z 600');
  expect(
    (
      await new AxeBuilder({ page })
        .include('app-save-import-dialog')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  await dialog.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(dialog).toContainText("2 repère(s) d'autel ajouté(s).");
  const altars = (): Promise<{ x: number; z: number; level: number; shared: boolean }[]> =>
    page.evaluate(async () =>
      (
        (await (await fetch('api/v1/markers')).json()) as {
          x: number;
          z: number;
          kind: string;
          level: number;
          shared: boolean;
        }[]
      ).filter((m) => m.kind === 'altar' && [500, 700].includes(m.x)),
    );
  expect(await altars()).toEqual([
    expect.objectContaining({ x: 500, z: 800, level: 1, shared: false }),
    expect.objectContaining({ x: 700, z: 600, level: 2, shared: false }),
  ]);

  // the same file again adds nothing: both are flagged as already there
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await menu(page, 'Importer une sauvegarde');
  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles(world);
  await expect(dialog.getByText('déjà un repère')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
  expect(await altars()).toHaveLength(2);

  // a file that is neither a character nor a world save is refused with a clear message
  await dialog.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'other.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({ miscellaneous: Buffer.alloc(20) }),
  });
  await expect(dialog.getByRole('alert')).toContainText('ni une sauvegarde de personnage');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();

  // what lies in the altar's zone: the popup counts the map elements inside the square (the border included)
  const list = page.locator('app-marker-list');
  await list.locator('summary').click();
  await list.locator('.list button', { hasText: 'niveau 1' }).first().click();
  const zone = page.locator('.cm-zone').last();
  await expect(zone).toContainText('Dans la zone de construction : 2 élément(s)');
  await expect(zone.locator('li')).toHaveCount(2);
  expect(
    (
      await new AxeBuilder({ page })
        .include('.leaflet-popup')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .include('app-marker-list')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
});

test('map: the ruler measures two points, and is one map mode among the others', async ({
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
  const host = page.locator('.map-host');
  const measure = page.getByRole('button', { name: 'Mesurer' });
  const add = page.getByRole('button', { name: 'Ajouter un repère' });
  const label = page.locator('.cm-measure-label');
  await measure.click();
  await expect(measure).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cm-hint')).toContainText('Cliquez deux points');
  await host.click({ position: { x: 250, y: 420 } });
  await expect(label).toHaveCount(0); // one point is not a measure yet
  await host.click({ position: { x: 450, y: 420 } });
  await expect(label).toHaveCount(1);
  const text = (await label.textContent())!;
  const [, distance, dx, dz] = text.match(/^(\d+) m · ΔX (\d+) · ΔZ (\d+)$/)!;
  expect(Number(distance)).toBeGreaterThan(0);
  expect(dx).toBe(distance); // a horizontal line: all of the distance is on x
  expect(dz).toBe('0');
  await host.click({ position: { x: 300, y: 380 } }); // a further click starts a new measure
  await expect(label).toHaveCount(0);

  // one mode at a time: adding a marker turns the ruler off, and Escape ends the active mode
  await add.click();
  await expect(measure).toHaveAttribute('aria-pressed', 'false');
  await expect(add).toHaveAttribute('aria-pressed', 'true');
  await measure.click();
  await expect(add).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(measure).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.cm-hint')).toHaveCount(0);

  // from the keyboard the button places a point at the centre of the view: twice there is a 0 m measure
  await measure.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(label).toHaveText('0 m · ΔX 0 · ΔZ 0');
  await page.keyboard.press('Escape');
  await expect(label).toHaveCount(0);
});

test('save import: the character sheet (level, worn equipment, skills) goes into the profile', async ({
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

  const worn = [1, 2, 7, 8, 9, 3, 10, 5].map((n, i) => ({
    id: fnv(`11111111-0000-0000-0000-0000000000${n.toString(16).padStart(2, '0')}`),
    level: [12, 5, 5, 5, 5, 8, 14, 6][i],
    upgrades: [2, 0, 0, 0, 0, 0, 0, 0][i],
  }));
  await menu(page, 'Importer une sauvegarde');
  const imp = page.getByRole('dialog', { name: 'Importer une sauvegarde' });
  await imp.getByLabel('Fichier de sauvegarde').setInputFiles({
    name: 'character7.ksd',
    mimeType: 'application/octet-stream',
    buffer: fakeKsd({
      player_knowledge: knowledge([]),
      player_character: character(
        21,
        [
          [2, 2], // Endurance, 2 of 3
          [5, 1], // Force
        ],
        worn,
      ),
    }),
  });
  await expect(imp).toContainText(
    "Fiche du personnage : niveau 21, 8 pièces d'équipement, 2 compétences",
  );
  await expect(imp).toContainText("Casque d'essai");
  await imp.getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(imp).toContainText('1 éléments cochés');
  await imp.getByRole('button', { name: 'Fermer', exact: true }).last().click();

  // the Character screen shows it: level, what is worn (the ring has a base level in its range)
  await page.locator('app-topbar').getByRole('button', { name: 'Personnage', exact: true }).click();
  const build = page.locator('app-build');
  await expect(build.getByLabel('Niveau du personnage', { exact: true })).toHaveValue('21');
  await expect(build.getByRole('button', { name: /Tête/ })).toHaveAccessibleName(/Casque d'essai/);
  await expect(build.getByRole('button', { name: /Torse/ })).toHaveAccessibleName(
    /Plastron d'essai/,
  );
  await expect(build.getByRole('button', { name: /Bouclier/ })).toHaveAccessibleName(
    /Bouclier d'essai/,
  );

  // the skills are the profile's: 2 + 1 points spent
  await build.getByRole('button', { name: 'Compétences', exact: true }).click();
  await expect(page.locator('app-skills g.skill').filter({ hasText: /Endurance/ })).toContainText(
    '2/3',
  );
  await expect(page.locator('app-skills .points')).toContainText(/Disponible\s*3$/);

  // a skill build saves the skills only: the level and the equipment stay with the profile
  await page.getByRole('button', { name: 'Builds enregistrés', exact: true }).click();
  await page.getByLabel('Nom du build').fill('Import');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect
    .poll(async () => {
      const saved = await page.evaluate(async () => (await fetch('api/v1/builds')).json());
      return saved.length ? Object.keys(saved[0]).sort() : null;
    })
    .toEqual(['id', 'name', 'nodes', 'updated_at']);
});

// ---- add-ons: the site lists what /addon/api/manifest allows and mounts the custom elements ----
const addonFile = (name: string) => readFileSync(join(__dirname, 'fixtures/addon', name), 'utf8');

/** A fake add-on behind `/addon/`: the site's own /auth/me and /auth/login say `addon: true`, the rest is served from fixtures. */
async function fakeAddon(
  page: Page,
  opts: { enabled?: boolean; manifest?: unknown; script?: () => number } = {},
) {
  const { enabled = true, manifest = JSON.parse(addonFile('manifest.json')) } = opts;
  await page.route('**/api/v1/auth/{me,login}', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: enabled ? { ...body, addon: true } : body });
  });
  await page.route('**/addon/api/manifest', (route) => route.fulfill({ json: manifest as object }));
  await page.route('**/addon/styles.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: addonFile('elements.css') }),
  );
  await page.route('**/addon/main.js', (route) =>
    (opts.script?.() ?? 200) === 200
      ? route.fulfill({ contentType: 'text/javascript', body: addonFile('elements.js') })
      : route.fulfill({ status: 404, body: 'nope' }),
  );
}

async function signInAgain(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel("Nom d'utilisateur").fill(user);
  await page
    .getByRole('dialog')
    .getByLabel('Mot de passe', { exact: true })
    .fill('a brand new passphrase');
  await page.getByRole('dialog').getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.who')).toContainText(user);
}

test('add-ons: no tab unless /auth/me says the add-on exists', async ({ page }) => {
  let asked = false;
  await fakeAddon(page, { enabled: false });
  await page.route('**/addon/api/manifest', (route) => {
    asked = true; // registered last, so it answers first
    return route.fulfill({ json: {} });
  });
  await signInAgain(page);
  await expect(page.locator('app-topbar').getByRole('button', { name: 'Serveur' })).toHaveCount(0);
  expect(asked).toBe(false);
});

test('add-ons: a hostile manifest shows nothing and injects nothing', async ({ page }) => {
  const bad = { ...JSON.parse(addonFile('manifest.json')), script: 'https://evil.example/x.js' };
  await fakeAddon(page, { manifest: bad });
  await signInAgain(page);
  await expect(page.locator('app-topbar').getByRole('button', { name: 'Serveur' })).toHaveCount(0);
  expect(await page.locator('script[src*="evil"]').count()).toBe(0);
});

test('add-ons: tabs from the manifest, the element gets lang and active, the draft survives, AXE', async ({
  page,
}) => {
  await fakeAddon(page);
  await signInAgain(page);
  const bar = page.locator('app-topbar');
  const h1Color = () => page.locator('app-topbar h1').evaluate((e) => getComputedStyle(e).color);
  const before = await h1Color();
  await expect(bar.getByRole('button', { name: 'Serveur' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Coffres' })).toBeVisible();

  await bar.getByRole('button', { name: 'Serveur' }).click();
  const el = page.locator('[data-addon] addon-server');
  await expect(el.locator('#state')).toHaveText('lang=fr active=true');
  await expect(bar.getByRole('button', { name: 'Serveur' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await el.getByLabel('Draft').fill('my unsaved draft');
  expect(
    (await new AxeBuilder({ page }).include('[data-addon]:not([hidden])').analyze()).violations,
  ).toEqual([]);

  // another screen: the element stays mounted, hidden and inactive, with its draft
  await bar.getByRole('button', { name: 'Partie', exact: true }).click();
  await expect(page.locator('[data-addon]').first()).toBeHidden();
  await expect(el.locator('#state')).toHaveText('lang=fr active=false');
  await bar.getByRole('button', { name: 'Serveur' }).click();
  await expect(el.getByLabel('Draft')).toHaveValue('my unsaved draft');

  // a link to #addon/<id> opens the other tab
  await page.evaluate(() => (location.hash = '#addon/chestsort'));
  await expect(bar.getByRole('button', { name: 'Coffres' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-addon] addon-chestsort')).toBeVisible();
  // the add-on's stylesheet changed nothing of the site's own look
  expect(await h1Color()).toBe(before);
});

test('add-ons: a script that does not load shows an error, and Retry loads it', async ({
  page,
}) => {
  let status = 404;
  await fakeAddon(page, { script: () => status });
  await signInAgain(page);
  await page.locator('app-topbar').getByRole('button', { name: 'Serveur' }).click();
  const host = page.locator('app-addon-host');
  await expect(host.getByRole('alert')).toBeVisible();
  status = 200;
  await host.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.locator('[data-addon] addon-server #state')).toBeVisible();
  await expect(host.getByRole('alert')).toHaveCount(0);
});

test('add-ons: the Administration dialog has one access tab per add-on', async ({ page }) => {
  await fakeAddon(page);
  const puts: { url: string; body: unknown; header: string | undefined }[] = [];
  await page.route('**/addon/api/server/access**', (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      puts.push({ url: req.url(), body: req.postDataJSON(), header: req.headers()['x-addon'] });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: [{ user_key: '9:t', username: 'bob', level: 'read' }] });
  });
  await signInAgain(page);
  await menu(page, 'Administration');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab')).toHaveText(['Comptes', 'Serveur', 'Coffres']);
  await expect(dialog.getByRole('button', { name: 'Générer le lien' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Serveur' }).click();
  await expect(dialog.getByLabel('bob')).toHaveValue('read');
  await dialog.getByLabel('bob').selectOption('action');
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toMatchObject({ body: { level: 'action' }, header: '1' });
  expect(puts[0].url).toContain('/addon/api/server/access/9%3At');
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
});
