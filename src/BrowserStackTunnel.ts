/**
 * @module digdug/BrowserStackTunnel
 */

import * as fs from 'fs';
import * as pathUtil from 'path';
import Task from 'dojo-core/async/Task';
import request, { Response } from 'dojo-core/request';
import { NodeRequestOptions } from 'dojo-core/request/node';
import Tunnel, { TunnelProperties, DownloadOptions, ChildExecutor, NormalizedEnvironment, StatusEvent } from './Tunnel';
import { parse as parseUrl, Url } from 'url';
import * as util from './util';
import { JobState } from './interfaces';

export interface BrowserStackProperties extends TunnelProperties {
	accessKey: string;
	automateOnly: boolean;
	killOtherTunnels: boolean;
	servers: (Url | string)[];
	skipServerValidation: boolean;
	forceLocal: boolean;
	username: string;
	environmentUrl: string;
}

export type BrowserStackOptions = Partial<BrowserStackProperties>;

/**
 * A BrowserStack tunnel.
 *
 * @constructor module:digdug/BrowserStackTunnel
 * @extends module:digdug/Tunnel
 */
export default class BrowserStackTunnel extends Tunnel {
	/**
	 * The BrowserStack access key. This will be initialized with the value of the `BROWSERSTACK_ACCESS_KEY`
	 * environment variable.
	 *
	 * @type {string}
	 * @default the value of the BROWSERSTACK_ACCESS_KEY environment variable
	 */
	accessKey: string;

	/**
	 * Whether or not to start the tunnel with only WebDriver support. Setting this value to `false` is not
	 * supported.
	 *
	 * @type {boolean}
	 * @default
	 */
	automateOnly: boolean;

	directory: string;

	hostname: string;

	/**
	 * If true, any other tunnels running on the account will be killed when the tunnel is started.
	 *
	 * @type {boolean}
	 * @default
	 */
	killOtherTunnels: boolean;

	port: string;

	protocol: string;

	/**
	 * A list of server URLs that should be proxied by the tunnel. Only the hostname, port, and protocol are used.
	 *
	 * @type {string[]}
	 */
	servers: (Url | string)[];

	/**
	 * Skip verification that the proxied servers are online and responding at the time the tunnel starts.
	 *
	 * @type {boolean}
	 * @default
	 */
	skipServerValidation: boolean;

	/**
	 * If true, route all traffic via the local machine.
	 *
	 * @type {boolean}
	 * @default
	 */
	forceLocal: boolean;

	/**
	 * The BrowserStack username. This will be initialized with the value of the `BROWSERSTACK_USERNAME`
	 * environment variable.
	 *
	 * @type {string}
	 * @default the value of the BROWSERSTACK_USERNAME environment variable
	 */
	username: string;

	/**
	 * The URL of a service that provides a list of environments supported by BrowserStack.
	 */
	environmentUrl: string;

	get auth() {
		return `${this.username || ''}:${this.accessKey || ''}`;
	}

	get executable() {
		return `./BrowserStackLocal${this.platform === 'win32' ? '.exe' : '' }`;
	}

	get extraCapabilities(): Object {
		const capabilities: any = {
			'browserstack.local': 'true'
		};

		if (this.tunnelId) {
			capabilities['browserstack.localIdentifier'] = this.tunnelId;
		}

		return capabilities;
	}

	get url() {
		const platform = this.platform;
		const architecture = this.architecture;
		let url = 'https://www.browserstack.com/browserstack-local/BrowserStackLocal-';

		if (platform === 'darwin' && architecture === 'x64') {
			url += platform + '-' + architecture;
		} else if (platform === 'win32') {
			url += platform;
		}
		else if (platform === 'linux' && (architecture === 'ia32' || architecture === 'x64')) {
			url += platform + '-' + architecture;
		}
		else {
			throw new Error(platform + ' on ' + architecture + ' is not supported');
		}

		url += '.zip';
		return url;
	}

	constructor(kwArgs?: BrowserStackOptions) {
		super(util.assign({
			servers: []
		}, kwArgs));
	}

	protected _postDownloadFile(response: Response<any>, options?: DownloadOptions): Promise<void> {
		return super._postDownloadFile(response, options).then(() => {
			const executable = pathUtil.join(this.directory, this.executable);
			fs.chmodSync(executable, parseInt('0755', 8));
		});
	}

	protected _makeArgs(...values: string[]): string[] {
		const args = [
			this.accessKey,
			this.servers.map(function (server) {
				const url = parseUrl(String(server));
				return [ url.hostname, url.port, url.protocol === 'https:' ? 1 : 0 ].join(',');
			}).join(',')
		];

		this.automateOnly && args.push('-onlyAutomate');
		this.forceLocal && args.push('-forcelocal');
		this.killOtherTunnels && args.push('-force');
		this.skipServerValidation && args.push('-skipCheck');
		this.tunnelId && args.push('-localIdentifier', this.tunnelId);
		this.verbose && args.push('-v');

		if (this.proxy) {
			const proxy = parseUrl(this.proxy);

			proxy.hostname && args.push('-proxyHost', proxy.hostname);
			proxy.port && args.push('-proxyPort', proxy.port);

			if (proxy.auth) {
				const auth = proxy.auth.split(':');
				args.push('-proxyUser', auth[0], '-proxyPass', auth[1]);
			}
			/*else {
				proxy.username && args.push('-proxyUser', proxy.username);
				proxy.password && args.push('-proxyPass', proxy.password);
			}*/
		}

		return args;
	}

	sendJobState(jobId: string, data: JobState): Task<void> {
		const payload = JSON.stringify({
			status: data.status || data.success ? 'completed' : 'error'
		});

		const url = `https://www.browserstack.com/automate/sessions/${jobId}.json`;
		return <Task<any>> request.put<string>(url, <NodeRequestOptions<any>> {
			data: payload,
			headers: {
				'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
				'Content-Type': 'application/json'
			},
			password: this.accessKey,
			user: this.username,
			proxy: this.proxy
		}).then(response => {
			if (response.statusCode >= 200 && response.statusCode < 300) {
				return true;
			}
			else {
				throw new Error(response.data || `Server reported ${response.statusCode} with no other data.`);
			}
		});
	}

	protected _start(executor: ChildExecutor) {
		return this._makeChild((child, resolve, reject) => {
			let handle = util.on(child.stdout, 'data', (data: any) => {
				data = String(data);
				const error = /\s*\*\*\* Error: (.*)$/m.exec(data);
				if (error) {
					handle.destroy();
					reject(new Error(`The tunnel reported: ${error[1]}`));
				}
				else if (data.indexOf('You can now access your local server(s) in our remote browser') > -1) {
					handle.destroy();
					resolve();
				}
				else {
					const line = data.replace(/^\s+/, '').replace(/\s+$/, '');
					if (
						/^BrowserStackLocal v/.test(line) ||
						/^Connecting to BrowserStack/.test(line) ||
						/^Connected/.test(line)
					) {
						this.emit<StatusEvent>({
							type: 'status',
							target: this,
							status: line
						});
					}
				}
			});

			executor(child, resolve, reject);
		});
	}

	protected _stop(): Promise<number> {
		return new Promise(resolve => {
			const childProcess = this._process;
			let exited = false;

			childProcess.once('exit', function (code) {
				exited = true;
				resolve(code);
			});
			childProcess.kill('SIGINT');

			// As of at least version 5.1, BrowserStackLocal spawns a secondary process. This is the one that needs to
			// receive the CTRL-C, but Node doesn't provide an easy way to get the PID of the secondary process, so we'll
			// just wait a few seconds, then kill the process if it hasn't ended cleanly.
			setTimeout(function () {
				if (!exited) {
					childProcess.kill('SIGTERM');
				}
			}, 5000);
		});
	}

	/**
	 * Attempt to normalize a BrowserStack described environment with the standard Selenium capabilities
	 * 
	 * BrowserStack returns a list of environments that looks like:
	 *
	 * {
	 *     "browser": "opera",
	 *     "os_version": "Lion",
	 *     "browser_version":"12.15",
	 *     "device": null,
	 *     "os": "OS X"
	 * }
	 * 
	 * @param {Object} environment a BrowserStack environment descriptor
	 * @returns a normalized descriptor
	 * @private
	 */
	protected _normalizeEnvironment(environment: any): NormalizedEnvironment {
		const platformMap: any = {
			Windows: {
				'10': 'WINDOWS',
				'8.1': 'WIN8',
				'8': 'WIN8',
				'7': 'WINDOWS',
				'XP': 'XP'
			},

			'OS X': 'MAC'
		};

		const browserMap: any = {
			ie: 'internet explorer'
		};

		// Create the BS platform name for a given os + version
		let platform = platformMap[environment.os] || environment.os;
		if (typeof platform === 'object') {
			platform = platform[environment.os_version];
		}

		const browserName = browserMap[environment.browser] || environment.browser;
		const version = environment.browser_version;

		return {
			platform,
			platformName: environment.os,
			platformVersion: environment.os_version,

			browserName,
			browserVersion: version,
			version: environment.browser_version,

			descriptor: environment,

			intern: {
				platform,
				browserName,
				version
			}
		};
	}
};

util.assign(BrowserStackTunnel.prototype, <BrowserStackProperties> {
	accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
	automateOnly: true,
	directory: pathUtil.join(__dirname, 'browserstack'),
	environmentUrl: 'https://www.browserstack.com/automate/browsers.json',
	hostname: 'hub.browserstack.com',
	killOtherTunnels: false,
	port: '443',
	protocol: 'https',
	servers: null,
	skipServerValidation: true,
	forceLocal: false,
	username: process.env.BROWSERSTACK_USERNAME
});
