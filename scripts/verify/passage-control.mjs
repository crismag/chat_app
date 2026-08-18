/*
 * Compact Bible passage control used by the reflection editor.
 *
 * The free-typed "Scripture reference" field was removed; passage identity is
 * chosen through this control. Verification scripts share the same selectors
 * so they do not drift back to the retired input.
 */
import { By } from 'selenium-webdriver';

export const passageChooserInput = By.css('input[placeholder="John 3:16-18"]');

export async function biblePassageTrigger(driver) {
  for (const button of await driver.findElements(By.css('button[aria-expanded]'))) {
    const text = (await button.getText()).replace(/\s+/g, ' ').trim();
    if (/Choose Bible passage/i.test(text) || / · /.test(text)) return button;
  }
  return null;
}

export async function openBibleChooser(driver) {
  const trigger = await biblePassageTrigger(driver);
  if (!trigger) throw new Error('Bible passage control not found');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return trigger;
}

export async function setBiblePassage(driver, reference) {
  await openBibleChooser(driver);
  const input = await driver.findElement(passageChooserInput);
  await input.clear();
  await input.sendKeys(reference);
  for (const button of await driver.findElements(By.css('button'))) {
    if (/^Load passage$/i.test((await button.getText()).trim())) {
      await button.click();
      return;
    }
  }
  throw new Error('Load passage was not on screen');
}
