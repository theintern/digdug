/**
 * @module digdug/Tunnel
 */

var Decompress = require('decompress');
var Evented = require('dojo/Evented');
var fs = require('fs');
var pathUtil = require('path');
var Promise = require('dojo/Promise');
var sendRequest = require('dojo/request');
var spawnUtil = require('child_process');
var urlUtil = require('url');
var util = require('./util');
var request = require('dojo/request');

// TODO: Spawned processes are not getting cleaned up if there is a crash

/**
 * Clears an array of remover handles.
 *
 * @param {Handle[]} handles
 * @private
 */
function clearHandles(handles) {
	var handle;
	while ((handle = handles.pop())) {
		handle.remove();
	}
}

/**
 * Creates a new function that emits an event of type `type` on `target` every time the returned function is called.
 *
 * @param {module:dojo/Evented} target A target event emitter.
 * @param {string} type The type of event to emit.
 * @returns {Function} The function to call to trigger an event.
 * @private
 */
function proxyEvent(target, type) {
	return function (data) {
		target.emit(type, data);
	};
}

/**
 * A Tunnel is a mechanism for connecting to a WebDriver service provider that securely exposes local services for
 * testing within the service provider’s network.
 *
 * @constructor module:digdug/Tunnel
 * @param {Object} kwArgs A map of properties that should be set on the new instance.
 */
function Tunnel(kwArgs) {
	Evented.apply(this, arguments);
	for (var key in kwArgs) {
		Object.defineProperty(this, key, Object.getOwnPropertyDescriptor(kwArgs, key));
	}
}

var _super = Evented.prototype;
Tunnel.prototype = util.mixin(Object.create(_super), /** @lends module:digdug/Tunnel# */ {
	/**
	 * Part of the tunnel has been downloaded from the server.
	 *
	 * @event module:digdug/Tunnel#downloadprogress
	 * @type {Object}
	 * @property {number} received The number of bytes received so far.
	 * @property {number} total The total number of bytes to download.
	 */

	/**
	 * A chunk of raw string data output by the tunnel software to stdout.
	 *
	 * @event module:digdug/Tunnel#stdout
	 * @type {string}
	 */

	/**
	 * A chunk of raw string data output by the tunnel software to stderr.
	 *
	 * @event module:digdug/Tunnel#stderr
	 * @type {string}
	 */

	/**
	 * Information about the status of the tunnel setup process that is suitable for presentation to end-users.
	 *
	 * @event module:digdug/Tunnel#status
	 * @type {string}
	 */

	constructor: Tunnel,

	/**
	 * The architecture the tunnel will run against. This information is automatically retrieved for the current
	 * system at runtime.
	 *
	 * @type {string}
	 */
	architecture: process.arch,

	/**
	 * An HTTP authorization string to use when initiating connections to the tunnel. This value of this property is
	 * defined by Tunnel subclasses.
	 *
	 * @type {string}
	 */
	auth: null,

	/**
	 * The directory where the tunnel software will be extracted. If the directory does not exist, it will be
	 * created. This value is set by the tunnel subclasses.
	 *
	 * @type {string}
	 */
	directory: null,

	/**
	 * The executable to spawn in order to create a tunnel. This value is set by the tunnel subclasses.
	 *
	 * @type {string}
	 */
	executable: null,

	/**
	 * The host on which a WebDriver client can access the service provided by the tunnel. This may or may not be
	 * the host where the tunnel application is running.
	 *
	 * @type {string}
	 * @default
	 */
	hostname: 'localhost',

	/**
	 * Whether or not the tunnel is currently running.
	 *
	 * @type {boolean}
	 * @readonly
	 */
	isRunning: false,

	/**
	 * Whether or not the tunnel is currently starting up.
	 *
	 * @type {boolean}
	 * @readonly
	 */
	isStarting: false,

	/**
	 * Whether or not the tunnel is currently stopping.
	 *
	 * @type {boolean}
	 * @readonly
	 */
	isStopping: false,

	/**
	 * The path that a WebDriver client should use to access the service provided by the tunnel.
	 *
	 * @type {string}
	 * @default
	 */
	pathname: '/wd/hub/',

	/**
	 * The operating system the tunnel will run on. This information is automatically retrieved for the current
	 * system at runtime.
	 *
	 * @type {string}
	 */
	platform: process.platform,

	/**
	 * The local port where the WebDriver server should be exposed by the tunnel.
	 *
	 * @type {number}
	 * @default
	 */
	port: 4444,

	/**
	 * The protocol (e.g., 'http') that a WebDriver client should use to access the service provided by the tunnel.
	 *
	 * @type {string}
	 * @default
	 */
	protocol: 'http',

	/**
	 * The URL of a proxy server for the tunnel to go through. Only the hostname, port, and auth are used.
	 *
	 * @type {string}
	 */
	proxy: null,

	/**
	 * A unique identifier for the newly created tunnel.
	 *
	 * @type {string=}
	 */
	tunnelId: null,

	/**
	 * The URL where the tunnel software can be downloaded.
	 *
	 * @type {string}
	 */
	url: null,

	/**
	 * Whether or not to tell the tunnel to provide verbose logging output.
	 *
	 * @type {boolean}
	 * @default
	 */
	verbose: false,

	_handles: null,
	_process: null,

	/**
	 * The URL that a WebDriver client should used to interact with this service.
	 *
	 * @member {string} clientUrl
	 * @memberOf module:digdug/Tunnel#
	 * @type {string}
	 * @readonly
	 */
	get clientUrl() {
		return urlUtil.format(this);
	},

	/**
	 * A map of additional capabilities that need to be sent to the provider when a new session is being created.
	 *
	 * @member {string} extraCapabilities
	 * @memberOf module:digdug/Tunnel#
	 * @type {Object}
	 * @readonly
	 */
	get extraCapabilities() {
		return {};
	},

	/**
	 * Whether or not the tunnel software has already been downloaded.
	 *
	 * @member {string} isDownloaded
	 * @memberOf module:digdug/Tunnel#
	 * @type {boolean}
	 * @readonly
	 */
	get isDownloaded() {
		return fs.existsSync(pathUtil.join(this.directory, this.executable));
	},

	/**
	 * Downloads and extracts the tunnel software if it is not already downloaded.
	 *
	 * This method can be extended by implementations to perform any necessary post-processing, such as setting
	 * appropriate file permissions on the downloaded executable.
	 *
	 * @param {boolean} forceDownload Force downloading the software even if it already has been downloaded.
	 * @returns {Promise.<void>} A promise that resolves once the download and extraction process has completed.
	 */
	download: function (forceDownload) {
		var self = this;

		return new Promise(function (resolve, reject, progress, setCanceler) {
			setCanceler(function (reason) {
				request && request.cancel(reason);
			});

			if (!forceDownload && self.isDownloaded) {
				resolve();
				return;
			}

			var request = sendRequest(self.url, { proxy: self.proxy });
			request.then(
				function (response) {
					var decompressor = new Decompress();
					decompressor.src(response.data)
						.use(Decompress.zip())
						.use(Decompress.targz())
						.dest(self.directory)
						.run(function (error) {
							if (error) {
								reject(error);
							}
							else {
								resolve();
							}
						});
				},
				function (error) {
					if (error.response && error.response.statusCode >= 400) {
						error = new Error('Download server returned status code ' + error.response.statusCode);
					}
					reject(error);
				},
				progress
			);

			return request;
		});
	},

	/**
	 * Creates the list of command-line arguments to be passed to the spawned tunnel. Implementations should
	 * override this method to provide the appropriate command-line arguments.
	 *
	 * Arguments passed to {@link module:digdug/Tunnel#_makeChild} will be passed as-is to this method.
	 *
	 * @protected
	 * @returns {string[]} A list of command-line arguments.
	 */
	_makeArgs: function () {
		return [];
	},

	/**
	 * Creates a newly spawned child process for the tunnel software. Implementations should call this method to
	 * create the tunnel process.
	 *
	 * Arguments passed to this method will be passed as-is to {@link module:digdug/Tunnel#_makeArgs} and
	 * {@link module:digdug/Tunnel#_makeOptions}.
	 *
	 * @protected
	 * @returns {{ process: module:ChildProcess, deferred: module:dojo/Deferred }}
	 * An object containing a newly spawned Process and a Deferred that will be resolved once the tunnel has started
	 * successfully.
	 */
	_makeChild: function () {
		function handleChildExit() {
			if (dfd.promise.state === Promise.State.PENDING) {
				var message = 'Tunnel failed to start: ' + (errorMessage || ('Exit code: ' + exitCode));
				dfd.reject(new Error(message));
			}
		}

		var command = this.executable;
		var args = this._makeArgs.apply(this, arguments);
		var options = this._makeOptions.apply(this, arguments);

		var dfd = new Promise.Deferred(function (reason) {
			child.kill('SIGINT');
			return new Promise(function (resolve, reject) {
				child.once('exit', function () {
					reject(reason);
				});
			});
		});
		var child = spawnUtil.spawn(command, args, options);

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		// Detect and reject on common errors, but only until the promise is fulfilled, at which point we should
		// no longer be managing any events since it means the process has started successfully and is underway
		var errorMessage = '';
		var exitCode = null;
		var stderrClosed = false;

		var handles = [
			util.on(child, 'error', dfd.reject.bind(dfd)),
			util.on(child.stderr, 'data', function (data) {
				errorMessage += data;
			}),
			util.on(child, 'exit', function (code) {
				exitCode = code;
				if (stderrClosed) {
					handleChildExit();
				}
			}),
			// stderr might still have data in buffer at the time the exit event is sent, so we have to store data
			// from stderr and the exit code and reject only once stderr closes
			util.on(child.stderr, 'close', function () {
				stderrClosed = true;
				if (exitCode !== null) {
					handleChildExit();
				}
			})
		];

		dfd.promise.then(function () {
			clearHandles(handles);
		}).catch(function () {
			clearHandles(handles);
		});

		return {
			process: child,
			deferred: dfd
		};
	},

	/**
	 * Creates the set of options to use when spawning the tunnel process. Implementations should override this
	 * method to provide the appropriate options for the tunnel software.
	 *
	 * Arguments passed to {@link module:digdug/Tunnel#_makeChild} will be passed as-is to this method.
	 *
	 * @protected
	 * @returns {Object} A set of options matching those provided to Node.js {@link module:child_process.spawn}.
	 */
	_makeOptions: function () {
		return {
			cwd: this.directory,
			env: process.env
		};
	},

	/**
	 * Sends information about a job to the tunnel provider.
	 *
	 * @param {string} jobId The job to send data about. This is usually a session ID.
	 * @param {JobState} data Data to send to the tunnel provider about the job.
	 * @returns {Promise.<void>} A promise that resolves once the job state request is complete.
	 */
	sendJobState: function () {
		var dfd = new Promise.Deferred();
		dfd.reject(new Error('Job state is not supported by this tunnel.'));
		return dfd.promise;
	},

	/**
	 * Starts the tunnel, automatically downloading dependencies if necessary.
	 *
	 * @returns {Promise.<void>} A promise that resolves once the tunnel has been established.
	 */
	start: function () {
		if (this.isRunning) {
			throw new Error('Tunnel is already running');
		}
		else if (this.isStopping) {
			throw new Error('Previous tunnel is still terminating');
		}
		else if (this.isStarting) {
			return this._startTask;
		}

		this.isStarting = true;

		var self = this;
		this._startTask = this
			.download()
			.then(null, null, function (progress) {
				self.emit('downloadprogress', progress);
			})
			.then(function () {
				self._handles = [];
				return self._start();
			})
			.then(function (child) {
				var childProcess = child.process;
				self._process = childProcess;
				self._handles.push(
					util.on(childProcess.stdout, 'data', proxyEvent(self, 'stdout')),
					util.on(childProcess.stderr, 'data', proxyEvent(self, 'stderr')),
					util.on(childProcess, 'exit', function () {
						self.isStarting = false;
						self.isRunning = false;
					})
				);
				return child.deferred.promise;
			});

		this._startTask.then(function () {
			self._startTask = null;
			self.isStarting = false;
			self.isRunning = true;
			self.emit('status', 'Ready');
		}, function (error) {
			self._startTask = null;
			self.isStarting = false;
			self.emit('status', error.name === 'CancelError' ? 'Start cancelled' : 'Failed to start tunnel');
		});

		return this._startTask;
	},

	/**
	 * This method provides the implementation that actually starts the tunnel and any other logic for emitting
	 * events on the Tunnel based on data passed by the tunnel software.
	 *
	 * The default implementation that assumes the tunnel is ready for use once the child process has written to
	 * `stdout` or `stderr`. This method should be reimplemented by other tunnel launchers to implement correct
	 * launch detection logic.
	 *
	 * @protected
	 * @returns {{ process: module:ChildProcess, deferred: module:dojo/Deferred }}
	 * An object containing a reference to the child process, and a Deferred that is resolved once the tunnel is
	 * ready for use. Normally this will be the object returned from a call to `Tunnel#_makeChild`.
	 */
	_start: function () {
		function resolve() {
			clearHandles(handles);
			dfd.resolve();
		}

		var childHandle = this._makeChild();
		var child = childHandle.process;
		var dfd = childHandle.deferred;
		var handles = [
			util.on(child.stdout, 'data', resolve),
			util.on(child.stderr, 'data', resolve),
			util.on(child, 'error', function (error) {
				clearHandles(handles);
				dfd.reject(error);
			})
		];

		return childHandle;
	},

	/**
	 * Stops the tunnel.
	 *
	 * @returns {Promise.<integer>}
	 * A promise that resolves to the exit code for the tunnel once it has been terminated.
	 */
	stop: function () {
		if (this.isStopping) {
			throw new Error('Tunnel is already terminating');
		}
		else if (this.isStarting) {
			this._startTask.cancel();
			return;
		}
		else if (!this.isRunning) {
			throw new Error('Tunnel is not running');
		}

		this.isRunning = false;
		this.isStopping = true;

		var self = this;
		return this._stop().then(function (returnValue) {
			clearHandles(self._handles);
			self._process = self._handles = null;
			self.isRunning = self.isStopping = false;
			return returnValue;
		}, function (error) {
			self.isRunning = true;
			self.isStopping = false;
			throw error;
		});
	},

	/**
	 * This method provides the implementation that actually stops the tunnel.
	 *
	 * The default implementation that assumes the tunnel has been closed once the child process has exited. This
	 * method should be reimplemented by other tunnel launchers to implement correct shutdown logic, if necessary.
	 *
	 * @protected
	 * @returns {Promise.<void>} A promise that resolves once the tunnel has shut down.
	 */
	_stop: function () {
		var dfd = new Promise.Deferred();
		var childProcess = this._process;

		childProcess.once('exit', function (code) {
			dfd.resolve(code);
		});
		childProcess.kill('SIGINT');

		return dfd.promise;
	},

	/**
	 * Get a list of environments available on the service
	 */
	getEnvironments: function () {
		return request(this.getEnvironmentUrl, {
			password: this.accessKey,
			user: this.username,
			proxy: this.proxy
		}).then(function (response) {
			if (response.statusCode >= 200 && response.statusCode < 400) {
				return JSON.parse(response.data.toString());
			}
			else {
				throw new Error('Server replied with a status of ' + response.statusCode);
			}
		});
	},

	/**
	 * @param browser the browser name to filter by
	 *
	 * @return {Promise<U>} a list of unique, numeric versions filtered by browser
	 */
	getVersions: function (browser) {
		function reduceVersions(list, environment) {
			var version = environment.browser_version || environment.version || environment.short_version;

			if (!isNaN(Number(version)) &&
				this._matchEnvironment(environment, browser) &&
				!versionSet.hasOwnProperty(version)) {
				versionSet[version] = environment;
				list.push(version);
			}
			return list;
		}

		var versionSet = {};

		return this.getEnvironments()
			.then(function (environments) {
				return environments
					.reduce(reduceVersions.bind(this), [])
					.sort(this._compareVersionStrings);
			}.bind(this));
	},

	_matchEnvironment: function (environment, browser) {
		var normalizedBrowser = (environment.browser || environment.name || environment.api_name).toLowerCase();

		return browser.toLowerCase() === normalizedBrowser;
	},

	/**
	 * Take a version string which may contain a range or version aliases and returns a list of individual versions
	 * for use with the tunnel service
	 *
	 * Supported version types and ranges:
	 *
	 * single version: 9
	 * ranged version: 9..11
	 * latest keyword: latest
	 * previous keyword: previous
	 * ranged version with alias: 9..latest
	 * mathed version alias: latest-2
	 * ranged mathed version alias: latest-2...latest
	 *
	 * @param versions a version string
	 * @param browser {string} the name of the target browser
	 * @param platform {string} [undefined] An optional platform target
	 * @return {Array<string>} a list of individual version numbers for the specific target
	 */
	parseVersions: function (versions, browser) {
		function splitVersions(versions) {
			versions = versions.split('..').map(function (version) {
				return version.trim();
			});

			if (versions.length > 2) {
				throw new Error('Invalid version syntax');
			}

			return versions;
		}

		function expandVersionRange(left, right, availableVersions) {
			left = parseInt(left, 10);
			right = parseInt(right, 10);
			return availableVersions.filter(function (version) {
				version = parseInt(version, 10);

				return !isNaN(version) && version >= left && version <= right;
			});
		}

		if (!isNaN(Number(versions))) {
			// avoid making an API service call for single version numbers
			return Promise.resolve([ versions ]);
		}

		var self = this;
		return this.getVersions(browser)
			.then(function (availableVersions) {
				versions = splitVersions(versions)
					.map(self._resolveVersionAlias.bind(self, availableVersions))
					.sort(self._compareVersionStrings);

				if (versions.length === 2) {
					versions = expandVersionRange(versions[0], versions[1], availableVersions);
				}

				return versions;
			});
	},

	_resolveVersionAlias: function (versions, version) {
		var pieces = version.split('-').map(function (version) {
			return version.trim();
		});

		if (pieces[0] !== 'previous' && pieces[0] !== 'latest') {
			return version;
		}

		var offset = pieces[0] === 'previous' ? 2 : 1;

		if (pieces.length === 2) {
			offset += Number(pieces[1]);
		}

		if (offset > versions.length) {
			throw new Error(version + ' is out of bounds. Only ' + versions.length + ' available');
		}
		return versions[versions.length - offset];
	},

	_compareVersionStrings: function (a, b) {
		return parseFloat(a) - parseFloat(b);
	}
});

module.exports = Tunnel;
