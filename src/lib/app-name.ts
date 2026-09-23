/**
 * Turning what the sampler recorded into what a person calls the app.
 *
 * The sampler stores a raw identity -- usually a full exe path, sometimes a
 * bare process name when Windows refused `.Path`. Display names are resolved
 * HERE, in code, and never stored, so these rules can be corrected without
 * re-ingesting a single row.
 *
 * ---------------------------------------------------------------------------
 * FOUR RULES, three of them learned the hard way in the sibling project.
 *
 * 1. VERSIONED INSTALL PATHS SPLIT ONE APP INTO MANY. A packaged app lives
 *    under `WindowsApps\Claude_1.40609.0.0_x64__pzs8sxrjxfjjc\`, and the
 *    version is in the directory name, so an update silently creates a second
 *    app with the same name. Group on the identity that survives the update.
 *
 * 2. GENERIC BASENAMES MUST BE KEYED BY DIRECTORY. `setup.exe` is Visual
 *    Studio's installer in one path and NVIDIA's in another; grouping on the
 *    basename merged them and labelled the result "setup.exe". Same for
 *    `app.exe`, `launcher.exe`, `updater.exe`.
 *
 * 3. A DISPLAY NAME MUST BE UNIQUE ACROSS KEYS. The colour map is keyed by
 *    display name, so two keys sharing a label silently share a colour. If you
 *    add an entry below, check it does not collide with one already there.
 *
 * 4. THE FALLBACK MUST STAY RECOGNISABLE. An unknown exe keeps its basename,
 *    with word breaks inserted and nothing else -- if the dashboard says
 *    "Zephyrus Control", nobody can find that in Task Manager. Spaces are the
 *    one safe edit: `logoKey()` strips them, so "InternetSpeedMeter" and
 *    "Internet Speed Meter" are still the same app to the logo and colour
 *    lookups, and still the same string to a person searching for it.
 *
 * 5. A PACKAGE FAMILY IS NOT A DISPLAY NAME. `B9ECED6F.ArmouryCrate` and
 *    `OpenAI.Codex` are identifiers with a publisher namespace bolted on the
 *    front, and the exe inside is often named something else again
 *    (`OpenAI.Codexpp\ChatGPT.exe`). Every packaged name below was read
 *    from Windows itself -- `Get-StartApps` and the package manifest -- not
 *    guessed from the folder.
 * ---------------------------------------------------------------------------
 */

export interface ResolvedApp {
  /** Stable grouping key. Survives version bumps and path changes. */
  key: string;
  /** What the dashboard shows. */
  name: string;
  /** True when this is a Windows component rather than something you chose. */
  system: boolean;
}

/**
 * Basenames whose display name Windows itself would show, or that are
 * otherwise unguessable from the file name.
 *
 * Lowercase keys, without `.exe`. `key` overrides the grouping key, and exists
 * for the case where two different exes ARE one app -- rule 3 says a display
 * name must be unique across keys, so two rows both labelled "7-Zip" is not an
 * option and merging them is the honest answer.
 *
 * This map is checked BEFORE the packaged-app branch, and deliberately: a
 * store app's exe name is a better clue than its package family, and matching
 * here still takes the stable `appx:` key from the folder. `ChatGPT.exe` under
 * `OpenAI.Codex_...` is exactly that case.
 */
const KNOWN: Record<string, { name: string; system?: boolean; key?: string }> = {
  // Shell and desktop
  explorer: { name: 'File Explorer', system: true },
  dwm: { name: 'Desktop Window Manager', system: true },
  applicationframehost: { name: 'Store App (unresolved)', system: true },
  searchhost: { name: 'Windows Search', system: true },
  startmenuexperiencehost: { name: 'Start Menu', system: true },
  // Three hosts, one surface: the taskbar's flyouts. ShellExperienceHost draws
  // the notification centre and calendar, ShellHost the Windows 11 Quick
  // Settings panel, and sihost (Shell Infrastructure Host) the odd toast
  // between them. Which exe owns a given flyout moves between Windows builds,
  // so as three rows they split one habit -- clicking the corner of the
  // taskbar -- by an implementation detail. Search and Start stay apart: they
  // are surfaces a person names.
  shellexperiencehost: { name: 'Windows Shell', system: true, key: 'exe:shellexperiencehost' },
  shellhost: { name: 'Windows Shell', system: true, key: 'exe:shellexperiencehost' },
  sihost: { name: 'Windows Shell', system: true, key: 'exe:shellexperiencehost' },
  textinputhost: { name: 'Text Input', system: true },
  // "Windows Settings", not "Settings" -- see the note on cross-device names
  // below the map.
  systemsettings: { name: 'Windows Settings', system: true },
  taskmgr: { name: 'Task Manager', system: true },
  lockapp: { name: 'Lock Screen', system: true },
  logonui: { name: 'Sign-in Screen', system: true },
  rundll32: { name: 'Windows Host Process', system: true },
  // The Windows 11 shell surfaces. Their exe names read as internals, which is
  // what they are -- but they hold real foreground time, so they need a label
  // a person can place. Both were read from their FileDescription ("File
  // Picker UI Host", "Microsoft Management Console").
  pickerhost: { name: 'File Picker', system: true },
  mmc: { name: 'Microsoft Management Console', system: true },
  gameinputsvc: { name: 'Game Input Service', system: true },
  // Not a Windows component, but not something you chose either: it is the
  // runtime other apps host their UI in, so it belongs with them.
  msedgewebview2: { name: 'Microsoft Edge WebView2', system: true },

  // Browsers
  msedge: { name: 'Microsoft Edge' },
  chrome: { name: 'Google Chrome' },
  brave: { name: 'Brave' },
  firefox: { name: 'Firefox' },

  // Editors and terminals
  code: { name: 'VS Code' },
  devenv: { name: 'Visual Studio' },
  windowsterminal: { name: 'Windows Terminal' },
  powershell: { name: 'Windows PowerShell' },
  pwsh: { name: 'PowerShell 7' },
  cmd: { name: 'Command Prompt', system: true },
  conhost: { name: 'Console Host', system: true },

  // Everyday
  claude: { name: 'Claude' },
  vlc: { name: 'VLC' },
  qbittorrent: { name: 'qBittorrent' },
  spotify: { name: 'Spotify' },
  discord: { name: 'Discord' },
  telegram: { name: 'Telegram' },
  whatsapp: { name: 'WhatsApp' },
  // One app, two exes -- the file manager and the extraction dialog. Sharing a
  // key merges them; sharing only a NAME would put two "7-Zip" rows on the
  // page and give them the same colour (rule 3).
  '7zg': { name: '7-Zip', key: 'exe:7-zip' },
  '7zfm': { name: '7-Zip', key: 'exe:7-zip' },
  notepad: { name: 'Notepad' },
  mspaint: { name: 'Paint' },
  winword: { name: 'Word' },
  excel: { name: 'Excel' },
  powerpnt: { name: 'PowerPoint' },
  outlook: { name: 'Outlook' },

  // Store apps, keyed by the exe inside the package. Every name here came from
  // `Get-StartApps` or the package manifest, because the package family lies:
  // `OpenAI.Codex` ships `ChatGPT.exe` and Windows calls it ChatGPT.
  chatgpt: { name: 'ChatGPT' },
  armourycrate: { name: 'Armoury Crate' },
  'winstore.app': { name: 'Microsoft Store' },
  snippingtool: { name: 'Snipping Tool' },
  windowscamera: { name: 'Windows Camera' },
  photos: { name: 'Windows Photos' },

  // Desktop apps whose exe name is not their name. FileDescription, read off
  // the binaries on this machine.
  googledrivefs: { name: 'Google Drive' },
  studio64: { name: 'Android Studio' },
  resolve: { name: 'DaVinci Resolve' },
  'powertoys.settings': { name: 'PowerToys Settings' },
  // The Control Panel, and the container that hosts its desktop right-click
  // entry and tray menu. The container is recorded as a bare process name
  // (Windows refuses its `.Path` unelevated), so it cannot inherit the
  // package key and has to be pointed at it. The NVIDIA App is a different
  // program -- GeForce Experience's successor -- and stays its own row.
  nvcplui: { name: 'NVIDIA Control Panel', key: 'appx:nvidiacorp.nvidiacontrolpanel_56jybvy8sckqj' },
  'nvdisplay.container': { name: 'NVIDIA Control Panel', key: 'appx:nvidiacorp.nvidiacontrolpanel_56jybvy8sckqj' },
  // No FileDescription; identified by its path, under the Android SDK's
  // `emulator\qemu\`. "qemu-system-x86_64" is true and tells you nothing.
  'qemu-system-x86_64': { name: 'Android Emulator' },
};

/**
 * ⚠️ WHY THREE OF THOSE SAY "WINDOWS" WHEN THE START MENU DOES NOT.
 *
 * Windows calls them Camera, Photos and Settings. The dashboard covers a
 * laptop AND a phone, and the phone has apps by those exact names -- measured
 * against `android_apps`, the full overlap is:
 *
 *   Brave  ChatGPT  Claude  Telegram  VLC     same app on both devices
 *   Camera  Photos  Settings                  DIFFERENT apps, same word
 *
 * The first group SHOULD share a name: one app, one logo, one colour. The
 * second must not, because logos and brand colours are keyed by display name
 * across the whole dashboard, so "Photos" would hand the Windows app Google
 * Photos' pinwheel -- and it did, in the other direction: `Photos.png` (the
 * Windows icon) sorted ahead of `Photos.svg` and was being served for the
 * PHONE'S Google Photos.
 *
 * So the rule is narrower than "prefix Windows apps": disambiguate only where
 * one name would name two different programs.
 */

/**
 * The map above, for `scripts/selftest.ts`.
 *
 * Exported so rule 3 can be checked mechanically over every entry rather than
 * over the handful a test remembers to name. Nothing in the app reads it --
 * `resolveApp` is the only way in.
 */
export function knownApps(): Readonly<typeof KNOWN> {
  return KNOWN;
}

/**
 * Basenames too generic to identify an app on their own.
 *
 * These get their parent directory folded into the key, so two different
 * `setup.exe` stay two different rows instead of merging into one mystery.
 */
const GENERIC = new Set([
  'setup', 'install', 'installer', 'update', 'updater', 'launcher',
  'app', 'main', 'start', 'run', 'host', 'helper', 'service', 'client',
]);

/** Windows' own directories, for deciding whether something is a component. */
const SYSTEM_DIRS = ['\\windows\\', '\\system32\\', '\\syswow64\\'];

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Insert word breaks into a CamelCase run, WITHOUT wrecking acronyms.
 *
 * The naive `([a-z0-9])([A-Z])` split is what the packaged branch used to do,
 * and it turns `HWiNFO64` into "HWi NFO64" -- a name that reads as corrupted
 * data rather than as a program. Requiring the capital to be FOLLOWED BY A
 * LOWERCASE letter means a break is only made where a new word demonstrably
 * starts:
 *
 *   InternetSpeedMeter -> Internet Speed Meter   (t|Sp and d|Me both split)
 *   ArmouryCrate       -> Armoury Crate
 *   HWiNFO64           -> HWiNFO64               (i|NF -- N leads no word)
 *   ChatGPT            -> ChatGPT
 *
 * It still cannot know that "PowerToys" is one word; nothing can, short of a
 * list. That is what `KNOWN` is for, and why a wrong break is acceptable here:
 * the string stays searchable either way, which is rule 4.
 */
function splitWords(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])(?=[a-z])/g, '$1 $2');
}

/**
 * Pull the app identity out of a packaged (`WindowsApps`) path.
 *
 * `...\WindowsApps\Claude_1.40609.0.0_x64__pzs8sxrjxfjjc\app\Claude.exe`
 * The folder is `Name_Version_Arch__PublisherId`. The VERSION changes on every
 * update, so keying on the folder verbatim creates a brand new app each time
 * the store updates something -- rule 1. Name plus publisher is stable.
 */
function packagedIdentity(path: string): { key: string; name: string } | null {
  const m = /\\windowsapps\\([^\\]+)\\/i.exec(path);
  if (!m) return null;
  const folder = m[1]!;
  const parts = folder.split('_');
  if (parts.length < 2) return null;
  const family = parts[0]!;
  const publisher = parts[parts.length - 1]!;

  // The family is dotted, and everything before the last dot is a PUBLISHER
  // NAMESPACE rather than part of the name: `Microsoft.Windows.Photos` is
  // Photos and `B9ECED6F.ArmouryCrate` is Armoury Crate. Printing the
  // namespace produced rows labelled "B9 ECED6 F.Armoury Crate" -- rule 5.
  const leaf = family.split('.').pop() || family;

  // Publisher id keeps two vendors' same-named packages apart. It stays in the
  // KEY, where it does that job, and out of the NAME, where it does not.
  return {
    key: `appx:${family.toLowerCase()}_${publisher.toLowerCase()}`,
    name: splitWords(leaf),
  };
}

/** The last path component, without extension. */
function basename(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '');
  const last = cleaned.split(/[\\/]/).pop() ?? cleaned;
  return last.replace(/\.exe$/i, '');
}

/** The immediate parent directory name, for disambiguating generic basenames. */
function parentDir(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2]! : '';
}

/**
 * Resolve one stored identity.
 *
 * `identity` is `app_path` from the database: a full path, or a bare process
 * name when Windows refused `.Path` (protected processes do, unelevated).
 */
export function resolveApp(identity: string): ResolvedApp {
  const raw = (identity ?? '').trim();
  if (!raw) return { key: 'unknown', name: 'Unknown', system: true };

  const lower = raw.toLowerCase();
  const isPath = /[\\/]/.test(raw);
  const base = basename(raw).toLowerCase();

  // A packaged app is identified by its package folder, not its exe, so a
  // store update does not create a second entry.
  const packaged = isPath ? packagedIdentity(raw) : null;

  const known = KNOWN[base];
  const inSystemDir = isPath && SYSTEM_DIRS.some((d) => lower.includes(d));

  if (known) {
    return {
      key: known.key ?? packaged?.key ?? `exe:${base}`,
      name: known.name,
      system: known.system ?? false,
    };
  }

  if (packaged) {
    return { key: packaged.key, name: packaged.name, system: false };
  }

  if (GENERIC.has(base) && isPath) {
    // Rule 2: keyed by directory, and NAMED by it too -- "Setup" alone tells
    // the reader nothing about which installer they were looking at.
    const dir = parentDir(raw);
    return {
      key: `exe:${dir.toLowerCase()}/${base}`,
      name: dir ? `${titleCase(dir)} (${base}.exe)` : `${base}.exe`,
      system: inSystemDir,
    };
  }

  // An installer unpacked into TEMP runs under a randomly generated name, so
  // there is nothing to look up and nothing to remember: `hwi64_852.tmp` is
  // real, unique to one run, and says nothing. Keep the string -- it is the
  // only handle on it -- and say what kind of thing it was.
  if (/\.tmp$/i.test(base)) {
    return { key: `exe:${base}`, name: `Installer (${basename(raw)})`, system: false };
  }

  // Rule 4: unknown exes keep the name you would see in Task Manager, with
  // word breaks put in. The KEY is built from the unsplit basename, so adding
  // one of these to KNOWN later regroups nothing and rewrites no history.
  return { key: `exe:${base}`, name: splitWords(basename(raw)), system: inSystemDir };
}

