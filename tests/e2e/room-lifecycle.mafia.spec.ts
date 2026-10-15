import { test, expect } from "@playwright/test";

test("mafia room lifecycle quick", async ({ page, context }) => {
  await page.goto("http://localhost:8080/host");
  await page.click("text=Create Room");
  const code = await page.locator(".room-code").innerText();
  expect(code).toBeTruthy();

  const player = await context.newPage();
  await player.goto(`http://localhost:8080/join/${code}`);
  await expect(player.locator("text=Waiting")).toBeVisible();

  // host starts roles assignment / night
  await page.click("text=Assign roles");
  await page.click("text=Start Night");
  await expect(page.locator("text=Phase: night")).toBeVisible();
});
