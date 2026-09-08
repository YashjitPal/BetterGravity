import fs from "node:fs";
import { app, nativeImage, WebContentsView } from "electron";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

interface PetImage {
  width: number;
  height: number;
  previewDataUrl: string;
}

/** Electron's nativeImage does not decode WebP on every platform. */
export class PetImageReader {
  private view: WebContentsView | undefined;
  private ready: Promise<void> | undefined;
  private generation = 0;

  async read(file: string, sprite: boolean): Promise<PetImage> {
    const generation = this.generation;
    if (!/\.(png|webp)$/i.test(file) || fs.statSync(file).size > MAX_IMAGE_BYTES) {
      throw new Error("Pets need a PNG or WebP image of at most 12 MB.");
    }
    const bytes = fs.readFileSync(file);
    const image = nativeImage.createFromBuffer(bytes);
    if (!image.isEmpty()) {
      const size = image.getSize();
      if (sprite && (size.width !== 1536 || size.height !== 2288)) {
        throw new Error("The version 2 sprite sheet must be 1536 × 2288 pixels.");
      }
      const preview = sprite ? image.crop({ x: 0, y: 0, width: 192, height: 208 }) : image.resize({ width: 240 });
      return { ...size, previewDataUrl: preview.toDataURL() };
    }
    if (!/\.webp$/i.test(file)) throw new Error("The pet image could not be decoded.");

    await app.whenReady();
    if (generation !== this.generation) throw new Error("Pet image loading was cancelled.");
    if (!this.view || this.view.webContents.isDestroyed()) {
      // An unattached view supplies Chromium's image codec without adding a
      // desktop window or inheriting the host's plugin preload and session.
      this.view = new WebContentsView({ webPreferences: {
        partition: "bettergravity-pet-images", sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false
      } });
      this.view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      this.ready = this.view.webContents.loadURL("about:blank");
    }
    const contents = this.view.webContents;
    await this.ready;
    if (generation !== this.generation || contents.isDestroyed()) throw new Error("Pet image loading was cancelled.");
    const source = `data:image/webp;base64,${bytes.toString("base64")}`;
    return contents.executeJavaScript(`(async () => {
      let image;
      try { image = await createImageBitmap(await (await fetch(${JSON.stringify(source)})).blob()); }
      catch { throw new Error("The pet image could not be decoded."); }
      const width = image.width, height = image.height;
      if (${sprite} && (width !== 1536 || height !== 2288)) {
        image.close();
        throw new Error("The version 2 sprite sheet must be 1536 × 2288 pixels.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = ${sprite} ? 192 : 240;
      canvas.height = ${sprite} ? 208 : Math.max(1, Math.round(height * 240 / width));
      const context = canvas.getContext("2d");
      if (${sprite}) context.drawImage(image, 0, 0, 192, 208, 0, 0, 192, 208);
      else context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      return { width, height, previewDataUrl: canvas.toDataURL("image/png") };
    })()`) as Promise<PetImage>;
  }

  dispose(): void {
    this.generation++;
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = undefined;
    this.ready = undefined;
  }
}
