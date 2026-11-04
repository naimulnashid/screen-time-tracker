// The dashboard's version, from the file a release bumps, so the footer names
// the latest release. vercel.json rebuilds the site when that file changes.
import pkg from '../../../package.json';

const version = (pkg as { version?: string }).version;
if (!version) throw new Error('No "version" in package.json');

/** The public repository: every outbound link on the page points into it. */
export const REPO = 'https://github.com/naimulnashid/screen-time-tracker';

const file = (path: string) => `${REPO}/blob/master/${path}`;

export const SITE = {
  name: 'Screen Time Tracker',
  title: 'Screen Time Tracker: per-app screen time, kept for good',
  description:
    'A local dashboard of how long each app was really in the foreground, on a Windows PC and Android phones, ' +
    'kept on a drive that survives a Windows reset.',
  author: 'Md. Naimul Hasan Nashid',
  version: `v${version}`,
};

export const LINKS = {
  repo: REPO,
  // The latest release page, not a file: the phone app's asset name carries its version.
  releases: `${REPO}/releases/latest`,
  issues: `${REPO}/issues`,
  license: file('LICENSE'),
  security: file('SECURITY.md'),
  setup: `${REPO}#installation-and-getting-started`,
  config: `${REPO}#configuration`,
  phone: `${REPO}#3-add-an-android-phone-optional`,
  recovery: `${REPO}#recovery-after-a-windows-reset`,
  design: file('docs/DEVLOG.md'),
};
