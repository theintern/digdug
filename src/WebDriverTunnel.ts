import Tunnel, { DownloadOptions, TunnelProperties } from './Tunnel';
import {
  CancellablePromise,
  createCompositeHandle,
  Handle,
  Task
} from '@theintern/common';
import {
  WebDriverConfig,
  WebDriverConfigOptions,
  webDriverConstructors
} from './lib/webDriverConfig';
import { join } from 'path';
import { format } from 'util';
import { fileExists, on, writeFile } from './lib/util';
import WebDriverProxy from './lib/WebDriverProxy';
import { ChildProcess } from 'child_process';
import { makeChildWithCommand } from './lib/tunnelChildProcesses';

export interface WebDriver {
  name: string;
  port: number;
  handle?: Handle;
  process?: ChildProcess;
  sessionInfo?: any;
  failedInitAttempts: number;
}

/**
 * WebDriver Tunnel options.
 */
export interface WebDriverTunnelOptions extends Partial<TunnelProperties> {
  // The directory that will receive the downloaded WebDriver executables.  The
  // tunnel will create a subdirectory for each browser name.
  driverDirectory?: string;
  // Options to controll which versions of the WebDriver executables to download
  // and run.
  drivers?: WebDriverTunnelDownloadOptions[];
  // The maximum number of times the tunnel will try to connect to a WebDriver
  // server before returning an error.
  maxConnectAttempts?: number;
  // When a WebDriver executable writes to stdout, the tunnel will request a new
  // session.  If the executable does not write to stdout, the tunnel will
  // wait this amount of time in milliseoncds before requesting a new session.
  // Default is 1000ms (1 second).
  startupWait?: number;
}

/**
 * Interface for the tunnel options "drivers" property in the
 */
export interface WebDriverTunnelDownloadOptions {
  // Driver name, usually same as browser name.
  name: string;
  // The base URL from which the driver executable will be downloaded.
  baseUrl?: string;
  // The version of the WebDriver executable to use.
  version?: string;
  // True indicates the WebDriver executable should not be downloaded.
  // Use this if the WebDriver executable is always available or if
  // the browser is not being uses.  By default, the tunnel downloads all of the
  // executables, whether they are used or not, when they cannot be found locally.
  noDownload?: boolean;
}

interface WebDriverDowloadFileOptions extends DownloadOptions {
  dontExtract: boolean;
  executable: string;
}

/**
 * A WebDriver tunnel that does NOT depend on Java. This tunnel downloads
 * WebDriver server executables for each supported browsers.
 * See webDriverConstructors in webDriverConfig.ts for a list of supported
 * browsers.
 *
 * Use WebDriverTunnelOptions to configure the tunnel to use different
 * versions of the WebDriver servers or even non-standard implementations.
 *
 * * `MicrosoftEdge`
 * * `chrome`
 * * `firefox`
 * * `internet explorer`
 * * `safari`
 */
export default class WebDriverTunnel extends Tunnel {
  readonly webDriverConfigs: { [key: string]: WebDriverConfig };
  webDriverProxy: WebDriverProxy;
  lastUsedPort: number;
  driverDirectory!: string;
  drivers!: WebDriverTunnelDownloadOptions[];
  maxConnectAttempts!: number;
  startupWait!: number;

  constructor(options: WebDriverTunnelOptions) {
    super(
      Object.assign(
        {
          driverDirectory: 'webdriver_tunnel',
          maxConnectAttempts: 3,
          startupWait: 1000
        },
        options
      )
    );

    const { pathname, port, maxConnectAttempts } = this;

    this.lastUsedPort = Number(this.port);

    // Instantiate the WebDriver config objects.  Pass the tunnel options
    // to each one as appropriate.
    const webDriverConfigs: {
      [key: string]: WebDriverConfig;
    } = (this.webDriverConfigs = {});

    Object.keys(webDriverConstructors).forEach(browserName => {
      const Constructor = webDriverConstructors[browserName];
      webDriverConfigs[browserName] = new Constructor(
        this.webDriverOptionsFactory(browserName) || {}
      );
    });

    this.webDriverProxy = new WebDriverProxy({
      port: Number(port),
      path: pathname,
      maxConnectAttempts: maxConnectAttempts,
      webDriverChildFactory: browserName => {
        return this.createWebDriverChild(browserName);
      },
      verbose: this.verbose
    });
  }

  /**
   * Find settings in the drivers property that correspond to the given browser name.
   * This code will use the first object it finds in the drivers array that matches the
   * browser name and ignore any others that match.
   * @param browserName
   */
  private webDriverOptionsFactory(browserName: string): WebDriverConfigOptions {
    const { drivers } = this;
    let options: WebDriverConfigOptions = {};

    drivers &&
      drivers.some(driverOptions => {
        if (driverOptions.name === browserName) {
          options = { ...driverOptions };
          return true;
        }
        return false;
      });

    return options;
  }

  get directory() {
    return join(this.basePath, this.driverDirectory);
  }

  get isDownloaded() {
    const { webDriverConfigs } = this;
    return !Object.keys(webDriverConfigs).some(browserName => {
      // Return true if WebDriver executable is missing.
      return !this.isWebDriverDownloaded(webDriverConfigs[browserName]);
    });
  }

  private isWebDriverDownloaded(config: WebDriverConfig) {
    return (
      config.noDownload ||
      fileExists(join(this.directory, config.directory, config.executable))
    );
  }

  download(forceDownload = false): CancellablePromise<void> {
    let tasks: CancellablePromise<void>[];
    const { webDriverConfigs } = this;

    return new Task(
      (resolve: (value?: PromiseLike<void>) => void) => {
        tasks = Object.keys(webDriverConfigs).map(browserName => {
          const config = webDriverConfigs[browserName];

          if (!forceDownload && this.isWebDriverDownloaded(config)) {
            return Task.resolve();
          }

          return this._downloadFile(config.url, this.proxy, {
            directory: config.directory,
            dontExtract: config.dontExtract,
            executable: config.executable
          } as WebDriverDowloadFileOptions);
        });

        Task.all(tasks).then(() => resolve());
      },
      () => {
        tasks &&
          tasks.forEach(task => {
            task.cancel();
          });
      }
    );
  }

  protected _postDownloadFile(
    data: Buffer,
    options: WebDriverDowloadFileOptions
  ) {
    if (options.dontExtract) {
      let directory = this.directory;
      if (options.directory) {
        directory = join(directory, options.directory);
      }
      return writeFile(data, join(directory, options.executable));
    }
    return super._postDownloadFile(data, options);
  }

  /**
   * Start the WebDriver server.
   * @param browserName The browser name associated with a WebDriver configuration.
   * @private
   */
  private createWebDriverChild(browserName: string): Promise<WebDriver> {
    const { startupWait, verbose } = this;

    return new Promise<WebDriver>((resolve, reject) => {
      // Look up the WebDriver config for the given browser name.
      let webDriver: WebDriver;
      const webDriverConfig = this.webDriverConfigs[browserName];
      if (!webDriverConfig) {
        reject(format('Could not find a configuration for %s.', browserName));
        return;
      }

      // Retrieve the command to execute.
      let command;
      if (webDriverConfig.noDownload) {
        command = webDriverConfig.executable;
      } else {
        command = join(
          this.directory,
          webDriverConfig.directory,
          webDriverConfig.executable
        );
      }
      const port = ++this.lastUsedPort;

      const childExecutor = (
        child: ChildProcess,
        resolve: () => void,
        reject: (reason: any) => void
      ) => {
        const handle = createCompositeHandle(
          on(child.stdout!, 'data', resolve),
          on(child.stderr!, 'data', resolve),
          on(child, 'error', (error: Error) => {
            reject(error);
          })
        );

        // Some WebDriver servers are silent.  Set a timer as a last resort.
        setTimeout(resolve, startupWait);

        // Create a WebDriver object that keeps track of data necessary to manage the
        // WebDriver connection.
        webDriver = {
          name: browserName,
          port: port,
          handle: handle,
          process: child,
          failedInitAttempts: 0
        };

        return handle;
      };

      console.log(
        format(
          'WebDriver Tunnel starting WebDriver server %s on port %s.',
          command,
          port
        )
      );
      makeChildWithCommand(
        command,
        childExecutor,
        webDriverConfig.makeCommandLineArgs(port, verbose),
        { env: process.env }
      )
        .then(() => {
          resolve(webDriver);
        })
        .catch((err: any) => {
          reject(err);
        });
    });
  }

  /**
   * Start the WebDriver tunnel.
   * @private
   */
  protected _start(): CancellablePromise<any> {
    return new Task((resolve: (value?: any | PromiseLike<any>) => void) => {
      this.webDriverProxy.start().then(resolve);
    });
  }

  /**
   * Stop the tunnel.
   * @private
   */
  protected _stop() {
    return this.webDriverProxy.stop();
  }

  sendJobState(): CancellablePromise<void> {
    // Do nothing
    return Task.resolve();
  }
}
