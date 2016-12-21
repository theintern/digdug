import Tunnel from 'src/Tunnel';
import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import Test = require('intern/lib/Test');

let tunnel: Tunnel;

registerSuite({
	name: 'unit/Tunnel',

	beforeEach: function () {
		tunnel = new Tunnel(<any> { foo: 'bar' });
	},

	'#clientUrl': function () {
		tunnel.port = '4446';
		tunnel.hostname = 'foo.com';
		tunnel.protocol = 'https';
		tunnel.pathname = 'bar/baz/';
		assert.strictEqual(tunnel.clientUrl, 'https://foo.com:4446/bar/baz/');
	},

	'#extraCapabilities': function () {
		assert.deepEqual(tunnel.extraCapabilities, {});
	},

	'#start': function () {
		try {
			tunnel.isRunning = true;
			assert.throws(function () {
				tunnel.start();
			});
			tunnel.isRunning = false;

			tunnel.isStopping = true;
			assert.throws(function () {
				tunnel.start();
			});
			tunnel.isStopping = false;
		}
		finally {
			tunnel.isRunning = false;
			tunnel.isStopping = false;
			tunnel.isStarting = false;
		}
	},

	'#stop': function () {
		try {
			tunnel.isStopping = true;
			assert.throws(function () {
				tunnel.stop();
			});
			tunnel.isStopping = false;

			tunnel.isStarting = true;
			assert.throws(function () {
				tunnel.stop();
			});
			tunnel.isStarting = false;

			tunnel.isRunning = false;
			assert.throws(function () {
				tunnel.stop();
			});
			tunnel.isRunning = true;
		}
		finally {
			tunnel.isStopping = false;
			tunnel.isStarting = false;
			tunnel.isRunning = false;
		}
	},

	'#sendJobState': function (this: Test) {
		const dfd = this.async();
		tunnel.sendJobState('0', { success: true }).catch(function () {
			dfd.resolve();
		});
	}
});
