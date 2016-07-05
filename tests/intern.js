/* jshint dojo:true */
define([
	'intern/dojo/has'
], function (has) {
	if (process.env.TRAVIS_EVENT_TYPE === 'cron' || process.env.INTEGRATION === 'true') {
		has.add('integration', true);
	}

	return {
		proxyPort: 9000,
		proxyUrl: 'http://localhost:9000/',
		maxConcurrency: 3,
		loaderOptions: {
			packages: [
				{ name: 'digdug', location: '.' }
			]
		},
		reporters: [ 'Console' ],
		suites: [ 'digdug/tests/all' ],
		functionalSuites: [],
		excludeInstrumentation: /^(?:tests|node_modules)\//
	};
});
