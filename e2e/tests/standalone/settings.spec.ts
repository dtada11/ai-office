import { expect, test } from '../../fixtures/standalone';

test.describe('Standalone / settings', () => {
  // The standalone server drops openSessionsFolder / exportLayout / importLayout
  // (see the default branch of clientMessageHandler) — they need an IDE host to
  // open a folder or a file dialog. Shown, they are buttons that do nothing.
  test('hides the IDE-only menu items @area:standalone', async ({ page }) => {
    await page.getByRole('button', { name: '설정', exact: true }).click();

    // Positive assertion first: proves the modal actually opened, so the
    // absences below mean "hidden" and not "never rendered".
    await expect(page.getByRole('button', { name: '에셋 폴더 추가' })).toBeVisible();

    for (const label of ['세션 폴더 열기', '레이아웃 내보내기', '레이아웃 가져오기']) {
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
  });
});
