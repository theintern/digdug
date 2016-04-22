/* jshint dojo:true */
define([
	'intern/dojo/node!../Tunnel',
	'intern/dojo/node!../SauceLabsTunnel',
	'intern/dojo/node!../BrowserStackTunnel',
	'intern/dojo/node!../TestingBotTunnel',
	'intern/dojo/node!../NullTunnel',
	'intern/dojo/node!fs',
	'intern/dojo/node!path',
	'intern!object',
	'intern/chai!assert',
	'intern',
	'intern/dojo/Promise'
], function (
	Tunnel,
	SauceLabsTunnel,
	BrowserStackTunnel,
	TestingBotTunnel,
	NullTunnel,
	fs,
	pathUtil,
	registerSuite,
	assert,
	intern,
	Promise
) {
	function cleanup(tunnel) {
		if (intern.args.noClean) {
			return;
		}

		function deleteRecursive(dir) {
			var files = [];
			if (fs.existsSync(dir)) {
				files = fs.readdirSync(dir);
				files.forEach(function(file) {
					var path = pathUtil.join(dir, file);
					try {
						if (fs.lstatSync(path).isDirectory()) {
							deleteRecursive(path);
						}
						else {
							fs.unlinkSync(path);
						}
					}
					catch (error) {
						if (error.code !== 'ENOENT') {
							console.warn('Unable to delete ' + path, error);
						}
					}
				});
				fs.rmdirSync(dir);
			}
		}

		deleteRecursive(tunnel.directory);
	}

	function tunnelTest(dfd, tunnel, check) {
		cleanup(tunnel);

		if (intern.args.showStdout) {
			tunnel.on('stdout', console.log);
			tunnel.on('stderr', console.log);
		}

		tunnel.start().then(function () {
			dfd.resolve();
		}).catch(function (error) {
			if (check(error)) {
				dfd.resolve();
			}
			else {
				dfd.reject(error);
			}
		});
	}

	var tunnel;

	registerSuite({
		name: 'digdug',

		afterEach: function () {
			function _cleanup() {
				cleanup(tunnel);
				tunnel = null;
			}

			if (tunnel.isRunning) {
				return tunnel.stop().finally(_cleanup);
			}
			else {
				_cleanup();
			}
		},

		'SauceLabsTunnel': (function () {
			return {
				beforeEach: function() {
					tunnel = new SauceLabsTunnel();
				},

				'#start': function() {
					tunnelTest(this.async(120000), tunnel, function (error) {
						return /Not authorized/.test(error.message);
					});
				},

				'#auth': function () {
					tunnel.username = 'foo';
					tunnel.accessKey = 'bar';
					assert.equal(tunnel.auth, 'foo:bar');
				},

				'#executable': function () {
					tunnel.platform = 'foo';
					assert.equal(tunnel.executable, 'java');

					tunnel.platform = 'osx';
					tunnel.architecture = 'foo';
					var executable = /\.\/sc-\d+\.\d+(?:\.\d+)?-osx\/bin\/sc/;
					assert.match(tunnel.executable, executable);

					tunnel.platform = 'linux';
					assert.equal(tunnel.executable, 'java');

					tunnel.architecture = 'x64';
					executable = /\.\/sc-\d+\.\d+(?:\.\d+)?-linux\/bin\/sc/;
					assert.match(tunnel.executable, executable);

					tunnel.platform = 'win32';
					executable = /\.\/sc-\d+\.\d+(?:\.\d+)?-win32\/bin\/sc\.exe/;
					assert.match(tunnel.executable, executable);
				},

				'#extraCapabilities': function () {
					assert.deepEqual(tunnel.extraCapabilities, {});
					tunnel.tunnelId = 'foo';
					assert.deepEqual(tunnel.extraCapabilities, { 'tunnel-identifier': 'foo' });
				},

				'#isDownloaded': function () {
					tunnel.platform = 'foo';
					assert.isFalse(tunnel.isDownloaded);
				},

				'#url': function () {
					tunnel.platform = 'foo';
					tunnel.architecture = 'bar';
					assert.equal(tunnel.url, 'https://saucelabs.com/downloads/Sauce-Connect-3.1-r32.zip');

					tunnel.platform = 'darwin';
					var url = /https:\/\/saucelabs\.com\/downloads\/sc-\d+\.\d+(?:\.\d+)?-osx\.zip/;
					assert.match(tunnel.url, url);

					tunnel.platform = 'linux';
					tunnel.architecture = 'x64';
					url = /https:\/\/saucelabs\.com\/downloads\/sc-\d+\.\d+(?:\.\d+)?-linux\.tar\.gz/;
					assert.match(tunnel.url, url);
				}
			};
		})(),

		'BrowserStackTunnel': (function () {
			return {
				beforeEach: function () {
					tunnel = new BrowserStackTunnel();
				},

				'#start': function () {
					tunnelTest(this.async(), tunnel, function (error) {
						return /The tunnel reported:/.test(error.message);
					});
				},

				'#auth': function () {
					tunnel.username = 'foo';
					tunnel.accessKey = 'bar';
					assert.equal(tunnel.auth, 'foo:bar');
				},

				'#executable': function () {
					tunnel.platform = 'foo';
					var executable = './BrowserStackLocal';
					assert.equal(tunnel.executable, executable);

					tunnel.platform = 'win32';
					executable = './BrowserStackLocal.exe';
					assert.equal(tunnel.executable, executable);
				},

				'#extraCapabilities': function () {
					var capabilities = { 'browserstack.local': 'true' };
					assert.deepEqual(tunnel.extraCapabilities, capabilities);
					capabilities['browserstack.localIdentifier'] = tunnel.tunnelId = 'foo';
					assert.deepEqual(tunnel.extraCapabilities, capabilities);
				},

				'#url': function () {
					tunnel.platform = 'foo';
					assert.throws(function () {
						tunnel.url;
					});

					var url = 'https://www.browserstack.com/browserstack-local/BrowserStackLocal-';
					tunnel.platform = 'darwin';
					tunnel.architecture = 'x64';
					assert.equal(tunnel.url, url + 'darwin-x64.zip');

					tunnel.platform = 'win32';
					assert.equal(tunnel.url, url + 'win32.zip');

					tunnel.platform = 'linux';
					tunnel.architecture = 'x64';
					assert.equal(tunnel.url, url + 'linux-x64.zip');

					tunnel.architecture = 'ia32';
					assert.equal(tunnel.url, url + 'linux-ia32.zip');
				}
			};
		})(),

		'TestingBotTunnel': (function () {
			return {
				beforeEach: function () {
					tunnel = new TestingBotTunnel();
				},

				'#start': function () {
					tunnelTest(this.async(120000), tunnel, function (error) {
						return /Could not get tunnel info/.test(error.message);
					});
				},

				'#auth': function () {
					tunnel.apiKey = 'foo';
					tunnel.apiSecret = 'bar';
					assert.equal(tunnel.auth, 'foo:bar');
				}
			};
		})(),

		'NullTunnel': function () {
			tunnel = new NullTunnel();
			tunnelTest(this.async(), tunnel, function (error) {
				return /Could not get tunnel info/.test(error.message);
			});
		},

		'Tunnel': (function () {
			return {
				beforeEach: function () {
					tunnel = new Tunnel({ foo: 'bar' });
				},

				'#clientUrl': function () {
					tunnel.port = 4446;
					tunnel.hostname = 'foo.com';
					tunnel.protocol = 'https';
					tunnel.pathname = 'bar/baz/';
					assert.strictEqual(tunnel.clientUrl, 'https://foo.com:4446/bar/baz/');
				},

				'#extraCapabilities': function () {
					assert.deepEqual(tunnel.extraCapabilities, {});
				},

				'#start': function () {
					try {
						tunnel.isRunning = true;
						assert.throws(function () {
							tunnel.start();
						});
						tunnel.isRunning = false;

						tunnel.isStopping = true;
						assert.throws(function () {
							tunnel.start();
						});
						tunnel.isStopping = false;
					}
					finally {
						tunnel.isRunning = false;
						tunnel.isStoppping = false;
						tunnel.isStarting = false;
					}
				},

				'#stop': function () {
					try {
						tunnel.isStopping = true;
						assert.throws(function () {
							tunnel.stop();
						});
						tunnel.isStopping = false;

						tunnel.isStarting = true;
						assert.throws(function () {
							tunnel.stop();
						});
						tunnel.isStarting = false;

						tunnel.isRunning = false;
						assert.throws(function () {
							tunnel.stop();
						});
						tunnel.isRunning = true;
					}
					finally {
						tunnel.isStopping = false;
						tunnel.isStarting = false;
						tunnel.isRunning = false;
					}
				},

				'#sendJobState': function () {
					var dfd = this.async();
					tunnel.sendJobState().catch(function () {
						dfd.resolve();
					});
				},

				'#_resolveVersionAlias': (function () {
					var versions = [
						'0',
						'1',
						'2',
						'3',
						'4'
					];

					return {
						'unknown alias; pass-thru': function () {
							var value = 'unknown';
							assert.strictEqual(tunnel._resolveVersionAlias(versions, value), value);
						},

						'single version; pass-thru': function () {
							assert.strictEqual(tunnel._resolveVersionAlias(versions, '2'), '2');
						},

						'latest': function () {
							assert.strictEqual(tunnel._resolveVersionAlias(versions, 'latest'), '4');
						},

						'previous': function () {
							assert.strictEqual(tunnel._resolveVersionAlias(versions, 'previous'), '3');
						},

						'latest-1': function () {
							var expected = '3';
							assert.strictEqual(tunnel._resolveVersionAlias(versions, 'latest-1'), expected);
							assert.strictEqual(tunnel._resolveVersionAlias(versions, 'latest - 1'), expected);
						},

						'previous-2': function () {
							assert.strictEqual(tunnel._resolveVersionAlias(versions, 'previous-2'), '1');
						},

						'alias out of bounds; throws': function () {
							assert.throws(function () {
								tunnel._resolveVersionAlias(versions, 'latest-100');
							});
						}
					};
				}()),

				'#getVersions': {
					'filters by browser': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{ browser: 'chrome', version: '12' },
								{ browser: 'firefox', version: '13' }
							]);
						};

						return tunnel.getVersions('chrome')
							.then(function (versions) {
								assert.lengthOf(versions, 1);
							});
					},

					'removes duplicate versions': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{ browser: 'chrome', version: '12' },
								{ browser: 'chrome', version: '12' }
							]);
						};

						return tunnel.getVersions('chrome')
							.then(function (versions) {
								assert.lengthOf(versions, 1);
							});
					},

					'removes non-numeric versions': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{ browser: 'chrome', version: '12' },
								{ browser: 'chrome', version: 'beta' },
								{ browser: 'chrome', version: 'dev' }
							]);
						};

						return tunnel.getVersions('chrome')
							.then(function (versions) {
								assert.lengthOf(versions, 1);
								assert.deepEqual(versions, [ '12' ]);
							});
					},

					'sorts versions numerically': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{ browser: 'chrome', version: '13' },
								{ browser: 'chrome', version: '12' }
							]);
						};

						return tunnel.getVersions('chrome')
							.then(function (versions) {
								assert.lengthOf(versions, 2);
								assert.strictEqual(versions[0], '12');
								assert.strictEqual(versions[1], '13');
							});
					},

					'works with BrowserStack APIs': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{
									os: 'Windows',
									os_version: '8.1',
									browser: 'chrome',
									browser_version: '24.0',
									device: null
								},
								{
									os: 'Windows',
									os_version: '8.1',
									browser: 'chrome',
									browser_version: '25.0',
									device: null
								}
							]);
						};

						return tunnel.getVersions('chrome')
							.then(function (versions) {
								assert.lengthOf(versions, 2);
								assert.strictEqual(versions[0], '24.0');
								assert.strictEqual(versions[1], '25.0');
							});
					},

					'works with SauceLab APIs': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{
									selenium_name: 'FF7',
									name: 'firefox',
									platform: 'WIN10',
									version: '7'
								},
								{
									selenium_name: 'FF8',
									name: 'firefox',
									platform: 'WIN10',
									version: '8'
								}
							]);
						};

						return tunnel.getVersions('firefox')
							.then(function (versions) {
								assert.lengthOf(versions, 2);
								assert.strictEqual(versions[0], '7');
								assert.strictEqual(versions[1], '8');
							});
					},

					'works with TestingBot APIs': function () {
						tunnel.getEnvironments = function () {
							return Promise.resolve([
								{
									short_version: '26',
									long_name: 'Firefox',
									api_name: 'firefox',
									long_version: '26.0b2.',
									latest_stable_version: '',
									automation_backend: 'webdriver',
									os: 'Windows 2003'
								},
								{
									short_version: '25',
									long_name: 'Firefox',
									api_name: 'firefox',
									long_version: '25.0b2.',
									latest_stable_version: '',
									automation_backend: 'webdriver',
									os: 'Windows 2003'
								}
							]);
						};

						return tunnel.getVersions('firefox')
							.then(function (versions) {
								assert.lengthOf(versions, 2);
								assert.strictEqual(versions[0], '25');
								assert.strictEqual(versions[1], '26');
							});
					}
				},

				'#parseVersions': (function () {
					return {
						beforeEach: function () {
							tunnel.getEnvironments = function () {
								return Promise.resolve([
									{ browser: 'chrome', version: '13' },
									{ browser: 'chrome', version: '12' },
									{ browser: 'chrome', version: '21' },
									{ browser: 'Chrome', version: '18' },
									{ browser: 'Chrome', version: '19' },
									{ browser: 'firefox', version: '7' },
									{ browser: 'FireFox', version: '25' }
								]);
							};
						},

						'single version; pass-thru': function () {
							return tunnel.parseVersions('14', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '14' ]);
								});
						},

						'ranged version': function () {
							return tunnel.parseVersions('14..22', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '18', '19', '21' ]);
								});
						},

						'latest keyword': function () {
							return tunnel.parseVersions('latest', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '21' ]);
								});
						},

						'previous keyword': function () {
							return tunnel.parseVersions('previous', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '19' ]);
								});
						},

						'ranged version with alias': function () {
							return tunnel.parseVersions('15 .. latest', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '18', '19', '21' ]);
								});
						},

						'mathed version alias': function () {
							return tunnel.parseVersions('latest - 1', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '19' ]);
								});
						},

						'ranged mathed version alias': function () {
							return tunnel.parseVersions('latest - 2 .. latest', 'chrome')
								.then(function (version) {
									assert.deepEqual(version, [ '18', '19', '21' ]);
								});
						}
					};
				}())
			};
		})(),
	});
});
