import Tunnel from 'src/Tunnel';
import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';
import Test = require('intern/lib/Test');
import Task from 'dojo-core/async/Task';

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
			(<any> tunnel)._state = 'running';
			assert.throws(function () {
				tunnel.start();
			});

			(<any> tunnel)._state = 'stopping';
			assert.throws(function () {
				tunnel.start();
			});
		}
		finally {
			(<any> tunnel)._state = 'stopped';
		}
	},

	'#stop': {
		'stop a stopping tunnel'() {
			(<any> tunnel)._state = 'stopping';
			return tunnel.stop();
		},

		'stop a starting tunnnel'() {
			let timeout: NodeJS.Timer;
			const startTask = new Task(
				resolve => {
					timeout = setTimeout(resolve, 500);
				},
				() => {
					clearTimeout(timeout);
				}
			);
			(<any> tunnel)['_state'] = 'starting';
			(<any> tunnel)['_startTask'] = startTask;
			(<any> tunnel)['_stop'] = () => Promise.resolve(0);
			return tunnel.stop();
		},

		'stop a tunnel that is not running; throws'() {
			(<any> tunnel)['_state'] = 'stopped';
			(<any> tunnel)['_stop'] = () => Promise.resolve(0);
			(<any> tunnel)['_handle'] = { destroy() {} };
			return tunnel.stop();
		}
	},

	'#sendJobState': function (this: Test) {
		const dfd = this.async();
		tunnel.sendJobState('0', { success: true }).catch(function () {
			dfd.resolve();
		});
	}
});
