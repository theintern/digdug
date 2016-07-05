/**
 * @module digdug/SeleniumTunnel
 */

var Tunnel = require('./Tunnel');
var util = require('./util');
var pathUtil = require('path');
var Promise = require('dojo/Promise');
var descriptors = require('./seleniumDescriptors');
var fs = require('fs');
var request = require('dojo/request');

function SeleniumTunnel() {
	Tunnel.apply(this, arguments);

	if (!this.seleniumDrivers) {
		this.seleniumDrivers = [ 'chrome' ];
	}
}

var _super = Tunnel.prototype;
SeleniumTunnel.prototype = util.mixin(Object.create(_super), /** @lends module:digdug/SauceLabsTunnel# */ {
	constructor: SeleniumTunnel,

	/**
	 * The desired version of selenium to install. This can be defined using a version number or an object containing a
	 * version number and baseUrl.
	 *
	 * example:
	 * 	{
	 * 		version: '2.53.0',
	 * 		baseUrl: 'https://selenium-release.storage.googleapis.com'
	 * 	}
	 *
	 * @type {string|object}
	 * @default
	 */
	seleniumVersion: descriptors.SeleniumConfig.prototype.version,

	/**
	 * The desired selenium drivers to install. This is a list of driver definitions that may either be a basic string
	 * or an object.
	 *
	 * example:
	 * 	[
	 * 		'chrome',
	 * 		{
	 * 			name: 'firefox',
	 * 			version: '0.8.0',
	 * 			baseUrl: 'https://github.com/mozilla/geckodriver/releases/download'
	 * 		}
	 * 	]
	 *
	 * @type {Array}
	 * @default [ 'chrome' ]
	 */
	seleniumDrivers: null,
	
	startupTimeout: 5000,

	seleniumArgs: null,

	get directory() {
		return pathUtil.join(__dirname, 'selenium-standalone');
	},

	get executable() {
		return 'java';
	},

	get isDownloaded() {
		var directory = this.directory;
		return this._getConfigs().every(function (config) {
			return fs.existsSync(pathUtil.join(directory, config.executable));
		});
	},

	_getDriverConfigs: function () {
		return this.seleniumDrivers.map(function (driver) {
			return descriptors.getDriverConfig(driver);
		});
	},

	_getConfigs: function () {
		var configs = this._getDriverConfigs();
		configs.push(new descriptors.SeleniumConfig(this.seleniumVersion));
		return configs;
	},

	download: function (forceDownload) {
		var tasks = this._getConfigs().map(function (config) {
			return this._download(config, forceDownload);
		}.bind(this));
		
		return Promise.all(tasks);
	},

	_download: function (config, forceDownload) {
		var executable = config.executable;
		var isDownloaded = fs.existsSync(pathUtil.join(this.directory, executable));
		var self = {
			isDownloaded: isDownloaded,
			url: config.url,
			proxy: this.proxy,
			directory: this.directory,
			executable: executable,
			dontExtract: !!config.dontExtract
		};
		// Leverages the parent download() method by binding a call using the parameters created above
		// TODO we should consider extracting download into a command/utility function external to Tunnel
		return _super.download.call(self, forceDownload);
	},
	
	_makeArgs: function () {
		var directory = this.directory;
		var seleniumConfig = new descriptors.SeleniumConfig(this.seleniumVersion);
		var driverConfigs = this._getDriverConfigs();
		var args = [
			'-jar',
			pathUtil.join(this.directory, seleniumConfig.executable),
			'-port',
			this.port
		];
		
		driverConfigs.reduce(function (args, config) {
			var file = pathUtil.join(directory, config.executable);
			args.push('-D' + config.seleniumProperty + '=' + file);
			return args;
		}, args);

		if (this.seleniumArgs) {
			args = args.concat(this.seleniumArgs);
		}

		if (this.verbose) {
			args.push('-debug');
			console.log('starting with arguments: ', args.join(' '));
		}
		
		return args;
	},

	_start: function () {
		function clearHandles() {
			handles.forEach(function (handle) {
				handle.remove();
			});
		}

		var self = this;
		var childHandle = this._makeChild();
		var child = childHandle.process;
		var dfd = childHandle.deferred;
		var handles = [
			util.on(child.stderr, 'data', function (data) {
				// Selenium recommends that we poll the hub looking for a status response
				// https://github.com/seleniumhq/selenium-google-code-issue-archive/issues/7957
				// We're going against the recommendation here for a few reasons
				// 1. There's no default pid or log to look for errors to provide a specific failure
				// 2. Polling on a failed server start could leave us with an unpleasant wait
				// 3. Just polling a selenium server doesn't guarantee it's the server we started
				// 4. This works pretty well
				if (data.indexOf('java.net.BindException') > -1) {
					clearHandles();
					dfd.reject(new Error(data));
				}
				if (data.indexOf('Selenium Server is up and running') > -1) {
					clearHandles();
					dfd.resolve();
				}
				if (self.verbose) {
					console.log(data);
				}
			}),
			util.on(child, 'error', function (error) {
				clearHandles();
				dfd.reject(error);
			})
		];

		return dfd.promise.then(clearHandles, clearHandles)
			.then(function () {
				return self._assertStarted()
					.then(function () {
						return childHandle;
					});
			});
	},

	_assertStarted: function () {
		return request('http://' + this.hostname + ':' + this.port + '/wd/hub/status', {
			timeout: this.startupTimeout,
			handleAs: 'text'
		}).then(function (response) {
			if (response.statusCode !== 200) {
				throw new Error('Server reported ' + response.statusCode + ' with: ' + response.data);
			}

			var json = JSON.parse(response.data);

			if ( json.state !== 'success' ) {
				throw new Error('Selenium Tunnel reported a state of ' + json.state );
			}
		});
	},

	_stop: function () {
		var self = this;

		return request('http://' + this.hostname + ':' + this.port +
			'/selenium-server/driver/?cmd=shutDownSeleniumServer', {
			timeout: this.startupTimeout,
			handleAs: 'text'
		}).then(function (response) {
			var text = response.data.toString();
			if (text !== 'OKOK') {
				throw new Error('Tunnel not shut down');
			}
			return _super._stop.apply(self);
		});
	},
	
	sendJobState: function () {
		// This is a noop for Selenium
		return Promise.resolve();
	}
});

module.exports = SeleniumTunnel;
