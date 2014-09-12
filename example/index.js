var SauceLabsTunnel = require('../SauceLabsTunnel');
var rimraf = require('rimraf');
var pathUtil = require('path');
var target = pathUtil.join(__dirname, 'saucelabs');
var tunnel = new SauceLabsTunnel({
	directory: target,
	proxy: 'http://localhost:8888'
});

rimraf(target, function () {
	tunnel.download()
		.then(function () {
			console.log('Download complete');
		}, function (error) {
			console.log('Error:');
			console.log(error);
		}, function (update) {
			if (!update) { return; }
			if (update.type === 'data') {
				console.log('chunk: ' + update.chunk.length + ' loaded: ' + update.loaded + ' total: ' + update.total);
			}
			if (update.type === 'redirect') {
				console.log('redirect: ' + update.location);
			}
		});
});