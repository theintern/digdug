/**
 * @module digdug/TestingBotTunnel
 */

import Tunnel, { TunnelProperties, ChildExecutor, NormalizedEnvironment, StatusEvent } from './Tunnel';

import * as fs from 'fs';
import UrlSearchParams from 'dojo-core/UrlSearchParams';
import * as os from 'os';
import * as pathUtil from 'path';
import request from 'dojo-core/request';
import { NodeRequestOptions } from 'dojo-core/request/node';
import * as urlUtil from 'url';
import * as util from './util';
import { JobState } from './interfaces';
import Task from 'dojo-core/async/Task';

export interface TestingBotProperties extends TunnelProperties {
	apiKey: string;
	apiSecret: string;
	fastFailDomains: string[];
	logFile: string;
	useCompression: boolean;
	useJettyProxy: boolean;
	useSquidProxy: boolean;
	useSsl: boolean;
}

export type TestingBotOptions = Partial<TestingBotProperties>;

/**
 * A TestingBot tunnel.
 *
 * @constructor module:digdug/TestingBotTunnel
 * @extends module:digdug/Tunnel
 */
export default class TestingBotTunnel extends Tunnel implements TunnelProperties {
	/**
	 * The TestingBot API key.
	 *
	 * @type {string}
	 * @default the value of the TESTINGBOT_API_KEY environment variable
	 */
	apiKey: string;

	/**
	 * The TestingBot API secret.
	 *
	 * @type {string}
	 * @default the value of the TESTINGBOT_API_SECRET environment variable
	 */
	apiSecret: string;

	directory: string;

	executable: string;

	/**
	 * A list of regular expressions corresponding to domains whose connections should fail immediately if the VM
	 * attempts to make a connection to them.
	 *
	 * @type {string[]}
	 */
	fastFailDomains: string[];

	/**
	 * A filename where additional logs from the tunnel should be output.
	 *
	 * @type {string}
	 */
	logFile: string;

	/**
	 * Whether or not to use rabbIT compression for the tunnel connection.
	 *
	 * @type {boolean}
	 * @default
	 */
	useCompression: boolean;

	/**
	 * Whether or not to use the default local Jetty proxy for the tunnel.
	 *
	 * @type {boolean}
	 * @default
	 */
	useJettyProxy: boolean;

	/**
	 * Whether or not to use the default remote Squid proxy for the VM.
	 *
	 * @type {boolean}
	 * @default
	 */
	useSquidProxy: boolean;

	/**
	 * Whether or not to re-encrypt data encrypted by self-signed certificates.
	 *
	 * @type {boolean}
	 * @default
	 */
	useSsl: boolean;

	get auth() {
		return `${this.apiKey || ''}:${this.apiSecret || ''}`;
	}

	get isDownloaded() {
		return util.fileExists(pathUtil.join(this.directory, 'testingbot-tunnel/testingbot-tunnel.jar'));
	}

	constructor(options?: TestingBotOptions) {
		super(util.assign({
			fastFailDomains: []
		}, options));
	}

	protected _makeArgs(readyFile: string): string[] {
		const args = [
			'-jar', 'testingbot-tunnel/testingbot-tunnel.jar',
			this.apiKey,
			this.apiSecret,
			'-P', this.port,
			'-f', readyFile
		];

		this.fastFailDomains.length && args.push('-F', this.fastFailDomains.join(','));
		this.logFile && args.push('-l', this.logFile);
		this.useJettyProxy || args.push('-x');
		this.useSquidProxy || args.push('-q');
		this.useCompression && args.push('-b');
		this.useSsl && args.push('-s');
		this.verbose && args.push('-d');

		if (this.proxy) {
			const proxy = urlUtil.parse(this.proxy);

			proxy.hostname && args.unshift('-Dhttp.proxyHost=', proxy.hostname);
			proxy.port && args.unshift('-Dhttp.proxyPort=', proxy.port);
		}

		return args;
	}

	sendJobState(jobId: string, data: JobState): Task<void> {
		const params = new UrlSearchParams();

		data.success != null && params.set('test[success]', String(data.success ? 1 : 0));
		data.status && params.set('test[status_message]', data.status);
		data.name && params.set('test[name]', data.name);
		data.extra && params.set('test[extra]', JSON.stringify(data.extra));
		data.tags && data.tags.length && params.set('groups', data.tags.join(','));

		const url = `https://api.testingbot.com/v1/tests/${jobId}`;
		const payload = params.toString();
		return <Task<any>> request.put<string>(url, <NodeRequestOptions<any>> {
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
				else if (!data.success) {
					throw new Error('Job data failed to save.');
				}
				else if (response.statusCode !== 200) {
					throw new Error(`Server reported ${response.statusCode} with: ${response.data}`);
				}
			}
			else {
				throw new Error(`Server reported ${response.statusCode} with no other data.`);
			}
		});
	}

	protected _start(executor: ChildExecutor) {
		const readyFile = pathUtil.join(os.tmpdir(), 'testingbot-' + Date.now());

		return this._makeChild((child, resolve, reject) => {

			// Polling API is used because we are only watching for one file, so efficiency is not a big deal, and the
			// `fs.watch` API has extra restrictions which are best avoided
			fs.watchFile(readyFile, { persistent: false, interval: 1007 }, function (current, previous) {
				if (Number(current.mtime) === Number(previous.mtime)) {
					// readyFile hasn't been modified, so ignore the event
					return;
				}

				fs.unwatchFile(readyFile);
				resolve();
			});

			let lastMessage: string;
			this._handle = util.on(child.stderr, 'data', (data: string) => {
				data = String(data);
				data.split('\n').forEach((message) => {
					if (message.indexOf('INFO: ') === 0) {
						message = message.slice('INFO: '.length);
						// the tunnel produces a lot of repeating messages during setup when the status is pending;
						// deduplicate them for sanity
						if (
							message !== lastMessage &&
							message.indexOf('>> [') === -1 &&
							message.indexOf('<< [') === -1
						) {
							this.emit<StatusEvent>({
								type: 'status',
								target: this,
								status: message
							});
							lastMessage = message;
						}
					}
					else if (message.indexOf('SEVERE: ') === 0) {
						reject(message);
					}
				});
			});

			executor(child, resolve, reject);
		}, readyFile);
	}

	/**
	 * Attempt to normalize a TestingBot described environment with the standard Selenium capabilities
	 *
	 * TestingBot returns a list of environments that looks like:
	 *
	 * {
	 *     "selenium_name": "Chrome36",
	 *     "name": "googlechrome",
	 *     "platform": "CAPITAN",
	 *     "version":"36"
	 * }
	 *
	 * @param {Object} environment a TestingBot environment descriptor
	 * @returns a normalized descriptor
	 * @private
	 */
	protected _normalizeEnvironment(environment: any): NormalizedEnvironment {
		const browserMap: any = {
			googlechrome: 'chrome',
			iexplore: 'internet explorer'
		};

		const platform = environment.platform;
		const browserName = browserMap[environment.name] || environment.name;
		const version = environment.version;

		return {
			platform,
			browserName,
			version,
			descriptor: environment,

			intern: {
				platform,
				browserName,
				version
			}
		};
	}
}

util.assign(TestingBotTunnel.prototype, <TestingBotOptions> {
	apiKey: process.env.TESTINGBOT_KEY,
	apiSecret: process.env.TESTINGBOT_SECRET,
	directory: pathUtil.join(__dirname, 'testingbot'),
	executable: 'java',
	fastFailDomains: null,
	logFile: null,
	port: '4445',
	url: 'https://testingbot.com/downloads/testingbot-tunnel.zip',
	useCompression: false,
	useJettyProxy: true,
	useSquidProxy: true,
	useSsl: false,
	environmentUrl: 'https://api.testingbot.com/v1/browsers'
});
