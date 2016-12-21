import SeleniumTunnel from 'src/SeleniumTunnel';
import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';

registerSuite({
	name: 'unit/SeleniumTunnel',

	config: {
		'name only': function () {
			const tunnel = new SeleniumTunnel({ drivers: [ 'chrome' ] });
			assert.isFalse(tunnel.isDownloaded);
		},

		'config object': function () {
			const tunnel = new SeleniumTunnel({
				directory: '.',
				drivers: [ { name: 'chrome', executable: 'README.md' } ]
			});
			Object.defineProperty(tunnel, 'artifact', {
				value: '.'
			});
			assert.isTrue(tunnel.isDownloaded);
		},

		'definition object': function () {
			const tunnel = new SeleniumTunnel({
				directory: '.',
				drivers: [ <any> { executable: 'README.md' } ]
			});
			Object.defineProperty(tunnel, 'artifact', {
				value: '.'
			});
			assert.isTrue(tunnel.isDownloaded);
		},

		'invalid name': function () {
			assert.throws(function () {
				const tunnel = new SeleniumTunnel({ drivers: <any> [ 'foo' ] });
				tunnel.isDownloaded;
			}, /Invalid driver/);
		},

		'config object with invalid name': function () {
			assert.throws(function () {
				const tunnel = new SeleniumTunnel({ drivers: [ { name: 'foo' } ] });
				tunnel.isDownloaded;
			}, /Invalid driver/);
		}
	}
});
