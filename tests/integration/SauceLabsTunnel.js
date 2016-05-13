define([
	'intern!object',
	'intern/chai!assert',
	'./common',
	'intern/dojo/node!../../SauceLabsTunnel'
], function (
	registerSuite,
	assert,
	createCommonTests,
	SauceLabsTunnel
) {
	function assertSauceLabsEnvironment(environment) {
		assert.property(environment, 'short_version');
		assert.property(environment, 'long_name');
		assert.property(environment, 'api_name');
		assert.property(environment, 'long_version');
		assert.property(environment, 'latest_stable_version');
		assert.property(environment, 'automation_backend');
		assert.property(environment, 'os');
	}

	var commonTests = createCommonTests(SauceLabsTunnel, {
		assertDescriptor: assertSauceLabsEnvironment
	});
	commonTests.name = 'integration/SauceLabsTunnel';
	registerSuite(commonTests);
});
