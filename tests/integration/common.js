define([
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/node!util'
], function (
	registerSuite,
	assert,
	util
) {
	return function (Tunnel, options) {
		options = options || { };
		var metRequirements = false;
		var tunnel = null;

		function assertNormalizedProperties(environment) {
			var message = ' undefined for ' + util.inspect(environment.descriptor);
			assert.isDefined(environment.browserName, 'browserName' + message);
			assert.isDefined(environment.version, 'version', + message);
			assert.isDefined(environment.platform, 'platform' + message);
		}

		var tests = {
			beforeEach: function () {
				tests.tunnel = tunnel = new Tunnel();
				metRequirements = !options.requirementsCheck || options.requirementsCheck(tunnel);
			},

			getEnvironments: function () {
				if (!metRequirements) {
					this.skip(options.missingRequirementsMessage);
					return;
				}
				return tests.tunnel.getEnvironments()
					.then(function (browsers) {
						assert.isArray(browsers);
						browsers.forEach(function (environment) {
							assertNormalizedProperties(environment);
							assert.property(environment, 'descriptor');
							options.assertDescriptor(environment.descriptor);
						});
					});
			}
		};
		
		return tests;
	};
});
