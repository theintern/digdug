define([
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/node!../../TestingBotTunnel',
	'intern/dojo/Promise'
], function (
	registerSuite,
	assert,
	TestingBotTunnel,
	Promise
) {
	var tunnel;

	registerSuite({
		name: 'integration/TestingBotTunnel',

		beforeEach: function () {
			tunnel = new TestingBotTunnel();
		},

		getEnvironments: function () {
			return tunnel.getEnvironments()
				.then(function (browsers) {
					assert.isArray(browsers);
					browsers.forEach(function (environment) {
						assert.property(environment, 'selenium_name');
						assert.property(environment, 'name');
						assert.property(environment, 'platform');
						assert.property(environment, 'version');
					});
				});
		},

		parseVersions: (function () {
			var availableVersionsPromise;

			return {
				before: function () {
					availableVersionsPromise = tunnel.getVersions('firefox');
				},

				latest: function () {
					return Promise.all([
						tunnel.parseVersions('latest', 'firefox'),
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
						tunnel.parseVersions('latest - 2 .. latest', 'firefox'),
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
