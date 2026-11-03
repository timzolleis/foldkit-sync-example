import assert from "node:assert/strict"
import { chromium } from "playwright"

const url = process.env.GROCERY_URL ?? "http://localhost:5180/"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const rowsOf = (page) =>
  page.$$eval("li", (rows) =>
    rows.map((row) => {
      const checkbox = row.querySelector("input[type=checkbox]")
      const name = row.querySelector("button")?.textContent
      return `${checkbox?.checked ? "[x]" : "[ ]"} ${name}${row.className.includes("opacity-60") ? " (saving)" : ""}`
    }),
  )
const statusOf = (page) => page.$eval("[role=status]", (status) => status.textContent)
const addItem = async (page, name) => {
  await page.fill("input[aria-label='New item']", name)
  await page.press("input[aria-label='New item']", "Enter")
}
const step = async (title, check) => {
  await check()
  console.log(`✓ ${title}`)
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
const annaDevice = await browser.newContext()
const benDevice = await browser.newContext()
const anna = await annaDevice.newPage()
const ben = await benDevice.newPage()
await anna.goto(url)
await ben.goto(url)
await sleep(1500)

await step("both devices are live", async () => {
  assert.equal(await statusOf(anna), "Live")
  assert.equal(await statusOf(ben), "Live")
})
await step("an add on one device shows on the other", async () => {
  await addItem(anna, "Milk")
  await addItem(anna, "Eggs")
  await sleep(800)
  assert.deepEqual(await rowsOf(ben), ["[ ] Milk", "[ ] Eggs"])
})
await step("a check-off shows on the other device", async () => {
  await ben.click("input[aria-label='Check off Milk']")
  await sleep(800)
  assert.deepEqual(await rowsOf(anna), ["[ ] Eggs", "[x] Milk"])
})
await step("a name already on the list is undone, with the reason", async () => {
  await addItem(ben, "  milk ")
  await sleep(800)
  assert.deepEqual(await rowsOf(ben), ["[ ] Eggs", "[x] Milk"])
  assert.match(await ben.$eval("[role=alert]", (alert) => alert.textContent), /already on the list/)
})
await step("a rename shows on the other device", async () => {
  await anna.click("button:text('Eggs')")
  await anna.fill("input[aria-label='Item name']", "Free-range eggs")
  await anna.press("input[aria-label='Item name']", "Enter")
  await sleep(800)
  assert.deepEqual(await rowsOf(ben), ["[ ] Free-range eggs", "[x] Milk"])
})
await step("offline, writes stay on the device as saving", async () => {
  await annaDevice.setOffline(true)
  await sleep(500)
  await addItem(anna, "Bread")
  await anna.click("input[aria-label='Check off Free-range eggs']")
  await sleep(800)
  assert.match(await statusOf(anna), /Offline/)
  assert.deepEqual(await rowsOf(anna), ["[ ] Bread (saving)", "[x] Milk", "[x] Free-range eggs (saving)"])
  assert.deepEqual(await rowsOf(ben), ["[ ] Free-range eggs", "[x] Milk"])
})
await step("a reload while the server is unreachable keeps the list and the writes", async () => {
  await annaDevice.setOffline(false)
  await anna.route("**/api/**", (route) => route.abort())
  await anna.reload()
  await sleep(1500)
  assert.deepEqual(await rowsOf(anna), ["[ ] Bread (saving)", "[x] Milk", "[x] Free-range eggs (saving)"])
})
await step("back online, the writes reach the other device", async () => {
  await anna.unroute("**/api/**")
  await sleep(4500)
  assert.equal(await statusOf(anna), "Live")
  assert.deepEqual(await rowsOf(anna), ["[ ] Bread", "[x] Milk", "[x] Free-range eggs"])
  assert.deepEqual(await rowsOf(ben), ["[ ] Bread", "[x] Milk", "[x] Free-range eggs"])
})
await step("a removal shows on the other device", async () => {
  await ben.click("button[aria-label='Remove Bread']")
  await sleep(800)
  assert.deepEqual(await rowsOf(anna), ["[x] Milk", "[x] Free-range eggs"])
})

await browser.close()
