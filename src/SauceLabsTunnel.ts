/**
 * @module digdug/SauceLabsTunnel
 */

import Tunnel, { TunnelProperties, DownloadOptions, ChildExecutor, NormalizedEnvironment } from './Tunnel';

import { JobState } from './interfaces';
import * as fs from 'fs';
import * as os from 'os';
import * as pathUtil from 'path';
import Task, { State } from 'dojo-core/async/Task';
import request, { Response } from 'dojo-core/request';
import { NodeRequestOptions } from 'dojo-core/request/node';
import { format as formatUrl, parse as parseUrl, Url } from 'url';
import * as util from './util';
import { assign } from 'dojo-core/lang';

const SC_VERSION = '4.4.1';

export interface SauceLabsProperties extends TunnelProperties {
	accessKey: string;
	directDomains: string[];
	tunnelDomains: string[];
	domainAuthentication: string[];
	fastFailDomains: string[];
	isSharedTunnel: boolean;
	logFile: string;
	pidFile: string;
	logFileSize: number;
	logTrafficStats: number;
	restUrl: string;
	skipSslDomains: string[];
	squidOptions: string;
	useProxyForTunnel: boolean;
	username: string;
	vmVersion: string;
}

export type SauceLabsOptions = Partial<SauceLabsProperties>;
/**
 * A Sauce Labs tunnel. This tunnel uses Sauce Connect 4 on platforms where it is supported, and Sauce Connect 3
 * on all other platforms.
 *
 * @constructor module:digdug/SauceLabsTunnel
 * @extends module:digdug/Tunnel
 */
export default class SauceLabsTunnel extends Tunnel implements SauceLabsProperties {
	apiSecret: string;
	apiKey: string;

	/**
	 * The Sauce Labs access key.
	 *
	 * @type {string}
	 * @default the value of the SAUCE_ACCESS_KEY environment variable
	 */
	accessKey: string;

	/**
	 * A list of domains that should not be proxied by the tunnel on the remote VM.
	 *
	 * @type {string[]}
	 */
	directDomains: string[];

	/**
	 * A list of domains that will be proxied by the tunnel on the remote VM.
	 *
	 * @type {string[]}
	 */
	tunnelDomains: string[];

	directory: string;

	/**
	 * A list of URLs that require additional HTTP authentication. Only the hostname, port, and auth are used.
	 * This property is only supported by Sauce Connect 4 tunnels.
	 *
	 * @type {string[]}
	 */
	domainAuthentication: string[];

	/**
	 * A list of regular expressions corresponding to domains whose connections should fail immediately if the VM
	 * attempts to make a connection to them.
	 *
	 * @type {string[]}
	 */
	fastFailDomains: string[];

	/**
	 * Allows the tunnel to also be used by sub-accounts of the user that started the tunnel.
	 *
	 * @type {boolean}
	 * @default
	 */
	isSharedTunnel: boolean;

	/**
	 * A filename where additional logs from the tunnel should be output.
	 *
	 * @type {string}
	 */
	logFile: string;

	/**
	 * A filename where Sauce Connect stores its process information.
	 *
	 * @type {string}
	 */
	pidFile: string;

	/**
	 * Specifies the maximum log filesize before rotation, in bytes.
	 * This property is only supported by Sauce Connect 3 tunnels.
	 *
	 * @type {number}
	 */
	logFileSize: number;

	/**
	 * Log statistics about HTTP traffic every `logTrafficStats` milliseconds.
	 * This property is only supported by Sauce Connect 4 tunnels.
	 *
	 * @type {number}
	 * @default
	 */
	logTrafficStats: number;

	/**
	 * An alternative URL for the Sauce REST API.
	 * This property is only supported by Sauce Connect 3 tunnels.
	 *
	 * @type {string}
	 */
	restUrl: string;

	/**
	 * A list of domains that should not have their SSL connections re-encrypted when going through the tunnel.
	 *
	 * @type {string[]}
	 */
	skipSslDomains: string[];

	/**
	 * An additional set of options to use with the Squid proxy for the remote VM.
	 * This property is only supported by Sauce Connect 3 tunnels.
	 *
	 * @type {string}
	 */
	squidOptions: string;

	/**
	 * Whether or not to use the proxy defined at {@link module:digdug/Tunnel#proxy} for the tunnel connection
	 * itself.
	 *
	 * @type {boolean}
	 * @default
	 */
	useProxyForTunnel: boolean;

	/**
	 * The Sauce Labs username.
	 *
	 * @type {string}
	 * @default the value of the SAUCE_USERNAME environment variable
	 */
	username: string;

	/**
	 * Overrides the version of the VM created on Sauce Labs.
	 * This property is only supported by Sauce Connect 3 tunnels.
	 *
	 * @type {string}
	 */
	vmVersion: string;

	/**
	 * The URL of a service that provides a list of environments supported by Sauce Labs.
	 */
	environmentUrl: string;

	scVersion: string;

	get auth() {
		return `${this.username || ''}:${this.accessKey || ''}`;
	}

	get executable() {
		const platform = this.platform === 'darwin' ? 'osx' : this.platform;
		const architecture = this.architecture;

		if (platform === 'osx' || platform === 'win32' || (platform === 'linux' && architecture === 'x64')) {
			return './sc-' + this.scVersion + '-' + platform + '/bin/sc' + (platform === 'win32' ? '.exe' : '');
		}
		else {
			return 'java';
		}
	}

	get extraCapabilities() {
		const capabilities: any = {};

		if (this.tunnelId) {
			capabilities['tunnel-identifier'] = this.tunnelId;
		}

		return capabilities;
	}

	get isDownloaded() {
		return util.fileExists(this.executable === 'java' ?
			pathUtil.join(this.directory, 'Sauce-Connect.jar') :
			pathUtil.join(this.directory, this.executable)
		);
	}

	get url() {
		const platform = this.platform === 'darwin' ? 'osx' : this.platform;
		const architecture = this.architecture;
		let url = 'https://saucelabs.com/downloads/sc-' + this.scVersion + '-';

		if (platform === 'osx' || platform === 'win32') {
			url += platform + '.zip';
		}
		else if (platform === 'linux' && architecture === 'x64') {
			url += platform + '.tar.gz';
		}
		// Sauce Connect 3 uses Java so should be able to run on other platforms that Sauce Connect 4 does not support
		else {
			url = 'https://saucelabs.com/downloads/Sauce-Connect-3.1-r32.zip';
		}

		return url;
	}

	constructor(kwArgs?: SauceLabsOptions) {
		super(assign(<SauceLabsOptions> {
			directDomains: [],
			tunnelDomains: [],
			domainAuthentication: [],
			fastFailDomains: [],
			skipSslDomains: []
		}, kwArgs));
	}

	protected _postDownloadFile(response: Response<any>, options?: DownloadOptions): Promise<void> {
		return super._postDownloadFile(response, options).then(() => {
			if (this.executable !== 'java') {
				fs.chmodSync(pathUtil.join(this.directory, this.executable), parseInt('0755', 8));
			}
		});
	}

	protected _makeNativeArgs(proxy?: Url): string[] {
		const args = [
			'-u', this.username,
			'-k', this.accessKey
		];

		if (proxy) {
			if (proxy.host) {
				args.push('-p', proxy.host);
			}

			if (proxy.auth) {
				args.push('-w', proxy.auth);
			}
			/*else if (proxy.username) {
				args.push('-w', proxy.username + ':' + proxy.password);
			}*/
		}

		if (this.domainAuthentication.length) {
			this.domainAuthentication.forEach(function (domain) {
				const url = parseUrl(domain);
				args.push('-a', `${url.hostname}:${url.port}:${url.auth}`);
			});
		}

		this.logTrafficStats && args.push('-z', String(Math.floor(this.logTrafficStats / 1000)));
		this.verbose && args.push('-v');

		return args;
	}

	protected _makeJavaArgs(proxy?: Url): string[] {
		const args = [
			'-jar', 'Sauce-Connect.jar',
			this.username,
			this.accessKey
		];

		this.logFileSize && args.push('-g', String(this.logFileSize));
		this.squidOptions && args.push('-S', this.squidOptions);
		this.verbose && args.push('-d');

		if (proxy) {
			proxy.hostname && args.push('-p', proxy.hostname + (proxy.port ? ':' + proxy.port : ''));

			if (proxy.auth) {
				const auth = proxy.auth.split(':');
				args.push('-u', auth[0], '-X', auth[1]);
			}
			/*else {
				proxy.username && args.push('-u', proxy.username);
				proxy.password && args.push('-X', proxy.password);
			}*/
		}

		return args;
	}

	protected _makeArgs(readyFile: string): string[] {
		const proxy = this.proxy ? parseUrl(this.proxy) : undefined;
		const args = this.executable === 'java' ? this._makeJavaArgs(proxy) : this._makeNativeArgs(proxy);

		args.push(
			'-P', this.port,
			'-f', readyFile
		);

		this.directDomains.length && args.push('-D', this.directDomains.join(','));
		this.tunnelDomains.length && args.push('-t', this.tunnelDomains.join(','));
		this.fastFailDomains.length && args.push('-F', this.fastFailDomains.join(','));
		this.isSharedTunnel && args.push('-s');
		this.logFile && args.push('-l', this.logFile);
		this.pidFile && args.push('--pidfile', this.pidFile);
		this.restUrl && args.push('-x', this.restUrl);
		this.skipSslDomains.length && args.push('-B', this.skipSslDomains.join(','));
		this.tunnelId && args.push('-i', this.tunnelId);
		this.useProxyForTunnel && args.push('-T');
		this.vmVersion && args.push('-V', this.vmVersion);

		return args;
	}

	sendJobState(jobId: string, data: JobState): Task<void> {
		let url = parseUrl(this.restUrl || 'https://saucelabs.com/rest/v1/');
		url.auth = this.username + ':' + this.accessKey;
		url.pathname += this.username + '/jobs/' + jobId;

		const payload = JSON.stringify({
			build: data.buildId,
			'custom-data': data.extra,
			name: data.name,
			passed: data.success,
			public: data.visibility,
			tags: data.tags
		});

		return <Task<any>> request.put<string>(formatUrl(url), <NodeRequestOptions<any>> {
			data: payload,
			headers: {
				'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			password: this.apiSecret,
			user: this.apiKey,
			proxy: this.proxy
		}).then(function (response) {
			if (response.data) {
				const data = JSON.parse(response.data);

				if (data.error) {
					throw new Error(data.error);
				}

				if (response.statusCode !== 200) {
					throw new Error(`Server reported ${response.statusCode} with: ${response.data}`);
				}
			}
			else {
				throw new Error(`Server reported ${response.statusCode} with no other data.`);
			}
		});
	}

	protected _start(executor: ChildExecutor) {
		const readyFile = pathUtil.join(os.tmpdir(), 'saucelabs-' + Date.now());

		let readMessage: Function;
		let readStartupMessage: (message: string) => boolean;
		let readRunningMessage: (message: string) => void;

		const task = this._makeChild((child, resolve, reject) => {

			readStartupMessage = function (message: string) {
				function fail(message: string) {
					if (task.state === State.Pending) {
						reject(new Error(message));
					}
					return true;
				}

				// These messages contain structured data we can try to consume
				if (message.indexOf('Error: response: ') === 0) {
					try {
						const error = /(\{[\s\S]*\})/.exec(message);
						if (error) {
							const data = JSON.parse(error[1]);
							return fail(data.error);
						}
					}
					catch (error) {
						// It seems parsing did not work so well; fall through to the normal error handler
					}
				}

				if (message.indexOf('Error: ') === 0) {
					// skip known warnings
					if (
						/open file limit \d+ is too low/.test(message) ||
						/Sauce Labs recommends setting it/.test(message) ||
						/HTTP response code indicated failure/.test(message)
					) {
						return;
					}
					return fail(message.slice('Error: '.length));
				}

				readStatus(message);
			};

			readRunningMessage = function(message: string) {
				// Sauce Connect 3
				if (message.indexOf('Problem connecting to Sauce Labs REST API') > -1) {
					// It will just keep trying and trying and trying for a while, but it is a failure, so force it
					// to stop
					child.kill('SIGTERM');
				}

				readStatus(message);
			};

			const readStatus = (message: string) => {
				if (
					message &&
					message.indexOf('Please wait for') === -1 &&
					message.indexOf('Sauce Connect is up') === -1 &&
					message.indexOf('Sauce Connect') !== 0 &&
					message.indexOf('Using CA certificate bundle') === -1 &&
					// Sauce Connect 3
					message.indexOf('You may start your tests') === -1
				) {
					this.emit({ type: 'status', status: message });
				}
			};

			readMessage = readStartupMessage;

			// Polling API is used because we are only watching for one file, so efficiency is not a big deal, and the
			// `fs.watch` API has extra restrictions which are best avoided
			fs.watchFile(readyFile, { persistent: false, interval: 1007 }, function (current, previous) {
				if (Number(current.mtime) === Number(previous.mtime)) {
					// readyFile hasn't been modified, so ignore the event
					return;
				}

				fs.unwatchFile(readyFile);

				// We have to watch for errors until the tunnel has started successfully at which point we only want to
				// watch for status messages to emit
				readMessage = readStatus;

				resolve();
			});

			// Sauce Connect exits with a zero status code when there is a failure, and outputs error messages to
			// stdout, like a boss. Even better, it uses the "Error:" tag for warnings.
			this._handle = util.on(child.stdout, 'data', function (data: string) {
				String(data).split('\n').some(function (message) {
					// Get rid of the date/time prefix on each message
					const delimiter = message.indexOf(' - ');
					if (delimiter > -1) {
						message = message.slice(delimiter + 3);
					}
					return readMessage(message.trim());
				});
			});
		});

		task.then(function () {
			readRunningMessage('');
			readMessage = null;
		});

		return task;
	}

	/**
	 * Attempt to normalize a SauceLabs described environment with the standard Selenium capabilities
	 *
	 * SauceLabs returns a list of environments that looks like:
	 *
	 * {
	 *     "short_version": "25",
	 *     "long_name": "Firefox",
	 *     "api_name": "firefox",
	 *     "long_version": "25.0b2.",
	 *     "latest_stable_version": "",
	 *     "automation_backend": "webdriver",
	 *     "os": "Windows 2003"
	 * }
	 *
	 * @param {Object} environment a SauceLabs environment descriptor
	 * @returns a normalized descriptor
	 * @private
	 */
	protected _normalizeEnvironment(environment: any): NormalizedEnvironment {
		const windowsMap: any = {
			'Windows 2003': 'Windows XP',
			'Windows 2008': 'Windows 7',
			'Windows 2012': 'Windows 8',
			'Windows 2012 R2': 'Windows 8.1',
			'Windows 10': 'Windows 10'
		};

		const browserMap: any = {
			'microsoftedge': 'MicrosoftEdge'
		};

		let os = environment.os;
		let platformName = os;
		let platformVersion: string;
		if (os.indexOf('Windows') === 0) {
			os = windowsMap[os] || os;
			platformName = 'Windows';
			platformVersion = os.slice('Windows '.length);
		}
		else if (os.indexOf('Mac') === 0) {
			platformName = 'OS X';
			platformVersion = os.slice('Mac '.length);
		}

		const platform = platformName + (platformVersion ? ' ' + platformVersion : '');
		const browserName = browserMap[environment.api_name] || environment.api_name;
		const version = environment.short_version;

		return {
			platform,
			platformName,
			platformVersion,

			browserName,
			browserVersion: version,
			version,

			descriptor: environment,

			intern: {
				platform,
				browserName,
				version
			}
		};
	}
};

assign(SauceLabsTunnel.prototype, {
	accessKey: process.env.SAUCE_ACCESS_KEY,
	directDomains: null,
	tunnelDomains: null,
	directory: pathUtil.join(__dirname, 'saucelabs'),
	domainAuthentication: null,
	fastFailDomains: null,
	isSharedTunnel: false,
	logFile: null,
	pidFile: null,
	logFileSize: null,
	logTrafficStats: 0,
	restUrl: null,
	skipSslDomains: null,
	squidOptions: null,
	useProxyForTunnel: false,
	username: process.env.SAUCE_USERNAME,
	vmVersion: null,
	environmentUrl: 'https://saucelabs.com/rest/v1/info/platforms/webdriver',
	scVersion: SC_VERSION
});
