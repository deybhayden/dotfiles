#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

if (process.argv.length < 3) {
  console.error("Usage: node minify-json.js <input.json>");
  process.exit(1);
}

const inputFile = process.argv[2];

try {
  const raw = fs.readFileSync(inputFile, "utf8");
  const data = JSON.parse(raw);

  const minified = JSON.stringify(data);

  const { name, ext, dir } = path.parse(inputFile);
  const outputFile = path.join(dir, `${name}.min${ext}`);

  fs.writeFileSync(outputFile, minified);

  console.log(`Minified JSON written to: ${outputFile}`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
