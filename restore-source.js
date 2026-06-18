// Rebuilds the uploaded source bundle into editable project files.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const partsDir = path.join(__dirname, "source-parts");
const outDir = path.join(__dirname, "restored-source");

const partFiles = fs.readdirSync(partsDir)
  .filter((name) => name.startsWith("ud-smartdesk-source.txt.br.b64.part"))
  .sort();

if (partFiles.length !== 9) {
  throw new Error(`Expected 9 source parts, found ${partFiles.length}`);
}

const base64 = partFiles
  .map((name) => fs.readFileSync(path.join(partsDir, name), "utf8").trim())
  .join("");

const packed = Buffer.from(base64, "base64");
const sourceText = zlib.brotliDecompressSync(packed).toString("utf8");
const fileRegex = /=====FILE:(.+?)=====\r?\n([\s\S]*?)\r?\n=====END:\1=====\r?\n?/g;

fs.mkdirSync(outDir, { recursive: true });

const restored = [];
let match;
while ((match = fileRegex.exec(sourceText))) {
  const fileName = match[1];
  const content = match[2];
  fs.writeFileSync(path.join(outDir, fileName), content, "utf8");
  restored.push(fileName);
}

if (restored.length !== 3) {
  throw new Error(`Expected 3 restored files, restored ${restored.length}`);
}

console.log(`Restored ${restored.length} files to ${outDir}`);
console.log(restored.join("\n"));
