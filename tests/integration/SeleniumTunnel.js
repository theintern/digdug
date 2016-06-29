define([
	'intern',
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/node!../../SeleniumTunnel',
	'intern/dojo/node!../../seleniumDescriptors',
	'intern/dojo/node!fs',
	'../support/cleanup'
], function (
	intern,
	registerSuite,
	assert,
	SeleniumTunnel,
	descriptors,
	fs,
	cleanupDirectory
) {
	var tunnel;

	function assertFiles(tunnel, expected) {
		return function () {
			var files = fs.readdirSync(tunnel.directory);
			assert.sameMembers(expected, files);
		};
	}

	function cleanup(tunnel) {
		tunnel && cleanupDirectory(tunnel);
	}

	registerSuite({
		name: 'integration/SeleniumTunnel',
		
		beforeEach: function (test) {
			test.timeout = 10 * 60 * 1000; // ten minutes
		},

		afterEach: function () {
			cleanup(tunnel);

			if (tunnel && tunnel.isRunning) {
				tunnel.stop();
			}
		},

		'isDownloaded': {
			'returns false when files are missing': function () {
				if (intern.args.noClean) {
					return this.skip('Cleanup is disabled');
				}
				tunnel = new SeleniumTunnel();
				cleanup(tunnel);

				assert.isFalse(tunnel.isDownloaded);
			}
		},

		'download': {
			'downloads missing files': function () {
				var selenuimDesc = new descriptors.SeleniumConfig();
				var chromeDesc = new descriptors.drivers.chrome();
				var expected = [ selenuimDesc.executable, chromeDesc.executable ];

				tunnel = new SeleniumTunnel();

				return tunnel.download()
					.then(assertFiles(tunnel, expected));
			}
		},

		'start': {
			'runs selenium-standalone': function () {
				tunnel = new SeleniumTunnel({
					port: 4445
				});

				return tunnel.start();
			}
		},

		'stop': {
			beforeEach: function () {
				tunnel = new SeleniumTunnel({
					port: 4445
				});

				return tunnel.start()
					.then(function () {
						return tunnel._assertStarted();
					});
			},

			'shuts down a running selenium': function () {
				return tunnel.stop()
					.then(function () {
						return tunnel._assertStarted()
							.then(function () {
								throw new Error('tunnel is still running');
							}, function () {
								return true;
							});
					});
			}
		}
	});
});
