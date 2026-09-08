const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const [root, directory] = process.argv.slice(2);
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();

const plugin = path.join(root, "community/plugins/pets");
const source = fs.readFileSync(path.join(plugin, "index.js"), "utf8");
const surface = source.slice(0, source.indexOf("/* ═══ PART TWO"));
const rocky = fs.readFileSync(path.join(plugin, "assets/rocky.webp"));

// A valid ignored RIFF chunk makes the bundled artwork as large as generated
// pets, without committing personal artwork or a multi-megabyte test fixture.
const padding = Buffer.alloc(8 + 2 * 1024 * 1024);
padding.write("JUNK");
padding.writeUInt32LE(padding.length - 8, 4);
const large = Buffer.concat([rocky, padding]);
large.writeUInt32LE(large.length - 8, 4);
const dataUrl = (bytes) => `data:image/webp;base64,${bytes.toString("base64")}`;
const rockyUrl = dataUrl(rocky);
const largeUrl = dataUrl(large);
const css = ["pet.css", "hud.css"].map((name) =>
  fs.readFileSync(path.join(plugin, "styles", name), "utf8")
).join("\n").replaceAll("../assets/rocky.webp", rockyUrl);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true }
  });
  let renderedSheets = 0;
  const evaluate = (expression) => window.webContents.executeJavaScript(expression);
  const checkSheet = async (expectedUrl, expectedPet) => {
    const result = await evaluate(`(async () => {
      const pet = document.querySelector('.bettergravity-pet');
      const sprite = pet.querySelector('.bettergravity-pet__body');
      const background = getComputedStyle(sprite).backgroundImage;
      if (background === 'none') throw new Error('Pet has no rendered background image');
      const url = JSON.parse(background.slice(4, -1));
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 208;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, 192, 208, 0, 0, 192, 208);
      const pixels = context.getImageData(0, 0, 192, 208).data;
      let visiblePixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visiblePixels++;
      return {
        correctSheet: url === ${JSON.stringify(expectedUrl)},
        pet: pet.dataset.pet,
        width: image.naturalWidth,
        height: image.naturalHeight,
        visiblePixels
      };
    })()`);
    assert.equal(result.correctSheet, true, "The selected sheet must reach the sprite");
    assert.equal(result.pet, expectedPet);
    assert.equal(result.width, 1536);
    assert.equal(result.height, 2288);
    assert.ok(result.visiblePixels > 100, "The rendered sheet must decode into visible artwork");
    renderedSheets++;
  };
  const selectSheet = (sheet) => evaluate(`receivePetMessage({ t: 'config', config: { sheet: ${JSON.stringify(sheet)} } })`);

  try {
    await window.loadURL("data:text/html,<!doctype html><html><body></body></html>");
    await window.webContents.insertCSS(css);
    for (const desktop of [false, true]) {
      await evaluate(`${surface}\npetSurface({
        send() {}, setInteractive() {}, setFocusable() {},
        onMessage(listener) { window.receivePetMessage = listener; return () => {}; }
      }, ${JSON.stringify({ desktop, at: { x: 200, y: 200 }, config: { sheet: largeUrl } })});`);
      await checkSheet(largeUrl, "custom");
      await selectSheet("");
      await checkSheet(rockyUrl, "rocky");
      await selectSheet(rockyUrl);
      await checkSheet(rockyUrl, "custom");
      await selectSheet("file:///unsupported.webp");
      await checkSheet(rockyUrl, "rocky");
      await selectSheet(largeUrl);
      await checkSheet(largeUrl, "custom");
      await evaluate("receivePetMessage({ t: 'bye' })");
    }
    fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify({ homes: 2, renderedSheets }));
    window.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    window.destroy();
    app.exit(1);
  }
}).catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  app.exit(1);
});
