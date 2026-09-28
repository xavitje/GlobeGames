import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectJavaScript(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? collectJavaScript(path) : path.endsWith(".js") ? [path] : [];
  });
}

const files = [...collectJavaScript("src"), ...collectJavaScript("scripts")];
const failures = files.filter((file) => spawnSync(process.execPath, ["--check", file], { stdio: "inherit" }).status !== 0);

if (failures.length) process.exitCode = 1;
else console.log(`Checked ${files.length} JavaScript files.`);

