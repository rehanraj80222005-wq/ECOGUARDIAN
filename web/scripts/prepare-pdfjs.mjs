import { mkdir, copyFile, cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("pdfjs-dist/package.json");
const packageDirectory = path.dirname(packagePath);
const packageInfo = JSON.parse(await readFile(packagePath, "utf8"));

const destination = path.resolve(
  "public",
  "pdfjs",
  packageInfo.version
);

await mkdir(destination, { recursive: true });

await copyFile(
  path.join(packageDirectory, "build", "pdf.worker.min.mjs"),
  path.join(destination, "pdf.worker.min.mjs")
);

for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(
    path.join(packageDirectory, directory),
    path.join(destination, directory),
    { recursive: true }
  );
}

console.log(`Prepared PDF.js ${packageInfo.version} browser assets.`);