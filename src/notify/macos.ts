import { exec } from "node:child_process";

function escape(s: string): string {
  return s.replace(/["\\]/g, "\\$&").replace(/\n/g, " ");
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`command -v ${cmd}`, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

/**
 * Fire a macOS notification. Uses terminal-notifier (clickable → opens the
 * dashboard) when installed, else falls back to osascript. No-op off macOS or
 * when SPEAR_NO_NOTIFY is set.
 */
export async function notify(title: string, body: string, url?: string): Promise<void> {
  if (process.env.SPEAR_NO_NOTIFY) return;
  if (process.platform !== "darwin") return;

  const tn = await which("terminal-notifier");
  if (tn) {
    const openArg = url ? ` -open "${escape(url)}"` : "";
    exec(`terminal-notifier -title "${escape(title)}" -message "${escape(body)}"${openArg} -sound default`);
    return;
  }
  exec(`osascript -e 'display notification "${escape(body)}" with title "${escape(title)}"'`);
}
