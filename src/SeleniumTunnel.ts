/**
 * @module digdug/SeleniumTunnel
 */

import Tunnel, { TunnelProperties, DownloadOptions, ChildExecutor } from './Tunnel';
import { format } from 'util';
import * as pathUtil from 'path';
import Task from 'dojo-core/async/Task';
import request, { Response } from 'dojo-core/request';
import * as util from './util';
import { Handle } from 'dojo-core/interfaces';

export interface DriverFile extends RemoteFile {
	seleniumProperty: string;
}

export interface RemoteFile {
	dontExtract?: boolean;
	executable: string;
	url: string;
}

export type DriverDescriptor = 'chrome' | 'ie' | 'firefox' | DriverFile | { name: string };

export interface SeleniumProperties extends TunnelProperties {
	seleniumArgs: string[];
	drivers: DriverDescriptor[];
	baseUrl: string;
	version: string;
	seleniumTimeout: number;
}

export type SeleniumOptions = Partial<SeleniumProperties>;

export interface SeleniumDownloadOptions extends DownloadOptions {
	executable?: string;
}

/**
 * A Selenium tunnel. This tunnel downloads the {@link http://www.seleniumhq.org/download/ Selenium-standalone server}
 * and any necessary WebDriver executables, and handles starting and stopping Selenium.
 *
 * The primary configuration option is {@linkcode module:digdug/SeleniumTunnel#drivers drivers}, which determines which
 * browsers the Selenium tunnel will support.
 *
 * Note that Java must be installed and in the system path to use this tunnel.
 *
 * @constructor module:digdug/SeleniumTunnel
 * @extends module:digdug/Tunnel
 */
export default class SeleniumTunnel extends Tunnel implements SeleniumProperties {
	/**
	 * Additional arguments to send to the Selenium server at startup
	 *
	 * @type {Array.<string>}
	 */
	seleniumArgs: string[];

	/**
	 * The desired Selenium drivers to install. Each entry may be a string or an object. Strings must be the names of
	 * existing drivers in SeleniumTunnel. An object with a 'name' property is a configuration object -- the name must
	 * be the name of an existing driver in SeleniumTunnel, and the remaining properties will be used to configure that
	 * driver. An object without a 'name' property is a driver definition. It must contain three properties:
	 *
	 *   - executable - the name of the driver executable
	 *   - url - the URL where the driver can be downloaded from
	 *   - seleniumProperty - the name of the Java property used to tell Selenium where the driver is
	 *
	 * @example
	 * 	[
	 *      'chrome',
	 *      {
	 *          name: 'firefox',
	 *          version: '0.8.0'
	 *      },
	 *      {
	 *          url: 'https://github.com/operasoftware/operachromiumdriver/releases/.../operadriver_mac64.zip',
	 *          executable: 'operadriver',
	 *          seleniumProperty: 'webdriver.opera.driver'
	 *      }
	 * 	]
	 *
	 * @type {Array.<string|Object>}
	 * @default [ 'chrome' ]
	 */
	drivers: DriverDescriptor[];

	/**
	 * The base address where Selenium artifacts may be found.
	 *
	 * @type {string}
	 * @default https://selenium-release.storage.googleapis.com
	 */
	baseUrl: string;

	/**
	 * The desired version of selenium to install.
	 *
	 * @type {string}
	 * @default 3.0.1
	 */
	version: string;

	/**
	 * Timeout in milliseconds for communicating with the Selenium server
	 *
	 * @type {number}
	 * @default 5000
	 */
	seleniumTimeout: number;

	get artifact() {
		return `selenium-server-standalone-${this.version}.jar`;
	}

	get directory() {
		return pathUtil.join(__dirname, 'selenium-standalone');
	}

	get executable() {
		return 'java';
	}

	get isDownloaded() {
		const directory = this.directory;
		return this._getDriverConfigs().every(config => {
				return util.fileExists(pathUtil.join(directory, config.executable));
			}) &&
			util.fileExists(pathUtil.join(directory, this.artifact));
	}

	get url() {
		const majorMinorVersion = this.version.slice(0, this.version.lastIndexOf('.'));
		return format('%s/%s/%s', this.baseUrl, majorMinorVersion, this.artifact);
	}

	constructor(options?: SeleniumOptions) {
		super(util.assign({
			drivers: [ 'chrome' ]
		}, options));
	}

	download(forceDownload = false): Task<any> {
		if (!forceDownload && this.isDownloaded) {
			return Task.resolve();
		}

		let tasks: Task<any>[];

		return new Task(
			(resolve, reject) => {
				const configs: RemoteFile[] = [
					{ url: this.url, executable: this.artifact },
					...this._getDriverConfigs()
				];

				tasks = configs.map(config => {
					const executable = config.executable;

					if (util.fileExists(pathUtil.join(this.directory, executable))) {
						return Task.resolve();
					}

					// TODO: progress events
					return this._downloadFile(config.url, this.proxy, <any> {
						executable
					});
				});

				resolve(Promise.all(tasks));
			},
			() => {
				tasks && tasks.forEach(task => {
					task.cancel();
				});
			}
		);
	}

	sendJobState() {
		// This is a noop for Selenium
		return Task.resolve();
	}

	protected _getDriverConfigs(): DriverFile[] {
		function getDriverConfig(name: string, options?: any) {
			const Constructor = driverNameMap[name];
			if (!Constructor) {
				throw new Error('Invalid driver name "' + name + '"');
			}
			return new Constructor(options);
		}

		return this.drivers.map(function (data) {
			if (typeof data === 'string') {
				return getDriverConfig(data);
			}

			if (typeof data === 'object' && (<any> data).name) {
				return getDriverConfig((<any> data).name, data);
			}

			// data is a driver definition
			return <DriverFile> data;
		});
	}

	protected _makeArgs(): string[] {
		const directory = this.directory;
		const driverConfigs = this._getDriverConfigs();
		const args: string[] = [];

		driverConfigs.reduce(function (args: string[], config) {
			const file = pathUtil.join(directory, config.executable);
			args.push('-D' + config.seleniumProperty + '=' + file);
			return args;
		}, args);

		if (this.seleniumArgs) {
			args.push(...this.seleniumArgs);
		}

		args.push(
			'-jar',
			pathUtil.join(this.directory, this.artifact),
			'-port',
			this.port
		);

		if (this.verbose) {
			args.push('-debug');
			console.log('starting with arguments: ', args.join(' '));
		}

		return args;
	}

	protected _postDownloadFile(response: Response<any>, options: SeleniumDownloadOptions) {
		if (pathUtil.extname(options.executable) === '.jar') {
			return util.writeFile(response.data, pathUtil.join(this.directory, options.executable));
		}
		return super._postDownloadFile(response, options);
	}

	protected _start(executor: ChildExecutor) {
		let handle: Handle;
		const task = this._makeChild((child, resolve, reject) => {
			handle = util.on(child.stderr, 'data', (data: string) => {
				// Selenium recommends that we poll the hub looking for a status response
				// https://github.com/seleniumhq/selenium-google-code-issue-archive/issues/7957
				// We're going against the recommendation here for a few reasons
				// 1. There's no default pid or log to look for errors to provide a specific failure
				// 2. Polling on a failed server start could leave us with an unpleasant wait
				// 3. Just polling a selenium server doesn't guarantee it's the server we started
				// 4. This works pretty well
				data = String(data);
				if (data.indexOf('Selenium Server is up and running') > -1) {
					resolve();
				}
				if (this.verbose) {
					process.stderr.write(data);
				}
			});

			executor(child, resolve, reject);
		});

		task.then(handle.destroy.bind(handle), handle.destroy.bind(handle));

		return task;
	}

	protected _stop(): Promise<number> {
		return new Promise((resolve, reject) => {
			const childProcess = this._process;
			let timeout: NodeJS.Timer;

			childProcess.once('exit', function (code) {
				resolve(code);
				clearTimeout(timeout);
			});

			// Nicely ask the Selenium server to shutdown
			request('http://' + this.hostname + ':' + this.port +
				'/selenium-server/driver/?cmd=shutDownSeleniumServer', {
				timeout: this.seleniumTimeout
			});

			// Give Selenium a few seconds, then forcefully tell it to shutdown
			timeout = setTimeout(function () {
				childProcess.kill('SIGTERM');
			}, 5000);

		});
	}
}

util.assign(SeleniumTunnel.prototype, <SeleniumProperties> {
	seleniumArgs: null,
	drivers: null,
	baseUrl: 'https://selenium-release.storage.googleapis.com',
	version: '3.0.1',
	seleniumTimeout: 5000
});

type DriverConstructor = { new (config?: any): DriverFile; };

abstract class Config<T> {
	constructor(config: T) {
		util.assign(this, config);
	}

	readonly abstract executable: string;
	readonly abstract url: string;
	readonly abstract seleniumProperty?: string;
}

interface ChromeProperties {
	arch: string;
	baseUrl: string;
	platform: string;
	version: string;
}

type ChromeOptions = Partial<ChromeProperties>;

class ChromeConfig extends Config<ChromeOptions> implements ChromeProperties, DriverFile {
	arch = process.arch;
	baseUrl = 'https://chromedriver.storage.googleapis.com';
	platform = process.platform;
	version = '2.25';

	get artifact() {
		let platform = this.platform;
		if (platform === 'linux') {
			platform = 'linux' + (this.arch === 'x64' ? '64' : '32');
		}
		else if (platform === 'darwin') {
			const parts = String(this.version).split('.').map(Number);
			const isGreater = [ 2, 22 ].some(function (part, i) {
				return parts[i] > part;
			});
			platform = isGreater ? 'mac64' : 'mac32';
		}
		return format('chromedriver_%s.zip', platform);
	}

	get url() {
		return format('%s/%s/%s', this.baseUrl, this.version, this.artifact);
	}

	get executable() {
		return this.platform === 'win32' ? 'chromedriver.exe' : 'chromedriver';
	}

	get seleniumProperty() {
		return 'webdriver.chrome.driver';
	}
}

interface FirefoxProperties {
	arch: string;
	baseUrl: string;
	platform: string;
	version: string;
}

type FirefoxOptions = Partial<FirefoxProperties>;

class FirefoxConfig extends Config<FirefoxOptions> implements FirefoxProperties, DriverFile {
	arch = process.arch;
	baseUrl = 'https://github.com/mozilla/geckodriver/releases/download';
	platform = process.platform;
	version = '0.11.1';

	get artifact() {
		let platform = this.platform;
		if (platform === 'linux') {
			platform = 'linux' + (this.arch === 'x64' ? '64' : '32');
		}
		else if (platform === 'win32') {
			platform = 'win' + (this.arch === 'x64' ? '64' : '32');
		}
		else if (platform === 'darwin') {
			platform = 'macos';
		}
		const extension = /^win/.test(platform) ? '.zip' : '.tar.gz';
		return format('geckodriver-v%s-%s%s', this.version, platform, extension);
	}

	get url() {
		return format('%s/v%s/%s', this.baseUrl, this.version, this.artifact);
	}

	get executable() {
		return this.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver';
	}

	get seleniumProperty() {
		return 'webdriver.gecko.driver';
	}
}

// tslint:disable-next-line:interface-name
interface IEProperties {
	arch: string;
	baseUrl: string;
	version: string;
}

type IEOptions = Partial<IEProperties>;

class IEConfig extends Config<IEOptions> implements IEProperties, DriverFile {
	arch = process.arch;
	baseUrl = 'https://selenium-release.storage.googleapis.com';
	version = '3.0.0';

	get artifact() {
		const architecture = this.arch === 'x64' ? 'x64' : 'Win32';
		return format('IEDriverServer_%s_%s.zip', architecture, this.version);
	}

	get url() {
		const majorMinorVersion = this.version.slice(0, this.version.lastIndexOf('.'));
		return format('%s/%s/%s', this.baseUrl, majorMinorVersion, this.artifact);
	}

	get executable() {
		return 'IEDriverServer.exe';
	}

	get seleniumProperty() {
		return 'webdriver.ie.driver';
	}
}

const driverNameMap: { [key: string]: DriverConstructor; } = {
	chrome: ChromeConfig,
	firefox: FirefoxConfig,
	ie: IEConfig
};
