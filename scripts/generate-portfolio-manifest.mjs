import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portfolioRoot = path.join(root, "public", "portfolio");
const manifestPath = path.join(portfolioRoot, "manifest.json");

const folders = {
  pictures: { directory: "project", extensions: new Set([".jpg", ".jpeg", ".png", ".webp"]) },
  games: { directory: "games", extensions: new Set([".jpg", ".jpeg", ".png", ".webp"]) },
  certificates: { directory: "certificates", extensions: new Set([".pdf"]) },
};

const titleFromFile = (filename) =>
  path
    .basename(filename, path.extname(filename))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const encodePath = (...segments) =>
  `/portfolio/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;

const certificatePreviews = new Set(
  await readdir(path.join(portfolioRoot, "certificates", "thumbnails")).catch(() => [])
);

const manifest = {};
for (const [key, config] of Object.entries(folders)) {
  const filenames = await readdir(path.join(portfolioRoot, config.directory));
  manifest[key] = filenames
    .filter((filename) => config.extensions.has(path.extname(filename).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((filename) => {
      const item = {
        src: encodePath(config.directory, filename),
        title: titleFromFile(filename),
      };
      if (key === "certificates") {
        const previewName = `${path.basename(filename, path.extname(filename))}.png`;
        if (certificatePreviews.has(previewName)) {
          item.thumbnail = encodePath(config.directory, "thumbnails", previewName);
        }
      }
      return item;
    });
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(
  `Portfolio manifest: ${manifest.pictures.length} pictures, ${manifest.games.length} game images, ${manifest.certificates.length} certificates.`
);
