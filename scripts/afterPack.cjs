// electron-builder afterPack hook — ad-hoc code-sign the macOS .app.
//
// We have no Apple Developer ID (build.mac.identity is null), so electron-builder
// skips signing entirely and ships a bundle with no `_CodeSignature` seal. macOS
// Gatekeeper reports such a bundle as "'spear.app' is damaged and can't be opened"
// and offers no bypass — every download is dead on arrival.
//
// afterPack runs after the app is packed but BEFORE the dmg is built and before
// electron-builder's own (skipped) signing step, so an ad-hoc signature here is
// what ends up inside the published dmg. Ad-hoc signing (`codesign --sign -`)
// seals the bundle: after the user clears the download quarantine
// (`xattr -dr com.apple.quarantine`), the app launches, and the Gatekeeper prompt
// downgrades from the un-bypassable "damaged" to the bypassable
// "unidentified developer" (right-click -> Open).
//
// The real fix for a quarantine-free download is Developer ID signing + notarization
// (needs an Apple Developer account + CSC_* / notarize secrets); this hook is the
// no-account floor that at least makes the build installable.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  // Fail the build loudly if the seal didn't take.
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  console.log(`[afterPack] signature verified`);
};
