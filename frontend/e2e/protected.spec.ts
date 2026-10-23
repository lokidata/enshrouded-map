import { expect, test } from '@playwright/test';

// Only meaningful behind nginx (`make e2e-stack`): `ng serve` serves the map files to anyone.
test.skip(!process.env['PROTECTED_ASSETS'], 'needs the nginx stack');

for (const path of [
  'map-data.json',
  'resources.json',
  'tiles/0/0_0.jpg',
  'icons/x.png',
  'biomes.png',
]) {
  test(`${path} is refused without a session`, async ({ request }) => {
    expect((await request.get(`/${path}`)).status()).toBe(401);
  });
}
