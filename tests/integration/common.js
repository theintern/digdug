define([
	'intern!object',
	'intern/chai!assert',
	'intern/dojo/Promise'
], function (
	registerSuite,
	assert
) {
	return function (Tunnel, options) {
		options = options || { };
		var metRequirements = false;
		var tunnel = null;
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
							assert.property(environment, 'browserName');
							assert.property(environment, 'version');
							assert.property(environment, 'platform');
							assert.property(environment, 'descriptor');
							options.assertDescriptor(environment.descriptor);
						});
					});
			}
		};
		
		return tests;
	};
});
