/* End-to-end proof for the Phase 3 reflection → Studio → save/export loop. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Builder, By, until } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const options = new chrome.Options()
  .addArguments('--headless=new', '--no-sandbox', '--window-size=1440,1100')
  .setUserPreferences({
    'download.default_directory': fileURLToPath(OUT),
    'download.prompt_for_download': false,
  })
const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

try {
  await driver.get(`${APP}/login`)
  await driver.wait(until.elementLocated(By.css('#email')), 10000)
  await driver.findElement(By.css('#email')).sendKeys(`studio${Date.now()}@example.com`)
  await driver.findElement(By.css('#password')).sendKeys('password123')
  for (const button of await driver.findElements(By.css('button'))) {
    if ((await button.getText()).includes('Create an account')) await button.click()
  }
  await wait(250)
  await driver.findElement(By.css('button[type=submit]')).click()
  await driver.wait(async () => !(await driver.getCurrentUrl()).includes('/login'), 10000)

  const id = await driver.executeScript(async () => {
    const request = (path, method, body) => fetch(path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((response) => response.json())
    const reflection = await request('/api/conversations', 'POST', {
      title: 'Remain in the vine',
      scriptureReference: 'John 15:5',
    })
    await request(`/api/conversations/${reflection.id}/sections`, 'PATCH', {
      type: 'heart',
      content: 'I am invited to remain close instead of striving alone.',
      authorOrigin: 'user',
    })
    await request(`/api/bible/reflections/${reflection.id}/passage`, 'PUT', {
      provider: 'youversion',
      translationId: 111,
      abbreviation: 'NIV',
      name: 'New International Version',
      passageId: 'JHN.15.5',
      reference: 'John 15:5',
      content: 'I am the vine; you are the branches.',
      copyright: 'Scripture quotation test notice.',
      retrievedAt: new Date().toISOString(),
    })
    return reflection.id
  })

  await driver.get(`${APP}/create?c=${id}`)
  await driver.wait(until.elementLocated(By.css('canvas')), 15000)
  await wait(1500)
  const body = await driver.findElement(By.css('main')).getText()
  if (!body.includes('Remain in the vine') || !body.includes('Heart')) {
    throw new Error('The selected reflection did not map into the Studio workspace.')
  }
  writeFileSync(new URL('create-studio-phase-3.png', OUT), await driver.takeScreenshot(), 'base64')

  await driver.findElement(By.xpath("//button[normalize-space()='Save']")).click()
  await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'Saved. This composition')]")), 10000)
  await driver.navigate().refresh()
  await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'Saved Studio document reopened')]")), 15000)
  await driver.findElement(By.xpath("//button[normalize-space()='Export']")).click()
  await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'Exported and saved 1080 × 1080 PNG')]")), 15000)

  await driver.get(`${APP}/open-source-licenses`)
  await driver.wait(until.elementLocated(By.xpath("//h2[normalize-space()='Fabric.js']")), 10000)
  console.log('Phase 3 Create Studio save/reopen/export and offline notice route passed.')
} finally {
  await driver.quit()
}
