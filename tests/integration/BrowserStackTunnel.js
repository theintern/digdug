define([
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/node!../../BrowserStackTunnel',
	'intern/dojo/Promise'
], function (
	registerSuite,
	assert,
	BrowserStackTunnel,
	Promise
) {
	var tunnel;
	var missingCredentials;

	registerSuite({
		name: 'integration/BrowserStack',

		beforeEach: function () {
			tunnel = new BrowserStackTunnel();
			missingCredentials = !tunnel.accessKey || !tunnel.username;
		},

		getEnvironments: function () {
			if (missingCredentials) {
				this.skip('missing credentials. Please provide BrowserStack credentials with the ' +
					'BROWSERSTACK_ACCESS_KEY and BROWSERSTACK_USERNAME environment variables');
				return;
			}
			return tunnel.getEnvironments()
				.then(function (browsers) {
					assert.isArray(browsers);
					browsers.forEach(function (environment) {
						assert.property(environment, 'os_version');
						assert.property(environment, 'browser');
						assert.property(environment, 'os');
						assert.property(environment, 'device');
						assert.property(environment, 'browser_version');
					});
				});
		},

		parseVersions: (function () {
			var availableVersionsPromise;

			return {
				before: function () {
					if (!missingCredentials) {
						availableVersionsPromise = tunnel.getVersions('chrome');
					}
				},

				latest: function () {
					if (missingCredentials) {
						this.skip('missing credentials. Please provide BrowserStack credentials with the ' +
							'BROWSERSTACK_ACCESS_KEY and BROWSERSTACK_USERNAME environment variables');
						return;
					}

					return Promise.all([
						tunnel.parseVersions('latest', 'chrome'),
						availableVersionsPromise
					]).then(function (results) {
						var versions = results[0];
						var availableVersions = results[1];
						assert.lengthOf(versions, 1);
						assert.deepEqual(versions, availableVersions.slice(-1));
					});
				},

				'latest - 2 .. latest': function () {
					if (missingCredentials) {
						this.skip('missing credentials. Please provide BrowserStack credentials with the ' +
							'BROWSERSTACK_ACCESS_KEY and BROWSERSTACK_USERNAME environment variables');
						return;
					}

					return Promise.all([
						tunnel.parseVersions('latest - 2 .. latest', 'chrome'),
						availableVersionsPromise
					]).then(function (results) {
						var versions = results[0];
						var availableVersions = results[1];
						assert.lengthOf(versions, 3);
						assert.deepEqual(versions, availableVersions.slice(-3));
					});
				}
			};
		}())
	});
});
