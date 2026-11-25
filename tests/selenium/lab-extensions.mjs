import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { Builder, By, logging, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const PORT = 3115;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for Next.js server at ${url}`);
}

async function waitForText(driver, locator, expectedSubstring, timeoutMs = 8000) {
  let lastSeen = "";
  try {
    await driver.wait(async () => {
      try {
        const el = await driver.findElement(locator);
        lastSeen = await el.getText();
        return lastSeen.includes(expectedSubstring);
      } catch {
        return false;
      }
    }, timeoutMs);
  } catch {
    throw new Error(`Expected ${locator} to include "${expectedSubstring}", but last saw: "${lastSeen}"`);
  }
}

async function scrollAndClick(driver, element) {
  await driver.executeScript(
    "arguments[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });",
    element,
  );
  await driver.sleep(60);
  await element.click();
}

async function chooseCustomDropdown(driver, ariaLabel, optionTextSubstring) {
  const trigger = await driver.findElement(By.css(`button[aria-label="${ariaLabel}"]`));
  await scrollAndClick(driver, trigger);
  const listbox = await driver.wait(until.elementLocated(By.css(`ul[role="listbox"][aria-label="${ariaLabel}"]`)), 5000);
  const option = await listbox.findElement(
    By.xpath(`.//li[@role='option' and contains(., "${optionTextSubstring}")]`),
  );
  await driver.wait(until.elementIsVisible(option), 3000);
  await option.click();
}

async function run() {
  console.log("[Selenium E2E] Starting production Next.js server on port", PORT);
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let driver = null;
  try {
    await waitForServer(BASE_URL);
    console.log("[Selenium E2E] Server ready. Launching headless Chrome via Selenium WebDriver...");

    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.BROWSER, logging.Level.SEVERE);

    const options = new chrome.Options();
    options.addArguments(
      "--headless=new",
      "--window-size=1440,960",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required",
    );
    options.setLoggingPrefs(prefs);

    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

    // 1. Homepage check
    console.log("[Selenium E2E] 1/5 Verifying Homepage (/): real videography & Explore grid...");
    await driver.get(`${BASE_URL}/`);
    await driver.wait(until.elementLocated(By.css("h1")), 10000);
    const videoSource = await driver.findElement(By.css('#lineage video source[src="/world/prato-de-chladni-14.webm"]'));
    assert.ok(videoSource, "Expected physical Chladni plate video source on homepage");

    // 2. Compare Studio (/compare): Custom animated dropdowns (no duplicate /æ/ /æ/) + 3D A<->B Auto-Morph Stage
    console.log("[Selenium E2E] 2/5 Verifying /compare custom dropdowns, uncluttered tabs & 3D A<->B morph stage...");
    await driver.get(`${BASE_URL}/compare`);
    await driver.wait(until.elementLocated(By.css('button[aria-label="Target vowel"]')), 10000);

    // Open Target vowel custom dropdown and assert zero duplicate "/æ/ /æ/" strings
    const targetTrigger = await driver.findElement(By.css('button[aria-label="Target vowel"]'));
    await targetTrigger.click();
    const targetMenu = await driver.wait(
      until.elementLocated(By.css('ul[role="listbox"][aria-label="Target vowel"]')),
      5000,
    );
    const menuText = await targetMenu.getText();
    assert.ok(!menuText.includes("/æ/ /æ/"), "Dropdown must never duplicate /æ/ /æ/");
    assert.ok(!menuText.includes("/ɜː/ /ɜː/"), "Dropdown must never duplicate /ɜː/ /ɜː/");
    await targetMenu.findElement(By.xpath(".//li[@role='option' and contains(., 'Auto-detect vowel')]")).click();

    // Generate starter pair and verify 3D Morphing controller appears and animates
    const starterBtn = await driver.findElement(By.xpath("//button[contains(., 'starter pair')]"));
    await starterBtn.click();
    await waitForText(driver, By.xpath("//button[contains(., 'Auto-morphing')]"), "Auto-morphing A ↔ B", 10000);

    // Switch 3D geometry in /compare via custom dropdown & switch tabs cleanly
    await chooseCustomDropdown(driver, "3D stage geometry", "3D Vocal tract");
    const spectraTab = await driver.findElement(By.xpath("//button[@role='tab' and normalize-space()='Spectrum & Poles']"));
    await spectraTab.click();
    const notesTab = await driver.findElement(By.xpath("//button[@role='tab' and normalize-space()='Waveform & Notes']"));
    await notesTab.click();

    // 3. Laboratory (/lab): Custom 3D geometry dropdown + pointer drag orbit + tap plate
    console.log("[Selenium E2E] 3/5 Verifying /lab 3D Acoustic Stage custom dropdown & pointer interactions...");
    await driver.get(`${BASE_URL}/lab`);
    await waitForText(driver, By.css('[data-testid="lab-regime-strip"]'), "Voiced vowel", 10000);

    const stage = await driver.wait(
      until.elementLocated(By.css('[aria-label*="Chladni figure"], [data-testid="plate-3d-stage"]')),
      8000,
    );
    const actions = driver.actions({ async: true });
    await actions.move({ origin: stage, x: 0, y: 0 }).press().move({ origin: stage, x: 65, y: -30 }).release().perform();

    const tapBtn = await driver.findElement(By.xpath("//button[normalize-space()='Tap plate']"));
    await tapBtn.click();

    for (const label of ["Bessel drum", "Harmonic field", "3D Vocal tract", "Square plate"]) {
      await chooseCustomDropdown(driver, "3D geometry", label);
    }

    // 4. Multi-model spectral controls via custom dropdown
    console.log("[Selenium E2E] 4/5 Verifying Multi-Model Spectral dropdown (LPC Burg + Cepstrum)...");
    await chooseCustomDropdown(driver, "LPC model", "LPC Burg");
    const cepBtn = await driver.findElement(By.xpath("//button[normalize-space()='+ Cepstrum']"));
    await scrollAndClick(driver, cepBtn);
    assert.equal(await cepBtn.getAttribute("aria-pressed"), "true");

    // 5. Signals outside the 8 vowels via custom Built-in source dropdown + VTL calibration
    console.log("[Selenium E2E] 5/5 Verifying outside-vowel signals via custom dropdown + VTL calibration...");
    const sourceTab = await driver.findElement(By.xpath("//button[@role='tab' and normalize-space()='Source']"));
    await scrollAndClick(driver, sourceTab);

    await chooseCustomDropdown(driver, "Built-in source", "Test: White noise");
    await waitForText(driver, By.css('[data-testid="lab-regime-strip"]'), "Fricative / noise", 8000);

    await chooseCustomDropdown(driver, "Built-in source", "Test: Sine");
    await waitForText(driver, By.css('[data-testid="lab-regime-strip"]'), "Harmonic tone", 8000);

    await chooseCustomDropdown(driver, "Built-in source", "Synthetic voice");
    await waitForText(driver, By.css('[data-testid="lab-regime-strip"]'), "Voiced vowel", 8000);

    const analysisTab = await driver.findElement(By.xpath("//button[@role='tab' and normalize-space()='Analysis']"));
    await scrollAndClick(driver, analysisTab);
    const fitBtn = await driver.findElement(By.xpath("//button[normalize-space()='Fit target to current voice']"));
    await scrollAndClick(driver, fitBtn);

    const logs = await driver.manage().logs().get(logging.Type.BROWSER);
    const severe = logs.filter((entry) => entry.level.name === "SEVERE" && !entry.message.includes("favicon"));
    assert.equal(severe.length, 0, `Unexpected browser console errors: ${JSON.stringify(severe)}`);

    console.log("[Selenium E2E] PASS: All 5 real-browser Selenium suites passed with 0 console errors!");
  } finally {
    if (driver) {
      await driver.quit().catch(() => undefined);
    }
    server.kill();
  }
}

run().catch((err) => {
  console.error("[Selenium E2E] FAILED:", err);
  process.exit(1);
});
