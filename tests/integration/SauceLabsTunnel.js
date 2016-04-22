define([
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/node!../../SauceLabsTunnel',
	'intern/dojo/Promise'
], function (
	registerSuite,
	assert,
	SauceLabsTunnel,
	Promise
) {
	var tunnel;

	registerSuite({
		name: 'integration/SauceLabsTunnel',

		beforeEach: function () {
			tunnel = new SauceLabsTunnel();
		},

		getEnvironments: function () {
			return tunnel.getEnvironments()
				.then(function (browsers) {
					assert.isArray(browsers);
					browsers.forEach(function (environment) {
						assert.property(environment, 'short_version');
						assert.property(environment, 'long_name');
						assert.property(environment, 'api_name');
						assert.property(environment, 'long_version');
						assert.property(environment, 'latest_stable_version');
						assert.property(environment, 'automation_backend');
						assert.property(environment, 'os');
					});
				});
		},

		parseVersions: (function () {
			var availableVersionsPromise;

			return {
				before: function () {
					availableVersionsPromise = tunnel.getVersions('chrome');
				},

				latest: function () {
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
					return Promise.all([
						tunnel.parseVersions('latest - 2 .. latest', 'chrome'),
						availableVersionsPromise
					]).then(function (results) {
						var versions = results[0];
						var availableVersions = results[1];
						assert.deepEqual(versions, availableVersions.slice(-3));
					});
				}
			};
		}())
	});
});
