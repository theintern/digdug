define([
	'intern!object',
	'intern/chai!assert',
	'./common',
	'intern/dojo/node!../../TestingBotTunnel'
], function (
	registerSuite,
	assert,
	createCommonTests,
	TestingBotTunnel
) {
	function assertTestingBotEnvironment(environment) {
		assert.property(environment, 'selenium_name');
		assert.property(environment, 'name');
		assert.property(environment, 'platform');
		assert.property(environment, 'version');
	}

	var commonTests = createCommonTests(TestingBotTunnel, {
		assertDescriptor: assertTestingBotEnvironment
	});
	commonTests.name = 'integration/TestingBotTunnel';
	registerSuite(commonTests);
});
