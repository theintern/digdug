import TestingBotTunnel from 'src/TestingBotTunnel';
import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';

let tunnel: TestingBotTunnel;

registerSuite({
	name: 'unit/TestingBotTunnel',

	beforeEach: function () {
		tunnel = new TestingBotTunnel();
	},

	'#auth': function () {
		tunnel.apiKey = 'foo';
		tunnel.apiSecret = 'bar';
		assert.equal(tunnel.auth, 'foo:bar');
	}
});
