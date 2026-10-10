// Copia el runtime de Pyodide fijado en package.json a public/vendor y registra su procedencia.
// Pyodide se sirve desde el mismo sitio: no hay descargas dinámicas durante la partida.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pyodide");
const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const target = join(root, "public", "vendor", "pyodide", pkg.version);
const files = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
mkdirSync(target, { recursive: true });

const entries = files.map((name) => {
  const from = join(source, name);
  const to = join(target, name);
  if (!existsSync(to) || statSync(to).size !== statSync(from).size || sha256(to) !== sha256(from)) copyFileSync(from, to);
  return { file: name, bytes: statSync(to).size, sha256: sha256(to) };
});

const provenance = {
  component: "Pyodide",
  version: pkg.version,
  license: pkg.license,
  licenseUrl: "https://github.com/pyodide/pyodide/blob/main/LICENSE",
  origin: `paquete npm pyodide@${pkg.version} (node_modules)`,
  files: entries,
};
writeFileSync(join(target, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Pyodide ${pkg.version} disponible en ${target}`);
