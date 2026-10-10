import contractPy from "../../python/policy/contract.py?raw";
import entryPy from "../../python/policy/entry.py?raw";
import initPy from "../../python/policy/__init__.py?raw";
import policyPy from "../../python/policy/policy.py?raw";
import schemaJson from "../../contracts/worker-v2/worker-v2.schema.json?raw";

/** Archivos que el worker escribe en el sistema de archivos de Pyodide: no hay descargas durante la partida. */
export const POLICY_FILES: Readonly<Record<string, string>> = {
  "__init__.py": initPy,
  "contract.py": contractPy,
  "policy.py": policyPy,
  "entry.py": entryPy,
  "worker-v2.schema.json": schemaJson,
};
