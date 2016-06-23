/**
 * @module digdug/CrossBrowserTestingTunnel
 */

var fs = require('fs');
var os = require('os');
var pathUtil = require('path');
var request = require('dojo/request');
var Tunnel = require('./Tunnel');
var util = require('./util');

/**
 * A CrossBrowserTesting tunnel.
 *
 * @constructor module:digdug/CrossBrowserTestingTunnel
 * @extends module:digdug/Tunnel
 */
function CrossBrowserTestingTunnel() {
	this.apikey = process.env.CBT_APIKEY;
	this.username = process.env.CBT_USERNAME;
	this.servers = [];
	Tunnel.apply(this, arguments);
}

var _super = Tunnel.prototype;
CrossBrowserTestingTunnel.prototype = util.mixin(Object.create(_super), /** @lends module:digdug/CrossBrowserTestingTunnel# */ {
	constructor: CrossBrowserTestingTunnel,

	/**
	 * The CrossBrowserTesting API key.
	 *
	 * @type {string}
	 * @default the value of the CBT_APIKEY environment variable
	 */
	apikey: null,

	/**
	 * The CrossBrowserTesting username.
	 *
	 * @type {string}
	 * @default the value of the CBT_USERNAME environment variable
	 */
	username: null,

	directory: pathUtil.join(__dirname, 'CrossBrowserTesting'),

	executable: 'java',

	/**
	 * A list of regular expressions corresponding to domains whose connections should fail immediately if the VM
	 * attempts to make a connection to them.
	 *
	 * @type {string[]}
	 */
	servers: null,

	/**
	 * A filename where additional logs from the tunnel should be output.
	 *
	 * @type {string}
	 */
	logFile: null,

	hostname: 'hub.crossbrowsertesting.com',

	port: 80,

	url: 'https://github.com/crossbrowsertesting/cbt-tunnel-java/raw/master/cbttunnel.jar',

	/**
	 * Whether or not to use rabbIT compression for the tunnel connection.
	 *
	 * @type {boolean}
	 * @default
	 */
	useCompression: false,

	/**
	 * Whether or not to use the default local Jetty proxy for the tunnel.
	 *
	 * @type {boolean}
	 * @default
	 */
	useJettyProxy: true,

	/**
	 * Whether or not to use the default remote Squid proxy for the VM.
	 *
	 * @type {boolean}
	 * @default
	 */
	useSquidProxy: true,

	/**
	 * Whether or not to re-encrypt data encrypted by self-signed certificates.
	 *
	 * @type {boolean}
	 * @default
	 */
	useSsl: false,

	get auth() {
		return this.apikey + ':' + this.username;
	},

	get isDownloaded() {
		return fs.existsSync(pathUtil.join(this.directory, 'CrossBrowserTesting-tunnel/cbttunnel.jar'));
	},

	_makeArgs: function (readyFile) {
		var args = [
			'-jar', 'CrossBrowserTesting-tunnel/cbttunnel.jar',
			this.apikey,
			this.username,
			'-P', this.port,
			'-f', readyFile
		];

		this.servers.length && args.push('-F', this.servers.join(','));
		this.logFile && args.push('-l', this.logFile);
		this.useJettyProxy || args.push('-x');
		this.useSquidProxy || args.push('-q');
		this.useCompression && args.push('-b');
		this.useSsl && args.push('-s');
		this.verbose && args.push('-d');

		return args;
	},

	sendJobState: function (jobId, data) {
		var payload = JSON.stringify({
			status: data.status || data.success ? 'completed' : 'error'
		});

		return request.put('https://api.CrossBrowserTesting.com/v1/tests/' + jobId, {
			data: payload,
			handleAs: 'text',
			headers: {
				'Content-Length': Buffer.byteLength(payload, 'utf8'),
				'Content-Type': 'application/json'
			},
			password: this.username,
			user: this.apikey,
			proxy: this.proxy
		}).then(function (response) {
			if (response.data) {
				var data = JSON.parse(response.data);

				if (data.error) {
					throw new Error(data.error);
				}
				else if (!data.success) {
					throw new Error('Job data failed to save.');
				}
				else if (response.statusCode !== 200) {
					throw new Error('Server reported ' + response.statusCode + ' with: ' + response.data);
				}
			}
			else {
				throw new Error('Server reported ' + response.statusCode + ' with no other data.');
			}
		});
	},

	_start: function () {
		var readyFile = pathUtil.join(os.tmpdir(), 'CrossBrowserTesting-' + Date.now());
		var child = this._makeChild(readyFile);
		var childProcess = child.process;
		var dfd = child.deferred;

		// Polling API is used because we are only watching for one file, so efficiency is not a big deal, and the
		// `fs.watch` API has extra restrictions which are best avoided
		fs.watchFile(readyFile, { persistent: false, interval: 1007 }, function (current, previous) {
			if (Number(current.mtime) === Number(previous.mtime)) {
				// readyFile hasn't been modified, so ignore the event
				return;
			}

			fs.unwatchFile(readyFile);
			dfd.resolve();
		});

		var self = this;
		var lastMessage;
		this._handles.push(
			util.on(childProcess.stderr, 'data', function (data) {
				data.split('\n').forEach(function (message) {
					if (message.indexOf('INFO: ') === 0) {
						message = message.slice('INFO: '.length);
						// the tunnel produces a lot of repeating messages during setup when the status is pending;
						// deduplicate them for sanity
						if (
							message !== lastMessage &&
							message.indexOf('>> [') === -1 &&
							message.indexOf('<< [') === -1
						) {
							self.emit('status', message);
							lastMessage = message;
						}
					}
				});
			})
		);

		return child;
	}
});

module.exports = CrossBrowserTestingTunnel;
