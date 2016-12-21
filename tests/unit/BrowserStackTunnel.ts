import BrowserStackTunnel from 'src/BrowserStackTunnel';
import * as registerSuite from 'intern!object';
import * as assert from 'intern/chai!assert';

let tunnel: BrowserStackTunnel;

registerSuite({
	name: 'unit/BrowserStackTunnel',

	beforeEach() {
		tunnel = new BrowserStackTunnel();
	},

	'#auth'() {
		tunnel.username = 'foo';
		tunnel.accessKey = 'bar';
		assert.equal(tunnel.auth, 'foo:bar');
	},

	'#executable'() {
		tunnel.platform = 'foo';
		let executable = './BrowserStackLocal';
		assert.equal(tunnel.executable, executable);

		tunnel.platform = 'win32';
		executable = './BrowserStackLocal.exe';
		assert.equal(tunnel.executable, executable);
	},

	'#extraCapabilities'() {
		const capabilities: any = { 'browserstack.local': 'true' };
		assert.deepEqual(tunnel.extraCapabilities, capabilities);
		capabilities['browserstack.localIdentifier'] = tunnel.tunnelId = 'foo';
		assert.deepEqual(tunnel.extraCapabilities, capabilities);
	},

	'#url'() {
		tunnel.platform = 'foo';
		assert.throws(function () {
			tunnel.url;
		});

		let url = 'https://www.browserstack.com/browserstack-local/BrowserStackLocal-';
		tunnel.platform = 'darwin';
		tunnel.architecture = 'x64';
		assert.equal(tunnel.url, url + 'darwin-x64.zip');

		tunnel.platform = 'win32';
		assert.equal(tunnel.url, url + 'win32.zip');

		tunnel.platform = 'linux';
		tunnel.architecture = 'x64';
		assert.equal(tunnel.url, url + 'linux-x64.zip');

		tunnel.architecture = 'ia32';
		assert.equal(tunnel.url, url + 'linux-ia32.zip');
	}
});
