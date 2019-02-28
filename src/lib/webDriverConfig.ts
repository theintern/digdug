import { format } from 'util';
import { join } from 'path';
import { execSync } from 'child_process';

// TODO: Is there a better place to store these?
//   There will be... https://github.com/theintern/digdug/issues/71
const ChromeVersion = '74.0.3729.6';
const FirefoxVersion = '0.24.0';
const InternetExplorerVersion = '3.14.0';

// Microsoft is switching to using DISM for installing the Edge WebDriver.
// This is the last version that the tunnel can download and run.
const EdgeVersion = 17134;

const EdgeUUIDs: { [release: string]: string } = {
  '15063': '342316D7-EBE0-4F10-ABA2-AE8E0CDF36DD',
  '16299': 'D417998A-58EE-4EFE-A7CC-39EF9E020768',
  '17134': 'F8AF50AB-3C3A-4BC4-8773-DC27B32988DD'
};

export const CHROME = 'chrome';
export const FIREFOX = 'firefox';
export const SAFARI = 'safari';
export const EDGE = 'MicrosoftEdge';
export const INTERNET_EXPLORER = 'internet explorer';

export interface WebDriverConfig {
  // The WebDriver server's executable.  Not a path; only a file name,
  readonly executable: string;
  // The full URL needed to download the WebDriver executable.
  readonly url?: string;
  // The subdirectory in which the executable should be stored,
  readonly directory: string;
  // The browser name, used in desiredCapabilities, associated with the WebDriver.
  readonly name: string;
  // True indicates the WebDriver executable does not need to be downloaded.
  // It can always be found on the desired platform(s).
  readonly noDownload: boolean;
  // True indicates the downloaded file is the executable itself; no
  // unzipping needed.
  readonly dontExtract?: boolean;

  // Builds command line arguments for the WebDriver executable.
  makeCommandLineArgs(port: number, verbose: boolean): string[];
}

export interface WebDriverConfigCtor<T extends WebDriverConfigOptions> {
  new (config: T): WebDriverConfig;
}

export abstract class WebDriverConfigBase<T extends WebDriverConfigOptions> {
  protected config: T;

  protected constructor(config: T) {
    this.config = Object.assign(
      {
        arch: process.arch,
        platform: process.platform
      },
      config
    );
  }

  get noDownload() {
    return this.config.noDownload || false;
  }

  get directory() {
    const { name } = this;
    const { version, arch } = this.config;
    // if version and architecture is available, build the directory as
    // {webdriver name} / {version} / {architecture}
    let directory = version ? join(name, version) : name;
    directory = arch ? join(directory, arch) : directory;
    return directory.replace(/\s/g, '_');
  }

  abstract get name(): string;
}

export interface WebDriverConfigOptions {
  arch?: string;
  baseUrl?: string;
  platform?: string;
  version?: string;
  url?: string;
  // True indicates the WebDriver executable does not need to be downloaded.
  // It can always be found on the desired platform(s) or it is not being used.
  noDownload?: boolean;
}

function getWindowsBuildNumber(): string | undefined {
  if (process.platform === 'win32') {
    const result: Buffer = execSync('ver');
    if (result) {
      const ver = result.toString().trim();
      const parts = ver.split('.');
      return parts[2];
    }
  }
}

export class ChromeDriverConfig
  extends WebDriverConfigBase<WebDriverConfigOptions>
  implements WebDriverConfig {
  public readonly name: string;

  constructor(config: WebDriverConfigOptions) {
    super(
      Object.assign(
        {
          baseUrl: 'https://chromedriver.storage.googleapis.com',
          version: ChromeVersion
        },
        config
      )
    );

    this.name = CHROME;
  }

  get artifact() {
    const { config } = this;

    let platform = config.platform;
    if (platform === 'linux') {
      platform = 'linux' + (config.arch === 'x86' ? '32' : '64');
    } else if (platform === 'darwin') {
      const parts = String(config.version)
        .split('.')
        .map(Number);
      const isGreater = [2, 22].some(function(part, i) {
        return parts[i] > part;
      });
      platform = isGreater ? 'mac64' : 'mac32';
    }
    return format('chromedriver_%s.zip', platform);
  }

  get url() {
    const { config } = this;
    return format('%s/%s/%s', config.baseUrl, config.version, this.artifact);
  }

  get executable() {
    return this.config.platform === 'win32'
      ? 'chromedriver.exe'
      : 'chromedriver';
  }

  makeCommandLineArgs(port: number, verbose: boolean): string[] {
    const args = [];
    if (port) {
      args.push(format('--port=%s', port));
    }
    if (verbose) {
      args.push('--verbose');
    }
    return args;
  }
}

export class FirefoxDriverConfig
  extends WebDriverConfigBase<WebDriverConfigOptions>
  implements WebDriverConfig {
  public readonly name: string;

  constructor(config: WebDriverConfigOptions) {
    super(
      Object.assign(
        {
          baseUrl: 'https://github.com/mozilla/geckodriver/releases/download',
          version: FirefoxVersion
        },
        config
      )
    );

    this.name = FIREFOX;
  }

  get artifact() {
    const { config } = this;

    let platform = config.platform!;
    if (platform === 'linux') {
      platform = 'linux' + (config.arch === 'x64' ? '64' : '32');
    } else if (platform === 'win32') {
      platform = 'win' + (config.arch === 'x64' ? '64' : '32');
    } else if (platform === 'darwin') {
      platform = 'macos';
    }
    const extension = /^win/.test(platform) ? '.zip' : '.tar.gz';
    return format('geckodriver-v%s-%s%s', config.version, platform, extension);
  }

  get url() {
    const { config } = this;
    return format('%s/v%s/%s', config.baseUrl, config.version, this.artifact);
  }

  get executable() {
    return this.config.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver';
  }

  makeCommandLineArgs(port: number, verbose: boolean): string[] {
    const args = [];
    if (port) {
      args.push('-p');
      args.push(String(port));
    }
    if (verbose) {
      args.push('-vv');
    } else {
      // The exe needs to spit out something to stdio so we know it started.
      args.push('-v');
    }
    return args;
  }
}

export class SafariDriverConfig
  extends WebDriverConfigBase<WebDriverConfigOptions>
  implements WebDriverConfig {
  public name: string;
  public readonly executable: string;

  constructor(config: WebDriverConfigOptions) {
    super(config);

    this.name = SAFARI;
    this.executable = 'safaridriver';
    // Apple supports Safari on MacOS only and it is installed by default.
    // Force config.noDownload to true;
    this.config.noDownload = true;
  }

  makeCommandLineArgs(port: number): string[] {
    const args = [];
    if (port) {
      args.push(format('--port=%s', port));
    }
    return args;
  }
}

export interface EdgeDriverConfigOptions extends WebDriverConfigOptions {
  readonly uuid?: string;
}

export class EdgeDriverConfig
  extends WebDriverConfigBase<EdgeDriverConfigOptions>
  implements WebDriverConfig {
  public readonly name: string;
  public readonly dontExtract: boolean;

  private readonly artifact: string = 'MicrosoftWebDriver.exe';

  constructor(config: EdgeDriverConfigOptions) {
    super(
      Object.assign(
        {
          baseUrl: 'https://download.microsoft.com/download',
          version: getWindowsBuildNumber()
        },
        config
      )
    );

    const platform = process.platform;
    config = this.config;
    const downloadAvailable =
      platform === 'win32' &&
      config.version &&
      Number(config.version) <= EdgeVersion;
    config.noDownload = !downloadAvailable;

    this.name = EDGE;
    this.dontExtract = true;
  }

  get url() {
    const { config, artifact } = this;
    const { baseUrl, uuid, version = EdgeVersion } = config;
    const uuidToDowload = uuid || EdgeUUIDs[version];

    return format(
      '%s/%s/%s/%s/%s/%s',
      baseUrl,
      uuidToDowload[0],
      uuidToDowload[1],
      uuidToDowload[2],
      uuidToDowload,
      artifact
    );
  }

  get executable() {
    return this.artifact;
  }

  makeCommandLineArgs(port: number, verbose: boolean): string[] {
    const args = [];

    if (port) {
      args.push(format('--port=%s', port));
    }
    if (verbose) {
      args.push('--verbose');
    }
    return args;
  }
}

export class InternetExplorerConfig
  extends WebDriverConfigBase<WebDriverConfigOptions>
  implements WebDriverConfig {
  public readonly name: string;
  public readonly executable: string;

  constructor(config: WebDriverConfigOptions) {
    super(
      Object.assign(
        {
          baseUrl: 'https://selenium-release.storage.googleapis.com',
          version: InternetExplorerVersion
        },
        config
      )
    );

    this.name = INTERNET_EXPLORER;
    this.executable = 'IEDriverServer.exe';
    // Download only when the platform is Windows.
    this.config.noDownload = this.config.platform !== 'win32';
  }

  get artifact() {
    const { config } = this;
    const architecture = config.arch === 'x64' ? 'x64' : 'Win32';
    return format('IEDriverServer_%s_%s.zip', architecture, config.version);
  }

  get url() {
    const { config } = this;
    const { version = InternetExplorerVersion, baseUrl } = config;
    const majorMinorVersion = version.slice(0, version.lastIndexOf('.'));
    return format('%s/%s/%s', baseUrl, majorMinorVersion, this.artifact);
  }

  makeCommandLineArgs(port: number, verbose: boolean): string[] {
    const args = [];
    if (port) {
      args.push(format('/port=%s', port));
    }
    if (verbose) {
      args.push('/log-level=INFO');
    }
    return args;
  }
}

export const webDriverConstructors: {
  [key: string]: WebDriverConfigCtor<WebDriverConfigOptions>;
} = {};
webDriverConstructors[CHROME] = ChromeDriverConfig;
webDriverConstructors[FIREFOX] = FirefoxDriverConfig;
webDriverConstructors[SAFARI] = SafariDriverConfig;
webDriverConstructors[EDGE] = EdgeDriverConfig;
webDriverConstructors[INTERNET_EXPLORER] = InternetExplorerConfig;
