import { fileURLToPath } from "node:url";
import path from "node:path";
import { spearHome } from "./paths.js";

/** Absolute path to the compiled CLI entrypoint (dist/cli.js), sitting next to this module. */
export function resolveCliPath(): string {
  if (process.env.SPEAR_CLI_PATH) return process.env.SPEAR_CLI_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "cli.js");
}

export interface PlistOptions {
  hour: number;
  minute: number;
  nodePath?: string;
  cliPath?: string;
  label?: string;
}

/** Build a launchd plist that runs `spear morning` at the configured local time. */
export function buildMorningPlist(opts: PlistOptions): string {
  const node = opts.nodePath ?? process.execPath;
  const cli = opts.cliPath ?? resolveCliPath();
  const label = opts.label ?? "com.spear.morning";
  const logDir = spearHome();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${cli}</string>
    <string>morning</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${opts.hour}</integer>
    <key>Minute</key>
    <integer>${opts.minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, "morning.out.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, "morning.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`;
}
