import { spawnSync } from "node:child_process";

const PY_PROBE = "import yaml";

const PY_CHECK = `
import json, sys, yaml

paths = json.load(sys.stdin)
failures = []
for path in paths:
    try:
        with open(path, encoding="utf8") as handle:
            text = handle.read()
    except OSError as error:
        failures.append([path, "could not read: %s" % error])
        continue
    lines = text.replace("\\r\\n", "\\n").split("\\n")
    if not lines or lines[0] != "---":
        failures.append([path, "missing opening --- marker"])
        continue
    block = []
    closed = False
    for line in lines[1:]:
        if line == "---":
            closed = True
            break
        block.append(line)
    if not closed:
        failures.append([path, "missing closing --- marker"])
        continue
    try:
        value = yaml.safe_load("\\n".join(block))
    except Exception as error:
        failures.append([path, str(error).replace("\\n", " ")])
        continue
    if not isinstance(value, dict):
        failures.append([path, "front matter is not a YAML mapping"])
json.dump(failures, sys.stdout)
`;

export function pythonYamlAvailable() {
  const probe = spawnSync("python3", ["-c", PY_PROBE], { encoding: "utf8" });
  return probe.status === 0;
}

export function pythonYamlCheck(paths) {
  if (paths.length === 0) return { available: pythonYamlAvailable(), failures: [] };
  const run = spawnSync("python3", ["-c", PY_CHECK], {
    input: JSON.stringify(paths),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    return { available: false, failures: [] };
  }
  try {
    return { available: true, failures: JSON.parse(run.stdout) };
  } catch {
    return { available: false, failures: [] };
  }
}

export function assertPythonYamlParses(paths, context) {
  const result = pythonYamlCheck(paths);
  if (!result.available) {
    console.log(`  (python3 + PyYAML unavailable, skipped the cross-check for ${context})`);
    return false;
  }
  if (result.failures.length > 0) {
    const detail = result.failures.map(([path, message]) => `  ${path}: ${message}`).join("\n");
    throw new Error(`PyYAML rejected ${result.failures.length} file(s) in ${context}:\n${detail}`);
  }
  console.log(`  PyYAML parsed ${paths.length} file(s) in ${context}`);
  return true;
}
