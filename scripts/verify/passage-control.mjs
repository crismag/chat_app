/*
 * Compact Bible passage control used by the reflection editor.
 *
 * The free-typed "Scripture reference" field was removed; passage identity is
 * chosen through this control. Verification scripts share the same selectors
 * so they do not drift back to the retired input.
 *
 * The connector now lives in a sheet rather than on the page. The page carries
 * one button naming the passage; everything else — the chooser, the translation
 * picker, the quotation — exists only while that sheet is open. Every helper
 * here opens it first, so a script that wants a passage set does not have to
 * know where the connector is rendered.
 */
import { By } from 'selenium-webdriver';

export const passageChooserInput = By.css('input[placeholder="John 3:16-18"]');
export const passageSheet = By.css('[role="dialog"][aria-modal="true"]');

/** The one-line control on the page. Opens the sheet; never a chooser itself. */
export async function biblePassageControl(driver) {
  for (const button of await driver.findElements(By.css('button[aria-haspopup="dialog"]'))) {
    const text = (await button.getText()).replace(/\s+/g, ' ').trim();
    if (/Add Bible passage/i.test(text) || /\S/.test(text)) return button;
  }
  return null;
}

/** The chooser's own trigger, inside the sheet. */
export async function biblePassageTrigger(driver) {
  for (const button of await driver.findElements(By.css('button[aria-expanded][aria-controls]'))) {
    const text = (await button.getText()).replace(/\s+/g, ' ').trim();
    if (/Choose Bible passage/i.test(text) || / · /.test(text)) return button;
  }
  return null;
}

export async function openPassageSheet(driver) {
  if ((await driver.findElements(passageSheet)).length > 0) return;
  const control = await biblePassageControl(driver);
  if (!control) throw new Error('Bible passage control not found');
  await control.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await driver.findElements(passageSheet)).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Bible passage sheet did not open');
}

export async function closePassageSheet(driver) {
  for (const button of await driver.findElements(By.css('button[aria-label^="Close Bible passage"]'))) {
    await button.click();
    return;
  }
}

export async function openBibleChooser(driver) {
  await openPassageSheet(driver);
  const trigger = await biblePassageTrigger(driver);
  if (!trigger) throw new Error('Bible passage chooser not found in the sheet');
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
      /* Leave the page as a person would: passage set, sheet shut. */
      await new Promise((resolve) => setTimeout(resolve, 600));
      await closePassageSheet(driver);
      return;
    }
  }
  throw new Error('Load passage was not on screen');
}
